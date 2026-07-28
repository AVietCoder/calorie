/**
 * lib/excel/import/analyze-layout.js — BƯỚC 2–4: phân tích layout, nhận diện
 * bảng / ngày / bữa ăn bằng heuristic tất định.
 *
 *   Đọc file → [Phân tích layout] → [Nhận diện bảng] → [Nhận diện ngày]
 *            → [Nhận diện bữa ăn] → Chuẩn hoá → Lưu DB
 *
 * KIẾN TRÚC: registry các CHIẾN LƯỢC LAYOUT.
 * Mỗi chiến lược là một hàm thuần `(grid, ctx) => Hypothesis|null` tự chấm điểm
 * tin cậy. Orchestrator chạy tất cả rồi chọn điểm cao nhất. Muốn hỗ trợ kiểu
 * file mới → thêm một detector vào LAYOUT_STRATEGIES, KHÔNG sửa hàm đang chạy.
 *
 * Bốn chiến lược hiện có (đo trên corpus 43 file mẫu thật):
 *   pivot        ngày là HÀNG, bữa là CỘT                      — phổ biến nhất
 *   record       mỗi hàng là một bản ghi (ngày, bữa, món)
 *   single-meal  ngày là HÀNG nhưng cả bảng chỉ có MỘT bữa
 *   meal-rows    thực đơn 1 ngày, mỗi hàng là một bữa/giờ ăn
 *
 * Vì sao vẫn cần heuristic khi đã có AI?
 *   • bắt được phần lớn file mà không tốn lượt gọi LLM nào;
 *   • là phương án dự phòng khi LLM chết / timeout / trả JSON hỏng;
 *   • kết quả được đưa vào prompt làm gợi ý, giúp LLM chính xác và rẻ hơn.
 */

/* ───────────────────────── từ vựng nhận diện ───────────────────────── */

/**
 * CẢNH BÁO: KHÔNG dùng `\b` sau ký tự tiếng Việt.
 * `\b` của JavaScript chỉ hiểu [A-Za-z0-9_], nên "Thứ Tư" / "Thứ Năm" /
 * "Thứ Bảy" đều TRƯỢT vì ư/ăm/ảy bị coi là non-word.
 * Thay bằng lookahead Unicode với cờ `u`.
 */
const NB = '(?![\\p{L}\\p{N}])';

const DAY_PATTERNS = [
  { re: new RegExp(`^\\s*(thứ|thu)\\s*(2|hai)${NB}`, 'iu'), index: 1 },
  { re: new RegExp(`^\\s*(thứ|thu)\\s*(3|ba)${NB}`, 'iu'), index: 2 },
  { re: new RegExp(`^\\s*(thứ|thu)\\s*(4|tư|tu)${NB}`, 'iu'), index: 3 },
  { re: new RegExp(`^\\s*(thứ|thu)\\s*(5|năm|nam)${NB}`, 'iu'), index: 4 },
  { re: new RegExp(`^\\s*(thứ|thu)\\s*(6|sáu|sau)${NB}`, 'iu'), index: 5 },
  { re: new RegExp(`^\\s*(thứ|thu)\\s*(7|bảy|bay)${NB}`, 'iu'), index: 6 },
  { re: new RegExp(`^\\s*(chủ\\s*nhật|chu\\s*nhat|cn)${NB}`, 'iu'), index: 7 },
  { re: new RegExp(`^\\s*(ngày|ngay|day|thực\\s*đơn|thuc\\s*don|mẫu|mau)\\s*0?([1-9])${NB}`, 'iu'), index: null },
];

const MEAL_PATTERNS = [
  // "Bữa phụ" phải đứng TRƯỚC, nếu không "bữa phụ sáng" sẽ khớp nhầm "sáng".
  { re: /(bữa\s*phụ|bua\s*phu|ăn\s*nhẹ|an\s*nhe|bữa\s*nhẹ|bữa\s*xế|bua\s*xe|xế\s*chiều|snack|phụ\s*sáng|phụ\s*chiều|phụ\s*tối|quả\s*tươi|tráng\s*miệng)/iu, type: 'snack' },
  { re: /(bữa\s*sáng|bua\s*sang|buổi\s*sáng|điểm\s*tâm|breakfast|^\s*sáng\s*$)/iu, type: 'breakfast' },
  { re: /(bữa\s*trưa|bua\s*trua|buổi\s*trưa|lunch|^\s*trưa\s*$)/iu, type: 'lunch' },
  { re: /(bữa\s*tối|bua\s*toi|buổi\s*tối|chiều\s*tối|dinner|supper|^\s*tối\s*$)/iu, type: 'dinner' },
];

