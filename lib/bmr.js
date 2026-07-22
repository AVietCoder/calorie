// lib/bmr.js — shared BMR/TDEE/macro-target formula (Mifflin-St Jeor).
//
// Extracted from api/diet-info.js so the same calculation can be reused for
// a household_members row (family-menu feature) without duplicating it.
// Behavior is unchanged from the original inline logic in api/diet-info.js.

const SPEED_ADJUSTMENT_KCAL = { safe: 250, normal: 500, fast: 750 };

/**
 * @param {object} person
 * @param {'male'|string} person.gender
 * @param {number} person.birth_year
 * @param {number} person.height  cm
 * @param {number} person.weight  kg
 * @param {number} [person.activity_level]  default 1.2
 * @param {string} [person.goal]  comma-separated: 'lose,muscle', etc.
 * @param {string} [person.speed]  'safe' | 'normal' | 'fast'
 * @returns {{bmr:number, tdee:number, calories:number, macros:{protein:number, fat:number, carbs:number}}}
 */
export function computeTargets(person) {
  const currentYear = new Date().getFullYear();
  const age = currentYear - (person.birth_year || 2000);

  const bmr =
    person.gender === 'male'
      ? 10 * person.weight + 6.25 * person.height - 5 * age + 5
      : 10 * person.weight + 6.25 * person.height - 5 * age - 161;

  const tdee = Math.round(bmr * (person.activity_level || 1.2));

  const goals = String(person.goal || '')
    .split(',')
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);

  let targetCalories = tdee;
  const adjustment = SPEED_ADJUSTMENT_KCAL[person.speed] || 500;

  if (goals.includes('lose')) targetCalories -= adjustment;
  else if (goals.includes('gain') || goals.includes('muscle')) targetCalories += adjustment;

  const protein = Math.round((targetCalories * 0.3) / 4);
  const fat = Math.round((targetCalories * 0.25) / 9);
  const carbs = Math.round((targetCalories * 0.45) / 4);

  return {
    bmr: Math.round(bmr),
    tdee,
    calories: targetCalories,
    macros: { protein, fat, carbs },
  };
}

export default { computeTargets };
