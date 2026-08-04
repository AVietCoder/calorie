/**
 * lib/excel/import/index.js — ORCHESTRATOR của luồng nhập thông minh.
 *
 *     Upload Excel
 *          ↓
 *     Đọc lưới          (read-sheet.js — SheetJS, khoan dung)
 *          ↓
 *     File theo mẫu chuẩn?   ──yes──▶  parser cũ (giữ nguyên, không phá)
 *          ↓ no
 *     Phân tích layout  (analyze-layout.js — heuristic tất định)
 *          ↓
 *     Đủ tự tin?        ──no──▶  Nhận diện bằng AI (ai-structure.js)
 *          ↓ yes                      ↓ thất bại → quay lại heuristic
 *     Chuẩn hoá         (normalize.js)
 *          ↓
 *     Trả days[] cho persistTemplateDays()
 *
 * Nguyên tắc: AI chỉ chỉ TOẠ ĐỘ, không bao giờ sinh nội dung. Mọi tên món đều
 * đọc thẳng từ ô trong file, nên không thể có món "ma".
 */
import { readWorkbookGrid } from './read-sheet.js';
import { analyzeLayout } from './analyze-layout.js';
import { detectStructureWithAI } from './ai-structure.js';
import { normalizeToMenuModel } from './normalize.js';

/** Dưới ngưỡng này thì gọi AI để nhận diện lại. */
const AI_THRESHOLD = Number(process.env.EXCEL_IMPORT_AI_THRESHOLD || 0.7);

/** Cột bắt buộc của định dạng mẫu (tương thích ngược). */
const LEGACY_REQUIRED = ['day_index', 'meal_type', 'dish_name'];

/**
 * Số hàng đầu sheet được phép quét để tìm hàng tiêu đề.
 *
 * File mẫu do hệ thống sinh có tiêu đề ngay hàng 0, nhưng bộ thực đơn chuẩn
 * (final_sample/) đặt tiêu đề ở hàng 5 vì phía trên còn tiêu đề sheet + ghi chú
 * cách dùng. Chỉ nhìn hàng 0 thì toàn bộ 43 file đó bị coi là "không theo mẫu".
 */
const HEADER_SCAN_ROWS = 20;

const norm = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Vị trí hàng tiêu đề của định dạng phẳng, hoặc -1 nếu sheet không theo mẫu.
 * @returns {number}
 */
export function findFlatHeaderRow(grid) {
  const limit = Math.min(HEADER_SCAN_ROWS, grid?.length || 0);
  for (let r = 0; r < limit; r++) {
    const header = (grid[r] || []).map(norm);
    if (LEGACY_REQUIRED.every((c) => header.includes(c))) return r;
  }
  return -1;
}

/**
 * Các tiêu đề được chấp nhận cho cột Giá tiền.
 *
 * Mẫu chuẩn dùng `price` cho đồng bộ với 16 cột còn lại (đều là định danh máy
 * đọc), nhưng người dùng tự gõ tiêu đề tiếng Việt thì vẫn nhận — vì cột này là
 * tuỳ chọn, gõ sai tên chỉ mất dữ liệu chứ không báo lỗi, rất khó phát hiện.
 */
const PRICE_HEADERS = ['price', 'giá tiền', 'gia tien', 'gia_tien', 'giá'];

/**
 * Khoảng giá — cột RIÊNG, không lẫn với `price`.
 *
 * Bộ thực đơn chuẩn tách hai thứ: `price` là một con số trung bình ("14.000đ"),
 * `price_range` là khoảng từ tự nấu đến mua ngoài cho một người
 * ("11.000đ–17.000đ/người"). Gộp chung thì mất một nửa thông tin.
 */
const PRICE_RANGE_HEADERS = ['price_range', 'khoảng giá', 'khoang gia', 'price range'];

/** Tương tự cho giá của NGUYÊN LIỆU. */
const INGREDIENT_PRICE_HEADERS = [
  'ingredient_price', 'giá nguyên liệu', 'gia nguyen lieu', 'gia_nguyen_lieu', 'đơn giá', 'don gia',
];