/** Giờ ăn → bữa. Dùng cho thực đơn bệnh viện ghi theo mốc "7 giờ", "11 giờ". */
const TIME_TO_MEAL = [
  { max: 9, type: 'breakfast' },
  { max: 10.9, type: 'snack' },
  { max: 13.9, type: 'lunch' },
  { max: 16.9, type: 'snack' },
  { max: 21, type: 'dinner' },
  { max: 24, type: 'snack' },
];

const NUTRITION_HEADERS = /(kcal|calo|năng\s*lượng|nang\s*luong|đạm|protein|béo|fat|lipid|tinh\s*bột|carb|glucid|đường\s*bột|chất\s*xơ|fiber|natri|sodium)/iu;
const DISH_HEADERS = /(món\s*ăn|mon\s*an|tên\s*món|thực\s*phẩm|thuc\s*pham|món\s*chính|tên\s*bữa|món\s*kèm)/iu;
const LABEL_HEADERS = /^(ngày|ngay|thứ|thu|bữa\s*ăn|bua\s*an|giờ\s*ăn|gio\s*an|thực\s*đơn|stt|day|buổi)$/iu;
const NOISE_ROW = /^(lưu\s*ý|luu\s*y|nguồn|nguon|ghi\s*chú|tham\s*khảo|source|note|nguyên\s*tắc|nguyen\s*tac|đơn\s*vị|tư\s*vấn|tác\s*giả|thực\s*phẩm\s*(nên|thay)|giá\s*trị\s*dinh|lối\s*sống|thói\s*quen|đặc\s*điểm|tiêu\s*chí|gợi\s*ý\s*thay|khẩu\s*phần\s*gốc|tổng\s*năng\s*lượng)/iu;

/* ───────────────────────── orchestrator ───────────────────────── */

/**
 * @param {string[][]} grid
 * @param {object} [ctx]  { sheetName }
 * @returns {object} Hypothesis tốt nhất, luôn có `.layout` và `.confidence`
 */
export function analyzeLayout(grid, ctx = {}) {
  const base = {
    title: findTitle(grid),
    headerRow: findHeaderRow(grid),
    sheetName: ctx.sheetName || '',
  };

  const results = [];
  for (const strategy of LAYOUT_STRATEGIES) {
    try {
      const h = strategy.detect(grid, base);
      if (h) results.push({ ...h, layout: strategy.id });
    } catch {
      /* một detector hỏng không được làm chết cả pipeline */
    }
  }

  if (!results.length) {
    return {
      ...base,
      layout: 'unknown',
      confidence: 0,
      mealColumns: [],
      dayRows: [],
      meta: collectMeta(grid, base.headerRow),
      notes: collectNotes(grid, null),
      alternatives: [],
    };
  }

  results.sort((a, b) => b.confidence - a.confidence);
  const best = results[0];
  return {
    ...base,
    ...best,
    meta: collectMeta(grid, base.headerRow),
    notes: collectNotes(grid, best.lastDataRow ?? null),
    alternatives: results.slice(1, 3).map((r) => ({ layout: r.layout, confidence: r.confidence })),
  };
}

/* ───────────────────────── chiến lược 1: pivot ───────────────────────── */

/** Ngày là HÀNG, bữa là CỘT. Kiểu phổ biến nhất (~88% corpus). */
function detectPivot(grid, base) {
  const { headerRow } = base;
  if (headerRow == null) return null;

  const mealColumns = findMealColumns(grid[headerRow]);
  if (mealColumns.length < 2) return null;

  const dayRows = findDayRows(grid, 0, headerRow);
  if (dayRows.length < 2) return null;

  let c = 0.2 + Math.min(mealColumns.length, 4) * 0.1 + Math.min(dayRows.length, 7) * 0.05;
  if (dayRows.length === 7) c += 0.1;
  if (dayRows.some((d) => d.inferred)) c -= 0.2;

  return {
    confidence: clamp01(c),
    labelCol: 0,
    headerRow,
    mealColumns,
    dayRows,
    nutritionColumns: findNutritionColumns(grid[headerRow]),
    firstDataRow: dayRows[0].row,
    lastDataRow: dayRows[dayRows.length - 1].row,
  };
}

/* ───────────────────────── chiến lược 2: record ───────────────────────── */

