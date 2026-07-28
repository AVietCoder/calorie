/**
 * lib/excel/import/read-sheet.js — BƯỚC 1: đọc file thành lưới thô.
 *
 *   [Đọc file] → Phân tích layout → Nhận diện bảng → … → Lưu DB
 *
 * Dùng SheetJS (`xlsx`) chứ không dùng ExcelJS ở chiều ĐỌC, vì:
 *   • SheetJS khoan dung hơn nhiều với file lệch chuẩn;
 *   • ExcelJS KHÔNG đọc được workbook do openpyxl/LibreOffice sinh ra
 *     (thiếu docProps/app.xml) — mà đó chính là dạng file người dùng hay có.
 *
 * Đầu ra là một "grid" thuần: mảng 2 chiều các ô đã trim, kèm bản đồ merge.
 * Không suy diễn gì ở bước này — mọi thông minh nằm ở analyze-layout.js.
 */
import * as XLSX from 'xlsx';

const MAX_ROWS = 400;
const MAX_COLS = 40;

/**
 * @param {Buffer} buffer
 * @returns {{ sheets: Array<{ name:string, grid:string[][], merges:Array, rows:number, cols:number }> }}
 */
export function readWorkbookGrid(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: false, cellText: false });

  const sheets = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet || !sheet['!ref']) continue;

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const rowCount = Math.min(range.e.r - range.s.r + 1, MAX_ROWS);
    const colCount = Math.min(range.e.c - range.s.c + 1, MAX_COLS);

    const grid = [];
    for (let r = 0; r < rowCount; r++) {
      const row = [];
      for (let c = 0; c < colCount; c++) {
        const addr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
        row.push(cellText(sheet[addr]));
      }
      grid.push(row);
    }

    // Ô merge: trải giá trị của ô góc trên-trái ra toàn vùng, nếu không các
    // hàng "Thứ 2" bị merge dọc sẽ trông như hàng rỗng.
    const merges = (sheet['!merges'] || []).map((m) => ({
      r1: m.s.r - range.s.r, c1: m.s.c - range.s.c,
      r2: m.e.r - range.s.r, c2: m.e.c - range.s.c,
    }));
    spreadMerges(grid, merges);

    sheets.push({ name, grid, merges, rows: grid.length, cols: colCount });
  }

  if (!sheets.length) throw new Error('File Excel không có sheet nào đọc được.');
  return { sheets };
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.t === 'd' && cell.v instanceof Date) return formatDate(cell.v);
  const v = cell.w != null ? cell.w : cell.v;
  if (v == null) return '';
  return String(v).replace(/\r\n/g, '\n').trim();
}

function spreadMerges(grid, merges) {
  for (const m of merges) {
    const src = grid[m.r1]?.[m.c1];
    if (src == null || src === '') continue;
    for (let r = m.r1; r <= m.r2; r++) {
      for (let c = m.c1; c <= m.c2; c++) {
        if (grid[r] && (grid[r][c] == null || grid[r][c] === '')) grid[r][c] = src;
      }
    }
  }
}

function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Rút gọn lưới thành text để đưa vào prompt LLM (tiết kiệm token). */
export function gridToPreview(grid, { maxRows = 30, maxCols = 12, maxCellChars = 90 } = {}) {
  const lines = [];
  for (let r = 0; r < Math.min(grid.length, maxRows); r++) {
    const cells = [];
    for (let c = 0; c < Math.min(grid[r].length, maxCols); c++) {
      const v = String(grid[r][c] ?? '').replace(/\n/g, ' ⏎ ');
      cells.push(v.length > maxCellChars ? `${v.slice(0, maxCellChars)}…` : v);
    }
    // Bỏ các hàng hoàn toàn rỗng ở cuối dòng để prompt gọn
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    lines.push(`R${r + 1}: ${cells.map((v, i) => `[C${i + 1}] ${v}`).join(' | ')}`);
  }
  return lines.join('\n');
}

export default { readWorkbookGrid, gridToPreview };
