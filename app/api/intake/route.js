// app/api/intake/route.js — đồng bộ "đã ăn / bỏ bữa / món thêm" giữa web và app.
//
//   GET  /api/intake        -> { success, intake }
//   POST /api/intake        body { intake } -> { success, intake }  (đã trộn)
//
// Dữ liệu này trước đây chỉ nằm trong máy (localStorage ở web, AsyncStorage ở
// app) nên hai nền tảng không thấy nhau. Route này là chỗ duy nhất cả hai cùng
// đọc/ghi. Hình dạng giữ NGUYÊN như client vẫn dùng — xem migrations/
// user_intake_sync.sql.
import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 10;

/** Số ngày giữ lại. Bản ghi chỉ có thêm chứ không bao giờ tự bớt, mà giao diện
 *  cũng chỉ dùng tới 7 ngày gần nhất — giữ 60 ngày là quá đủ cho thống kê tuần
 *  mà không để cột jsonb phình vô hạn theo năm tháng. */
const KEEP_DAYS = 60;

const ok = (body, status = 200) => corsJson(NextResponse, { success: true, ...body }, { status });
const fail = (status, error) => corsJson(NextResponse, { success: false, error }, { status });

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

async function requireUser(request) {
  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) return { error: fail(401, 'Thiếu token') };
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: fail(401, 'Token không hợp lệ') };
  return { user };
}

/** "YYYY-MM-DD" của N ngày trước, theo giờ MÁY CHỦ — chỉ dùng để cắt bớt bản
 *  ghi quá cũ nên lệch múi giờ một ngày cũng không ảnh hưởng gì. */
function cutoffKey(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Trộn hai bản intake theo TỪNG NGÀY, bản có `_ts` mới hơn thắng.
 *
 * Chốt theo ngày chứ không theo cả object: nếu lấy cả cụm thì điện thoại sửa
 * hôm nay sẽ ghi đè luôn bản ghi hôm qua mà web vừa nhập.
 *
 * Không hợp nhất ở mức từng khoá (union các key `eaten`) vì như vậy thao tác
 * BỎ TICK sẽ không bao giờ lan được sang máy kia — khoá đã xoá ở máy này lại
 * được máy kia mang về. Lấy trọn bản ghi của ngày mới hơn là đúng ý người dùng
 * hơn: thao tác gần nhất thắng.
 */
function mergeIntake(serverSide, clientSide) {
  const out = { ...(serverSide || {}) };
  for (const [day, rec] of Object.entries(clientSide || {})) {
    if (!rec || typeof rec !== 'object') continue;
    const mine = Number(rec._ts) || 0;
    const theirs = Number(out[day]?._ts) || 0;
    if (!out[day] || mine >= theirs) out[day] = rec;
  }
  // Cắt bản ghi quá cũ.
  const cutoff = cutoffKey(KEEP_DAYS);
  for (const day of Object.keys(out)) if (day < cutoff) delete out[day];
  return out;
}

export async function GET(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const { data, error: dbErr } = await supabase
    .from('profiles').select('intake').eq('id', user.id).single();
  if (dbErr) return fail(500, dbErr.message);
  return ok({ intake: data?.intake || {} });
}

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const incoming = body?.intake;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return fail(400, 'intake phải là object { "YYYY-MM-DD": {...} }');
  }

  const { data: row, error: readErr } = await supabase
    .from('profiles').select('intake').eq('id', user.id).single();
  if (readErr) return fail(500, readErr.message);

  const merged = mergeIntake(row?.intake || {}, incoming);

  const { error: upErr } = await supabase
    .from('profiles').update({ intake: merged }).eq('id', user.id);
  if (upErr) return fail(500, upErr.message);

  // Trả bản ĐÃ TRỘN để client ghi đè lại kho cục bộ — nhờ vậy máy vừa gửi cũng
  // nhận được ngay những ngày mà máy kia đã nhập.
  return ok({ intake: merged });
}
