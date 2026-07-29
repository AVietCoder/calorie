/**
 * lib/excel/import/normalize.js — BƯỚC 5: chuẩn hoá dữ liệu.
 *
 *   … → Nhận diện bữa ăn → [Chuẩn hoá dữ liệu] → Lưu Database
 *
 * Nhận lưới + hypothesis layout (từ heuristic hoặc AI) và trả về đúng cấu trúc
 * `days[]` mà persistTemplateDays() đang dùng — nên KHÔNG phải sửa tầng ghi DB,
 * tính năng cũ không bị ảnh hưởng.
 *
 * Mỗi layout có một reader riêng; tất cả cùng đổ vào một collector chung, nên
 * thêm layout mới chỉ là thêm một reader.
 */
import { parseDayIndex } from './analyze-layout.js';
import { parseDishSpec } from '../../family-menu/dish-parse.js';

/** Ký tự tách món trong cùng một ô. Xuống dòng là chính. */
const LINE_SPLIT = /\n+|(?:^|\s)[•·▪]\s+/u;

/** Ô chỉ chứa định lượng ("100 g", "Vừa đủ") — không phải tên món. */
const QUANTITY_ONLY = /^(\d+[.,]?\d*\s*(g|gam|gr|kg|ml|l|quả|trái|củ|bó|hộp|chai|gói|lon|vỉ|bìa|con|miếng|lát|thìa|muỗng|bát|chén|cốc|ly)?|vừa\s*đủ|—|-|tùy\s*ý|tuỳ\s*ý)$/iu;

/**
 * @param {string[][]} grid
 * @param {object} map  hypothesis đã validate (có `.layout`)
 * @returns {{ days:Array, stats:object, warnings:string[] }}
 */
export function normalizeToMenuModel(grid, map) {
  const warnings = [];
  const collector = new DayCollector();

  const reader = READERS[map.layout] || READERS.pivot;
  reader(grid, map, collector, warnings);

  const days = collector.toArray();

  if (!days.length) warnings.push('Không trích được ngày nào có món ăn từ file.');
  else if (days.length < 7 && map.layout === 'pivot') {
    warnings.push(`Chỉ nhận diện được ${days.length}/7 ngày — phần còn lại có thể ở sheet khác hoặc định dạng lạ.`);
  }
  if (map.layout === 'meal-rows') {
    warnings.push('File chỉ chứa thực đơn 1 ngày — đã nhập thành Ngày 1. Bổ sung các ngày còn lại nếu cần.');
  }

  return {
    days,
    stats: {
      dayCount: days.length,
      dishCount: collector.dishCount,
      layout: map.layout,
      source: map.source || 'heuristic',
      confidence: map.confidence ?? null,
    },
    warnings,
  };
}

/* ───────────────────────── collector ───────────────────────── */

class DayCollector {
  constructor() {
    this.byDay = new Map();
    this.dishCount = 0;
  }

  add(dayIndex, mealType, dishes) {
    if (!dishes?.length) return;
    if (!this.byDay.has(dayIndex)) this.byDay.set(dayIndex, new Map());
    const meals = this.byDay.get(dayIndex);
    if (!meals.has(mealType)) meals.set(mealType, []);
    meals.get(mealType).push(...dishes);
    this.dishCount += dishes.length;
  }

  toArray() {
    return [...this.byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day_index, meals]) => ({
        day_index,
        meals: [...meals.entries()].map(([meal_type, dishes]) => ({ meal_type, dishes })),
      }));
  }
}

/* ───────────────────────── readers theo layout ───────────────────────── */

