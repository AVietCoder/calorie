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
 * Đơn vị định lượng xuất hiện trong bộ thực đơn chuẩn.
 * Xếp DÀI TRƯỚC NGẮN: nếu 'l' đứng trước 'ly' thì "1 ly" bị khớp thành "1 l".
 */
const UNITS = [
  'gram', 'gam', 'lít', 'lit', 'kg', 'ml', 'g', 'l',
  'chén', 'bát', 'tô', 'ly', 'cốc', 'hũ', 'hộp', 'chai', 'lon', 'gói', 'vỉ', 'bìa',
  'quả', 'trái', 'củ', 'bó', 'con', 'miếng', 'lát', 'múi', 'nhánh', 'bắp', 'ổ',
  'thìa', 'muỗng', 'suất', 'phần',
];

/*
 * Bắt cụm "SỐ + ĐƠN VỊ" ở bất kỳ đâu trong tên món:
 *   "200 g cháo yến mạch"                 → 200 g
 *   "1 quả táo và 10 g bơ đậu phộng"      → 1 quả · 10 g
 *   "½ quả táo" · "1,5 chén" · "1–1,5 bát"
 *
 * Không dùng \b sau đơn vị: \b của JS chỉ tính [A-Za-z0-9_], nên đơn vị kết
 * thúc bằng chữ có dấu ("củ", "bó") sẽ không có ranh giới từ. Dùng lookahead
 * "không phải chữ/số" mới đúng với tiếng Việt.
 */
const AMOUNT_RE = new RegExp(
  '(\\d+(?:[.,]\\d+)?(?:\\s*[–—-]\\s*\\d+(?:[.,]\\d+)?)?|[½¼¾⅓⅔⅛])'
  + '\\s*(' + UNITS.join('|') + ')'
  + '(?![\\p{L}\\p{N}])',
  'giu'
);

/**
 * Tách tên món thành các đoạn để tô đậm phần định lượng.
 *
 * Thuần dữ liệu (trả mảng, không trả JSX) để test được bằng node và để nơi gọi
 * tự quyết định bọc bằng thẻ gì.
 *
 * @param {string} text
 * @returns {{ text: string, amount: boolean }[]}
 */
export function splitAmounts(text) {
  const s = String(text || '');
  if (!s) return [];

  const out = [];
  let last = 0;
  // Regex có cờ /g → phải reset lastIndex, nếu không lần gọi sau bắt đầu lệch.
  AMOUNT_RE.lastIndex = 0;
  let m;
  while ((m = AMOUNT_RE.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), amount: false });
    out.push({ text: m[0], amount: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), amount: false });
  return out.length ? out : [{ text: s, amount: false }];
}

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
