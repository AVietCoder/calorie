/**
 * scripts/backfill-dish-ingredients.mjs
 *
 * Thực đơn nhập trước đây giữ nguyên liệu NGAY TRONG tên món
 * ("Phở bò: 180 g bánh phở, 50 g thịt bò") nên menu_template_dish_ingredients
 * rỗng ⇒ danh sách đi chợ trống. Script tách chúng ra bảng nguyên liệu.
 *
 *   node scripts/backfill-dish-ingredients.mjs                 # dry-run (mặc định)
 *   node scripts/backfill-dish-ingredients.mjs --apply
 *   node scripts/backfill-dish-ingredients.mjs --apply --plans # bù cả plan_dish_ingredients
 *   node scripts/backfill-dish-ingredients.mjs --apply --force # parse lại từ source_text
 *   node scripts/backfill-dish-ingredients.mjs --template <uuid>
 *
 * Idempotent: món đã có nguyên liệu thì bỏ qua, trừ khi --force. Chạy lại lần 2
 * phải báo "0 đã đổi". Cần migrations/dish_source_text.sql chạy trước.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
loadEnv(path.join(ROOT, '.env.local'));

const { parseDishSpec } = await import('../lib/family-menu/dish-parse.js');
const { aggregateDishForHousehold } = await import('../lib/family-menu/nutrition-scale.js');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const PAGE = 1000;   // trần mặc định của PostgREST
const PLANS = args.includes('--plans');
const ONLY_TEMPLATE = valueOf('--template');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local');
const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

console.log(APPLY ? '\n*** CHẾ ĐỘ GHI (--apply) ***\n' : '\n--- DRY RUN: không ghi gì. Thêm --apply để thực thi. ---\n');

await backfillTemplates();
if (PLANS) await backfillPlans();

console.log('\nXong.\n');

/* ───────────────────────── pha A: template ───────────────────────── */

async function backfillTemplates() {
  // source_text chỉ cần cho --force (parse lại từ chuỗi gốc). Chưa chạy
  // migrations/dish_source_text.sql thì vẫn backfill được, chỉ mất khả năng đó.
  const hasSourceText = await columnExists('menu_template_dishes', 'source_text');
  if (!hasSourceText) {
    console.log('  ⚠️  Chưa có cột source_text (migrations/dish_source_text.sql chưa chạy).');
    console.log('      Vẫn backfill được, nhưng --force sẽ không parse lại từ chuỗi gốc.\n');
    if (FORCE) fail('--force cần cột source_text. Hãy chạy migrations/dish_source_text.sql trước.');
  }

  const cols = `id, name, base_grams, template_meal_id${hasSourceText ? ', source_text' : ''}, menu_template_dish_ingredients(id)`;
  let q = sb.from('menu_template_dishes').select(cols);
  if (ONLY_TEMPLATE) {
    const { data: meals } = await sb.from('menu_template_meals')
      .select('id, menu_template_days!inner(template_id)')
      .eq('menu_template_days.template_id', ONLY_TEMPLATE);
    q = q.in('template_meal_id', (meals || []).map((m) => m.id));
  }
  // PostgREST trả tối đa 1000 dòng/lần. Không phân trang thì 1457/2457 món bị
  // bỏ sót trong im lặng — script báo "xong" mà hơn nửa thư viện chưa được đụng.
  const dishes = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) fail(`Đọc menu_template_dishes lỗi: ${error.message}`);
    dishes.push(...data);
    if (data.length < PAGE) break;
  }

  console.log(`PHA A — ${dishes.length} món trong thư viện thực đơn\n`);

  let changed = 0; let skipped = 0; let withQty = 0; let estOnly = 0; let ingTotal = 0;

  for (const d of dishes) {
    const already = (d.menu_template_dish_ingredients || []).length;
    if (already && !FORCE) { skipped++; continue; }

    // FORCE parse lại từ source_text — parse từ `name` đã rút gọn sẽ mất dữ liệu.
    const src = d.source_text ?? d.name;
    const spec = parseDishSpec(src);
    if (!spec.ingredients.length) { skipped++; continue; }

    // Món không tách được nguyên liệu nhưng ĐÃ có base_grams (355 món dạng
    // "Sữa đậu nành" = 150 g) thì dùng luôn con số đó thay vì bỏ trống — biết
    // rồi mà vẫn ghi "cần ước lượng" là phí dữ liệu thật.
    const ingredients = spec.ingredients.map((i) => (
      i.grams == null && spec.ingredients.length === 1 && d.base_grams != null
        ? { ...i, grams: Number(d.base_grams), unit: 'g', needsEstimate: false }
        : i
    ));

    const hasQty = ingredients.some((i) => i.grams != null);
    if (hasQty) withQty++; else estOnly++;
    ingTotal += ingredients.length;
    changed++;

    console.log(`  ${hasQty ? '[SỐ] ' : '[EST]'} ${trunc(src, 62)}`);
    if (spec.name !== d.name) console.log(`        tên → "${spec.name}"`);
    for (const i of ingredients) {
      console.log(`           · ${(i.grams != null ? `${i.grams} ${i.unit}` : 'cần ước lượng').padEnd(14)}${i.name}`);
    }

    if (!APPLY) continue;

    // base_grams chỉ ghi khi parser TỰ suy ra được. Gán thẳng spec.baseGrams sẽ
    // xoá trắng 355 giá trị đang có (150 g, 200 g, 70 g…) thành null.
    const patch = { name: spec.name.slice(0, 200) };
    if (spec.baseGrams != null) patch.base_grams = spec.baseGrams;
    if (hasSourceText) patch.source_text = src;
    const { error: uErr } = await sb.from('menu_template_dishes').update(patch).eq('id', d.id);
    if (uErr) fail(`Cập nhật món ${d.id} lỗi: ${uErr.message}`);

    if (already) await sb.from('menu_template_dish_ingredients').delete().eq('dish_id', d.id);

    const { error: iErr } = await sb.from('menu_template_dish_ingredients').insert(
      ingredients.map((i) => ({ dish_id: d.id, name: i.name, grams: i.grams, unit: i.unit, tags: [] }))
    );
    if (iErr) fail(`Chèn nguyên liệu cho ${d.id} lỗi: ${iErr.message}`);
  }

  console.log(`\n  đã đổi ${changed} · bỏ qua ${skipped} · có định lượng ${withQty} · cần ước lượng ${estOnly} · tổng nguyên liệu ${ingTotal}`);
}

