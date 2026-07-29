/**
 * scripts/verify-account-deletion.mjs — soát "không bảng nào bị bỏ sót".
 *
 *   npm run verify:account-deletion
 *
 * Xoá tài khoản mà quên một bảng nghĩa là dữ liệu cá nhân ở lại sau khi người
 * dùng đã yêu cầu xoá — vi phạm chính sách Google Play và cũng là chuyện không
 * ai phát hiện ra cho tới lúc quá muộn. Nguy hiểm nhất là kịch bản thêm bảng
 * mới có cột user_id vào tháng sau rồi quên cập nhật hàm SQL.
 *
 * Script dò TỪNG BẢNG trên DB thật xem có cột trỏ tới người dùng không, rồi đối
 * chiếu với migrations/account_deletion.sql. Bảng nào có cột người dùng mà
 * không được nhắc tới trong migration ⇒ FAIL.
 *
 * Chỉ ĐỌC. Không xoá gì, không cần tài khoản thử.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env.local'));

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local');
  process.exit(1);
}
const db = createClient(url, key);

/**
 * Cột được coi là "trỏ tới một con người cụ thể".
 *
 * `email` nằm trong danh sách vì có bảng định danh người dùng bằng email chứ
 * không bằng uuid — household_invites là một ví dụ đã suýt lọt lưới: bảng rỗng
 * nên không đọc được cột, và không có user_id nên quét theo id cũng không thấy.
 */
const USER_COLUMNS = [
  'user_id', 'owner_id', 'created_by', 'uploaded_by', 'updated_by', 'decided_by',
  'email', 'uploaded_by_email',
];

/**
 * Bảng rỗng thì PostgREST không trả được tên cột, nên khai thẳng ở đây những
 * bảng ta ĐÃ BIẾT là có giữ dữ liệu người dùng. Thiếu phần này thì một bảng
 * rỗng mang cột email sẽ trôi qua diện "bỏ qua" mà không ai để ý.
 */
const KNOWN_USER_TABLES = {
  household_invites: ['email'],
  household_notifications: ['user_id'],
  survey_responses: ['user_id'],
  ingredient_prices: ['updated_by'],
};

/**
 * Bảng có cột người dùng nhưng CỐ Ý không xử lý theo user — kèm lý do.
 * Danh sách này phải luôn có lý do, để lần sau đọc lại biết vì sao.
 */
const INTENTIONAL = {
  account_deletion_log:
    'chính là nhật ký xoá — phải sống lâu hơn người dùng, không có FK tới auth.users',
};

/** Bảng dọn theo dây chuyền khoá ngoại, không cần lệnh delete riêng. */
const VIA_CASCADE = {
  household_members: 'households (chủ hộ) + delete tường minh cho tư cách thành viên',
  weekly_menu_plans: 'households',
  plan_days: 'weekly_menu_plans', plan_meals: 'plan_days',
  plan_dishes: 'plan_meals', plan_dish_ingredients: 'plan_dishes',
  shopping_lists: 'weekly_menu_plans', shopping_list_items: 'shopping_lists',
  menu_adjustment_audit: 'weekly_menu_plans',
  survey_answers: 'survey_responses',
  menu_template_days: 'menu_templates', menu_template_meals: 'menu_template_days',
  menu_template_dishes: 'menu_template_meals', menu_template_dish_ingredients: 'menu_template_dishes',
};

/** Mọi bảng public mà mã nguồn có đụng tới, gom từ chính code. */
function tablesFromSource() {
  const found = new Set();
  const RE = /\.from\(\s*['"`]([a-z_]+)['"`]/g;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|mjs|jsx)$/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      let m;
      while ((m = RE.exec(src))) found.add(m[1]);
    }
  };
  for (const d of ['app', 'lib', 'scripts']) walk(path.join(ROOT, d));

  return found;
}

/** Bảng khai trong migrations (kể cả bảng code chưa đụng tới). */
function tablesFromMigrations() {
  const found = new Set();
  const RE = /create table (?:if not exists )?(?:public\.)?([a-z_]+)/gi;
  const dir = path.join(ROOT, 'migrations');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    let m;
    while ((m = RE.exec(src))) found.add(m[1]);
  }
  return found;
}

