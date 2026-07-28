/**
 * lib/excel/theme.js — LỚP STYLE (design tokens).
 *
 * Toàn bộ màu / font / kích thước KHÔNG được viết tay ở đây theo một file mẫu
 * cụ thể. Chúng được suy ra từ corpus 43 file mẫu bởi
 * scripts/extract-excel-templates.py và nạp từ knowledge/excel-theme.json.
 *
 * Muốn đổi bộ nhận diện? Thêm file mẫu mới rồi chạy lại script — không sửa code.
 *
 *   Data ─▶ Template ─▶ [Style] ─▶ Renderer ─▶ Excel
 *
 * Fallback tokens chỉ dùng khi knowledge/excel-theme.json chưa được build,
 * để export không bao giờ chết vì thiếu artifact.
 */
import themeArtifact from '../../knowledge/excel-theme.json' with { type: 'json' };

/* ─────────────── fallback: bộ token tối thiểu ─────────────── */
const FALLBACK = {
  'font.name': 'Carlito',
  'title.fill': 'FF2F6B4F',
  'title.fontColor': 'FFFFFFFF',
  'title.size': 16,
  'meta.fill': 'FFE9F5EE',
  'meta.fontColor': 'FF2F6B4F',
  'meta.size': 11,
  'tableHeader.fill': 'FF5D9277',
  'tableHeader.fontColor': 'FFFFFFFF',
  'tableHeader.size': 11,
  'rowLabel.fill': 'FFDDECE3',
  'rowLabel.fontColor': 'FF2F6B4F',
  'rowLabel.size': 11,
  'sectionHeader.fill': 'FF2F7666',
  'sectionHeader.fontColor': 'FFFFFFFF',
  'sectionHeader.size': 11,
  'note.fill': 'FFFFF4DA',
  'note.fontColor': 'FF7A5814',
  'note.size': 11,
  'numeric.fill': 'FFF4FAF7',
  'dataRow.size': 11,
};

const TOKENS = { ...FALLBACK, ...(themeArtifact?.tokens || {}) };

/**
 * Token phái sinh — các vai trò mà corpus không phân biệt được bằng heuristic
 * (subheader của section, ô cảnh báo…) được suy ra từ token gốc thay vì bịa số.
 */
const DERIVED = {
  'sectionSubHeader.fill': 'FFDDEDE7',
  'sectionSubHeader.fontColor': 'FF24584D',
  // Cảnh báo / highlight: dùng chung hệ vàng-nâu của khối ghi chú.
  'warn.fill': TOKENS['note.fill'],
  'warn.fontColor': TOKENS['note.fontColor'],
  'zebra.fill': 'FFF7FBF9',
  'done.fontColor': 'FF6B7280',
};

export const FONT_NAME = TOKENS['font.name'] || 'Carlito';
export const FONT_SIZE = Number(TOKENS['dataRow.size']) || 11;

/**
 * Kích thước hình học lấy từ corpus (đơn vị của Excel).
 * LINE_HEIGHT = chiều cao 1 dòng text 11pt; các mẫu đều là bội số của nó.
 */
export const METRICS = {
  LINE_HEIGHT: 15.75,
  TITLE_ROW_HEIGHT: 30,
  META_ROW_HEIGHT: 22,
  HEADER_ROW_HEIGHT: 24,
  MIN_DATA_ROW_HEIGHT: 28,
  MAX_DATA_ROW_HEIGHT: 220,
  NOTE_MIN_HEIGHT: 40,
  MIN_COL_WIDTH: 10,
  MAX_COL_WIDTH: 52,
  LABEL_COL_WIDTH: Number(TOKENS['columnWidth']) || 13,
  NUMERIC_COL_WIDTH: 14,
};

/** Bảng biến thể — cho phép chọn tông màu khác mà vẫn nằm trong corpus. */
export const VARIANTS = themeArtifact?.variants || {};

/**
 * @param {string} [variant] khoá biến thể, ví dụ 'teal'. Không truyền = canonical.
 */
export function createTheme(variant) {
  const t = { ...TOKENS, ...DERIVED };
  if (variant && VARIANT_PRESETS[variant]) Object.assign(t, VARIANT_PRESETS[variant]);
  return {
    token: (key, fallback = null) => t[key] ?? fallback,
    fontName: t['font.name'] || FONT_NAME,
    metrics: METRICS,
    all: t,
  };
}

/**
 * Preset chỉ gom các giá trị ĐÃ XUẤT HIỆN trong corpus (xem `variants` trong
 * knowledge/excel-theme.json) — không phải màu tự nghĩ ra.
 */
export const VARIANT_PRESETS = {
  green: {},
  teal: {
    'title.fill': 'FF245F52',
    'meta.fill': 'FFE8F4F0',
    'tableHeader.fill': 'FF4E9385',
    'rowLabel.fill': 'FFDFF0EA',
    'rowLabel.fontColor': 'FF24584E',
  },
  ocean: {
    'title.fill': 'FF1F5F8B',
    'meta.fill': 'FFEAF3F8',
    'tableHeader.fill': 'FF4B8DB8',
    'rowLabel.fill': 'FFE5F0F7',
    'rowLabel.fontColor': 'FF1F5F8B',
  },
};

export const CORPUS_SIZE = themeArtifact?._corpusSize || 0;

export default { createTheme, FONT_NAME, FONT_SIZE, METRICS, VARIANTS, VARIANT_PRESETS, CORPUS_SIZE };
