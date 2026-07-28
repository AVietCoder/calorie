/**
 * lib/excel/styles.js — ánh xạ VAI TRÒ ngữ nghĩa → style ExcelJS.
 *
 * Renderer không bao giờ biết mã màu; nó chỉ nói "ô này là tableHeader".
 * Nhờ vậy đổi theme = đổi token, không đụng tới renderer hay template.
 *
 * Ghi chú quan trọng rút ra từ corpus: các file mẫu KHÔNG dùng border.
 * Chúng phân tách bằng dải màu nền (fill banding). Ta giữ đúng quy tắc đó —
 * `border` chỉ bật khi template yêu cầu rõ ràng (ví dụ bảng đi chợ có checkbox).
 */
import { createTheme } from './theme.js';

const solid = (argb) => (argb ? { type: 'pattern', pattern: 'solid', fgColor: { argb } } : undefined);

const thin = (argb = 'FFD9E5DF') => ({ style: 'thin', color: { argb } });
export const boxBorder = (argb) => ({ top: thin(argb), left: thin(argb), bottom: thin(argb), right: thin(argb) });

/**
 * @param {object} theme  kết quả createTheme()
 * @returns {Record<string, (opts?) => object>} bảng style theo vai trò
 */
export function createStyleSheet(theme = createTheme()) {
  const t = theme.token.bind(theme);
  const font = (over = {}) => ({ name: theme.fontName, size: 11, ...over });

  return {
    /** Dải tiêu đề lớn, merge hết chiều ngang. */
    title: () => ({
      font: font({ size: Number(t('title.size', 16)), bold: true, color: { argb: t('title.fontColor') } }),
      fill: solid(t('title.fill')),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }),

    /** Dải metadata (Nguồn / Đơn vị / Ngày đăng…) — nhãn in đậm hơn giá trị. */
    metaLabel: () => ({
      font: font({ italic: true, bold: true, color: { argb: t('meta.fontColor') } }),
      fill: solid(t('meta.fill')),
      alignment: { vertical: 'middle', wrapText: true },
    }),
    metaValue: () => ({
      font: font({ italic: true, color: { argb: t('meta.fontColor') } }),
      fill: solid(t('meta.fill')),
      alignment: { vertical: 'middle', wrapText: true },
    }),

    /** Hàng tiêu đề bảng: chữ trắng trên nền xanh trung. */
    tableHeader: () => ({
      font: font({ bold: true, color: { argb: t('tableHeader.fontColor') } }),
      fill: solid(t('tableHeader.fill')),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }),

    /** Cột nhãn bên trái (Thứ 2 / Bữa sáng / Nhóm…). */
    rowLabel: () => ({
      font: font({ bold: true, color: { argb: t('rowLabel.fontColor') } }),
      fill: solid(t('rowLabel.fill')),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }),

    /** Ô nội dung thường: canh trên, xuống dòng tự động, KHÔNG nền. */
    body: ({ zebra = false } = {}) => ({
      font: font(),
      fill: zebra ? solid(t('zebra.fill')) : undefined,
      alignment: { vertical: 'top', wrapText: true },
    }),

    /** Ô số (kcal / đạm / béo…): canh giữa + nền rất nhạt. */
    numeric: ({ numFmt } = {}) => ({
      font: font(),
      fill: solid(t('numeric.fill')),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      numFmt,
    }),

    /** Dải tiêu đề của một khối phụ (NGUYÊN TẮC DINH DƯỠNG…). */
    sectionHeader: () => ({
      font: font({ bold: true, color: { argb: t('sectionHeader.fontColor') } }),
      fill: solid(t('sectionHeader.fill')),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }),
    sectionSubHeader: () => ({
      font: font({ bold: true, color: { argb: t('sectionSubHeader.fontColor') } }),
      fill: solid(t('sectionSubHeader.fill')),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }),

    /** Ghi chú cuối trang: chữ nghiêng nâu trên nền vàng nhạt. */
    note: () => ({
      font: font({ italic: true, color: { argb: t('note.fontColor') } }),
      fill: solid(t('note.fill')),
      alignment: { vertical: 'middle', wrapText: true },
    }),

    /** Ô cảnh báo trong bảng (nguyên liệu thiếu, món bị thay…). */
    warn: () => ({
      font: font({ bold: true, color: { argb: t('warn.fontColor') } }),
      fill: solid(t('warn.fill')),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }),

    /** Ô tổng cộng. */
    total: () => ({
      font: font({ bold: true, color: { argb: t('rowLabel.fontColor') } }),
      fill: solid(t('rowLabel.fill')),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    }),

    /** Ô trống có nền (dùng cho checkbox "đã mua"). */
    checkbox: () => ({
      font: font({ size: 12 }),
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: boxBorder(t('rowLabel.fill')),
    }),
  };
}

export default { createStyleSheet, boxBorder };
