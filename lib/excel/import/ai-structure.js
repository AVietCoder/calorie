/**
 * lib/excel/import/ai-structure.js — nhận diện cấu trúc bằng LLM.
 *
 * Được gọi khi heuristic không đủ tự tin (hoặc khi caller ép `forceAI`).
 * LLM KHÔNG được phép bịa món ăn — nó chỉ trả về BẢN ĐỒ toạ độ:
 *
 *     "hàng 6 là Thứ Hai", "cột 3 là bữa trưa", "hàng 14 trở đi là ghi chú"
 *
 * Việc lấy nội dung ô vẫn do code làm, đọc thẳng từ lưới. Nhờ ràng buộc này,
 * LLM có ảo giác thì cũng chỉ dẫn tới ánh xạ sai (phát hiện được bằng validate)
 * chứ không bao giờ tạo ra món ăn không tồn tại trong file.
 */
import { llm, LLM_MODEL } from '../../llm.js';
import { gridToPreview } from './read-sheet.js';

const TIMEOUT_MS = Number(process.env.EXCEL_IMPORT_AI_TIMEOUT_MS || 25_000);

const SYSTEM_PROMPT = `Bạn là bộ phân tích cấu trúc bảng tính. Bạn nhận một lưới ô của file thực đơn tiếng Việt và trả về BẢN ĐỒ TOẠ ĐỘ.

QUY TẮC TUYỆT ĐỐI:
- CHỈ trả JSON hợp lệ, không markdown, không giải thích, không dấu \`\`\`.
- KHÔNG được sáng tác tên món ăn. Bạn chỉ chỉ ra vị trí (số hàng/số cột).
- Số hàng và số cột dùng ĐÚNG như nhãn R.../C... trong dữ liệu (bắt đầu từ 1).
- Nếu không chắc một trường nào, trả null cho trường đó thay vì đoán bừa.

Schema JSON:
{
  "title": string|null,
  "orientation": "day-rows" | "day-cols",
  "headerRow": number|null,
  "labelCol": number,
  "mealColumns": [{"col": number, "mealType": "breakfast"|"lunch"|"dinner"|"snack", "header": string}],
  "dayRows": [{"row": number, "dayIndex": number, "label": string}],
  "nutritionColumns": [{"col": number, "field": "calories"|"protein"|"fat"|"carbs"|"fiber"|"sugar"|"sodium", "header": string}],
  "noteRows": [number],
  "confidence": number
}

Ghi chú ngữ nghĩa:
- "orientation": "day-rows" khi mỗi HÀNG là một ngày và mỗi CỘT là một bữa. "day-cols" khi ngược lại.
- dayIndex: Thứ 2 = 1, Thứ 3 = 2, ..., Thứ 7 = 6, Chủ nhật = 7. "Ngày 1" = 1.
- "Bữa phụ", "bữa xế", "ăn nhẹ", "bữa phụ sáng", "bữa phụ chiều" đều là "snack".
- Bỏ qua các hàng tiêu đề khối như "NGUYÊN TẮC DINH DƯỠNG", "LƯU Ý", "Nguồn" — đưa chúng vào noteRows.`;

/**
 * @param {string[][]} grid
 * @param {object} hint  kết quả analyzeLayout() — làm gợi ý ban đầu cho LLM
 * @returns {Promise<object|null>} bản đồ đã validate, hoặc null nếu thất bại
 */
