/**
 * app/api/account/route.js — xoá tài khoản vĩnh viễn.
 *
 *   DELETE /api/account   (Authorization: Bearer <access_token>)
 *   -> 200 { success: true }
 *
 * Quyền sở hữu KHÔNG lấy từ body: id người bị xoá luôn là id giải mã được từ
 * chính token. Nhờ vậy không tồn tại đường nào để gửi id của người khác vào —
 * đây cũng là lý do route không nhận tham số nào cả.
 *
 * Không cần chống CSRF riêng: xác thực bằng Bearer token đọc từ localStorage /
 * AsyncStorage chứ không phải cookie, nên trình duyệt không tự đính kèm thông
 * tin đăng nhập vào request từ site khác.
 */
import { NextResponse } from 'next/server';

import { authenticateToken } from '../../../lib/auth-middleware.js';
import { deleteUserAccount, AccountDeletionError } from '../../../lib/account-deletion.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 60;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function DELETE(request) {
  const user = await authenticateToken(request);
  if (!user) {
    return corsJson(NextResponse, { success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await deleteUserAccount(user.id);
    return corsJson(NextResponse, { success: true, deleted: result.stats, images: result.images });
  } catch (err) {
    const status = err instanceof AccountDeletionError ? err.status : 500;
    if (status >= 500) console.error('[api/account] DELETE lỗi:', err);
    return corsJson(
      NextResponse,
      { success: false, error: String(err?.message || err) },
      { status }
    );
  }
}

/**
 * Vài môi trường (proxy doanh nghiệp, WebView cũ) chặn method DELETE. Cho phép
 * POST kèm action rõ ràng làm đường vòng, đi qua ĐÚNG handler ở trên nên không
 * có nhánh xử lý thứ hai để lệch nhau.
 */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (body?.action !== 'delete_account') {
    return corsJson(NextResponse, { success: false, error: 'action không hợp lệ' }, { status: 400 });
  }
  return DELETE(request);
}