/**
 * Mỗi HÀNG là một bản ghi (ngày, bữa, món): cột A là ngày/thực đơn, một cột
 * giữa là bữa, cột kế là món. Ví dụ BV Đức Giang — "Thực đơn 1 | Bữa sáng | Phở gà".
 */
function detectRecord(grid, base) {
  const { headerRow } = base;
  if (headerRow == null) return null;

  const header = grid[headerRow] || [];

  // Cột bữa = cột mà GIÁ TRỊ (không phải tiêu đề) là tên bữa, lặp nhiều lần.
  let mealCol = -1;
  for (let c = 1; c < Math.min(header.length, 5); c++) {
    if (countColumnMealHits(grid, c, headerRow) >= 3) {
      mealCol = c;
      break;
    }
  }
  if (mealCol < 1) return null;

  let dishCol = header.findIndex((h, i) => i > mealCol && DISH_HEADERS.test(String(h || '')));
  if (dishCol === -1) dishCol = mealCol + 1;
  if (dishCol >= header.length) return null;

  const records = [];
  const groupSeq = new Map();
  let seq = 0;

  for (let r = headerRow + 1; r < grid.length; r++) {
    const groupRaw = String(grid[r]?.[0] ?? '').trim();
    const mealRaw = String(grid[r]?.[mealCol] ?? '').trim();
    if (NOISE_ROW.test(groupRaw)) break;
    if (!mealRaw) continue;

    const mealType = matchMeal(mealRaw) || mealFromTime(mealRaw);
    if (!mealType) continue;

    let dayIndex = parseDayIndex(groupRaw);
    if (!dayIndex) {
      if (!groupSeq.has(groupRaw)) groupSeq.set(groupRaw, ++seq);
      dayIndex = groupSeq.get(groupRaw);
    }
    if (dayIndex > 7) continue;

    records.push({ row: r, dayIndex, mealType, label: groupRaw });
  }

  if (records.length < 3) return null;
  const days = [...new Set(records.map((r) => r.dayIndex))].sort((a, b) => a - b);

  return {
    confidence: clamp01(0.55 + Math.min(days.length, 7) * 0.05),
    labelCol: 0,
    headerRow,
    mealCol,
    dishCol,
    records,
    detailCols: rangeCols(dishCol + 1, header.length).filter((c) => !NUTRITION_HEADERS.test(String(header[c] || ''))),
    dayRows: days.map((d) => ({ dayIndex: d, row: records.find((r) => r.dayIndex === d).row, label: `Ngày ${d}` })),
    mealColumns: [{ col: dishCol, mealType: 'mixed', header: String(header[dishCol] || 'Món ăn') }],
    nutritionColumns: findNutritionColumns(header),
    firstDataRow: records[0].row,
    lastDataRow: records[records.length - 1].row,
  };
}

/* ───────────────────────── chiến lược 3: single-meal ───────────────────────── */

/**
 * Ngày là HÀNG nhưng cả bảng chỉ có MỘT bữa; loại bữa suy từ tiêu đề hoặc tên
 * sheet. Ví dụ "GỢI Ý BỮA SÁNG 7 NGÀY" (Vinmec) — cột Món ăn / Nguyên liệu /
 * Cách chế biến.
 */
function detectSingleMeal(grid, base) {
  const { headerRow, title, sheetName } = base;
  if (headerRow == null) return null;

  const mealType = matchMeal(title || '') || matchMeal(sheetName || '');
  if (!mealType) return null;

  const dayRows = findDayRows(grid, 0, headerRow);
  if (dayRows.length < 3) return null;

  const header = grid[headerRow] || [];
  let dishCol = header.findIndex((h, i) => i > 0 && DISH_HEADERS.test(String(h || '')));
  if (dishCol === -1) dishCol = 1;

  const width = Math.max(...grid.map((r) => r.length), 0);

  return {
    confidence: clamp01(0.5 + Math.min(dayRows.length, 7) * 0.06),
    labelCol: 0,
    headerRow,
    singleMealType: mealType,
    dishCol,
    detailCols: rangeCols(dishCol + 1, width).filter((c) => !NUTRITION_HEADERS.test(String(header[c] || ''))),
    dayRows,
    mealColumns: [{ col: dishCol, mealType, header: String(header[dishCol] || 'Món ăn') }],
    nutritionColumns: findNutritionColumns(header),
    firstDataRow: dayRows[0].row,
    lastDataRow: dayRows[dayRows.length - 1].row,
  };
}

