/**
 * scripts/backfill-menu-categories.mjs — điền `category` cho thực đơn còn trống.
 *
 *   node scripts/backfill-menu-categories.mjs          # dry-run (mặc định)
 *   node scripts/backfill-menu-categories.mjs --apply
 *   node scripts/backfill-menu-categories.mjs --apply --force   # tính lại TẤT CẢ
 *
 * Thư viện lọc theo danh mục, nên dòng nào `category` null sẽ rơi hết vào
 * "Khác". Hai đường tạo thực đơn nay tự suy danh mục, script này để dọn các
 * dòng cũ — và để tính lại toàn bộ (`--force`) mỗi khi categoryFromName được
 * sửa (đã từng có bug bỏ sót dấu "_" khiến 2 dòng rơi nhầm nhóm).
 *
 * Deterministic: chỉ đọc tiêu đề, không AI, không mạng ngoài Supabase.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { categoryFromName, getCategory } from '../lib/family-menu/menu-categories.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env.local'));

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local');
  process.exit(1);
}
const db = createClient(url, key);

let q = db.from('menu_templates').select('id, title, category').order('title');
if (!FORCE) q = q.is('category', null);

const { data, error } = await q;
if (error) {
  console.error('Truy vấn hỏng:', error.message);
  process.exit(1);
}

console.log(APPLY ? '=== GHI THẬT ===' : '=== DRY-RUN (thêm --apply để ghi) ===');

let changed = 0;
let failed = 0;
for (const t of data) {
  const next = categoryFromName(t.title);
  if (next === t.category) continue;                 // --force: bỏ qua dòng đã đúng
  const from = t.category ? getCategory(t.category).label : '(trống)';
  console.log(`  ${clip(t.title, 50).padEnd(52)} ${from} → ${getCategory(next).label}`);
  if (APPLY) {
    const { error: e } = await db.from('menu_templates').update({ category: next }).eq('id', t.id);
    if (e) { console.error(`     LỖI: ${e.message}`); failed += 1; continue; }
  }
  changed += 1;
}

console.log(`\nxét ${data.length} thực đơn — ${APPLY ? 'đã đổi' : 'sẽ đổi'} ${changed}${failed ? `, lỗi ${failed}` : ''}.`);
if (!APPLY && changed) console.log('Chạy lại kèm --apply để ghi.');
process.exit(failed ? 1 : 0);

function clip(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/** .env.local tối giản — cùng cách đọc với scripts/seed-reference-menus.mjs. */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    const k = trimmed.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}
