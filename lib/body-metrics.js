// lib/body-metrics.js — ngưỡng "hợp lý cho một con người" dùng CHUNG cho mọi nơi
// nhập cân nặng/chiều cao/năm sinh (signup, setup, hồ sơ gia đình) — cả phía
// client (page.jsx) lẫn server (route.js) đều import được module này vì nó
// không đụng tới bất kỳ API nào của trình duyệt hay của Node, chỉ toán học thuần.
//
// Có 2 bộ ngưỡng:
//   - "adult"  : áp cho hồ sơ CHÍNH CHỦ (signup/setup) — luôn là người tự đăng ký.
//   - "any"    : áp cho thành viên hộ gia đình (household_members) — có thể là
//                trẻ em/người già do chủ hộ nhập hộ (kind='dependent'), nên cho
//                phép chiều cao/cân nặng thấp hơn.
export const BIRTH_YEAR_MIN = 1900;
export const HEIGHT_MAX_CM = 250;
export const HEIGHT_MIN_ADULT_CM = 80;
export const HEIGHT_MIN_ANY_CM = 40;
export const WEIGHT_MAX_KG = 300;
export const WEIGHT_MIN_ADULT_KG = 20;
export const WEIGHT_MIN_ANY_KG = 2;

const currentYear = () => new Date().getFullYear();

/** true nếu năm sinh hợp lý (>=1900, không ở tương lai). */
export function isValidBirthYear(year) {
  const y = Number(year);
  return Number.isFinite(y) && y >= BIRTH_YEAR_MIN && y <= currentYear();
}

/** true nếu chiều cao (cm) hợp lý. allowChild=true nới ngưỡng dưới cho trẻ em. */
export function isValidHeight(cm, { allowChild = false } = {}) {
  const h = Number(cm);
  const min = allowChild ? HEIGHT_MIN_ANY_CM : HEIGHT_MIN_ADULT_CM;
  return Number.isFinite(h) && h >= min && h <= HEIGHT_MAX_CM;
}

/** true nếu cân nặng (kg) hợp lý. allowChild=true nới ngưỡng dưới cho trẻ em/trẻ sơ sinh. */
export function isValidWeight(kg, { allowChild = false } = {}) {
  const w = Number(kg);
  const min = allowChild ? WEIGHT_MIN_ANY_KG : WEIGHT_MIN_ADULT_KG;
  return Number.isFinite(w) && w >= min && w <= WEIGHT_MAX_KG;
}
