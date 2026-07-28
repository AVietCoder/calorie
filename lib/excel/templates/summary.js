/**
 * lib/excel/templates/summary.js — SHEET 4: TỔNG HỢP.
 *
 * Một trang duy nhất trả lời: tuần này ăn gì, bao nhiêu calo, tốn bao nhiêu tiền.
 * Đây là sheet giám đốc/chủ hộ nhìn đầu tiên, nên ưu tiên số to, ít chữ.
 */

export function summarySheet(model) {
  const { nutritionTotals, shopping, dishes, days, servings, members, household, template } = model;

  const dayCount = Math.max(1, days.length);
  const mealCount = countMeals(days);
  const totalPortions = countPortions(dishes, servings);

  const columns = [
    { header: 'Chỉ số', role: 'label', width: 30 },
    { header: 'Giá trị', role: 'numeric', width: 20 },
    { header: 'Trung bình / ngày', role: 'numeric', width: 22 },
    { header: 'Ghi chú', role: 'text', width: 44 },
  ];

  const nutritionRows = [
    row('Tổng năng lượng', nutritionTotals.calories, dayCount, 'kcal', '#,##0', energyNote(nutritionTotals.calories, dayCount, servings)),
    row('Tổng đạm (Protein)', nutritionTotals.protein, dayCount, 'g', '#,##0.0'),
    row('Tổng tinh bột (Carb)', nutritionTotals.carbs, dayCount, 'g', '#,##0.0'),
    row('Tổng chất béo (Fat)', nutritionTotals.fat, dayCount, 'g', '#,##0.0'),
    row('Tổng chất xơ', nutritionTotals.fiber, dayCount, 'g', '#,##0.0'),
    row('Tổng đường', nutritionTotals.sugar, dayCount, 'g', '#,##0.0'),
    row('Tổng natri', nutritionTotals.sodium, dayCount, 'mg', '#,##0', sodiumNote(nutritionTotals.sodium, dayCount)),
  ].filter((r) => r[1] !== 0 || r[0].includes('năng lượng'));

  const scaleRows = [
    ['Số ngày trong kế hoạch', days.length, '', ''],
    ['Số bữa', mealCount, round(mealCount / dayCount, 1), 'Bữa có món trong kế hoạch'],
    ['Số món khác nhau', new Set(dishes.map((d) => d.name)).size, '', ''],
    ['Tổng lượt món', dishes.length, round(dishes.length / dayCount, 1), ''],
    ['Số suất mỗi bữa', servings, '', members.length ? `${members.length} thành viên trong hộ` : ''],
    ['Tổng số suất phục vụ', totalPortions, round(totalPortions / dayCount, 1), 'Số món × số suất'],
  ];

  const costRows = [
    ['Tổng chi phí dự kiến', shopping.totals.estimatedCost || 0, round((shopping.totals.estimatedCost || 0) / dayCount, 0), shopping.totals.complete ? 'Đã đủ giá mọi nguyên liệu' : `Chưa tính ${shopping.totals.missingPriceCount} nguyên liệu thiếu giá`],
    ['Chi phí / suất', totalPortions ? round((shopping.totals.estimatedCost || 0) / totalPortions, 0) : 0, '', 'Ước tính'],
    ['Số nguyên liệu cần mua', shopping.totals.itemCount, '', `${shopping.totals.groupCount} nhóm hàng`],
    ['Nguyên liệu đã có giá', shopping.totals.pricedCount, '', `${shopping.totals.missingPriceCount} mục hiển thị "-"`],
  ];

  const blocks = [
    { type: 'title', text: 'TỔNG HỢP KẾ HOẠCH THỰC ĐƠN' },
    {
      type: 'meta',
      pairs: [
        ['Gia đình', household?.mode === 'family' ? 'Chế độ gia đình' : 'Chế độ bếp'],
        ['Mẫu nguồn', template?.title || '—'],
        ['Ngày xuất', formatDate(model.generatedAt)],
        ['Số thành viên', String(members.length || 0)],
      ],
      perRow: 2,
    },
    { type: 'spacer' },
    {
      type: 'section',
      title: 'DINH DƯỠNG CẢ TUẦN',
      span: columns.length,
      columns,
      rows: nutritionRows,
      options: { uniformHeight: true, heightRange: { min: 22, max: 50 } },
    },
    { type: 'spacer' },
    {
      type: 'section',
      title: 'QUY MÔ KẾ HOẠCH',
      span: columns.length,
      columns,
      rows: scaleRows,
      options: { uniformHeight: true, heightRange: { min: 22, max: 50 } },
    },
    { type: 'spacer' },
    {
      type: 'section',
      title: 'CHI PHÍ',
      span: columns.length,
      columns: [
        { header: 'Chỉ số', role: 'label', width: 30 },
        { header: 'Giá trị (đ)', role: 'numeric', numFmt: '#,##0', width: 20 },
        { header: 'Trung bình / ngày', role: 'numeric', numFmt: '#,##0', width: 22 },
        { header: 'Ghi chú', role: 'text', width: 44 },
      ],
      rows: costRows,
      options: { uniformHeight: true, heightRange: { min: 22, max: 50 } },
    },
    ...buildCategorySection(shopping),
    { type: 'spacer' },
    { type: 'note', text: buildNote(model) },
  ].filter(Boolean);

  return {
    name: 'TỔNG HỢP',
    width: columns.length,
    blocks,
    print: { orientation: 'portrait', footerLeft: 'Tổng hợp kế hoạch' },
  };
}