const deletionSql = fs.readFileSync(path.join(ROOT, 'migrations', 'account_deletion.sql'), 'utf8');

const tables = [...new Set([...tablesFromSource(), ...tablesFromMigrations()])].sort();

let pass = 0;
let fail = 0;
const skipped = [];

console.log(`\n=== soát ${tables.length} bảng ===\n`);

for (const table of tables) {
  const { data, error } = await db.from(table).select('*').limit(1);
  if (error) {
    // Bảng không tồn tại (tên bắt nhầm từ regex) — bỏ qua, không tính là lỗi.
    skipped.push(`${table} (${error.message.slice(0, 40)})`);
    continue;
  }
  // Bảng rỗng thì không đọc được cột từ dữ liệu — lùi về danh sách khai sẵn.
  const cols = data.length ? Object.keys(data[0]) : (KNOWN_USER_TABLES[table] || null);
  if (!cols) {
    const mentioned = new RegExp(`\\b${table}\\b`).test(deletionSql);
    if (mentioned || INTENTIONAL[table] || VIA_CASCADE[table]) { pass += 1; continue; }
    skipped.push(`${table} (rỗng, chưa khai trong KNOWN_USER_TABLES)`);
    continue;
  }

  const userCols = USER_COLUMNS.filter((c) => cols.includes(c));
  if (!userCols.length) { pass += 1; continue; }   // không giữ dữ liệu người dùng

  const mentioned = new RegExp(`\\b${table}\\b`).test(deletionSql);
  if (mentioned) {
    pass += 1;
    console.log(`  PASS  ${table.padEnd(32)} [${userCols.join(', ')}] có trong hàm xoá`);
  } else if (INTENTIONAL[table]) {
    pass += 1;
    console.log(`  PASS  ${table.padEnd(32)} bỏ qua có chủ đích — ${INTENTIONAL[table]}`);
  } else if (VIA_CASCADE[table]) {
    pass += 1;
    console.log(`  PASS  ${table.padEnd(32)} dọn theo cascade từ ${VIA_CASCADE[table]}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${table.padEnd(32)} [${userCols.join(', ')}] KHÔNG được xử lý trong account_deletion.sql`);
  }
}

if (skipped.length) {
  console.log(`\nbỏ qua ${skipped.length}: ${skipped.join(', ')}`);
}

/* ── kiểm tra hàm SQL đã được cài trên DB chưa ─────────────────────────── */
console.log('\n=== hàm delete_user_account trên DB ===');
{
  // Gọi với uuid không tồn tại: hàm phải chạy trót lọt và trả về jsonb thống kê
  // toàn số 0. Đây cũng chính là bài kiểm tra tính idempotent.
  const ghost = '00000000-0000-0000-0000-000000000000';
  const { data, error } = await db.rpc('delete_user_account', { p_user_id: ghost });
  if (error) {
    fail += 1;
    console.log(`  FAIL  gọi hàm lỗi: ${error.message}`);
    console.log('        → chạy migrations/account_deletion.sql trong Supabase SQL Editor.');
  } else {
    pass += 1;
    console.log(`  PASS  user không tồn tại ⇒ không lỗi, trả về ${JSON.stringify(data)}`);

    const { data: logs } = await db
      .from('account_deletion_log').select('user_id').eq('user_id', ghost);
    if (logs?.length) {
      pass += 1;
      console.log(`  PASS  có ghi nhật ký xoá (${logs.length} dòng cho uuid thử)`);
      await db.from('account_deletion_log').delete().eq('user_id', ghost);
      console.log('        (đã dọn dòng thử)');
    } else {
      fail += 1;
      console.log('  FAIL  không ghi được vào account_deletion_log');
    }
  }
}

console.log(`\n${pass}/${pass + fail} mục đạt${fail ? ` — ${fail} MỤC SAI` : ''}\n`);
process.exit(fail ? 1 : 0);

/** .env.local tối giản — cùng cách đọc với các script khác trong scripts/. */
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
