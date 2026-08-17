/**
 * lib/family-menu/ingredient-analysis.js — phân tích nguyên liệu của một ngày.
 *
 * Bộ thực đơn chuẩn gắn nhãn cho 100% nguyên liệu (30 nhãn khác nhau) và có
 * khối lượng cho 100%. Nhưng nhãn trộn HAI trục khác hẳn nhau:
 *
 *   nhóm thực phẩm    — rau, đạm, tinh bột, trái cây, thịt, cá, sữa, đậu…
 *   thuộc tính        — chất xơ, natri, chất béo bão hoà, đường bổ sung…
 *
 * Gộp cả 30 nhãn vào một biểu đồ là vô nghĩa: một miếng cá vừa là "cá" vừa là
 * "đạm" vừa là "chất béo tốt", cộng ba lần thành 300%. Nên tách:
 *
 *   groups     — mỗi nguyên liệu thuộc ĐÚNG MỘT nhóm, cộng theo gram ⇒ %
 *   highlights — thuộc tính đáng chú ý, đếm số nguyên liệu (không cộng gram)
 *
 * Thuần: không DB, không mạng. Cùng input luôn ra cùng output.
 */

/**
 * Nhóm thực phẩm, xét theo THỨ TỰ — nguyên liệu rơi vào nhóm khớp đầu tiên.
 *
 * Thứ tự quan trọng: "ngũ cốc nguyên hạt" phải xét trước "đạm", vì gạo lứt mang
 * cả hai nhãn mà nó là tinh bột. Tương tự "đậu" trước "đạm thực vật".
 */
const GROUPS = [
  { id: 'starch', label: 'Tinh bột', color: '#7dc976', tags: ['tinh bột', 'ngũ cốc nguyên hạt'] },
  { id: 'protein', label: 'Đạm', color: '#5b9cf6', tags: ['thịt', 'cá', 'hải sản', 'gia cầm', 'trứng', 'thịt đỏ', 'cá béo', 'đậu', 'đạm thực vật', 'đạm'] },
  { id: 'veg', label: 'Rau củ', color: '#4caf7d', tags: ['rau', 'rau củ', 'rau thơm', 'nấm', 'rong biển'] },
  { id: 'fruit', label: 'Trái cây', color: '#f5a623', tags: ['trái cây'] },
  { id: 'dairy', label: 'Sữa', color: '#9b8ef0', tags: ['sữa', 'đồ uống lên men'] },
  { id: 'fat', label: 'Chất béo', color: '#e8834a', tags: ['chất béo', 'chất béo tốt', 'chất béo bão hòa', 'hạt'] },
  { id: 'liquid', label: 'Nước dùng', color: '#8fb8d8', tags: ['nước'] },
  { id: 'season', label: 'Gia vị', color: '#c4a875', tags: ['gia vị', 'natri', 'món ngọt', 'đường bổ sung'] },
];

/**
 * Thuộc tính đáng lưu ý — ĐẾM nguyên liệu, không cộng gram.
 *
 * `good`/`warn` để giao diện tô màu: thực đơn ở đây dành cho người tiểu đường,
 * gout, cao huyết áp… nên "natri" hay "đường bổ sung" là thứ phải nhìn thấy.
 */
const HIGHLIGHTS = [
  { id: 'fiber', label: 'Giàu chất xơ', tag: 'chất xơ', tone: 'good' },
  { id: 'goodfat', label: 'Chất béo tốt', tag: 'chất béo tốt', tone: 'good' },
  { id: 'wholegrain', label: 'Ngũ cốc nguyên hạt', tag: 'ngũ cốc nguyên hạt', tone: 'good' },
  { id: 'plantprotein', label: 'Đạm thực vật', tag: 'đạm thực vật', tone: 'good' },
  { id: 'sodium', label: 'Nhiều natri', tag: 'natri', tone: 'warn' },
  { id: 'satfat', label: 'Chất béo bão hoà', tag: 'chất béo bão hòa', tone: 'warn' },
  { id: 'redmeat', label: 'Thịt đỏ', tag: 'thịt đỏ', tone: 'warn' },
  { id: 'addedsugar', label: 'Đường bổ sung', tag: 'đường bổ sung', tone: 'warn' },
];

const low = (v) => String(v ?? '').trim().toLowerCase();

/** Nhóm của một nguyên liệu; null nếu nhãn không thuộc nhóm nào đã biết. */
export function groupOf(tags) {
  const set = new Set((tags || []).map(low));
  for (const g of GROUPS) {
    if (g.tags.some((t) => set.has(t))) return g;
  }
  return null;
}

/**
 * @param {Array} ingredients  [{ name, grams, unit, tags }]
 * @returns {{ groups: Array, highlights: Array, totalGrams: number, counted: number }}
 */
export function analyseIngredients(ingredients) {
  const list = ingredients || [];
  const byGroup = new Map();
  let totalGrams = 0;
  let counted = 0;

  for (const i of list) {
    // Chỉ cộng nguyên liệu tính bằng khối lượng/thể tích. "1 quả", "2 bó" mà
    // cộng vào cùng một tổng gram là cộng táo với cam.
    const unit = low(i.unit);
    const grams = Number(i.grams);
    const usable = Number.isFinite(grams) && grams > 0 && (unit === 'g' || unit === 'ml' || unit === '');
    if (!usable) continue;

    const g = groupOf(i.tags) || { id: 'other', label: 'Khác', color: '#b9c2bd' };
    const prev = byGroup.get(g.id) || { ...g, grams: 0, items: [] };
    prev.grams += grams;
    prev.items.push(i.name);
    byGroup.set(g.id, prev);
    totalGrams += grams;
    counted += 1;
  }

  const order = [...GROUPS.map((g) => g.id), 'other'];
  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, percent: totalGrams ? (g.grams / totalGrams) * 100 : 0 }))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  // Thuộc tính đếm trên TOÀN BỘ nguyên liệu, kể cả loại không tính được gram.
  const highlights = HIGHLIGHTS
    .map((h) => ({ ...h, count: list.filter((i) => (i.tags || []).some((t) => low(t) === h.tag)).length }))
    .filter((h) => h.count > 0);

  return { groups, highlights, totalGrams: Math.round(totalGrams), counted };
}

export { GROUPS, HIGHLIGHTS };
export default { analyseIngredients, groupOf, GROUPS, HIGHLIGHTS };