/* ───────────────────────── helpers ───────────────────────── */

function buildCategorySection(shopping) {
  if (!shopping.groups?.length) return [];
  return [
    { type: 'spacer' },
    {
      type: 'section',
      title: 'CHI PHÍ THEO NHÓM NGUYÊN LIỆU',
      span: 4,
      columns: [
        { header: 'Nhóm', role: 'label', width: 30 },
        { header: 'Số mục', role: 'numeric', numFmt: '#,##0', width: 20 },
        { header: 'Tạm tính (đ)', role: 'numeric', numFmt: '#,##0', width: 22 },
        { header: 'Tỷ trọng', role: 'text', width: 44 },
      ],
      rows: shopping.groups.map((g) => [
        g.label,
        g.items.length,
        g.subtotal || '-',
        shopping.totals.estimatedCost ? `${Math.round((g.subtotal / shopping.totals.estimatedCost) * 100)}%` : '—',
      ]),
      options: {
        uniformHeight: true,
        heightRange: { min: 22, max: 40 },
        totalRow: ['TỔNG', shopping.totals.itemCount, shopping.totals.estimatedCost || '-', '100%'],
      },
    },
  ];
}

function row(label, total, dayCount, unit, numFmt, note = '') {
  return [
    label,
    { value: total ?? 0, style: 'numeric', numFmt },
    { value: round((total ?? 0) / dayCount, numFmt === '#,##0' ? 0 : 1), style: 'numeric', numFmt },
    note || unit,
  ];
}

function energyNote(total, dayCount, servings) {
  if (!total) return 'Chưa có số liệu calo';
  const perPersonPerDay = Math.round(total / dayCount / Math.max(1, servings));
  return `≈ ${perPersonPerDay.toLocaleString('vi-VN')} kcal/người/ngày`;
}

function sodiumNote(total, dayCount) {
  if (!total) return 'mg';
  const perDay = Math.round(total / dayCount);
  // WHO khuyến nghị < 2000 mg natri/người/ngày.
  return perDay > 2000 * dayCount ? 'Cao hơn khuyến nghị WHO (2.000 mg/người/ngày)' : 'mg';
}

function countMeals(days) {
  return days.reduce((s, d) => s + Object.keys(d.meals || {}).length, 0);
}

function countPortions(dishes, servings) {
  return dishes.length * servings;
}

function buildNote(model) {
  const lines = [
    'Các con số ở đây được tính từ chính dữ liệu trong Sheet DINH DƯỠNG và Sheet ĐI CHỢ, ' +
      'nên luôn khớp với hai sheet đó.',
  ];
  if (model.warnings?.length) lines.push(...model.warnings);
  lines.push('Chi phí là ước tính từ bảng giá tham khảo/giá Admin, dùng để lập ngân sách chứ không phải báo giá.');
  return `Lưu ý: ${lines.join('\n• ')}`;
}

function round(v, d = 0) {
  const m = 10 ** d;
  return Math.round((Number(v) || 0) * m) / m;
}

function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  const dt = d instanceof Date ? d : new Date(d);
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

export default summarySheet;
