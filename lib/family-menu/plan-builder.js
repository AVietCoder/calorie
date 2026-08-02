// lib/family-menu/plan-builder.js — orchestrates the "select from template,
// scale, apply rules" pipeline. AI/free-text generation is never used here;
// every dish in a plan traces back to a menu_template_dishes row (or, for a
// rule-triggered substitution, to another published dish from the pool).
import { supabaseAdmin } from '../supabase.js';
import { getMembers } from './household.js';
import { dishAllowedForHousehold } from './rules.js';
import { aggregateDishForHousehold } from './nutrition-scale.js';
import { recommendTemplates } from './recommend.js';
import { computeShoppingModel, computeDailyModels, formatShoppingText, buildCostIndex, costOfRows } from './shopping.js';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

/* ───────────────────────── Loading ───────────────────────── */

export async function loadTemplateFull(templateId) {
  const { data: template, error: tErr } = await supabaseAdmin
    .from('menu_templates')
    .select('*')
    .eq('id', templateId)
    .single();
  if (tErr) throw tErr;

  const { data: days, error: dErr } = await supabaseAdmin
    .from('menu_template_days')
    .select('*, menu_template_meals(*, menu_template_dishes(*, menu_template_dish_ingredients(*)))')
    .eq('template_id', templateId)
    .order('day_index', { ascending: true });
  if (dErr) throw dErr;

  return { ...template, days: days || [] };
}

/** Flat pool of every dish this household is allowed to SEE (public + own private), grouped by meal_type. */
async function loadDishPool(household) {
  const { data, error } = await supabaseAdmin
    .from('menu_template_dishes')
    .select(
      '*, menu_template_dish_ingredients(*), menu_template_meals(meal_type, menu_template_days(template_id, menu_templates(status, visibility, owner_household_id)))'
    )
    .limit(1000);
  if (error) throw error;

  const pool = { breakfast: [], lunch: [], dinner: [], snack: [] };
  for (const row of data || []) {
    const meal = row.menu_template_meals;
    const tpl = meal?.menu_template_days?.menu_templates;
    if (!meal || !tpl) continue;
    if (tpl.status !== 'published') continue;
    if (tpl.visibility !== 'public' && tpl.owner_household_id !== household.id) continue;
    if (pool[meal.meal_type]) pool[meal.meal_type].push(row);
  }
  return pool;
}

function calorieDistance(a, b) {
  return Math.abs((Number(a.calories) || 0) - (Number(b.calories) || 0));
}

async function findReplacement({ dish, mealType, pool, members, excludeDishId }) {
  const candidates = (pool[mealType] || []).filter((d) => d.id !== excludeDishId && d.id !== dish.id);
  const ranked = [];
  for (const cand of candidates) {
    const check = await dishAllowedForHousehold(members, cand);
    if (check.allowed) ranked.push(cand);
  }
  ranked.sort((a, b) => calorieDistance(a, dish) - calorieDistance(b, dish));
  return ranked[0] || null;
}

/* ───────────────────────── Building one dish ───────────────────────── */

async function buildMealDish({ templateDish, mealType, members, mealsPerDay, pool }) {
  const check = await dishAllowedForHousehold(members, templateDish);
  const audits = [];
  let finalDish = templateDish;

  if (!check.allowed) {
    const replacement = await findReplacement({
      dish: templateDish,
      mealType,
      pool,
      members,
      excludeDishId: templateDish.id,
    });
    const firstMatch = check.matches[0];
    if (replacement) {
      finalDish = replacement;
      audits.push({
        before: snapshotDish(templateDish),
        after: snapshotDish(replacement),
        rule_id: firstMatch?.rule?.id || null,
        reason: firstMatch?.reason || 'Rule Engine loại món do dị ứng/bệnh lý',
        actor: 'system',
      });
    } else {
      audits.push({
        before: snapshotDish(templateDish),
        after: null,
        rule_id: firstMatch?.rule?.id || null,
        reason: `${firstMatch?.reason || 'Xung đột dị ứng/bệnh lý'} — không tìm được món thay thế trong thư viện, cần rà soát thủ công.`,
        actor: 'system',
      });
    }
  }

  const aggregated = aggregateDishForHousehold(finalDish, members, mealsPerDay);
  return { finalDish, aggregated, audits };
}

