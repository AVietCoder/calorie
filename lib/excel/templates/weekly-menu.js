/**
 * lib/excel/templates/weekly-menu.js — SHEET 1: THỰC ĐƠN.
 *
 * Đây là sheet phải giống các file mẫu gần như 100%. Nó tái tạo đúng ngữ pháp
 * bố cục đã trích từ corpus 43 file:
 *
 *     TITLE  → META → (trống) → BẢNG NGÀY×BỮA → (trống) → SECTION* → (trống) → NOTE
 *
 * KHÔNG có cột dinh dưỡng ở đây (theo yêu cầu) — số liệu nằm ở Sheet 2.
 * Template chỉ trả về mảng block; nó không biết ExcelJS tồn tại.
 */
import { mealLabel } from '../labels.js';

const DEFAULT_NOTE =
  'Lưu ý: Thực đơn do hệ thống sinh tự động từ thư viện mẫu và đã được điều chỉnh theo hồ sơ ' +
  'sức khoẻ của từng thành viên. Đây là gợi ý tham khảo, không thay thế chỉ định của bác sĩ ' +
  'hoặc chuyên gia dinh dưỡng. Người có bệnh lý nền, đang dùng thuốc, phụ nữ mang thai hoặc ' +
  'trẻ nhỏ cần được tư vấn cá nhân hoá trước khi áp dụng.';

/**
 * @param {object} model  kết quả buildExportModel()
 * @returns {object} SheetSpec cho renderSheet()
 */
export function weeklyMenuSheet(model) {
  const { days, mealTypes, household, template, servings, warnings } = model;

  /* ── cột: [Ngày] + mỗi bữa một cột ── */
  const columns = [
    { header: 'Ngày', role: 'label', width: 14 },
    ...mealTypes.map((mt) => ({ header: mealLabel(mt), role: 'text' })),
  ];

  /* ── thân bảng: mỗi ngày một hàng ── */
  const rows = days.map((day) => [
    day.label,
    ...mealTypes.map((mt) => day.meals[mt]?.text || ''),
  ]);

  /* ── dải metadata ── */
  const pairs = [
    ['Nguồn', template?.title || 'Thư viện thực đơn Calorie AI'],
    ['Số suất', `${servings} suất/bữa`],
    ['Cơ cấu bữa', mealTypes.map(mealLabel).join(' + ')],
    ['Ngày xuất', formatDate(model.generatedAt)],
  ];
  if (household?.region) pairs.push(['Khu vực', household.region]);
  if (model.startDate) pairs.push(['Áp dụng từ', formatDate(new Date(model.startDate))]);

  /* ── các khối phụ: chỉ thêm khi CÓ dữ liệu, không chèn khối rỗng ── */
  const sections = [];

  const memberSection = buildMemberSection(model);
  if (memberSection) sections.push({ type: 'spacer' }, memberSection);

  const adjustSection = buildAdjustmentSection(model);
  if (adjustSection) sections.push({ type: 'spacer' }, adjustSection);

  const blocks = [
    { type: 'title', text: buildTitle(model) },
    { type: 'meta', pairs, perRow: Math.max(1, Math.floor(columns.length / 2)) },
    { type: 'spacer' },
    { type: 'table', columns, rows, options: { uniformHeight: true } },
    ...sections,
    { type: 'spacer' },
    { type: 'note', text: buildNote(warnings) },
  ];

  return {
    name: 'THỰC ĐƠN',
    width: columns.length,
    blocks,
    print: {
      // Lặp lại hàng tiêu đề bảng (hàng 5 sau title+meta+spacer) trên mọi trang in.
      repeatRows: `${headerRowIndex(pairs, columns.length)}:${headerRowIndex(pairs, columns.length)}`,
      footerLeft: buildTitle(model),
    },
  };
}

/* ───────────────────────── khối phụ ───────────────────────── */

/** "THÀNH VIÊN & LƯU Ý SỨC KHOẺ" — thứ các file mẫu không có mà bản sinh nên có. */
function buildMemberSection(model) {
  const members = model.members || [];
  if (!members.length) return null;

  const rows = members.map((m) => [
    m.display_name || 'Thành viên',
    m.disease || '—',
    (m.allergies || []).join(', ') || '—',
    (m.dislikes || []).join(', ') || '—',
  ]);

  return {
    type: 'section',
    title: 'THÀNH VIÊN & RÀNG BUỘC ĐÃ ÁP DỤNG',
    span: 4,
    columns: [
      { header: 'Thành viên', role: 'label', width: 20 },
      { header: 'Bệnh lý', role: 'text', width: 22 },
      { header: 'Dị ứng', role: 'text', width: 24 },
      { header: 'Không thích', role: 'text', width: 24 },
    ],
    rows,
    options: { uniformHeight: true, heightRange: { min: 22, max: 90 } },
  };
}

/** Nhật ký Rule Engine — minh bạch vì sao món bị đổi. */
function buildAdjustmentSection(model) {
  const adjusted = (model.dishes || []).filter((d) => d.adjusted);
  if (!adjusted.length) return null;

  const rows = adjusted.slice(0, 40).map((d) => [
    `${d.dayLabel} · ${d.mealLabel}`,
    d.name,
    d.reason || 'Đã điều chỉnh theo quy tắc dinh dưỡng',
  ]);

  return {
    type: 'section',
    title: 'CÁC MÓN ĐÃ ĐƯỢC ĐIỀU CHỈNH TỰ ĐỘNG',
    span: 3,
    columns: [
      { header: 'Vị trí', role: 'label', width: 20 },
      { header: 'Món hiện tại', role: 'text', width: 30 },
      { header: 'Lý do', role: 'text', width: 48 },
    ],
    rows,
    options: { uniformHeight: true, heightRange: { min: 22, max: 90 } },
  };
}

/* ───────────────────────── utils ───────────────────────── */

function buildTitle(model) {
  const diseases = [...new Set((model.members || []).map((m) => m.disease).filter(Boolean))];
  const dayCount = model.days?.length || 0;
  const scope = dayCount === 7 ? 'THỰC ĐƠN 7 NGÀY' : `THỰC ĐƠN ${dayCount} NGÀY`;
  if (diseases.length === 1) return `${scope} CHO NGƯỜI ${diseases[0].toUpperCase()}`;
  if (diseases.length > 1) return `${scope} CHO GIA ĐÌNH (${diseases.join(', ').toUpperCase()})`;
  return `${scope} CHO GIA ĐÌNH`;
}

function buildNote(warnings) {
  if (!warnings?.length) return DEFAULT_NOTE;
  return `${DEFAULT_NOTE}\n• ${warnings.join('\n• ')}`;
}

/** Vị trí hàng tiêu đề bảng = 1 (title) + số hàng meta + 1 (spacer) + 1. */
function headerRowIndex(pairs, sheetWidth) {
  const slots = Math.max(1, Math.floor(sheetWidth / 2) || 1);
  const metaRows = Math.ceil(pairs.length / slots);
  return 1 + metaRows + 1 + 1;
}

function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  const dt = d instanceof Date ? d : new Date(d);
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

export default weeklyMenuSheet;