/* ───────────────────────── chiến lược 4: meal-rows ───────────────────────── */

/**
 * Thực đơn MỘT ngày: cột A là tên bữa ("Bữa sáng") hoặc giờ ăn ("7 giờ"),
 * các cột còn lại là mô tả món. Ví dụ Vạn Phước Cửu Long, Trạm y tế Sơn Kỳ,
 * Trạm y tế Tân Sơn Nhì.
 */
function detectMealRows(grid, base) {
  const { headerRow } = base;
  const start = headerRow != null ? headerRow + 1 : 0;

  const mealRows = [];
  for (let r = start; r < grid.length; r++) {
    const raw = String(grid[r]?.[0] ?? '').trim();
    if (!raw) continue;
    if (NOISE_ROW.test(raw)) break;
    const mealType = matchMeal(raw) || mealFromTime(raw);
    if (!mealType) {
      if (mealRows.length) break;
      continue;
    }
    mealRows.push({ row: r, mealType, label: raw });
  }

  if (mealRows.length < 2) return null;

  const width = Math.max(...grid.map((r) => r.length), 0);
  const header = headerRow != null ? grid[headerRow] || [] : [];

  return {
    confidence: clamp01(0.45 + mealRows.length * 0.07),
    labelCol: 0,
    headerRow,
    mealRows,
    dishCol: 1,
    detailCols: rangeCols(2, width).filter((c) => !NUTRITION_HEADERS.test(String(header[c] || ''))),
    dayRows: [{ row: mealRows[0].row, dayIndex: 1, label: 'Ngày 1' }],
    mealColumns: mealRows.map((m) => ({ col: 1, mealType: m.mealType, header: m.label })),
    nutritionColumns: findNutritionColumns(header),
    firstDataRow: mealRows[0].row,
    lastDataRow: mealRows[mealRows.length - 1].row,
  };
}

/* ───────────────────────── chiến lược 5: menu-catalog ───────────────────────── */

/**
 * Danh sách N thực đơn đánh số: cột A là STT (1, 2, 3…), các cột còn lại là
 * THÀNH PHẦN của cùng một bữa ("Tinh bột/món chính | Món đạm | Rau | Canh").
 * Ví dụ "20 THỰC ĐƠN BỮA CHÍNH CHO NGƯỜI BỊ GAN NHIỄM MỠ".
 *
 * Mỗi hàng = một thực đơn hoàn chỉnh cho một bữa → ánh xạ 7 hàng đầu thành
 * 7 ngày. Loại bữa suy từ tiêu đề ("bữa chính" → lunch).
 */