const READERS = {
  /** Ngày là hàng, bữa là cột. */
  pivot(grid, map, out) {
    for (const day of map.dayRows || []) {
      for (const mc of map.mealColumns || []) {
        const raw = String(grid[day.row]?.[mc.col] ?? '').trim();
        if (!isDishCell(raw)) continue;
        out.add(day.dayIndex, mc.mealType, splitDishes(raw).map((t) => buildDish(t, grid, day.row, map)));
      }
    }
  },

  /** Mỗi hàng là một bản ghi (ngày, bữa, món) + các cột mô tả kèm theo. */
  record(grid, map, out) {
    for (const rec of map.records || []) {
      const raw = String(grid[rec.row]?.[map.dishCol] ?? '').trim();
      if (!isDishCell(raw)) continue;
      const dishes = splitDishes(raw).map((t) => buildDish(t, grid, rec.row, map));
      attachDetails(dishes, grid, rec.row, map.detailCols);
      out.add(rec.dayIndex, rec.mealType, dishes);
    }
  },

  /** Ngày là hàng, cả bảng chỉ một bữa (suy từ tiêu đề/tên sheet). */
  'single-meal': function singleMeal(grid, map, out) {
    for (const day of map.dayRows || []) {
      const raw = String(grid[day.row]?.[map.dishCol] ?? '').trim();
      if (!isDishCell(raw)) continue;
      const dishes = splitDishes(raw).map((t) => buildDish(t, grid, day.row, map));
      attachDetails(dishes, grid, day.row, map.detailCols);
      out.add(day.dayIndex, map.singleMealType, dishes);
    }
  },

  /** Danh sách N thực đơn đánh số: mỗi hàng là một bữa hoàn chỉnh. */
  'menu-catalog': function menuCatalog(grid, map, out) {
    for (const day of map.dayRows || []) {
      const dishes = [];
      for (const comp of map.componentCols || []) {
        const raw = String(grid[day.row]?.[comp.col] ?? '').trim();
        if (!isDishCell(raw)) continue;
        for (const text of splitDishes(raw)) {
          const d = buildDish(text, grid, day.row, map);
          // Tiêu đề cột chính là nhóm món ("Món đạm", "Canh") → giữ làm nhãn.
          if (comp.header) d.tags = [comp.header.toLowerCase()];
          dishes.push(d);
        }
      }
      out.add(day.dayIndex, map.catalogMealType, dishes);
    }
  },

  /** Thực đơn 1 ngày, mỗi hàng là một bữa/giờ ăn. */
  'meal-rows': function mealRows(grid, map, out) {
    for (const mr of map.mealRows || []) {
      const raw = String(grid[mr.row]?.[map.dishCol] ?? '').trim();
      if (!isDishCell(raw)) continue;
      const dishes = splitDishes(raw).map((t) => buildDish(t, grid, mr.row, map));
      attachDetails(dishes, grid, mr.row, map.detailCols);
      out.add(map.dayIndex || 1, mr.mealType, dishes);
    }
  },
};

/* ───────────────────────── tách & dựng món ───────────────────────── */

/** Ô có phải mô tả món không (loại nhãn ngày lặp lại, ô định lượng trơ). */
function isDishCell(raw) {
  if (!raw || raw.length < 2) return false;
  if (QUANTITY_ONLY.test(raw)) return false;
  if (parseDayIndex(raw) && raw.length < 12) return false;
  return true;
}

export function splitDishes(raw) {
  let parts = String(raw).split(LINE_SPLIT);

  // Một dòng dài nối bằng "+" hoặc ";" — tách tiếp, nhưng chỉ khi mỗi vế đủ dài
  // để là một món chứ không phải "cơm + canh" nằm trong tên món.
  if (parts.length === 1 && raw.length > 40) {
    for (const sep of [';', '+']) {
      if (!raw.includes(sep)) continue;
      const bits = raw.split(sep).map((s) => s.trim()).filter(Boolean);
      if (bits.length >= 2 && bits.every((s) => s.length >= 6)) {
        parts = bits;
        break;
      }
    }
  }

  return parts
    .map((s) => s.replace(/^[\s•·▪–-]+/u, '').trim())
    .filter((s) => s.length >= 2 && !QUANTITY_ONLY.test(s))
    .slice(0, 12);
}

function buildDish(text, grid, row, map) {
  // Thực đơn nguồn viết nguyên liệu ngay trong tên món
  // ("Phở bò: 180 g bánh phở, 50 g thịt bò"). parseDishSpec tách chúng ra; nếu
  // ô không có cú pháp đó thì lùi về cách bóc gram cũ.
  const spec = parseDishSpec(text);
  const hasSpec = spec.ingredients.length > 0;
  const { name, grams } = hasSpec
    ? { name: spec.name, grams: spec.baseGrams }
    : extractGrams(text);

  const dish = {
    name: String(name).slice(0, 200),
    base_grams: grams,
    calories: null,
    protein: null,
    fat: null,
    carbs: null,
    fiber: null,
    sugar: null,
    sodium: null,
    tags: [],
    // grams/unit = null khi nguồn không khai định lượng — cột nullable, và
    // KHÔNG được để mặc định 'g'/0, vì đó là bịa số.
    ingredients: hasSpec
      ? spec.ingredients.map((i) => ({ name: i.name, grams: i.grams, unit: i.unit, tags: [] }))
      : [],
    source: 'excel_import',
    confidence: 'low',
    /** Chuỗi gốc trước khi rút gọn tên — vừa để đối chiếu, vừa là khoá backfill. */
    source_text: text,
  };

  // Nếu file có cột dinh dưỡng theo HÀNG, gán cho món đầu tiên của hàng đó.
  // KHÔNG chia đều cho mọi món — chia đều là bịa số.
  for (const nc of map.nutritionColumns || []) {
    const v = parseNumber(grid[row]?.[nc.col]);
    if (v != null && dish[nc.field] == null) dish[nc.field] = v;
  }

  return dish;
}