/**
 * @param {Buffer} buffer
 * @param {object} [opts]
 * @param {boolean} [opts.useAI=true]     cho phép gọi LLM khi heuristic yếu
 * @param {boolean} [opts.forceAI=false]  luôn gọi LLM (dùng để debug/so sánh)
 * @param {string}  [opts.sheetName]      ép đọc đúng một sheet
 * @returns {Promise<{ days:Array, report:object }>}
 */
export async function importMenuWorkbook(buffer, opts = {}) {
  const { useAI = true, forceAI = false, sheetName } = opts;
  const { sheets } = readWorkbookGrid(buffer);

  const candidates = sheetName ? sheets.filter((s) => s.name === sheetName) : sheets;
  if (!candidates.length) throw new Error(`Không tìm thấy sheet "${sheetName}".`);

  const attempts = [];

  /*
   * Nhánh A phải quét TOÀN BỘ sheet TRƯỚC nhánh B.
   *
   * Bộ thực đơn chuẩn có sheet nguồn dạng lưới tự do đứng trước sheet "DỮ LIỆU"
   * theo mẫu. Nếu duyệt tuần tự từng sheet qua cả hai nhánh, sheet tự do sẽ
   * được heuristic đọc thành công ngay và hàm trả về luôn — dữ liệu đầy đủ
   * (dinh dưỡng, giá, nguyên liệu) ở sheet DỮ LIỆU không bao giờ được chạm tới.
   */
  for (const sheet of candidates) {
    if (!isLegacyFlatFormat(sheet.grid)) continue;
    const days = parseLegacyFlat(sheet.grid);
    if (!days.length) {
      attempts.push({ sheet: sheet.name, strategy: 'legacy-flat', reason: 'đúng mẫu nhưng không có dòng dữ liệu' });
      continue;
    }
    return {
      days,
      report: {
        sheet: sheet.name,
        strategy: 'legacy-flat',
        confidence: 1,
        dayCount: days.length,
        dishCount: days.reduce((s, d) => s + d.meals.reduce((n, m) => n + m.dishes.length, 0), 0),
        warnings: [],
        attempts,
      },
    };
  }

  for (const sheet of candidates) {
    /* ── Nhánh B: layout tự do ── */
    const hint = analyzeLayout(sheet.grid, { sheetName: sheet.name });
    let map = { ...hint, source: 'heuristic' };
    let strategy = 'heuristic';

    const needAI = forceAI || (useAI && hint.confidence < AI_THRESHOLD);
    if (needAI) {
      const aiMap = await detectStructureWithAI(sheet.grid, hint);
      if (aiMap && aiMap.mealColumns.length >= hint.mealColumns.length) {
        map = aiMap;
        strategy = 'ai';
      } else {
        strategy = hint.confidence > 0 ? 'heuristic-after-ai-fallback' : 'heuristic';
      }
    }

    if (map.layout === 'unknown' || !map.dayRows?.length) {
      attempts.push({ sheet: sheet.name, strategy, layout: map.layout, reason: 'không nhận diện được cấu trúc bảng', confidence: hint.confidence });
      continue;
    }

    const { days, stats, warnings } = normalizeToMenuModel(sheet.grid, map);
    if (!days.length) {
      attempts.push({ sheet: sheet.name, strategy, reason: 'nhận diện được bảng nhưng không có món', confidence: map.confidence });
      continue;
    }

    return {
      days,
      report: {
        sheet: sheet.name,
        strategy,
        confidence: map.confidence ?? hint.confidence,
        layout: map.layout,
        title: map.title || hint.title,
        meta: hint.meta,
        notes: hint.notes,
        mealColumns: map.mealColumns.map((m) => m.header || m.mealType),
        ...stats,
        warnings,
        attempts,
      },
    };
  }

  const detail = attempts.length
    ? ` Đã thử: ${attempts.map((a) => `"${a.sheet}" (${a.reason})`).join('; ')}.`
    : '';
  throw new Error(
    `Không nhận diện được cấu trúc thực đơn trong file.${detail} ` +
      'Hãy kiểm tra file có bảng dạng Ngày × Bữa ăn, hoặc dùng file mẫu drfit-mau-nhap-thuc-don.xlsx.'
  );
}

/* ───────────────────────── định dạng cũ ───────────────────────── */