function detectMenuCatalog(grid, base) {
  const { headerRow, title } = base;
  if (headerRow == null) return null;

  const header = grid[headerRow] || [];
  const first = String(header[0] || '').trim();
  if (!/^(stt|số\s*tt|no\.?|#)$/iu.test(first)) return null;

  // Các cột còn lại phải là tên NHÓM MÓN, không phải tên bữa.
  const componentCols = [];
  for (let c = 1; c < header.length; c++) {
    const v = String(header[c] || '').trim();
    if (!v) continue;
    if (NUTRITION_HEADERS.test(v)) continue;
    componentCols.push({ col: c, header: v });
  }
  if (componentCols.length < 2) return null;

  const rows = [];
  for (let r = headerRow + 1; r < grid.length && rows.length < 7; r++) {
    const stt = String(grid[r]?.[0] ?? '').trim();
    if (NOISE_ROW.test(stt)) break;
    if (!/^\d{1,2}$/.test(stt)) continue;
    if (!componentCols.some((c) => String(grid[r]?.[c.col] ?? '').trim().length > 2)) continue;
    rows.push({ row: r, dayIndex: rows.length + 1, label: `Thực đơn ${stt}` });
  }
  if (rows.length < 3) return null;

  const mealType = matchMeal(title || '') || guessMealFromTitle(title) || 'lunch';

  return {
    confidence: clamp01(0.5 + rows.length * 0.05),
    labelCol: 0,
    headerRow,
    catalogMealType: mealType,
    componentCols,
    dayRows: rows,
    mealColumns: componentCols.map((c) => ({ col: c.col, mealType, header: c.header })),
    nutritionColumns: findNutritionColumns(header),
    firstDataRow: rows[0].row,
    lastDataRow: rows[rows.length - 1].row,
  };
}

/** "20 thực đơn BỮA CHÍNH …" → bữa chính = bữa trưa. */
function guessMealFromTitle(title) {
  const t = String(title || '');
  if (/bữa\s*chính|bua\s*chinh|main\s*meal/iu.test(t)) return 'lunch';
  return null;
}

/* ───────────────────────── registry ───────────────────────── */

export const LAYOUT_STRATEGIES = [
  { id: 'pivot', label: 'Ngày × Bữa ăn', detect: detectPivot },
  { id: 'record', label: 'Bản ghi (ngày, bữa, món)', detect: detectRecord },
  { id: 'single-meal', label: 'Một bữa × nhiều ngày', detect: detectSingleMeal },
  { id: 'menu-catalog', label: 'Danh sách thực đơn đánh số', detect: detectMenuCatalog },
  { id: 'meal-rows', label: 'Thực đơn 1 ngày theo bữa', detect: detectMealRows },
];

/* ───────────────────────── tiện ích dùng chung ───────────────────────── */

export function parseDayIndex(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  for (const p of DAY_PATTERNS) {
    const m = s.match(p.re);
    if (!m) continue;
    if (p.index != null) return p.index;
    const n = Number(m[2]);
    if (n >= 1 && n <= 9) return n;
  }
  const bare = s.match(/^0?([1-7])$/);
  return bare ? Number(bare[1]) : null;
}

export function matchMeal(raw) {
  const s = String(raw || '');
  if (!s.trim()) return null;
  for (const m of MEAL_PATTERNS) if (m.re.test(s)) return m.type;
  return null;
}

/** "7 giờ" / "11h30" → bữa tương ứng. */
export function mealFromTime(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{1,2})\s*(?:[:h.]\s*(\d{1,2}))?\s*(giờ|gio|h|hrs?)?\s*$/iu);
  if (!m) return null;
  if (!m[3] && !m[2]) return null; // "7" trơ trọi là số thứ tự, không phải giờ
  const hour = Number(m[1]) + (Number(m[2] || 0) >= 30 ? 0.5 : 0);
  if (!Number.isFinite(hour) || hour < 4 || hour > 23) return null;
  for (const t of TIME_TO_MEAL) if (hour <= t.max) return t.type;
  return null;
}

function findTitle(grid) {
  for (let r = 0; r < Math.min(grid.length, 5); r++) {
    const filled = (grid[r] || []).filter((v) => v && String(v).trim());
    if (!filled.length) continue;
    const uniq = [...new Set(filled.map((v) => String(v).trim()))];
    if (uniq.length === 1 && uniq[0].length >= 8) return uniq[0];
  }
  return null;
}

/**
 * Hàng tiêu đề bảng.
 *
 * Hai cái bẫy đã gặp trên corpus thật:
 *   1. Dải section merge ("THỰC PHẨM NÊN HẠN CHẾ HOẶC TRÁNH") bị trải ra 5 ô
 *      giống hệt nhau → nếu cộng điểm từng ô sẽ ăn điểm gấp 5 lần và thắng
 *      hàng tiêu đề thật. → Chỉ tính MỖI GIÁ TRỊ MỘT LẦN.
 *   2. Chính dải đó chứa chữ "Thực phẩm" nên khớp DISH_HEADERS.
 *      → Trừ điểm nặng nếu hàng khớp NOISE_ROW.
 * Khi hoà điểm thì ưu tiên hàng ở TRÊN (bảng chính luôn đứng trước section phụ).
 */
function findHeaderRow(grid) {
  let best = null;
  let bestScore = 0;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const values = [...new Set((grid[r] || []).map((v) => String(v || '').trim()).filter(Boolean))];
    if (!values.length) continue;

    // Hàng chỉ có 1 giá trị duy nhất trải ngang = dải merge, không phải header.
    if (values.length === 1 && (grid[r] || []).filter(Boolean).length > 1) continue;

    let score = 0;
    const seenMeals = new Set();
    for (const v of values) {
      if (LABEL_HEADERS.test(v)) score += 2;
      if (DISH_HEADERS.test(v)) score += 2;
      const mt = matchMeal(v);
      if (mt && !seenMeals.has(mt)) {
        score += 3;
        seenMeals.add(mt);
      }
      if (NUTRITION_HEADERS.test(v)) score += 1;
    }
    if (NOISE_ROW.test(values[0])) score -= 6;

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= 3 ? best : null;
}