/**
 * Các cột mô tả kèm theo (Nguyên liệu / Định lượng / Cách chế biến) được gắn
 * vào món ĐẦU TIÊN của hàng dưới dạng nguyên liệu hoặc ghi chú — không nhân
 * bản cho mọi món, vì không có căn cứ nào để chia.
 */
function attachDetails(dishes, grid, row, detailCols) {
  if (!dishes.length || !detailCols?.length) return;
  const first = dishes[0];

  for (const c of detailCols) {
    const raw = String(grid[row]?.[c] ?? '').trim();
    if (!raw || raw.length < 2) continue;

    const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    // Cột "Nguyên liệu" điển hình: mỗi dòng "300 g thịt gà".
    const parsed = lines.map(parseIngredientLine).filter(Boolean);
    if (parsed.length >= 2 || (parsed.length === 1 && parsed[0].grams != null)) {
      first.ingredients.push(...parsed.slice(0, 20));
    }
  }
}

/** "300 g thịt gà" → { name:'Thịt gà', grams:300, unit:'g' } */
export function parseIngredientLine(line) {
  const s = String(line || '').trim();
  if (!s || s.length < 2 || QUANTITY_ONLY.test(s)) return null;

  const lead = s.match(/^(\d+[.,]?\d*)\s*(g|gam|gram|gr|kg|ml|l|quả|trái|củ|bó|hộp|chai|gói|lon|vỉ|bìa|con|miếng|lát|thìa|muỗng)\s+(.{2,})$/iu);
  if (lead) return { name: capitalize(lead[3].trim()), grams: toNumber(lead[1]), unit: normUnit(lead[2]), tags: [] };

  const trail = s.match(/^(.{2,}?)\s*[::]\s*(\d+[.,]?\d*)\s*(g|gam|gram|gr|kg|ml|l|quả|trái|củ|bó|hộp|chai|gói|lon|vỉ|bìa|con|miếng|lát|thìa|muỗng)?\s*$/iu);
  if (trail) return { name: capitalize(trail[1].trim()), grams: toNumber(trail[2]), unit: normUnit(trail[3] || 'g'), tags: [] };

  return null;
}

/** "30 g tôm đút lò" → { name: 'Tôm đút lò', grams: 30 } */
export function extractGrams(text) {
  const s = String(text).trim();

  const lead = s.match(/^(\d+[.,]?\d*)\s*(g|gam|gram|gr|kg|ml|l)\s+(.{2,})$/iu);
  if (lead) return { name: capitalize(lead[3].trim()), grams: toGrams(lead[1], lead[2]) };

  const trail = s.match(/^(.+?)[\s(]+(\d+[.,]?\d*)\s*(g|gam|gram|gr|kg|ml|l)\)?\s*$/iu);
  if (trail) return { name: capitalize(trail[1].replace(/[(\s]+$/u, '').trim()), grams: toGrams(trail[2], trail[3]) };

  return { name: capitalize(s), grams: null };
}

function toGrams(num, unit) {
  const n = toNumber(num);
  if (n == null) return null;
  const u = String(unit).toLowerCase();
  return u === 'kg' || u === 'l' ? Math.round(n * 1000) : Math.round(n);
}

function toNumber(v) {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normUnit(u) {
  const s = String(u || 'g').toLowerCase().trim();
  return { gam: 'g', gram: 'g', gr: 'g', lit: 'l', 'lít': 'l' }[s] || s;
}

function parseNumber(v) {
  if (v == null || v === '') return null;
  // "1.925" trong văn bản tiếng Việt là 1925, không phải 1,925.
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default { normalizeToMenuModel, splitDishes, extractGrams, parseIngredientLine };
