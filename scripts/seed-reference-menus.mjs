/**
 * scripts/seed-reference-menus.mjs — nạp "Thực đơn mẫu"/*.xlsx vào menu_templates.
 *
 *   node scripts/seed-reference-menus.mjs              # dry-run (mặc định)
 *   node scripts/seed-reference-menus.mjs --apply
 *   node scripts/seed-reference-menus.mjs --apply --force   # ghi đè bản đã seed
 *   node scripts/seed-reference-menus.mjs --apply --limit 10
 *
 * Thư viện thực đơn trước đây gần như trống vì 44 file này chưa từng được nhập.
 * Seed dưới dạng public + is_system=true: mọi người xem/áp dụng được, chỉ admin
 * mới sửa/xoá.
 *
 * Idempotent: nhận diện bản đã seed qua `source = 'reference:<slug>'`. Chạy lại
 * phải báo 0 thêm mới. Cần migrations/menu_template_meta.sql chạy trước.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
loadEnv(path.join(ROOT, '.env.local'));

const { importMenuWorkbook } = await import('../lib/excel/import/index.js');
const { categoryFromName, getCategory } = await import('../lib/family-menu/menu-categories.js');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const SRC = valueOf('--src') || path.join(ROOT, 'Thực đơn mẫu');
const LIMIT = Number(valueOf('--limit') || 0);

const MIN_DAYS = 5;
const MIN_DISHES = 10;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local');
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

await requireColumn('menu_templates', 'is_system', 'migrations/menu_template_meta.sql');

console.log(APPLY ? '\n*** CHẾ ĐỘ GHI (--apply) ***\n' : '\n--- DRY RUN: không ghi gì. Thêm --apply để thực thi. ---\n');

const { data: existingRows } = await sb.from('menu_templates').select('id, source').eq('is_system', true);
const existing = new Map((existingRows || []).map((r) => [r.source, r.id]));

let files = fs.readdirSync(SRC).filter((f) => /\.xlsx?m?$/i.test(f)).sort();
if (LIMIT) files = files.slice(0, LIMIT);

let added = 0; let skipped = 0; let failed = 0; let totalDishes = 0;

for (const file of files) {
  const source = `reference:${slug(file)}`;
  if (existing.has(source) && !FORCE) { skipped++; continue; }

  let days; let report; let srcMeta;
  try {
    ({ days, report, meta: srcMeta } = await importMenuWorkbook(fs.readFileSync(path.join(SRC, file)), { useAI: false }));
  } catch (e) {
    failed++;
    console.log(`  BỎ  ${pad(file, 46)} ${e.message.slice(0, 46)}`);
    continue;
  }

  const trimmed = normalizeDays(days);
  const dishes = countDishes(trimmed);
  if (trimmed.length < MIN_DAYS || dishes < MIN_DISHES) {
    failed++;
    console.log(`  BỎ  ${pad(file, 46)} chỉ ${trimmed.length} ngày / ${dishes} món`);
    continue;
  }

  const meta = describe(file, trimmed, dishes);
  added++;
  totalDishes += dishes;
  console.log(`  ${existing.has(source) ? 'GHI ĐÈ' : 'THÊM  '} ${pad(meta.title, 44)} ${pad(getCategory(meta.category).label, 16)} ${trimmed.length}ng ${dishes}m`);

  if (!APPLY) continue;

  if (existing.has(source)) await sb.from('menu_templates').delete().eq('id', existing.get(source));

  const { data: tpl, error } = await sb.from('menu_templates').insert({
    title: meta.title,
    description: meta.description,
    category: meta.category,
    tags: meta.tags,
    disease_target: meta.tags,
    status: 'published',
    visibility: 'public',
    is_system: true,
    source,
    source_name: meta.sourceName,
    // Xuất xứ số liệu (USDA, nguồn giá…) từ sheet "THÔNG TIN XỬ LÝ".
    source_meta: srcMeta || null,
  }).select().single();
  if (error) fail(`Chèn "${meta.title}" lỗi: ${error.message}`);

  await persistDays(tpl.id, trimmed);
}

console.log(`\n  thêm/ghi đè ${added} · bỏ qua (đã có) ${skipped} · không đạt ${failed} · tổng ${totalDishes} món`);
if (!APPLY) console.log('\n  Chạy lại với --apply để ghi vào Supabase.');
console.log('');

/* ───────────────────────── ghi cây ngày → bữa → món ───────────────────────── */

