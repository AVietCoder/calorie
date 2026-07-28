/**
 * lib/excel/renderer.js — RENDERING ENGINE.
 *
 *   Data ─▶ Template ─▶ Style ─▶ [Renderer] ─▶ Excel
 *
 * Engine không biết gì về thực đơn, dinh dưỡng hay đi chợ. Nó chỉ biết dựng
 * các KHỐI (block) theo đúng ngữ pháp bố cục đã trích từ corpus file mẫu:
 *
 *     title → meta → (spacer) → table → (spacer) → section* → (spacer) → note
 *
 * Thêm loại báo cáo mới = viết một template trả về mảng block, KHÔNG sửa file này.
 *
 * Các loại block hỗ trợ:
 *   { type:'title',   text }
 *   { type:'meta',    pairs:[[label,value], …] }        // tự xếp thành cặp trên 1 hàng
 *   { type:'spacer',  height? }
 *   { type:'table',   columns:[…], rows:[[…]], options? }
 *   { type:'section', title, columns:[…], rows:[[…]] }
 *   { type:'note',    text }
 *   { type:'raw',     render(ctx) }                     // cửa thoát hiểm
 */
import ExcelJS from 'exceljs';
import { createTheme } from './theme.js';
import { createStyleSheet } from './styles.js';
import { autoColumnWidths, uniformRowHeight, singleRowHeight } from './measure.js';
import { applyPageSetup } from './page-setup.js';

/**
 * @param {object} spec
 * @param {string} spec.name          tên sheet
 * @param {object[]} spec.blocks
 * @param {number} [spec.width]       số cột của sheet (mặc định suy từ block rộng nhất)
 * @param {string} [spec.variant]     biến thể theme
 * @param {object} [spec.print]       tuỳ chọn in (xem page-setup.js)
 */
export function renderSheet(workbook, spec) {
  const theme = createTheme(spec.variant);
  const S = createStyleSheet(theme);
  const ws = workbook.addWorksheet(sanitizeSheetName(spec.name), {
    views: spec.freeze ? [{ state: 'frozen', ySplit: spec.freeze }] : [{ showGridLines: false }],
  });
  if (spec.freeze) ws.views = [{ state: 'frozen', ySplit: spec.freeze, showGridLines: false }];

  const sheetWidth = spec.width || inferWidth(spec.blocks);
  const ctx = { ws, S, theme, sheetWidth, row: 1, colWidths: new Array(sheetWidth).fill(null) };

  for (const block of spec.blocks) {
    if (!block) continue;
    const fn = BLOCK_RENDERERS[block.type];
    if (!fn) throw new Error(`Block type không hỗ trợ: ${block.type}`);
    fn(ctx, block);
  }

  // Áp bề rộng cột đã chốt (block nào set trước thì thắng — bảng chính luôn đứng đầu).
  ctx.colWidths.forEach((w, i) => {
    if (w) ws.getColumn(i + 1).width = w;
  });

  applyPageSetup(ws, { sheetWidth, ...(spec.print || {}) });
  return ws;
}

/* ───────────────────────── block renderers ───────────────────────── */

const BLOCK_RENDERERS = {
  title(ctx, { text, height }) {
    const { ws, S, sheetWidth } = ctx;
    const row = ws.getRow(ctx.row);
    row.getCell(1).value = text;
    ws.mergeCells(ctx.row, 1, ctx.row, sheetWidth);
    applyStyle(row.getCell(1), S.title());
    row.height = height || theMetric(ctx, 'TITLE_ROW_HEIGHT');
    ctx.row += 1;
  },

  /**
   * Dải metadata. Corpus xếp các cặp nhãn/giá trị liền nhau theo chiều ngang và
   * tô nền hết chiều rộng sheet — kể cả ô trống — nên ta tái tạo đúng như vậy.
   */
  meta(ctx, { pairs, perRow }) {
    const { ws, S, sheetWidth } = ctx;
    const slots = Math.max(1, perRow || Math.floor(sheetWidth / 2) || 1);
    for (let i = 0; i < pairs.length; i += slots) {
      const chunk = pairs.slice(i, i + slots);
      const row = ws.getRow(ctx.row);
      let col = 1;
      for (const [label, value] of chunk) {
        if (col <= sheetWidth) {
          row.getCell(col).value = label;
          applyStyle(row.getCell(col), S.metaLabel());
        }
        if (col + 1 <= sheetWidth) {
          row.getCell(col + 1).value = value == null ? '' : value;
          applyStyle(row.getCell(col + 1), S.metaValue());
        }
        col += 2;
      }
      for (; col <= sheetWidth; col++) applyStyle(row.getCell(col), S.metaValue());
      row.height = theMetric(ctx, 'META_ROW_HEIGHT');
      ctx.row += 1;
    }
  },

  spacer(ctx, { height }) {
    if (height) ctx.ws.getRow(ctx.row).height = height;
    ctx.row += 1;
  },

  table(ctx, block) {
    renderTable(ctx, block, { headerStyle: ctx.S.tableHeader() });
  },

  section(ctx, block) {
    const { ws, S, sheetWidth } = ctx;
    const span = block.span || Math.min(sheetWidth, Math.max(2, block.columns.length));

    const row = ws.getRow(ctx.row);
    row.getCell(1).value = block.title;
    ws.mergeCells(ctx.row, 1, ctx.row, span);
    applyStyle(row.getCell(1), S.sectionHeader());
    row.height = theMetric(ctx, 'HEADER_ROW_HEIGHT');
    ctx.row += 1;

    renderTable(ctx, block, { headerStyle: S.sectionSubHeader(), narrow: true });
  },

  note(ctx, { text, height }) {
    const { ws, S, sheetWidth } = ctx;
    const row = ws.getRow(ctx.row);
    row.getCell(1).value = text;
    ws.mergeCells(ctx.row, 1, ctx.row, sheetWidth);
    applyStyle(row.getCell(1), S.note());
    const totalWidth = ctx.colWidths.reduce((s, w) => s + (w || 10), 0);
    row.height = height || singleRowHeight(text, totalWidth);
    ctx.row += 1;
  },

  raw(ctx, { render }) {
    render(ctx);
  },
};

