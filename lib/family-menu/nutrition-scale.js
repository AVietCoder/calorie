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
 * Nhu cầu calo/ngày của một người trưởng thành TIÊU CHUẨN — mốc quy chiếu cho
 * "một suất" mà thực đơn mẫu được soạn theo.
 */
const REFERENCE_DAILY_CALORIES = 2000;

/* Người ăn ít nhất/nhiều nhất vẫn quanh một suất chuẩn. Chặn hai đầu để một hồ
   sơ khai sai (trẻ 2 tuổi, hay vận động viên 4000 kcal) không kéo cả nồi lệch. */
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 1.6;

/**
 * Scale a template/plan dish (authored for ONE standard adult portion) for one
 * person. Grams scale by the same linear factor as the nutrients — never scale
 * calories alone.
 *
 * HỆ SỐ LÀ TỈ LỆ SO VỚI MỘT SUẤT CHUẨN, không phải "kéo món cho đầy suất ăn".
 *
 * Bản cũ tính `factor = budget/dish.calories`, tức phóng MỖI MÓN lên cho bằng
 * trọn suất ăn của người đó. Hệ quả: mọi món trong bữa đều ra đúng một con số
 * calo giống hệt nhau, rồi cộng cho cả nhà thì nhân tiếp. Đo trên ca thật: hồ
 * sơ 2293 kcal/ngày ÷ 3 bữa × 4 người = 3058 — và mọi món trong thực đơn đều
 * hiện 3058 kcal, bữa 2 món thành 6.116, ngày 10 món thành 30.580 kcal. Món ít
 * calo còn tệ hơn: rau cải luộc bị nhân lên 11 kg vì phải "đủ" 3058 kcal.
 *
 * Sai lầm gốc là coi mỗi món phải một mình lấp đầy bữa ăn, trong khi một bữa
 * gồm nhiều món CHIA NHAU suất đó (cơm + cá + rau + canh). Thực đơn mẫu vốn đã
 * soạn khẩu phần hợp lý cho từng món, nên việc duy nhất cần làm là nhân theo số
 * người — đúng như kỳ vọng "4 người thì gấp 4".
 */
export function scaleDishForPerson(dish, person, mealsPerDay = 3) {
  const { calories: daily } = computeTargets(person) || {};
  const ratio = Number(daily) > 0 ? Number(daily) / REFERENCE_DAILY_CALORIES : 1;
  const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, ratio));

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

  /* Tổng hệ số của cả nhà — số "suất chuẩn" mà món này nấu cho.
     Nguyên liệu PHẢI nhân đúng con số này thì mới khớp với dinh dưỡng đã cộng ở
     trên. Bản cũ ở plan-builder lấy factor của MỘT thành viên rồi nhân số người,
     nên khi các thành viên có nhu cầu khác nhau thì lượng nguyên liệu lệch hẳn
     so với calo của chính món đó. */
  const totalFactor = perMember.reduce((s, p) => s + (p.factor || 0), 0) || 1;

  return { ...summed, perMember, totalFactor };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

export default { memberMealBudget, scaleDishForPerson, aggregateDishForHousehold };
