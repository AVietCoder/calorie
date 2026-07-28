/**
 * lib/excel/index.js — API công khai của phân hệ Excel.
 *
 * Phần còn lại của ứng dụng CHỈ import từ file này. Nhờ vậy renderer, theme,
 * template có thể được thay đổi mà không phá vỡ route hay UI.
 *
 *   import { exportPlanWorkbook } from '../../../lib/excel/index.js';
 */
import { renderWorkbook } from './renderer.js';
import { selectSheets, STANDALONE_TEMPLATES, SHEET_TEMPLATES } from './templates/index.js';

/**
 * Dựng workbook 4 sheet cho một kế hoạch thực đơn.
 *
 * @param {object} model    kết quả buildExportModel()
 * @param {object} [opts]
 * @param {string[]} [opts.sheets]  chỉ xuất một số sheet, vd ['menu','shopping']
 * @param {string} [opts.variant]   biến thể theme
 * @returns {Promise<{ buffer: Buffer, filename: string, sheets: string[] }>}
 */
export async function exportPlanWorkbook(model, opts = {}) {
  const templates = selectSheets(model, opts.sheets);
  if (!templates.length) throw new Error('Kế hoạch chưa có dữ liệu để xuất.');

  const sheets = templates.map((t) => {
    const spec = t.build(model);
    return opts.variant ? { ...spec, variant: opts.variant } : spec;
  });

  const buffer = await renderWorkbook({
    creator: 'Dr.Fit',
    title: sheets[0]?.blocks?.[0]?.text || 'Thực đơn',
    sheets,
  });

  return { buffer, filename: buildFilename(model), sheets: sheets.map((s) => s.name) };
}

/** File mẫu để người dùng tải về điền (2 sheet: DỮ LIỆU + HƯỚNG DẪN). */
export async function exportImportTemplate(opts = {}) {
  const sheets = [
    STANDALONE_TEMPLATES.importTemplate.build(),
    STANDALONE_TEMPLATES.importGuide.build(),
  ].map((s) => (opts.variant ? { ...s, variant: opts.variant } : s));

  const buffer = await renderWorkbook({
    creator: 'Dr.Fit',
    title: 'Mẫu nhập thực đơn',
    sheets,
  });
  return { buffer, filename: 'calorie-ai-mau-nhap-thuc-don.xlsx', sheets: sheets.map((s) => s.name) };
}

function buildFilename(model) {
  const slug = slugify(model.template?.title || 'thuc-don-gia-dinh');
  const d = model.generatedAt instanceof Date ? model.generatedAt : new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `thuc-don-${slug}-${stamp}.xlsx`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'thuc-don';
}

export { renderWorkbook, SHEET_TEMPLATES };
export { MIME_XLSX } from './mime.js';
export default { exportPlanWorkbook, exportImportTemplate };
