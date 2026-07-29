/**
 * lib/family-menu/plan-export.js — LỚP DATA MAPPING.
 *
 *   [Data] ─▶ Template ─▶ Style ─▶ Renderer ─▶ Excel
 *
 * Nhiệm vụ duy nhất: đọc một kế hoạch từ Supabase và biến nó thành một
 * "export model" phẳng, đã tính sẵn mọi thứ template cần. Template KHÔNG được
 * query DB, KHÔNG được tính toán dinh dưỡng — nhờ vậy render test được offline
 * chỉ với một object JSON.
 *
 * Export model:
 * {
 *   plan, household, members, template,
 *   servings,                       số suất (số thành viên, có thể ghi đè)
 *   mealTypes: ['breakfast', …],    các bữa THỰC SỰ có trong kế hoạch
 *   days: [{ dayIndex, label, meals: { breakfast: {text, dishes[]}, … }, totals }],
 *   dishes: [{ day, meal, name, grams, calories, protein, … , adjusted, reason }],
 *   shopping: { items, groups, totals },
 *   nutritionTotals, warnings[]
 * }
 */
import { supabaseAdmin } from '../supabase.js';
import { getMembers } from './household.js';
import { computeShoppingModel, buildCostIndex, costOfRows } from './shopping.js';
import { dayLabel, mealLabel, orderMeals, MEAL_ORDER } from '../excel/labels.js';

const NUT_FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium'];

/**
 * @param {string} planId
 * @param {object} [opts]
 * @param {number} [opts.servings]    ghi đè số suất (mặc định = số thành viên)
 * @param {string} [opts.startDate]   ngày ứng với day_index = 1
 */
