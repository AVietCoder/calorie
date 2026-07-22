// lib/family-menu/nutrition-scale.js — scale a template dish per person / per
// household, reusing the existing deterministic nutrition engine
// (lib/nutrition.js) instead of re-implementing portion math.
import { scaleLinear, validateNumericNutrition } from '../nutrition.js';
import { computeTargets } from '../bmr.js';

const NUT_FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium'];

/** Per-meal calorie budget for one person, evenly split across meals/day. */
export function memberMealBudget(person, mealsPerDay = 3) {
  const { calories } = computeTargets(person);
  return Math.max(calories / Math.max(mealsPerDay, 1), 0);
}

/**
 * Scale a template/plan dish (authored for ONE standard adult portion) to
 * match a person's per-meal calorie budget. Grams scale by the same linear
 * factor as the nutrients — never scale calories alone.
 */
export function scaleDishForPerson(dish, person, mealsPerDay = 3) {
  const budget = memberMealBudget(person, mealsPerDay);
  const baseCalories = Number(dish.calories) || 1;
  const factor = budget > 0 ? budget / baseCalories : 1;

  const scaledNutrients = scaleLinear(pick(dish, NUT_FIELDS), factor);
  const fixed = validateNumericNutrition(scaledNutrients);
  const grams = dish.base_grams != null ? Math.round(dish.base_grams * factor) : null;

  return { ...fixed, grams, factor };
}

/**
 * Aggregate one shared dish across every household member eating that meal
 * (scope='household'). Returns the summed dish (what actually gets written
 * to plan_dishes) plus a per-member breakdown for traceability/logging.
 */
export function aggregateDishForHousehold(dish, members, mealsPerDay = 3) {
  const perMember = members.map((m) => ({
    member_id: m.id,
    ...scaleDishForPerson(dish, m, mealsPerDay),
  }));

  const summed = { grams: 0 };
  for (const k of NUT_FIELDS) summed[k] = 0;
  for (const p of perMember) {
    summed.grams += p.grams || 0;
    for (const k of NUT_FIELDS) summed[k] += p[k] || 0;
  }
  for (const k of NUT_FIELDS) summed[k] = Math.round(summed[k] * 10) / 10;
  summed.calories = Math.round(summed.calories);

  return { ...summed, perMember };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

export default { memberMealBudget, scaleDishForPerson, aggregateDishForHousehold };