function snapshotDish(dish) {
  return {
    id: dish.id,
    name: dish.name,
    calories: dish.calories,
    protein: dish.protein,
    fat: dish.fat,
    carbs: dish.carbs,
    tags: dish.tags,
  };
}

/* ───────────────────────── Persisting a built day/meal ───────────────────────── */

async function persistMeal({ planDayId, mealType, templateMeal, members, mealsPerDay, pool, planId }) {
  const { data: planMeal, error } = await supabaseAdmin
    .from('plan_meals')
    .insert({ plan_day_id: planDayId, meal_type: mealType })
    .select()
    .single();
  if (error) throw error;

  for (const templateDish of templateMeal?.menu_template_dishes || []) {
    const { finalDish, aggregated, audits } = await buildMealDish({
      templateDish,
      mealType,
      members,
      mealsPerDay,
      pool,
    });

    const { data: planDish, error: pdErr } = await supabaseAdmin
      .from('plan_dishes')
      .insert({
        plan_meal_id: planMeal.id,
        source_template_dish_id: finalDish.id,
        name: finalDish.name,
        // Giá tiền đi theo MÓN, không nhân theo số suất — đây là chuỗi khoảng
        // giá nguyên văn của người nhập, không phải con số để tính toán.
        price: finalDish.price || '',
        grams: aggregated.grams,
        calories: aggregated.calories,
        protein: aggregated.protein,
        fat: aggregated.fat,
        carbs: aggregated.carbs,
        fiber: aggregated.fiber,
        sugar: aggregated.sugar,
        sodium: aggregated.sodium,
        tags: finalDish.tags || [],
      })
      .select()
      .single();
    if (pdErr) throw pdErr;

    const factor = aggregated.perMember[0]?.factor || 1;
    const ingredients = planIngredientRows(planDish.id, finalDish, factor, members.length);
    if (ingredients.length) {
      const { error: ingErr } = await supabaseAdmin.from('plan_dish_ingredients').insert(ingredients);
      if (ingErr) throw ingErr;
    }

    for (const audit of audits) {
      await supabaseAdmin.from('menu_adjustment_audit').insert({ plan_id: planId, plan_dish_id: planDish.id, ...audit });
    }
  }

  return planMeal;
}

/* ───────────────────────── Public API ───────────────────────── */

export async function generatePlan({ household, templateId }) {
  const members = await getMembers(household.id);
  if (!members.length) throw new Error('Household chưa có thành viên nào.');

  let chosenTemplateId = templateId;
  if (!chosenTemplateId) {
    const ranked = await recommendTemplates(household, members, { limit: 1 });
    if (!ranked.length) throw new Error('Không tìm thấy menu mẫu phù hợp trong thư viện.');
    chosenTemplateId = ranked[0].template.id;
  }

  const template = await loadTemplateFull(chosenTemplateId);
  const pool = await loadDishPool(household);
  const mealsPerDay = household.meals_per_day || 3;

  const { data: plan, error: planErr } = await supabaseAdmin
    .from('weekly_menu_plans')
    .insert({ household_id: household.id, source_template_id: template.id, scope: 'household' })
    .select()
    .single();
  if (planErr) throw planErr;

  for (const templateDay of template.days) {
    // Bữa không có món nào thì BỎ QUA — tạo plan_meal rỗng sẽ đẻ ra thẻ ngày
    // "0 kcal · Chưa có món" trên giao diện. Ngày mà mọi bữa đều rỗng thì cũng
    // không tạo plan_day.
    const meals = (templateDay.menu_template_meals || [])
      .filter((m) => (m.menu_template_dishes || []).length > 0);
    if (!meals.length) continue;

    const { data: planDay, error: pdErr } = await supabaseAdmin
      .from('plan_days')
      .insert({ plan_id: plan.id, day_index: templateDay.day_index })
      .select()
      .single();
    if (pdErr) throw pdErr;

    for (const templateMeal of meals) {
      await persistMeal({
        planDayId: planDay.id,
        mealType: templateMeal.meal_type,
        templateMeal,
        members,
        mealsPerDay,
        pool,
        planId: plan.id,
      });
    }
  }

  // Chỉ MỘT kế hoạch 'active' mỗi hộ. Hạ các bản cũ xuống 'archived' thay vì xoá:
  // GET ?resource=plan đã lọc status='active' nên bản mới hiện ra ngay, còn bản cũ
  // vẫn khôi phục được. Cũng vá luôn lỗi cũ: generate_plan từ Thư viện thực đơn
  // để lại NHIỀU bản active, thắng thua chỉ dựa vào created_at.
  await supabaseAdmin
    .from('weekly_menu_plans')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('household_id', household.id)
    .eq('status', 'active')
    .neq('id', plan.id);

  return plan;
}

