/**
 * scripts/backfill-source-name.mjs — điền `source_name` cho thực đơn hệ thống
 * ĐÃ seed, để thẻ thư viện tra được logo đơn vị phát hành.
 *
 *   node scripts/backfill-source-name.mjs           # dry-run (mặc định)
 *   node scripts/backfill-source-name.mjs --apply
 *
 * Vì sao KHÔNG bảo chạy lại `seed --apply --force`:
 *   seed --force XOÁ rồi CHÈN LẠI từng thực đơn, nên id đổi hết. Mà
 *   weekly_menu_plans.source_template_id tham chiếu tới id đó với
 *   `on delete set null` — mọi kế hoạch đang chạy của người dùng sẽ mất liên
 *   kết về thực đơn gốc, kéo theo nút "Đang sử dụng" và chức năng tạo lại
 *   thực đơn hỏng theo. Backfill chỉ UPDATE một cột, không đụng id.
 *
 * Nguồn suy ra tên đơn vị: tiêu đề do seed đặt theo đúng khuôn
 *   "Thực đơn {bệnh lý} — {Đơn vị}"
 * nên phần sau dấu "—" chính là tên đơn vị. Bản nào không khớp khuôn thì BỎ
 * QUA và báo ra, chứ không đoán bừa — gán sai logo là ghi sai nguồn tài liệu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
loadEnv(path.join(ROOT, '.env.local'));

const { sourceLogo } = await import('../lib/family-menu/source-logos.js');

const APPLY = process.argv.includes('--apply');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local');
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

console.log(APPLY ? '\n*** CHẾ ĐỘ GHI (--apply) ***\n' : '\n--- DRY RUN: không ghi gì. Thêm --apply để thực thi. ---\n');

const { data: rows, error } = await sb
  .from('menu_templates')
  .select('id, title, source, source_name, is_system')
  .eq('is_system', true);
if (error) fail(`Đọc menu_templates lỗi: ${error.message}. Đã chạy migrations/menu_source_name.sql chưa?`);

let filled = 0; let already = 0; let noMatch = 0; let noLogo = 0;

for (const row of rows || []) {
  if (row.source_name) { already++; continue; }

  const name = publisherFromTitle(row.title);
  if (!name) {
    noMatch++;
    console.log(`  BỎ    ${pad(row.title, 52)} không tách được tên đơn vị`);
    continue;
  }

  const logo = sourceLogo(name);
  if (!logo) noLogo++;
  filled++;
  console.log(`  ${logo ? 'ĐIỀN ' : 'ĐIỀN?'} ${pad(row.title, 52)} → ${pad(name, 30)} ${logo ? logo.split('/').pop() : '(chưa có logo)'}`);

  if (!APPLY) continue;
  const { error: upErr } = await sb.from('menu_templates').update({ source_name: name }).eq('id', row.id);
  if (upErr) fail(`Cập nhật "${row.title}" lỗi: ${upErr.message}`);
}

console.log(`\n  điền ${filled} · đã có sẵn ${already} · không tách được tên ${noMatch} · điền nhưng chưa có logo ${noLogo} · tổng ${rows?.length || 0}`);
if (!APPLY) console.log('\n  Chạy lại với --apply để ghi vào Supabase.');
console.log('');

/* ───────────────────────── helpers ───────────────────────── */

/** "Thực đơn tiểu đường — Medlatec" → "Medlatec". Không khớp khuôn ⇒ null. */
function publisherFromTitle(title) {
  const s = String(title || '').trim();
  // Em dash là ký tự seed dùng; chấp nhận cả gạch ngang thường cho chắc.
  const parts = s.split(/\s+[—–-]\s+/);
  if (parts.length < 2) return null;
  const name = parts[parts.length - 1].trim();
  return name.length >= 2 ? name : null;
}

function pad(v, n) {
  return String(v).padEnd(n).slice(0, n);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}
