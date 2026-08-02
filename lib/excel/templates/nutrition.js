/**
 * lib/excel/templates/nutrition.js — SHEET 2: THÔNG TIN DINH DƯỠNG.
 *
 * Tách khỏi Sheet 1 để bố cục thực đơn không bị rối (theo yêu cầu). Ở đây in
 * đầy đủ mọi chỉ số hệ thống đang lưu trong plan_dishes:
 *   calories · protein · carbs · fat · fiber · sugar · sodium
 *
 * Thêm một khối tổng theo NGÀY để người dùng thấy nhịp năng lượng trong tuần —
 * thứ không tra được nếu chỉ nhìn danh sách món.
 */
const COLUMN_DEFS = [
  { key: 'calories', header: 'Calo (kcal)', numFmt: '#,##0' },
  { key: 'protein', header: 'Đạm (g)', numFmt: '#,##0.0' },
  { key: 'carbs', header: 'Tinh bột (g)', numFmt: '#,##0.0' },
  { key: 'fat', header: 'Chất béo (g)', numFmt: '#,##0.0' },
  { key: 'fiber', header: 'Chất xơ (g)', numFmt: '#,##0.0' },
  { key: 'sugar', header: 'Đường (g)', numFmt: '#,##0.0' },
  { key: 'sodium', header: 'Natri (mg)', numFmt: '#,##0' },
];

export function nutritionSheet(model) {
  const { dishes, days, servings } = model;

  // Chỉ in cột nào THỰC SỰ có số liệu — tránh 3 cột toàn dấu gạch.
  const activeCols = COLUMN_DEFS.filter((c) => dishes.some((d) => d[c.key] != null && d[c.key] !== 0));
  const cols = activeCols.length ? activeCols : COLUMN_DEFS.slice(0, 4);

  // Giá tiền là chuỗi khoảng giá nguyên văn (role 'text', KHÔNG phải numeric) —
  // ép sang số sẽ phá đúng thứ người dùng đã gõ. Chỉ in cột này khi thực đơn
  // thật sự có giá, để file của thực đơn không khai giá không thừa một cột rỗng.
  const hasPrice = dishes.some((d) => String(d.price || '').trim() !== '');
  // Nguyên liệu in kèm để file xuất ra nạp lại được mà không mất dữ liệu.
  const hasIngredients = dishes.some((d) => d.ingredients?.length);

  const columns = [
    { header: 'Ngày', role: 'label', width: 13 },
    { header: 'Bữa', role: 'label', width: 13 },
    { header: 'Món ăn', role: 'text' },
    ...(hasPrice ? [{ header: 'Giá tiền', role: 'text', width: 22 }] : []),
    ...(hasIngredients ? [{ header: 'Nguyên liệu', role: 'text', width: 40 }] : []),
    { header: 'Khối lượng (g)', role: 'numeric', numFmt: '#,##0' },
    ...cols.map((c) => ({ header: c.header, role: 'numeric', numFmt: c.numFmt })),
  ];

  const rows = dishes.map((d) => [
    d.dayLabel,
    d.mealLabel,
    d.adjusted ? { value: d.name, note: d.reason || undefined } : d.name,
    ...(hasPrice ? [d.price || ''] : []),
    ...(hasIngredients ? [describeIngredients(d.ingredients)] : []),
    d.grams ?? '',
    ...cols.map((c) => (d[c.key] == null ? '' : d[c.key])),
  ]);

  const totalRow = [
    'TỔNG',
    '',
    `${dishes.length} món`,
    // Không cộng tổng giá: các ô là khoảng giá dạng chữ, cộng lại là bịa số.
    ...(hasPrice ? [''] : []),
    ...(hasIngredients ? [''] : []),
    sum(dishes, 'grams'),
    ...cols.map((c) => round(sum(dishes, c.key), c.key === 'calories' || c.key === 'sodium' ? 0 : 1)),
  ];

  const blocks = [
    { type: 'title', text: 'THÔNG TIN DINH DƯỠNG CHI TIẾT' },
    {
      type: 'meta',
      pairs: [
        ['Số suất', `${servings} suất/bữa`],
        ['Số món', String(dishes.length)],
        ['Số ngày', String(days.length)],
        ['Ghi chú', 'Giá trị đã nhân theo số suất'],
      ],
      perRow: Math.max(1, Math.floor(columns.length / 2)),
    },
    { type: 'spacer' },
    {
      type: 'table',
      columns,
      rows,
      options: { uniformHeight: false, zebra: true, totalRow, heightRange: { min: 20, max: 80 } },
    },
    { type: 'spacer' },
    buildDailySection(days, cols),
    { type: 'spacer' },
    {
      type: 'note',
      text:
        'Lưu ý: Số liệu dinh dưỡng được ước tính từ thư viện món ăn và đã nhân theo số suất. ' +
        'Sai số phụ thuộc cách chế biến, kích cỡ khẩu phần thực tế và nguồn nguyên liệu. ' +
        'Không dùng thay cho xét nghiệm hoặc chỉ định điều trị.',
    },
  ].filter(Boolean);

  return {
    name: 'DINH DƯỠNG',
    width: columns.length,
    blocks,
    freeze: 0,
    print: { orientation: 'landscape', footerLeft: 'Thông tin dinh dưỡng' },
  };
}

/** Khối tổng theo ngày — nhìn được nhịp năng lượng cả tuần. */
function buildDailySection(days, cols) {
  if (!days?.length) return null;
  return {
    type: 'section',
    title: 'TỔNG HỢP THEO NGÀY',
    span: 1 + cols.length,
    columns: [
      { header: 'Ngày', role: 'label', width: 14 },
      ...cols.map((c) => ({ header: c.header, role: 'numeric', numFmt: c.numFmt })),
    ],
    rows: days.map((d) => [d.labelPlain, ...cols.map((c) => d.totals[c.key] ?? '')]),
    options: {
      uniformHeight: true,
      heightRange: { min: 20, max: 40 },
      totalRow: ['TỔNG TUẦN', ...cols.map((c) => round(days.reduce((s, d) => s + (d.totals[c.key] || 0), 0), c.key === 'calories' || c.key === 'sodium' ? 0 : 1))],
    },
  };
}

/**
 * Nguyên liệu của một món → một ô nhiều dòng:
 *   Bánh phở · 180 g · 12.000đ
 *   Thịt gà · 100 g
 * Mỗi nguyên liệu một dòng để đọc được, và để người dùng chép ngược lại vào
 * mẫu nhập nếu muốn.
 */
function describeIngredients(list) {
  if (!list?.length) return '';
  return list
    .map((i) => {
      const bits = [i.name];
      if (i.grams != null) bits.push(`${Number(i.grams).toLocaleString('vi-VN')} ${i.unit || 'g'}`);
      if (String(i.price || '').trim()) bits.push(i.price);
      return bits.join(' · ');
    })
    .join('\n');
}

function sum(rows, key) {
  return round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0), 1);
}

function round(v, d = 1) {
  const m = 10 ** d;
  return Math.round((Number(v) || 0) * m) / m;
}

export default nutritionSheet;