/**
 * Regenerate part (or all) of an existing plan, always re-derived from the
 * SAME source template — never invented. scope: 'week' | 'day' | 'meal' | 'dish'.
 */
export async function regeneratePlan({ planId, scope, dayIndex, mealType, planDishId }) {
  const { data: plan, error: planErr } = await supabaseAdmin
    .from('weekly_menu_plans')
    .select('*')
    .eq('id', planId)
    .single();
  if (planErr) throw planErr;

  const { data: household, error: hErr } = await supabaseAdmin
    .from('households')
    .select('*')
    .eq('id', plan.household_id)
    .single();
  if (hErr) throw hErr;

  if (scope === 'week') {
    // Dựng kế hoạch MỚI trước rồi mới hạ kế hoạch cũ xuống 'archived'
    // (generatePlan tự làm ở cuối). Bản cũ xoá trước rồi mới dựng — hỏng giữa
    // chừng là mất trắng cả tuần của gia đình, không khôi phục được.
    return generatePlan({ household, templateId: plan.source_template_id });
  }

  const members = await getMembers(household.id);
  const pool = await loadDishPool(household);
  const mealsPerDay = household.meals_per_day || 3;
  const template = await loadTemplateFull(plan.source_template_id);

  if (scope === 'day') {
    const templateDay = template.days.find((d) => d.day_index === dayIndex);
    if (!templateDay) throw new Error(`Template không có ngày ${dayIndex}.`);

    const { data: existingDay } = await supabaseAdmin
      .from('plan_days')
      .select('id')
      .eq('plan_id', planId)
      .eq('day_index', dayIndex)
      .maybeSingle();
    if (existingDay) await supabaseAdmin.from('plan_days').delete().eq('id', existingDay.id);

    const { data: planDay, error: pdErr } = await supabaseAdmin
      .from('plan_days')
      .insert({ plan_id: planId, day_index: dayIndex })
      .select()
      .single();
    if (pdErr) throw pdErr;

    for (const templateMeal of templateDay.menu_template_meals || []) {
      await persistMeal({ planDayId: planDay.id, mealType: templateMeal.meal_type, templateMeal, members, mealsPerDay, pool, planId });
    }
    return planDay;
  }

  if (scope === 'meal') {
    const templateDay = template.days.find((d) => d.day_index === dayIndex);
    const templateMeal = templateDay?.menu_template_meals?.find((m) => m.meal_type === mealType);
    if (!templateMeal) throw new Error(`Template không có bữa ${mealType} ở ngày ${dayIndex}.`);

    const { data: planDay } = await supabaseAdmin.from('plan_days').select('id').eq('plan_id', planId).eq('day_index', dayIndex).single();
    const { data: existingMeal } = await supabaseAdmin
      .from('plan_meals')
      .select('id')
      .eq('plan_day_id', planDay.id)
      .eq('meal_type', mealType)
      .maybeSingle();
    if (existingMeal) await supabaseAdmin.from('plan_meals').delete().eq('id', existingMeal.id);

    return persistMeal({ planDayId: planDay.id, mealType, templateMeal, members, mealsPerDay, pool, planId });
  }

  if (scope === 'dish') {
    return swapDish({ planDishId, actor: 'system', reasonPrefix: 'Người dùng yêu cầu đổi món (regenerate)' });
  }

  throw new Error(`Scope không hợp lệ: ${scope}`);
}