export function isLegacyFlatFormat(grid) {
  return findFlatHeaderRow(grid) !== -1;
}

/**
 * Parser mẫu 16 cột — giữ đúng hành vi cũ (nhóm theo day/meal/dish, gom
 * nguyên liệu). Việc ước tính dinh dưỡng thiếu vẫn do route xử lý như trước.
 */
export function parseLegacyFlat(grid) {
  const headerRow = findFlatHeaderRow(grid);
  if (headerRow === -1) return [];

  const header = (grid[headerRow] || []).map(norm);
  const col = (name) => header.indexOf(name);
  const at = (row, name) => {
    const i = col(name);
    return i === -1 ? '' : String(row[i] ?? '').trim();
  };

  /**
   * Giá tiền: GIỮ NGUYÊN VĂN, chỉ cắt khoảng trắng hai đầu.
   *
   * Không ép về số, không format lại — giá trị là một KHOẢNG ("15.000đ ->
   * 18.000đ"), và yêu cầu là xuất Excel phải trả lại đúng chuỗi đã nhập. Bất kỳ
   * bước parse nào cũng làm mất định dạng gốc.
   *
   * Excel có thể trả về number nếu người dùng gõ mỗi "40000" và ô ở dạng số —
   * String() ở đây giữ nguyên phần hiển thị thô, vẫn là text như đặc tả.
   */
  const colOf = (names) => names.map((h) => header.indexOf(h)).find((i) => i !== -1);
  const readAt = (col) => (row) => (col == null ? '' : String(row[col] ?? '').trim());

  const readPrice = readAt(colOf(PRICE_HEADERS));
  const readPriceRange = readAt(colOf(PRICE_RANGE_HEADERS));
  const readIngredientPrice = readAt(colOf(INGREDIENT_PRICE_HEADERS));

  const dishesByKey = new Map();
  const order = [];

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !row.some((v) => String(v || '').trim())) continue;

    const dayIndex = Number(at(row, 'day_index'));
    const mealType = at(row, 'meal_type').toLowerCase();
    const dishName = at(row, 'dish_name');
    if (!dayIndex || !mealType || !dishName) continue;

    const key = `${dayIndex}::${mealType}::${dishName.toLowerCase()}`;
    if (!dishesByKey.has(key)) {
      dishesByKey.set(key, {
        day_index: dayIndex,
        meal_type: mealType,
        name: dishName,
        price: readPrice(row),
        price_range: readPriceRange(row),
        base_grams: num(at(row, 'base_grams')),
        calories: num(at(row, 'calories')),
        protein: num(at(row, 'protein')),
        fat: num(at(row, 'fat')),
        carbs: num(at(row, 'carbs')),
        fiber: num(at(row, 'fiber')),
        sugar: num(at(row, 'sugar')),
        sodium: num(at(row, 'sodium')),
        tags: list(at(row, 'dish_tags')),
        ingredients: [],
      });
      order.push(key);
    }

    const ingName = at(row, 'ingredient_name');
    if (ingName) {
      dishesByKey.get(key).ingredients.push({
        name: ingName,
        grams: num(at(row, 'ingredient_grams')),
        unit: at(row, 'ingredient_unit') || 'g',
        // Giá riêng của từng dòng nguyên liệu — khác giá món, đọc theo từng dòng.
        price: readIngredientPrice(row),
        tags: list(at(row, 'ingredient_tags')),
      });
    }
  }

  const byDay = new Map();
  for (const key of order) {
    const dish = dishesByKey.get(key);
    if (!byDay.has(dish.day_index)) byDay.set(dish.day_index, { day_index: dish.day_index, meals: new Map() });
    const day = byDay.get(dish.day_index);
    if (!day.meals.has(dish.meal_type)) day.meals.set(dish.meal_type, { meal_type: dish.meal_type, dishes: [] });
    day.meals.get(dish.meal_type).dishes.push(dish);
  }

  return [...byDay.values()]
    .map((d) => ({ day_index: d.day_index, meals: [...d.meals.values()] }))
    .sort((a, b) => a.day_index - b.day_index);
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function list(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export { readWorkbookGrid, analyzeLayout, normalizeToMenuModel };
export default { importMenuWorkbook };