export async function detectStructureWithAI(grid, hint = {}) {
  const preview = gridToPreview(grid, { maxRows: 32, maxCols: 12 });

  const userPrompt = [
    'Lưới ô của file (R = hàng, C = cột, đánh số từ 1):',
    '',
    preview,
    '',
    'Phỏng đoán ban đầu từ bộ phân tích tất định (có thể sai, hãy tự kiểm chứng):',
    JSON.stringify(
      {
        orientation: hint.orientation,
        headerRow: hint.headerRow != null ? hint.headerRow + 1 : null,
        mealColumns: (hint.mealColumns || []).map((m) => ({ col: m.col + 1, mealType: m.mealType, header: m.header })),
        dayRows: (hint.dayRows || []).map((d) => ({ row: d.row + 1, dayIndex: d.dayIndex, label: d.label })),
      },
      null,
      0
    ),
    '',
    'Trả về JSON theo đúng schema.',
  ].join('\n');

  let raw;
  try {
    const completion = await withTimeout(
      llm.chat.completions.create({
        model: LLM_MODEL,
        temperature: 0,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
      TIMEOUT_MS
    );
    raw = completion?.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.warn(`⚠️ [excel-import] LLM lỗi, dùng heuristic: ${err.message}`);
    return null;
  }

  const parsed = parseJsonLoose(raw);
  if (!parsed) {
    console.warn('⚠️ [excel-import] LLM trả về JSON không hợp lệ, dùng heuristic.');
    return null;
  }

  return validateStructure(parsed, grid);
}

/* ───────────────────────── validate ───────────────────────── */

const VALID_MEALS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const VALID_NUTRIENTS = new Set(['calories', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'sodium']);

/**
 * Ép bản đồ của LLM về hệ toạ độ 0-based và loại bỏ mọi thứ nằm ngoài lưới.
 * Đây là hàng rào chống ảo giác: toạ độ sai → bị bỏ, không bao giờ tới DB.
 */
export function validateStructure(s, grid) {
  const rows = grid.length;
  const cols = Math.max(...grid.map((r) => r.length), 0);
  const inRow = (r) => Number.isInteger(r) && r >= 0 && r < rows;
  const inCol = (c) => Number.isInteger(c) && c >= 0 && c < cols;

  const mealColumns = (Array.isArray(s.mealColumns) ? s.mealColumns : [])
    .map((m) => ({ col: toIdx(m.col), mealType: String(m.mealType || '').toLowerCase(), header: String(m.header || '') }))
    .filter((m) => inCol(m.col) && VALID_MEALS.has(m.mealType));

  const dayRows = (Array.isArray(s.dayRows) ? s.dayRows : [])
    .map((d) => ({ row: toIdx(d.row), dayIndex: Number(d.dayIndex), label: String(d.label || '') }))
    .filter((d) => inRow(d.row) && d.dayIndex >= 1 && d.dayIndex <= 7);

  const nutritionColumns = (Array.isArray(s.nutritionColumns) ? s.nutritionColumns : [])
    .map((n) => ({ col: toIdx(n.col), field: String(n.field || '').toLowerCase(), header: String(n.header || '') }))
    .filter((n) => inCol(n.col) && VALID_NUTRIENTS.has(n.field));

  // Bản đồ vô dụng nếu không có cả bữa lẫn ngày.
  if (!mealColumns.length || !dayRows.length) return null;

  // Loại trùng: mỗi cột chỉ giữ một meal, mỗi dayIndex chỉ giữ hàng đầu tiên.
  const seenCol = new Set();
  const seenDay = new Set();

  return {
    source: 'ai',
    title: s.title ? String(s.title) : null,
    orientation: s.orientation === 'day-cols' ? 'day-cols' : 'day-rows',
    headerRow: inRow(toIdx(s.headerRow)) ? toIdx(s.headerRow) : null,
    labelCol: inCol(toIdx(s.labelCol)) ? toIdx(s.labelCol) : 0,
    mealColumns: mealColumns.filter((m) => (seenCol.has(m.col) ? false : seenCol.add(m.col))),
    dayRows: dayRows.filter((d) => (seenDay.has(d.dayIndex) ? false : seenDay.add(d.dayIndex))).sort((a, b) => a.dayIndex - b.dayIndex),
    nutritionColumns,
    noteRows: (Array.isArray(s.noteRows) ? s.noteRows : []).map(toIdx).filter(inRow),
    confidence: clamp01(Number(s.confidence) || 0.6),
  };
}

function toIdx(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) - 1 : NaN;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** LLM hay bọc JSON trong ```json — bóc ra rồi mới parse. */
export function parseJsonLoose(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`LLM timeout sau ${ms}ms`)), ms)),
  ]);
}

export default { detectStructureWithAI, validateStructure, parseJsonLoose };