/** Manual (or regenerate-triggered) dish swap — picks a different candidate from the same meal-type pool. */
export async function swapDish({ planDishId, replacementDishId, actor = 'user', reasonPrefix = 'Người dùng đổi món' }) {
  const { data: planDish, error } = await supabaseAdmin
    .from('plan_dishes')
    .select('*, plan_meals(id, meal_type, plan_day_id, plan_days(plan_id))')
    .eq('id', planDishId)
    .single();
  if (error) throw error;

  const planId = planDish.plan_meals.plan_days.plan_id;
  const { data: plan } = await supabaseAdmin.from('weekly_menu_plans').select('household_id').eq('id', planId).single();
  const { data: household } = await supabaseAdmin.from('households').select('*').eq('id', plan.household_id).single();
  const members = await getMembers(household.id);
  const pool = await loadDishPool(household);
  const mealsPerDay = household.meals_per_day || 3;

  let replacement;
  if (replacementDishId) {
    const all = pool[planDish.plan_meals.meal_type] || [];
    replacement = all.find((d) => d.id === replacementDishId);
    if (!replacement) throw new Error('Không tìm thấy món thay thế trong thư viện.');
  } else {
    replacement = await findReplacement({
      dish: planDish,
      mealType: planDish.plan_meals.meal_type,
      pool,
      members,
      excludeDishId: planDish.source_template_dish_id,
    });
    if (!replacement) throw new Error('Không tìm được món thay thế phù hợp trong thư viện.');
  }

  const aggregated = aggregateDishForHousehold(replacement, members, mealsPerDay);
  const before = snapshotDish(planDish);

  const { data: updated, error: upErr } = await supabaseAdmin
    .from('plan_dishes')
    .update({
      source_template_dish_id: replacement.id,
      name: replacement.name,
      // Đổi món thì giá phải theo món MỚI, không được giữ giá món cũ.
      price: replacement.price || '',
      grams: aggregated.grams,
      calories: aggregated.calories,
      protein: aggregated.protein,
      fat: aggregated.fat,
      carbs: aggregated.carbs,
      fiber: aggregated.fiber,
      sugar: aggregated.sugar,
      sodium: aggregated.sodium,
      tags: replacement.tags || [],
    })
    .eq('id', planDishId)
    .select()
    .single();
  if (upErr) throw upErr;

  // Đổi món thì PHẢI đổi cả nguyên liệu. Thiếu bước này, danh sách đi chợ vẫn
  // cộng nguyên liệu của món CŨ — càng đổi càng lệch khỏi thực đơn.
  await supabaseAdmin.from('plan_dish_ingredients').delete().eq('dish_id', planDishId);
  const newIngredients = planIngredientRows(
    planDishId,
    replacement,
    aggregated.perMember?.[0]?.factor || 1,
    members.length
  );
  if (newIngredients.length) {
    const { error: ingErr } = await supabaseAdmin.from('plan_dish_ingredients').insert(newIngredients);
    if (ingErr) throw ingErr;
  }
  // Danh sách đi chợ đã cũ — xoá để lần mở sau dựng lại theo món mới.
  await supabaseAdmin.from('shopping_lists').delete().eq('plan_id', planId);

  await supabaseAdmin.from('menu_adjustment_audit').insert({
    plan_id: planId,
    plan_dish_id: planDishId,
    before,
    after: snapshotDish(replacement),
    rule_id: null,
    reason: reasonPrefix,
    actor,
  });

  return updated;
}

/**
 * Gộp toàn bộ nguyên liệu của một kế hoạch thành danh sách đi chợ.
 *
 * Từ bản này việc gộp/quy đổi/làm tròn/phân nhóm/tính giá do
 * lib/family-menu/shopping.js đảm nhiệm (hàm thuần, test được). Ở đây chỉ còn
 * phần I/O Supabase.
 *
 * TƯƠNG THÍCH NGƯỢC: các trường cũ `{ name, total_qty, unit }` được giữ NGUYÊN
 * ý nghĩa; mọi thứ mới (category, unit_price, line_total…) là trường BỔ SUNG,
 * nên UI cũ không vỡ.
 *
 * @param {string} planId
 * @param {object} [opts]
 * @param {number} [opts.servings] số suất mong muốn; mặc định = số thành viên
 */