export async function buildExportModel(planId, opts = {}) {
  const { data: plan, error } = await supabaseAdmin
    .from('weekly_menu_plans')
    .select('*, plan_days(*, plan_meals(*, plan_dishes(*, plan_dish_ingredients(*))))')
    .eq('id', planId)
    .single();
  if (error) throw error;
  if (!plan) throw new Error('Không tìm thấy kế hoạch thực đơn.');

  const { data: household } = await supabaseAdmin
    .from('households')
    .select('*')
    .eq('id', plan.household_id)
    .maybeSingle();

  const members = household ? await getMembers(household.id) : [];

  const { data: template } = plan.source_template_id
    ? await supabaseAdmin.from('menu_templates').select('*').eq('id', plan.source_template_id).maybeSingle()
    : { data: null };

  const { data: audits } = await supabaseAdmin
    .from('menu_adjustment_audit')
    .select('plan_dish_id, reason, actor')
    .eq('plan_id', planId);
  const auditByDish = new Map();
  for (const a of audits || []) {
    if (!a.plan_dish_id) continue;
    if (!auditByDish.has(a.plan_dish_id)) auditByDish.set(a.plan_dish_id, []);
    auditByDish.get(a.plan_dish_id).push(a);
  }

  const baseServings = Math.max(1, members.length || 1);
  const servings = Math.max(1, Number(opts.servings) || baseServings);
  const servingsFactor = servings / baseServings;

  /* ── phẳng hoá cây plan → mảng dishes + lưới ngày × bữa ── */
  const dishes = [];
  const ingredientRows = [];
  const mealRows = [];   // { dayIndex, mealType, row } — để tính chi phí từng bữa
  const mealTypesSeen = new Set();
  const dayMap = new Map();

  const sortedDays = [...(plan.plan_days || [])].sort((a, b) => a.day_index - b.day_index);

  for (const d of sortedDays) {
    const dayEntry = { dayIndex: d.day_index, meals: {}, totals: zeroNutrition() };
    dayMap.set(d.day_index, dayEntry);

    const sortedMeals = [...(d.plan_meals || [])].sort(
      (a, b) => (MEAL_ORDER[a.meal_type] ?? 99) - (MEAL_ORDER[b.meal_type] ?? 99)
    );

    for (const m of sortedMeals) {
      mealTypesSeen.add(m.meal_type);
      const cellDishes = [];

      for (const dish of m.plan_dishes || []) {
        const scaled = scaleNutrition(dish, servingsFactor);
        const dishAudits = auditByDish.get(dish.id) || [];
        const row = {
          id: dish.id,
          dayIndex: d.day_index,
          dayLabel: dayLabel(d.day_index, { startDate: opts.startDate, withDate: false }),
          mealType: m.meal_type,
          mealLabel: mealLabel(m.meal_type),
          name: dish.name,
          grams: dish.grams != null ? Math.round(dish.grams * servingsFactor) : null,
          ...scaled,
          tags: dish.tags || [],
          adjusted: dishAudits.length > 0,
          reason: dishAudits.map((a) => a.reason).filter(Boolean).join(' · ') || null,
        };
        dishes.push(row);
        cellDishes.push(row);
        addNutrition(dayEntry.totals, scaled);

        for (const ing of dish.plan_dish_ingredients || []) {
          const rawRow = { name: ing.name, grams: ing.grams, unit: ing.unit || 'g' };
          ingredientRows.push(rawRow);
          // Giữ theo (ngày, bữa) để bổ chi phí ra từng bữa ở bước dưới.
          mealRows.push({ dayIndex: d.day_index, mealType: m.meal_type, row: rawRow });
        }
      }

      dayEntry.meals[m.meal_type] = {
        dishes: cellDishes,
        // Ô trong lưới: mỗi món một dòng — đúng cách các file mẫu trình bày.
        text: cellDishes.map(describeDish).join('\n'),
      };
    }
  }

  const mealTypes = orderMeals([...mealTypesSeen]);

  const days = sortedDays.map((d) => {
    const entry = dayMap.get(d.day_index);
    return {
      ...entry,
      label: dayLabel(d.day_index, { startDate: opts.startDate }),
      labelPlain: dayLabel(d.day_index, { withDate: false }),
    };
  });

  /* ── danh sách đi chợ ──
     Dùng CHUNG computeShoppingModel với plan-builder.buildShoppingList. Trước đây
     mỗi bên tự gọi loadAdminPrices + buildShoppingModel nên file Excel và màn hình
     có thể ra số khác nhau. */
  const shopping = await computeShoppingModel(ingredientRows, {
    household,
    servings,
    baseServings,
  });

  /* ── chi phí: bổ tổng của danh sách đi chợ ra từng bữa / từng ngày ──
     Dùng cùng bảng giá đã gộp ⇒ Σ chi phí bữa == tổng danh sách đi chợ, không
     lệch như khi tính giá lại theo đường khác. */
  const costIndex = buildCostIndex(shopping);
  const cost = { byDay: {}, byMeal: {}, total: shopping.totals.estimatedCost };
  for (const { dayIndex, mealType, row } of mealRows) {
    const key = `${dayIndex}:${mealType}`;
    cost.byMeal[key] = (cost.byMeal[key] || 0) + costOfRows([row], costIndex, servingsFactor).cost;
    cost.byDay[dayIndex] = (cost.byDay[dayIndex] || 0) + costOfRows([row], costIndex, servingsFactor).cost;
  }

  /* ── tổng dinh dưỡng cả tuần ── */
  const nutritionTotals = zeroNutrition();
  for (const d of days) addNutrition(nutritionTotals, d.totals);

  const warnings = [];
  if (!ingredientRows.length) {
    warnings.push('Các món trong kế hoạch chưa khai báo nguyên liệu — danh sách đi chợ sẽ trống.');
  }
  if (shopping.totals.missingPriceCount > 0) {
    warnings.push(`${shopping.totals.missingPriceCount} nguyên liệu chưa có giá — cột Thành tiền hiển thị "-".`);
  }
  const adjustedCount = dishes.filter((d) => d.adjusted).length;
  if (adjustedCount > 0) {
    warnings.push(`${adjustedCount} món đã được Rule Engine thay đổi theo dị ứng/bệnh lý của thành viên.`);
  }

  return {
    plan,
    household,
    members,
    template,
    servings,
    baseServings,
    servingsFactor,
    startDate: opts.startDate || null,
    mealTypes,
    days,
    dishes,
    shopping,
    cost,
    nutritionTotals,
    warnings,
    generatedAt: new Date(),
  };
}

/* ───────────────────────── helpers ───────────────────────── */

/** "Phở gà (400 g · 450 kcal)" — bám sát văn phong mô tả của các file mẫu. */
function describeDish(d) {
  const bits = [];
  if (d.grams) bits.push(`${formatNum(d.grams)} g`);
  if (d.calories) bits.push(`${formatNum(d.calories)} kcal`);
  return bits.length ? `${d.name} (${bits.join(' · ')})` : d.name;
}

function scaleNutrition(dish, factor) {
  const out = {};
  for (const k of NUT_FIELDS) {
    const v = Number(dish[k]);
    out[k] = Number.isFinite(v) ? Math.round(v * factor * 10) / 10 : null;
  }
  if (out.calories != null) out.calories = Math.round(out.calories);
  return out;
}

function zeroNutrition() {
  const o = {};
  for (const k of NUT_FIELDS) o[k] = 0;
  return o;
}

function addNutrition(target, src) {
  for (const k of NUT_FIELDS) target[k] = Math.round((target[k] + (Number(src[k]) || 0)) * 10) / 10;
  target.calories = Math.round(target.calories);
}

function formatNum(v) {
  return Number(v).toLocaleString('vi-VN');
}

export { NUT_FIELDS };
export default { buildExportModel };