function findMealColumns(headerCells = []) {
  const out = [];
  const usedCols = new Set();
  (headerCells || []).forEach((cell, col) => {
    if (col === 0) return;
    const v = String(cell || '').trim();
    if (!v || usedCols.has(col)) return;
    const type = matchMeal(v);
    if (!type) return;
    usedCols.add(col);
    out.push({ col, mealType: type, header: v });
  });
  return out;
}

function findNutritionColumns(headerCells = []) {
  const out = [];
  (headerCells || []).forEach((cell, col) => {
    const v = String(cell || '').trim();
    if (!v || col === 0 || !NUTRITION_HEADERS.test(v)) return;
    const field = nutritionField(v);
    if (field) out.push({ col, header: v, field });
  });
  return out;
}

function nutritionField(header) {
  const h = String(header).toLowerCase();
  if (/kcal|calo|năng\s*lượng|nang\s*luong/u.test(h)) return 'calories';
  if (/đạm|dam|protein/u.test(h)) return 'protein';
  if (/béo|beo|fat|lipid/u.test(h)) return 'fat';
  if (/tinh\s*bột|carb|glucid|đường\s*bột/u.test(h)) return 'carbs';
  if (/chất\s*xơ|chat\s*xo|fiber/u.test(h)) return 'fiber';
  if (/natri|sodium/u.test(h)) return 'sodium';
  if (/đường|duong|sugar/u.test(h)) return 'sugar';
  return null;
}

function countColumnMealHits(grid, col, headerRow) {
  let hits = 0;
  for (let r = headerRow + 1; r < Math.min(grid.length, headerRow + 25); r++) {
    if (matchMeal(String(grid[r]?.[col] ?? ''))) hits += 1;
  }
  return hits;
}

function findDayRows(grid, labelCol, headerRow) {
  const out = [];
  const start = headerRow != null ? headerRow + 1 : 0;
  const usedIndex = new Set();
  let sequential = 0;

  for (let r = start; r < grid.length; r++) {
    const raw = String(grid[r]?.[labelCol] ?? '').trim();
    if (!raw) continue;
    if (NOISE_ROW.test(raw)) break;

    const parsed = parseDayIndex(raw);
    if (parsed && parsed <= 7) {
      if (usedIndex.has(parsed)) continue; // hàng lặp do merge dọc
      usedIndex.add(parsed);
      out.push({ row: r, dayIndex: parsed, label: raw });
      sequential = Math.max(sequential, parsed);
      continue;
    }

    const hasContent = (grid[r] || []).slice(1).some((v) => String(v || '').trim().length > 3);
    if (hasContent && out.length < 7) {
      // Không nhận ra tên ngày → đánh số TIẾP sau chỉ số lớn nhất đã dùng,
      // tránh đè lên ngày đã có (bug cũ: mọi hàng lạ đều thành "Ngày 1").
      do {
        sequential += 1;
      } while (usedIndex.has(sequential) && sequential <= 7);
      if (sequential > 7) break;
      usedIndex.add(sequential);
      out.push({ row: r, dayIndex: sequential, label: raw, inferred: true });
    } else if (out.length) {
      break;
    }
  }
  return out.sort((a, b) => a.dayIndex - b.dayIndex).slice(0, 7);
}

function collectNotes(grid, lastDataRow) {
  const out = [];
  const start = lastDataRow != null ? lastDataRow + 1 : 0;
  for (let r = start; r < grid.length; r++) {
    const cells = [...new Set((grid[r] || []).map((v) => String(v || '').trim()).filter(Boolean))];
    if (!cells.length) continue;
    const text = cells.join(' ');
    if (text.length > 25) out.push(text.slice(0, 600));
  }
  return out.slice(0, 5);
}

function collectMeta(grid, headerRow) {
  const out = [];
  const end = headerRow != null ? headerRow : Math.min(grid.length, 4);
  for (let r = 1; r < end; r++) {
    const cells = (grid[r] || []).map((v) => String(v || '').trim());
    for (let c = 0; c < cells.length - 1; c += 2) {
      if (cells[c] && cells[c + 1] && cells[c] !== cells[c + 1]) out.push([cells[c], cells[c + 1]]);
    }
  }
  return out.slice(0, 8);
}

function rangeCols(from, to) {
  const out = [];
  for (let c = from; c < to; c++) out.push(c);
  return out;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(Number(v).toFixed(2))));
}

export { MEAL_PATTERNS, DAY_PATTERNS, NOISE_ROW };
export default { analyzeLayout, parseDayIndex, matchMeal, mealFromTime, LAYOUT_STRATEGIES };