export async function buildShoppingList(planId, opts = {}) {
  // Lấy kèm day_index + meal_type để bổ chi phí ra từng bữa/ngày mà không phải
  // truy vấn lần hai.
  const { data: rows, error } = await supabaseAdmin
    .from('plan_dish_ingredients')
    .select('name, grams, unit, plan_dishes!inner(plan_meals!inner(meal_type, plan_days!inner(plan_id, day_index)))')
    .eq('plan_dishes.plan_meals.plan_days.plan_id', planId);
  if (error) throw error;

  const { household, members } = await loadPlanContext(planId);
  const baseServings = Math.max(1, members.length || 1);
  const servings = Math.max(1, Number(opts.servings) || baseServings);

  // Giữ lại các mục đã tick "đã mua" trước khi xoá danh sách cũ.
  const purchasedIds = await loadPurchasedIds(planId);

  // Cùng một hàm với plan-export.buildExportModel ⇒ màn hình và file Excel
  // không thể ra số khác nhau.
  const model = await computeShoppingModel(rows || [], {
    household,
    servings,
    baseServings,
    purchasedIds,
  });

  await supabaseAdmin.from('shopping_lists').delete().eq('plan_id', planId);
  const { data: list, error: lErr } = await supabaseAdmin
    .from('shopping_lists')
    .insert({ plan_id: planId, servings })
    .select()
    .single();
  if (lErr) throw lErr;

  if (model.items.length) {
    const payload = model.items.map((i) => ({
      list_id: list.id,
      name: i.name,
      // Giữ nguyên ngữ nghĩa cũ: tổng lượng ở đơn vị gốc.
      // null với mục "cần ước lượng" — KHÔNG ép về 0.
      total_qty: i.base_qty == null ? null : Math.round(i.base_qty),
      unit: i.base_unit,
      category: i.category,
      est_cost: i.line_total,
      ingredient_id: i.ingredient_id,
      display_qty: i.qty,
      display_unit: i.unit,
      unit_price: i.unit_price,
      substitutes: i.substitutes || [],
    }));
    // Cột mới chỉ tồn tại sau migrations/excel_export_and_pricing.sql. Nếu
    // migration chưa chạy, lùi về đúng bộ cột cũ thay vì làm hỏng tính năng.
    const { error: iErr } = await supabaseAdmin.from('shopping_list_items').insert(payload);
    if (iErr) {
      console.warn(`⚠️ [plan-builder] shopping_list_items thiếu cột mới, ghi bản rút gọn: ${iErr.message}`);
      const { error: fallbackErr } = await supabaseAdmin.from('shopping_list_items').insert(
        payload.map(({ list_id, name, total_qty, unit, category, est_cost }) => ({
          list_id, name, total_qty, unit, category, est_cost,
        }))
      );
      if (fallbackErr) throw fallbackErr;
    }
  }

  // Chi phí từng bữa/ngày bổ ra TỪ CHÍNH model trên ⇒ Σ luôn khớp tổng.
  const costIndex = buildCostIndex(model);
  const factor = servings / baseServings;
  const cost = { byDay: {}, byMeal: {}, total: model.totals.estimatedCost };
  for (const r of rows || []) {
    const meal = r.plan_dishes?.plan_meals;
    const dayIndex = meal?.plan_days?.day_index;
    if (dayIndex == null) continue;
    const c = costOfRows([{ name: r.name, grams: r.grams, unit: r.unit }], costIndex, factor).cost;
    cost.byDay[dayIndex] = (cost.byDay[dayIndex] || 0) + c;
    const key = `${dayIndex}:${meal.meal_type}`;
    cost.byMeal[key] = (cost.byMeal[key] || 0) + c;
  }

  // `text` dựng ngay tại nguồn để client/mobile khỏi tự ghép lại (và ghép lệch).
  return {
    ...list,
    servings,
    items: model.items,
    groups: model.groups,
    totals: model.totals,
    cost,
    days: await buildDailyChecklists(rows || [], (r) => r.plan_dishes?.plan_meals?.plan_days?.day_index, {
      household, servings, baseServings, purchasedIds,
    }),
    text: formatShoppingText(model),
  };
}

/**
 * Danh sách đi chợ của MỘT THỰC ĐƠN TRONG THƯ VIỆN — chưa cần áp dụng.
 *
 * Để người dùng cân nhắc "thực đơn này đi chợ tốn bao nhiêu, mua những gì"
 * TRƯỚC khi thay kế hoạch đang chạy. Chỉ đọc, không đụng bảng shopping_lists,
 * và đi qua đúng computeShoppingModel như kế hoạch thật nên số liệu khớp nhau.
 *
 * @param {string} templateId
 * @param {object} [opts]
 * @param {object} [opts.household]  có thì lấy vùng miền + giá riêng của hộ
 * @param {number} [opts.servings]
 */
