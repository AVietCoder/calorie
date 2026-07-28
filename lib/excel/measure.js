/**
 * lib/excel/measure.js — đo đạc hình học.
 *
 * Excel chỉ tự co giãn chiều cao hàng khi ô KHÔNG bị merge và người dùng chưa
 * set height. Các file mẫu đều set height tường minh, nên bản sinh ra cũng phải
 * làm vậy — nếu không, hàng có wrapText sẽ bị cắt khi mở bằng LibreOffice hoặc
 * khi in.
 *
 * Quy tắc rút ra từ corpus:
 *   • một bảng dữ liệu dùng MỘT chiều cao đồng nhất cho mọi hàng thân bảng,
 *     bằng chiều cao của hàng cao nhất (Vinmec: 62 đều, Nutrihome: 112 đều);
 *   • chiều cao ≈ số dòng hiển thị × 15.75, làm tròn lên số chẵn;
 *   • bề rộng cột bị chặn trong khoảng 10–52.
 */
import { METRICS } from './theme.js';

/** Ký tự vừa trong một dòng của cột rộng `width` (font 11pt). */
function charsPerLine(width) {
  return Math.max(4, Math.floor(width * 1.05));
}

/** Số dòng hiển thị của một chuỗi trong cột rộng `width` (tính cả \n thủ công). */
export function countLines(value, width) {
  if (value == null || value === '') return 1;
  const cpl = charsPerLine(width);
  return String(value)
    .split('\n')
    .reduce((sum, seg) => sum + Math.max(1, Math.ceil(seg.length / cpl)), 0);
}

/**
 * Chiều cao đồng nhất cho một khối hàng.
 * @param {Array<Array<any>>} rows   ma trận giá trị
 * @param {number[]} widths          bề rộng từng cột
 */
export function uniformRowHeight(rows, widths, { min = METRICS.MIN_DATA_ROW_HEIGHT, max = METRICS.MAX_DATA_ROW_HEIGHT } = {}) {
  let maxLines = 1;
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      maxLines = Math.max(maxLines, countLines(row[i], widths[i] ?? METRICS.MIN_COL_WIDTH));
    }
  }
  const raw = maxLines * METRICS.LINE_HEIGHT + 6;
  return clampEven(raw, min, max);
}

/** Chiều cao riêng cho một hàng (dùng cho ghi chú merge full-width). */
export function singleRowHeight(text, totalWidth, { min = METRICS.NOTE_MIN_HEIGHT, max = METRICS.MAX_DATA_ROW_HEIGHT } = {}) {
  const lines = countLines(text, totalWidth);
  return clampEven(lines * METRICS.LINE_HEIGHT + 6, min, max);
}

function clampEven(v, min, max) {
  const rounded = Math.ceil(v / 2) * 2;
  return Math.min(max, Math.max(min, rounded));
}

/**
 * Tự tính bề rộng cột từ nội dung.
 * Không dùng max thuần (một ô dài sẽ kéo cột ra 200 ký tự) mà dùng phân vị 80
 * — đúng cảm quan của corpus, nơi cột mô tả dài dừng ở 45–50.
 *
 * @param {Array<Array<any>>} rows
 * @param {object[]} columns  [{ width?, role? }] — width truyền vào sẽ được tôn trọng
 */
export function autoColumnWidths(rows, columns) {
  return columns.map((col, i) => {
    if (Number.isFinite(col.width)) return col.width;
    if (col.role === 'label') return METRICS.LABEL_COL_WIDTH;
    if (col.role === 'numeric') return col.header ? clampWidth(col.header.length + 6, 12, 20) : METRICS.NUMERIC_COL_WIDTH;

    const lengths = rows
      .map((r) => longestSegment(r[i]))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    if (!lengths.length) return METRICS.MIN_COL_WIDTH;

    const p80 = lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.8))];
    const headerLen = String(col.header || '').length;
    return clampWidth(Math.max(p80 * 0.62 + 10, headerLen + 4));
  });
}

/** Đoạn dài nhất giữa các lần xuống dòng — cột chỉ cần rộng bằng đoạn đó. */
function longestSegment(v) {
  if (v == null) return 0;
  return String(v)
    .split('\n')
    .reduce((m, s) => Math.max(m, s.length), 0);
}

function clampWidth(v, min = METRICS.MIN_COL_WIDTH, max = METRICS.MAX_COL_WIDTH) {
  return Math.min(max, Math.max(min, Math.round(v)));
}

export default { countLines, uniformRowHeight, singleRowHeight, autoColumnWidths };
