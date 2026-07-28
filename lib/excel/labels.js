/**
 * lib/excel/labels.js — ánh xạ nhãn hiển thị.
 *
 * DB vẫn lưu day_index = 1..7 và meal_type = breakfast|lunch|dinner|snack.
 * Việc dịch sang "Thứ 2" / "Bữa sáng" CHỈ xảy ra ở tầng xuất file — không có
 * chuỗi tiếng Việt nào rò rỉ xuống database.
 *
 * Hỗ trợ sẵn cho tương lai: truyền `startDate` thì nhãn thành 2 dòng
 *
 *     Thứ 2
 *     28/07/2026
 *
 * mà KHÔNG phải đổi schema — day_index vẫn là nguồn sự thật duy nhất.
 */

/** day_index 1..7 → thứ trong tuần. 1 = Thứ 2 (tuần Việt Nam bắt đầu từ thứ Hai). */
export const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

export const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner'];

export const MEAL_LABELS = {
  breakfast: 'Bữa sáng',
  lunch: 'Bữa trưa',
  dinner: 'Bữa tối',
  snack: 'Bữa phụ',
};

/** Thứ tự hiển thị cột theo đúng nhịp ăn trong ngày. */
export const MEAL_ORDER = { breakfast: 1, snack: 2, lunch: 3, dinner: 4 };

/**
 * Nhãn cột ngày.
 * @param {number} dayIndex 1..7
 * @param {object} [opts]
 * @param {Date|string} [opts.startDate] ngày ứng với day_index = 1
 * @param {boolean} [opts.withDate=true] có kèm dòng ngày khi có startDate không
 */
export function dayLabel(dayIndex, opts = {}) {
  const i = Number(dayIndex);
  const base = DAY_LABELS[(i - 1 + 7) % 7] || `Ngày ${i}`;
  const { startDate, withDate = true } = opts;
  if (!startDate || !withDate) return base;

  const d = startDate instanceof Date ? new Date(startDate) : new Date(String(startDate));
  if (Number.isNaN(d.getTime())) return base;
  d.setDate(d.getDate() + (i - 1));
  return `${base}\n${formatDate(d)}`;
}

export function mealLabel(mealType) {
  return MEAL_LABELS[mealType] || mealType || '';
}

/** Sắp xếp danh sách meal_type theo nhịp ăn, bỏ loại không xuất hiện. */
export function orderMeals(mealTypes) {
  return [...new Set(mealTypes)]
    .filter(Boolean)
    .sort((a, b) => (MEAL_ORDER[a] ?? 99) - (MEAL_ORDER[b] ?? 99));
}

export function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default { DAY_LABELS, MEAL_LABELS, dayLabel, mealLabel, orderMeals, formatDate };