export async function buildTemplateShoppingList(templateId, opts = {}) {
  const { data: rows, error } = await supabaseAdmin
    .from('menu_template_dish_ingredients')
    .select('name, grams, unit, menu_template_dishes!inner(menu_template_meals!inner(meal_type, menu_template_days!inner(template_id, day_index)))')
    .eq('menu_template_dishes.menu_template_meals.menu_template_days.template_id', templateId);
  if (error) throw error;

  const { household } = opts;
  const baseServings = Math.max(1, Number(opts.baseServings) || 1);
  const servings = Math.max(1, Number(opts.servings) || baseServings);
  const dayOf = (r) => r.menu_template_dishes?.menu_template_meals?.menu_template_days?.day_index;

  const model = await computeShoppingModel(rows || [], { household, servings, baseServings });

  return {
    template_id: templateId,
    servings,
    items: model.items,
    groups: model.groups,
    totals: model.totals,
    days: await buildDailyChecklists(rows || [], dayOf, { household, servings, baseServings }),
    text: formatShoppingText(model),
  };
}

/**
 * Checklist "hôm nay cần mua gì" cho từng ngày.
 *
 * @param {Function} dayOf  rút day_index ra khỏi một dòng nguyên liệu — cấu
 *                          trúc lồng của template và của plan khác nhau nên
 *                          để bên gọi tự chỉ đường.
 */
export async function buildDailyChecklists(rows, dayOf, opts) {
  const tagged = rows.map((r) => ({ name: r.name, grams: r.grams, unit: r.unit, dayIndex: dayOf(r) }));
  const models = await computeDailyModels(tagged, opts);

  const out = [];
  for (const [dayIndex, m] of models) {
    out.push({
      day_index: dayIndex,
      // exact_* = lượng CẦN dùng hôm đó (xem ghi chú ở computeDailyModels).
      items: m.items.map((i) => ({
        ingredient_id: i.ingredient_id,
        name: i.name,
        category: i.category,
        qty: i.exact_qty,
        unit: i.exact_unit,
        needs_estimate: i.needs_estimate,
      })),
      est_cost: m.totals.estimatedCost,
      estimate_count: m.totals.estimateCount,
    });
  }
  return out;
}

/**
 * Các nguyên liệu đã tick "đã mua" của danh sách hiện có.
 * Đọc TRƯỚC khi xoá, để dựng lại không mất trạng thái người dùng.
 */
async function loadPurchasedIds(planId) {
  const { data } = await supabaseAdmin
    .from('shopping_lists')
    .select('id, shopping_list_items(ingredient_id, purchased)')
    .eq('plan_id', planId)
    .maybeSingle();
  const ids = (data?.shopping_list_items || [])
    .filter((i) => i.purchased && i.ingredient_id)
    .map((i) => i.ingredient_id);
  return new Set(ids);
}

/**
 * Nguyên liệu của một plan_dish, scale theo hệ số + số người ăn.
 *
 * Dùng chung bởi persistMeal, swapDish và script backfill — công thức scale chỉ
 * tồn tại ở ĐÚNG MỘT chỗ này.
 *
 * @param {string} planDishId
 * @param {object} templateDish  bản ghi menu_template_dishes (có nested ingredients)
 * @param {number} factor        hệ số khẩu phần từ aggregateDishForHousehold
 * @param {number} memberCount
 */
export function planIngredientRows(planDishId, templateDish, factor, memberCount) {
  const src = templateDish?.menu_template_dish_ingredients || [];
  return src.map((ing) => ({
    dish_id: planDishId,
    name: ing.name,
    // null giữ nguyên null: nguồn không khai định lượng thì KHÔNG bịa ra số.
    grams: ing.grams != null ? Math.round(ing.grams * factor * memberCount) : null,
    unit: ing.unit ?? null,
    tags: ing.tags || [],
  }));
}

/** plan_id của một plan_dish — để kiểm tra quyền TRƯỚC khi ghi. */
export async function planIdForPlanDish(planDishId) {
  const { data } = await supabaseAdmin
    .from('plan_dishes')
    .select('id, plan_meals!inner(plan_days!inner(plan_id))')
    .eq('id', planDishId)
    .maybeSingle();
  return data?.plan_meals?.plan_days?.plan_id || null;
}

/** Household + members của một kế hoạch — cần cho khu vực giá và số suất. */
async function loadPlanContext(planId) {
  const { data: plan } = await supabaseAdmin
    .from('weekly_menu_plans')
    .select('household_id')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) return { household: null, members: [] };

  const { data: household } = await supabaseAdmin
    .from('households')
    .select('*')
    .eq('id', plan.household_id)
    .maybeSingle();

  const members = household ? await getMembers(household.id) : [];
  return { household, members };
}

export default { loadTemplateFull, generatePlan, regeneratePlan, swapDish, buildShoppingList, MEAL_TYPES };
