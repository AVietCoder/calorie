/**
 * lib/excel/import/index.js — ORCHESTRATOR của luồng nhập thông minh.
 *
 *     Upload Excel
 *          ↓
 *     Đọc lưới          (read-sheet.js — SheetJS, khoan dung)
 *          ↓
 *     File theo mẫu 16 cột?  ──yes──▶  parser cũ (giữ nguyên, không phá)
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

/** Cột bắt buộc của định dạng mẫu 16 cột (tương thích ngược). */
const LEGACY_REQUIRED = ['day_index', 'meal_type', 'dish_name'];

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

  for (const sheet of candidates) {
    /* ── Nhánh A: file theo đúng mẫu 16 cột → dùng parser cũ ── */
    if (isLegacyFlatFormat(sheet.grid)) {
      const days = parseLegacyFlat(sheet.grid);
      if (days.length) {
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
    }

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
      'Hãy kiểm tra file có bảng dạng Ngày × Bữa ăn, hoặc dùng file mẫu 16 cột.'
  );
}

/* ───────────────────────── định dạng cũ ───────────────────────── */

export function isLegacyFlatFormat(grid) {
  const header = (grid[0] || []).map((v) => String(v || '').trim().toLowerCase());
  return LEGACY_REQUIRED.every((c) => header.includes(c));
}

/**
 * Parser mẫu 16 cột — giữ đúng hành vi cũ (nhóm theo day/meal/dish, gom
 * nguyên liệu). Việc ước tính dinh dưỡng thiếu vẫn do route xử lý như trước.
 */
export function parseLegacyFlat(grid) {
  const header = (grid[0] || []).map((v) => String(v || '').trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const at = (row, name) => {
    const i = col(name);
    return i === -1 ? '' : String(row[i] ?? '').trim();
  };

  const dishesByKey = new Map();
  const order = [];

  for (let r = 1; r < grid.length; r++) {
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
