// lib/family-menu/plan-builder.js — orchestrates the "select from template,
// scale, apply rules" pipeline. AI/free-text generation is never used here;
// every dish in a plan traces back to a menu_template_dishes row (or, for a
// rule-triggered substitution, to another published dish from the pool).
import { supabaseAdmin } from '../supabase.js';
import { getMembers } from './household.js';
import { dishAllowedForHousehold } from './rules.js';
import { aggregateDishForHousehold } from './nutrition-scale.js';
import { recommendTemplates } from './recommend.js';

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
    const ingredients = (finalDish.menu_template_dish_ingredients || []).map((ing) => ({
      dish_id: planDish.id,
      name: ing.name,
      grams: ing.grams != null ? Math.round(ing.grams * factor * members.length) : null,
      unit: ing.unit,
      tags: ing.tags || [],
    }));
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
    const { data: planDay, error: pdErr } = await supabaseAdmin
      .from('plan_days')
      .insert({ plan_id: plan.id, day_index: templateDay.day_index })
      .select()
      .single();
    if (pdErr) throw pdErr;

    for (const templateMeal of templateDay.menu_template_meals || []) {
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
    await supabaseAdmin.from('weekly_menu_plans').delete().eq('id', planId);
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

/** Aggregate every ingredient across a plan's 7 days into one shopping list (unit-merged, rounded). */
export async function buildShoppingList(planId) {
  const { data: rows, error } = await supabaseAdmin
    .from('plan_dish_ingredients')
    .select('name, grams, unit, plan_dishes!inner(plan_meals!inner(plan_days!inner(plan_id)))')
    .eq('plan_dishes.plan_meals.plan_days.plan_id', planId);
  if (error) throw error;

  const byKey = new Map();
  for (const r of rows || []) {
    const key = `${r.name.trim().toLowerCase()}::${r.unit || 'g'}`;
    const prev = byKey.get(key) || { name: r.name, unit: r.unit || 'g', total_qty: 0 };
    prev.total_qty += Number(r.grams) || 0;
    byKey.set(key, prev);
  }
  const items = [...byKey.values()].map((i) => ({ ...i, total_qty: Math.round(i.total_qty) }));

  await supabaseAdmin.from('shopping_lists').delete().eq('plan_id', planId);
  const { data: list, error: lErr } = await supabaseAdmin.from('shopping_lists').insert({ plan_id: planId }).select().single();
  if (lErr) throw lErr;
  if (items.length) {
    const { error: iErr } = await supabaseAdmin
      .from('shopping_list_items')
      .insert(items.map((i) => ({ list_id: list.id, name: i.name, total_qty: i.total_qty, unit: i.unit })));
    if (iErr) throw iErr;
  }
  return { ...list, items };
}

export default { loadTemplateFull, generatePlan, regeneratePlan, swapDish, buildShoppingList, MEAL_TYPES };