/* ───────────────────────── pha B: kế hoạch đang dùng ───────────────────────── */

async function backfillPlans() {
  // Bù nguyên liệu cho kế hoạch ĐANG CHẠY mà không dựng lại — giữ nguyên các món
  // đã được Rule Engine chọn/thay.
  const { data: planDishes, error } = await sb.from('plan_dishes')
    .select('id, name, source_template_dish_id, plan_meals!inner(plan_days!inner(plan_id)), plan_dish_ingredients(id)');
  if (error) fail(`Đọc plan_dishes lỗi: ${error.message}`);

  console.log(`\nPHA B — ${planDishes.length} món trong các kế hoạch đang dùng\n`);

  const memberCache = new Map();
  let changed = 0; let skipped = 0;

  for (const pd of planDishes) {
    if ((pd.plan_dish_ingredients || []).length && !FORCE) { skipped++; continue; }
    if (!pd.source_template_dish_id) { skipped++; continue; }

    const { data: tpl } = await sb.from('menu_template_dishes')
      .select('*, menu_template_dish_ingredients(*)')
      .eq('id', pd.source_template_dish_id)
      .maybeSingle();
    if (!tpl || !(tpl.menu_template_dish_ingredients || []).length) { skipped++; continue; }

    const planId = pd.plan_meals?.plan_days?.plan_id;
    const ctx = await planContext(planId, memberCache);
    if (!ctx) { skipped++; continue; }

    // Cùng phép tính hệ số mà persistMeal dùng — không nhân đôi công thức.
    const aggregated = aggregateDishForHousehold(tpl, ctx.members, ctx.mealsPerDay);
    // totalFactor đã gồm cả số người — không nhân thêm members.length nữa.
    const totalFactor = aggregated.totalFactor || 1;

    const rows = (tpl.menu_template_dish_ingredients || []).map((ing) => ({
      dish_id: pd.id,
      name: ing.name,
      grams: ing.grams != null ? Math.round(ing.grams * totalFactor) : null,
      unit: ing.unit ?? null,
      tags: ing.tags || [],
    }));

    changed++;
    console.log(`  ${trunc(pd.name, 50).padEnd(52)} → ${rows.length} nguyên liệu (×${factor.toFixed(2)} × ${ctx.members.length} người)`);

    if (!APPLY) continue;

    if ((pd.plan_dish_ingredients || []).length) {
      await sb.from('plan_dish_ingredients').delete().eq('dish_id', pd.id);
    }
    const { error: iErr } = await sb.from('plan_dish_ingredients').insert(rows);
    if (iErr) fail(`Chèn nguyên liệu kế hoạch cho ${pd.id} lỗi: ${iErr.message}`);

    if (tpl.name && tpl.name !== pd.name) {
      await sb.from('plan_dishes').update({ name: tpl.name }).eq('id', pd.id);
    }
  }

  console.log(`\n  đã đổi ${changed} · bỏ qua ${skipped}`);

  if (APPLY && changed) {
    // Danh sách đi chợ cũ đã lỗi thời — xoá để lần mở tab sau dựng lại.
    const planIds = [...new Set(planDishes.map((p) => p.plan_meals?.plan_days?.plan_id).filter(Boolean))];
    for (const id of planIds) await sb.from('shopping_lists').delete().eq('plan_id', id);
    console.log(`  đã xoá cache danh sách đi chợ của ${planIds.length} kế hoạch`);
  }
}

async function planContext(planId, cache) {
  if (!planId) return null;
  if (cache.has(planId)) return cache.get(planId);
  const { data: plan } = await sb.from('weekly_menu_plans').select('household_id').eq('id', planId).maybeSingle();
  if (!plan) { cache.set(planId, null); return null; }
  const { data: hh } = await sb.from('households').select('*').eq('id', plan.household_id).maybeSingle();
  const { data: members } = await sb.from('household_members').select('*').eq('household_id', plan.household_id);
  const ctx = { members: members || [], mealsPerDay: hh?.meals_per_day || 3 };
  cache.set(planId, ctx);
  return ctx;
}

/* ───────────────────────── tiện ích ───────────────────────── */

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

/** Cột đã tồn tại chưa — để script chạy được cả khi migration chưa áp. */
async function columnExists(table, column) {
  const { error } = await sb.from(table).select(column).limit(1);
  return !error;
}

function trunc(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
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