async function persistDays(templateId, days) {
  for (const day of days) {
    const { data: dayRow, error: dErr } = await sb.from('menu_template_days')
      .insert({ template_id: templateId, day_index: day.day_index }).select().single();
    if (dErr) fail(`menu_template_days: ${dErr.message}`);

    for (const meal of day.meals) {
      const { data: mealRow, error: mErr } = await sb.from('menu_template_meals')
        .insert({
          template_day_id: dayRow.id,
          meal_type: meal.meal_type,
          note: String(meal.note || '').slice(0, 500),
          needs_review: !!meal.needs_review,
        }).select().single();
      if (mErr) fail(`menu_template_meals: ${mErr.message}`);

      for (const dish of meal.dishes) {
        const { data: dishRow, error: dishErr } = await sb.from('menu_template_dishes').insert({
          template_meal_id: mealRow.id,
          name: dish.name,
          // Giá nguyên văn từ bộ thực đơn chuẩn (price / price_range).
          price: dish.price || '',
          price_range: dish.price_range || '',
          base_grams: dish.base_grams ?? null,
          calories: dish.calories ?? null,
          protein: dish.protein ?? null,
          fat: dish.fat ?? null,
          carbs: dish.carbs ?? null,
          fiber: dish.fiber ?? null,
          sugar: dish.sugar ?? null,
          sodium: dish.sodium ?? null,
          tags: dish.tags || [],
          source: 'reference_seed',
          confidence: 'low',
          ...(dish.source_text ? { source_text: dish.source_text } : {}),
        }).select().single();
        if (dishErr) fail(`menu_template_dishes: ${dishErr.message}`);

        if (dish.ingredients?.length) {
          const { error: iErr } = await sb.from('menu_template_dish_ingredients').insert(
            dish.ingredients.map((i) => ({
              dish_id: dishRow.id, name: i.name, grams: i.grams ?? null, unit: i.unit ?? null,
              price: i.price || '', tags: i.tags || [],
            }))
          );
          if (iErr) fail(`menu_template_dish_ingredients: ${iErr.message}`);
        }
      }
    }
  }
}

/* ───────────────────────── chuẩn hoá & mô tả ───────────────────────── */

/** Bỏ bữa rỗng và ngày rỗng — nguồn gốc của thẻ "Thứ 7 · 0 kcal · Chưa có món". */
function normalizeDays(days) {
  return (days || [])
    .filter((d) => d.day_index >= 1 && d.day_index <= 7)
    .sort((a, b) => a.day_index - b.day_index)
    .map((d) => ({
      day_index: d.day_index,
      meals: (d.meals || [])
        // GIỮ note/needs_review: dựng lại object mà quên hai trường này thì
        // ghi chú của nguồn rơi mất im lặng ngay trước bước ghi DB.
        .map((m) => ({
          meal_type: m.meal_type,
          note: m.note || '',
          needs_review: !!m.needs_review,
          dishes: (m.dishes || []).filter((x) => x?.name?.trim()),
        }))
        .filter((m) => m.dishes.length),
    }))
    .filter((d) => d.meals.length);
}

function countDishes(days) {
  return days.reduce((s, d) => s + d.meals.reduce((t, m) => t + m.dishes.length, 0), 0);
}

function describe(file, days, dishes) {
  // Bỏ cả đuôi file lẫn hậu tố "_formatted" mà bộ thực đơn chuẩn gắn vào mọi
  // tên — không bỏ thì tiêu đề thư viện hiện "… — Vinmec_formatted".
  const base = file.replace(/\.xlsx?m?$/i, '').replace(/[_\s-]*formatted$/i, '').trim();
  const m = base.match(/^\[([^\]]+)\]\s*(.*)$/);
  const category = categoryFromName(base);
  const cat = getCategory(category);
  const source = m ? m[2].trim() : base.replace(/_/g, ' ').trim();

  const title = m ? `Thực đơn ${cat.label.toLowerCase()} — ${source}` : titleCase(source);
  const description =
    `Thực đơn ${days.length} ngày (${dishes} món) dành cho người ${cat.label.toLowerCase()}, `
    + `tham khảo từ ${source}.`;

  // sourceName = tên ĐƠN VỊ phát hành, lưu tách để tra logo (source-logos.js).
  return { title: title.slice(0, 180), description, category, sourceName: source, tags: category === 'khac' ? [] : [cat.label.toLowerCase()] };
}

function titleCase(s) {
  const t = String(s || '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Thực đơn';
}

function slug(file) {
  return file.replace(/\.xlsx?m?$/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/* ───────────────────────── tiện ích ───────────────────────── */

async function requireColumn(table, column, migration) {
  const { error } = await sb.from(table).select(column).limit(1);
  if (error) fail(`Thiếu cột ${table}.${column}. Hãy chạy ${migration} trước.`);
}

function pad(v, n) {
  return String(v).padEnd(n).slice(0, n);
}

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
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
