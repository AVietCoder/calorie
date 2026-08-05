/**
 * components/menu-library/template-day-utils.js — helper đọc cây thực đơn mẫu.
 *
 * Tách riêng vì TemplateDetail và TemplateDayModal đều cần: để chúng import
 * lẫn nhau sẽ tạo vòng phụ thuộc (TemplateDetail → Modal → TemplateDetail).
 * Hiện tại vòng đó vẫn chạy được vì mọi thứ chỉ dùng lúc render, nhưng chỉ cần
 * ai đó dùng một hằng số này ở cấp module là vỡ ngay lúc khởi tạo.
 *
 * Thuần dữ liệu: không JSX, không state.
 */
import { MEAL_ORDER } from '../../lib/excel/labels';

/** Icon từng bữa — dùng chung giữa thẻ xem trước và modal chi tiết. */
export const MEAL_ICON = {
  breakfast: 'fa-mug-hot',
  lunch: 'fa-bowl-food',
  dinner: 'fa-moon',
  snack: 'fa-apple-whole',
};

/** day_index của HÔM NAY theo tuần Việt Nam (T2 = 1 … CN = 7). */
export function todayDayIndex() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

/** Các bữa của một ngày, đã sắp theo nhịp ăn trong ngày. */
export function mealsOf(day) {
  return [...(day?.menu_template_meals || [])].sort(
    (a, b) => (MEAL_ORDER[a.meal_type] || 99) - (MEAL_ORDER[b.meal_type] || 99)
  );
}

export const kcalOf = (dishes) => dishes.reduce((s, d) => s + (Number(d.calories) || 0), 0);

/**
 * Tổng dinh dưỡng của một ngày trong THƯ VIỆN (cây menu_template_*).
 * Khác plan-export: ở đây KHÔNG nhân theo số suất — thư viện là bản mẫu gốc.
 */
export function templateDayTotals(day) {
  const dishes = mealsOf(day).flatMap((m) => m.menu_template_dishes || []);
  const total = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium: 0 };
  for (const d of dishes) {
    for (const k of Object.keys(total)) total[k] += Number(d[k]) || 0;
  }
  return { ...total, dishes };
}

export default { MEAL_ICON, todayDayIndex, mealsOf, kcalOf, templateDayTotals };