/* ───────────────────────── shared table renderer ───────────────────────── */

function renderTable(ctx, block, { headerStyle, narrow = false }) {
  const { ws, S } = ctx;
  const columns = block.columns || [];
  const rows = block.rows || [];
  const opts = block.options || {};

  const widths = autoColumnWidths(rows, columns);
  // Cột nào đã có bề rộng thì giữ nguyên (bảng chính quyết định layout sheet).
  widths.forEach((w, i) => {
    if (!narrow || ctx.colWidths[i] == null) ctx.colWidths[i] = ctx.colWidths[i] ?? w;
  });
  const effWidths = columns.map((_, i) => ctx.colWidths[i] || widths[i]);

  // hàng tiêu đề
  if (columns.some((c) => c.header)) {
    const hr = ws.getRow(ctx.row);
    columns.forEach((c, i) => {
      hr.getCell(i + 1).value = c.header ?? '';
      applyStyle(hr.getCell(i + 1), headerStyle);
    });
    hr.height = theMetric(ctx, 'HEADER_ROW_HEIGHT');
    ctx.row += 1;
  }

  if (!rows.length) return;

  const uniform = opts.uniformHeight !== false;
  const height = uniform ? uniformRowHeight(rows, effWidths, opts.heightRange || {}) : null;

  rows.forEach((r, rIdx) => {
    const row = ws.getRow(ctx.row);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const raw = r[i];
      // Ô có thể là giá trị thuần hoặc { value, style, note, numFmt }
      const isObj = raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw;
      const value = isObj ? raw.value : raw;
      cell.value = value == null ? '' : value;

      let style;
      if (isObj && raw.style && S[raw.style]) style = S[raw.style](raw.styleOptions || {});
      else if (c.role === 'label') style = S.rowLabel();
      else if (c.role === 'numeric') style = S.numeric({ numFmt: c.numFmt });
      else if (c.role === 'checkbox') style = S.checkbox();
      else style = S.body({ zebra: opts.zebra && rIdx % 2 === 1 });

      applyStyle(cell, style);
      if (isObj && raw.numFmt) cell.numFmt = raw.numFmt;
      if (isObj && raw.note) cell.note = raw.note;
    });
    row.height = height || uniformRowHeight([r], effWidths, opts.heightRange || {});
    ctx.row += 1;
  });

  if (opts.totalRow) {
    const row = ws.getRow(ctx.row);
    opts.totalRow.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v == null ? '' : v;
      applyStyle(cell, S.total());
      const col = columns[i];
      if (col?.numFmt) cell.numFmt = col.numFmt;
    });
    row.height = theMetric(ctx, 'HEADER_ROW_HEIGHT');
    ctx.row += 1;
  }
}

/* ───────────────────────── utils ───────────────────────── */

function applyStyle(cell, style) {
  if (!style) return;
  if (style.font) cell.font = style.font;
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.border) cell.border = style.border;
  if (style.numFmt) cell.numFmt = style.numFmt;
}

function theMetric(ctx, key) {
  return ctx.theme.metrics[key];
}

function inferWidth(blocks) {
  let w = 1;
  for (const b of blocks || []) {
    if (b?.columns?.length) w = Math.max(w, b.columns.length);
    if (b?.type === 'meta') w = Math.max(w, 2);
  }
  return w;
}

/** Excel cấm : \ / ? * [ ] và giới hạn 31 ký tự cho tên sheet. */
export function sanitizeSheetName(name) {
  return String(name || 'Sheet')
    .replace(/[:\\/?*[\]]/g, '-')
    .slice(0, 31);
}

/**
 * Dựng workbook hoàn chỉnh từ nhiều sheet spec và trả về Buffer.
 * @param {object} doc  { creator?, title?, sheets: SheetSpec[] }
 */
export async function renderWorkbook(doc) {
  const wb = new ExcelJS.Workbook();
  wb.creator = doc.creator || 'Dr.Fit';
  wb.lastModifiedBy = doc.creator || 'Dr.Fit';
  wb.created = new Date();
  wb.modified = new Date();
  if (doc.title) wb.title = doc.title;

  for (const sheet of doc.sheets) renderSheet(wb, sheet);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export default { renderSheet, renderWorkbook, sanitizeSheetName };
