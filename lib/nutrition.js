// lib/nutrition.js — Pipeline dinh dưỡng NHẤT QUÁN cho mọi ước tính món ăn.
//
// Vấn đề cũ: AI tự suy luận tổng dinh dưỡng cho cả cụm "300ml sữa socola" mỗi
// lần gọi → 200ml có thể ra NHIỀU kcal hơn 300ml (mỗi lần một mốc khác nhau).
//
// Cách mới (deterministic):
//   1. parseQuantity(): tách "300ml sữa socola" → { qty: 300, đơn vị ml, món "sữa socola" }.
//      Chuẩn hóa mọi đơn vị đo được về ml hoặc g (lít→1000ml, kg→1000g, muỗng→15ml,
//      thìa cà phê→5ml, ly/cốc→250ml, lạng→100g...).
//   2. Lấy MỐC DINH DƯỠNG CHUẨN trên 100g/100ml của MÓN GỐC (không kèm số lượng):
//        USDA FoodData Central → OpenFoodFacts → AI (temperature 0).
//      Mốc được cache (bảng nutrition_anchors + memory) → mọi lần gọi sau cùng
//      một món đều scale từ ĐÚNG MỘT mốc → 100/200/300/500ml tuyến tính tuyệt đối.
//   3. Đơn vị ĐẾM (miếng, quả, phần, tô, bát...): mốc là "đúng 1 đơn vị" —
//      FOODS DB (suất chuẩn Việt Nam) trước, sau đó AI temp 0 (cache) — rồi × số lượng.
//   4. validateAndFixNutrition(): chặn số âm + đối chiếu công thức Atwater
//      (kcal ≈ 4P + 4C + 9F, sai số cho phép 15%) — lệch thì tự hiệu chỉnh kcal.
//   5. Mỗi kết quả kèm confidence: high (USDA/OFF/DB) | medium (AI có mốc) | low (fallback).
import { llm, LLM_MODEL } from "./llm.js";
import { supabase } from "./supabase.js";

const FETCH_TIMEOUT_MS = 4500;

/* =========================================================
 * 1. PARSE ĐỊNH LƯỢNG + CHUẨN HÓA ĐƠN VỊ
 * ========================================================= */
// Thứ tự quan trọng: cụm dài (muỗng canh) phải đứng trước cụm ngắn (muỗng).
// serving=true: đơn vị tương đương "1 suất chuẩn" → được phép tra FOODS DB.
const UNIT_DEFS = [
  { re: "muỗng canh|muong canh|thìa canh|thia canh|tbsp", kind: "volume", ml: 15 },
  { re: "muỗng cà phê|muỗng cafe|muong ca phe|thìa cà phê|thìa cafe|thia ca phe|tsp", kind: "volume", ml: 5 },
  { re: "muỗng|muong|thìa|thia", kind: "volume", ml: 15 },
  { re: "ml|mL|cc", kind: "volume", ml: 1 },
  { re: "lít|liters|litres|liter|litre|lit|l", kind: "volume", ml: 1000 },
  { re: "ly|cốc|coc|cups|cup|glasses|glass", kind: "volume", ml: 250 },
  { re: "kg|kilogram|kilo|kí|ký", kind: "mass", g: 1000 },
  { re: "lạng|lang", kind: "mass", g: 100 },
  { re: "gram|gam|gr|g", kind: "mass", g: 1 },
  { re: "phần|phan|suất|suat|tô|to|bát|bat|chén|chen|đĩa|dĩa|dia|ổ|hộp|hop|cái|cai|lon|chai|gói|goi|servings|serving|portions|portion|bowls|bowl|plates|plate", kind: "count", serving: true },
  { re: "miếng|mieng|lát|lat|viên|vien|quả|qua|trái|trai|củ|que|cây|cay|khoanh|khúc|khuc|thanh|cặp|cap|pieces|piece|pcs|slices|slice|bars|bar", kind: "count", serving: false },
];

// Số: chữ số, thập phân, PHÂN SỐ "1/2", và số bằng CHỮ (Việt + Anh).
// Chữ số Việt chỉ nhận khi ĐỨNG NGAY TRƯỚC đơn vị (NUM_RE luôn đi kèm unit trong
// parseQuantity) nên "ba" trong "bún bò ba màu" không bị bắt nhầm.
const WORD_NUM = {
  "nửa": 0.5, nua: 0.5, "rưỡi": 0.5, half: 0.5,
  "một": 1, mot: 1, one: 1, a: 1, an: 1,
  hai: 2, two: 2,
  ba: 3, three: 3,
  "bốn": 4, bon: 4, four: 4,
  "năm": 5, five: 5,
  "sáu": 6, sau: 6, six: 6,
  "bảy": 7, bay: 7, seven: 7,
  "tám": 8, tam: 8, eight: 8,
  "chín": 9, chin: 9, nine: 9,
  "mười": 10, muoi: 10, ten: 10,
};

const NUM_RE =
  "(\\d+(?:[.,]\\d+)?(?:\\s*\\/\\s*\\d+(?:[.,]\\d+)?)?|" +
  Object.keys(WORD_NUM).join("|") +
  ")";

const parseNum = (s) => {
  const t = String(s || "").trim().toLowerCase();
  if (t in WORD_NUM) return WORD_NUM[t];
  // Phân số "1/2", "1/3", "3/4"...
  const frac = t.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/);
  if (frac) {
    const a = parseFloat(frac[1].replace(",", "."));
    const b = parseFloat(frac[2].replace(",", "."));
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) {
      const q = a / b;
      return q > 0 && q < 100000 ? q : null;
    }
  }
  const n = parseFloat(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
};

// Cụm phân số bằng CHỮ → dạng số, chạy TRƯỚC khi match đơn vị:
// "one third cup milk" → "1/3 cup milk" | "nửa quả chuối" giữ nguyên ("nửa" đã có
// trong WORD_NUM). Lookahead (?!\s*(chỉ|chi|rọi|roi)) để "một phần ba chỉ/ba rọi"
// (thịt ba chỉ) KHÔNG bị hiểu nhầm thành 1/3.
const FRACTION_PHRASES = [
  [/(?<!\p{L})(?:one|a)\s+third(?!\p{L})/giu, "1/3"],
  [/(?<!\p{L})two\s+thirds?(?!\p{L})/giu, "2/3"],
  [/(?<!\p{L})(?:one|a)\s+quarter(?!\p{L})/giu, "1/4"],
  [/(?<!\p{L})three\s+quarters?(?!\p{L})/giu, "3/4"],
  [/(?<!\p{L})half\s+(?:a|an)\s+/giu, "0.5 "],
  [/(?<!\p{L})half\s+/giu, "0.5 "],
  [/(?<!\p{L})một phần ba(?!\p{L})(?!\s*(?:chỉ|chi|rọi|roi))/giu, "1/3"],
  [/(?<!\p{L})hai phần ba(?!\p{L})(?!\s*(?:chỉ|chi|rọi|roi))/giu, "2/3"],
  [/(?<!\p{L})một phần tư(?!\p{L})/giu, "1/4"],
  [/(?<!\p{L})ba phần tư(?!\p{L})/giu, "3/4"],
];

const normalizeQuantityWords = (t) => {
  let out = t;
  for (const [re, rep] of FRACTION_PHRASES) out = out.replace(re, rep);
  return out.replace(/\s+/g, " ").trim();
};

const cleanBase = (s) =>
  String(s || "")
    .replace(/^\s*(của|cua)\s+/u, "")
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/gu, "")
    .trim();

/** Tách số lượng + đơn vị khỏi tên món.
 *  "300ml sữa socola" | "sữa socola 300ml" | "2 quả chuối" | "1 tô phở" | "nửa lít sữa"
 *  → { qty, unit, kind: 'volume'|'mass'|'count', ml?|g?, serving?, baseFood }
 *  Không nhận ra định lượng → null (caller giữ hành vi mặc định "1 phần"). */
export function parseQuantity(text) {
  const t = normalizeQuantityWords(String(text || "").toLowerCase().replace(/\s+/g, " ").trim());
  if (!t) return null;
  for (const def of UNIT_DEFS) {
    // Dạng đứng đầu: "300ml sữa socola" / "2 quả chuối"
    let m = t.match(new RegExp(`^${NUM_RE}\\s*(${def.re})(?!\\p{L})\\s*(.*)$`, "u"));
    let base = null, qty = null, unit = null;
    if (m) { qty = parseNum(m[1]); unit = m[2]; base = cleanBase(m[3]); }
    else {
      // Dạng đứng cuối: "sữa socola 300ml" / "chuối 2 quả"
      m = t.match(new RegExp(`^(.+?)\\s+${NUM_RE}\\s*(${def.re})(?!\\p{L})\\s*$`, "u"));
      if (m) { base = cleanBase(m[1]); qty = parseNum(m[2]); unit = m[3]; }
    }
    if (qty == null || !base) continue;
    const out = { qty, unit, kind: def.kind, baseFood: base };
    if (def.kind === "volume") out.ml = qty * def.ml;
    if (def.kind === "mass") out.g = qty * def.g;
    if (def.kind === "count") out.serving = !!def.serving;
    return out;
  }
  // Số TRẦN đứng đầu không kèm đơn vị: "10 chocolate chip cookies", "1 sushi",
  // "0.5 banana" (từ "half banana"), "1/2 chuối" → hiểu là "N cái <món>" (đếm
  // từng chiếc — KHÔNG phải N suất chuẩn). CHỈ nhận SỐ (digits/thập phân/phân số)
  // hoặc "nửa" đứng ĐẦU để không nhầm tên món có số bằng chữ ("ba rọi", "chè 3 màu"
  // — số nằm giữa/cuối hoặc là một phần của tên món).
  const bare = t.match(/^(\d{1,2}(?:[.,]\d+)?(?:\s*\/\s*\d{1,2})?|nửa|nua)\s+(.+)$/u);
  if (bare) {
    const qty = parseNum(bare[1]);
    const base = cleanBase(bare[2]);
    if (qty != null && qty > 0 && qty <= 50 && base && /\p{L}/u.test(base)) {
      return { qty, unit: "cái", kind: "count", serving: false, baseFood: base };
    }
  }
  return null;
}

/* =========================================================
 * 2. SCALE TUYẾN TÍNH + VALIDATION (ATWATER)
 * ========================================================= */
const NUT_KEYS = ["calories", "protein", "fat", "carbs", "fiber", "sugar", "sodium"];

const toNum = (v) => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(",", ".").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Nhân toàn bộ dinh dưỡng (kcal + P/F/C/fiber/sugar/sodium) theo cùng 1 hệ số.
 *  KHÔNG BAO GIỜ chỉ scale calories — tất cả các chất đi cùng nhau. */
export function scaleLinear(per, factor) {
  const out = {};
  for (const k of NUT_KEYS) {
    const n = toNum(per?.[k]);
    out[k] = n == null ? null : (k === "calories" ? Math.round(n * factor) : round1(n * factor));
  }
  return out;
}

/** Validation cuối trước khi trả kết quả (Yêu cầu #8):
 *  - Chặn giá trị âm (clamp về 0).
 *  - Đối chiếu Atwater: kcal ≈ 4×P + 4×C + 9×F. Lệch quá 15% → tự hiệu chỉnh
 *    kcal theo macro (deterministic, không tốn thêm 1 lượt gọi AI).
 *  - trustCalories=true (nhãn USDA/OFF đo thực tế): chỉ chặn âm, không sửa kcal.
 *  Nhận object số hoặc chuỗi ("25g"/"800mg"), trả về SỐ thuần + cờ corrected. */
export function validateNumericNutrition(nut, { trustCalories = false } = {}) {
  const n = {};
  for (const k of NUT_KEYS) {
    let v = toNum(nut?.[k]);
    if (v != null && v < 0) v = 0;
    n[k] = v;
  }
  let corrected = false;
  const p = n.protein, f = n.fat, c = n.carbs;
  if (p != null || f != null || c != null) {
    const atwater = 4 * (p || 0) + 4 * (c || 0) + 9 * (f || 0);
    if (atwater > 0) {
      if (n.calories == null) {
        n.calories = Math.round(atwater);
        corrected = true;
      } else if (!trustCalories && Math.abs(n.calories - atwater) > 0.15 * atwater) {
        n.calories = Math.round(atwater);
        corrected = true;
      }
    }
  }
  if (n.calories != null) n.calories = Math.round(n.calories);
  return { ...n, corrected };
}

/** Suy KHOẢNG calo [min, max] từ 1 số calo điểm + độ tin cậy (Yêu cầu #3).
 *  Độ rộng khoảng TỈ LỆ NGHỊCH với confidence:
 *    high  → hẹp  (~±9%,  bề rộng ~18%)
 *    medium→ vừa  (~±16%, bề rộng ~32%)
 *    low   → rộng (~±25%, bề rộng ~50%)
 *  Làm tròn min xuống / max lên bội số 5 để hiển thị đẹp. KHÔNG thay `calories`
 *  điểm — đây là field bổ sung, backward-compatible cho web + mobile. */
export function caloriesRange(calories, confidence = "medium") {
  const cal = Math.max(0, Math.round(Number(calories) || 0));
  if (!cal) return { min: 0, max: 0 };
  const width = { high: 0.18, medium: 0.32, low: 0.5 }[String(confidence || "").toLowerCase()] ?? 0.32;
  const half = width / 2;
  let min = Math.floor((cal * (1 - half)) / 5) * 5;
  let max = Math.ceil((cal * (1 + half)) / 5) * 5;
  if (min < 0) min = 0;
  if (max <= min) max = min + 5;
  return { min, max };
}

/** Bản dùng cho analyze-food / chat: giữ NGUYÊN format hiện có của response
 *  (calories: number, protein/fat/carbs/fiber/sugar: "Ng", sodium: "Nmg"). */
export function validateAndFixNutrition(obj, opts = {}) {
  const fixed = validateNumericNutrition(obj, opts);
  const g = (v, orig) => (v == null ? (orig ?? null) : `${v}g`);
  return {
    calories: fixed.calories ?? toNum(obj?.calories) ?? 0,
    protein: g(fixed.protein, obj?.protein),
    fat: g(fixed.fat, obj?.fat),
    carbs: g(fixed.carbs, obj?.carbs),
    fiber: g(fixed.fiber, obj?.fiber),
    sugar: g(fixed.sugar, obj?.sugar),
    sodium: fixed.sodium == null ? (obj?.sodium ?? null) : `${Math.round(fixed.sodium)}mg`,
    corrected: fixed.corrected,
  };
}

/* =========================================================
 * 3. CACHE MỐC DINH DƯỠNG (nutrition_anchors + memory)
 *    Cache là chìa khóa nhất quán GIỮA CÁC LẦN GỌI: món đã có
 *    mốc thì mọi request sau chỉ scale, không hỏi lại AI.
 * ========================================================= */
const memAnchors = new Map();

// Xếp hạng độ tin cậy của NGUỒN dữ liệu (A+B). Nguồn cao hơn được phép thay
// nguồn thấp hơn; `verified` (admin duyệt) coi như cao nhất, không bao giờ bị đè.
//   manual(admin) > usda ≈ off ≈ vn_ref (dữ liệu chuẩn) > foods (tích luỹ) > ai(đoán)
const SOURCE_RANK = { manual: 6, usda: 5, off: 4, vn_ref: 4, foods: 2, db: 2, ai: 1 };
const sourceRank = (s, verified) => (verified ? 100 : (SOURCE_RANK[String(s || "").toLowerCase()] ?? 0));
// Nguồn → độ tin mặc định hiển thị cho người dùng (khi engine không tự set)
const sourceConfidence = (s) => {
  const r = SOURCE_RANK[String(s || "").toLowerCase()] ?? 0;
  return r >= 4 ? "high" : r >= 2 ? "medium" : "low";
};

const normKey = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ── C: ALIAS VÙNG MIỀN ───────────────────────────────────────────────────────
// Đưa các tên gọi khác nhau về MỘT dạng chuẩn trong matching + cacheKey, để
// "bắp luộc" ↔ "ngô luộc", "thịt heo" ↔ "thịt lợn" dùng chung mốc/dòng foods.
// Chỉ chọn cặp AN TOÀN (từ đủ dài, không đụng đơn vị đếm như "trái"): tránh gộp
// nhầm. Áp trên chuỗi ĐÃ normKey (không dấu). canonKey = normKey → thay alias.
const FOOD_ALIASES = [
  [/\bbap\b/g, "ngo"],            // bắp = ngô
  [/\bheo\b/g, "lon"],           // heo = lợn
  [/\bkhoai mi\b/g, "san"],      // khoai mì = sắn
  [/\bbanh my\b/g, "banh mi"],   // bánh mỳ = bánh mì
  [/\bhu tiu\b/g, "hu tieu"],    // hủ tíu = hủ tiếu
  [/\bdau phong\b/g, "lac"],     // đậu phộng = lạc
  [/\bcu san\b/g, "san"],        // củ sắn
];

const canonKey = (s) => {
  let k = normKey(s);
  for (const [re, to] of FOOD_ALIASES) k = k.replace(re, to);
  return k.replace(/\s+/g, " ").trim();
};

const refMatches = (queryKey, ref) =>
  (ref.keys || []).some((k) => {
    const kk = canonKey(k);
    return queryKey === kk || queryKey.includes(kk) || kk.includes(queryKey);
  });

// Deterministic fallback references for common Vietnamese foods and regression cases.
// These sit between external public data and AI anchors, so repeated calls scale
// from the same baseline even when network/database lookups miss.
// LƯU Ý THỨ TỰ: mốc CHUNG (sữa tươi) phải đứng TRƯỚC biến thể (sữa socola) —
// refMatches khớp substring nên "sữa"/"milk" phải rơi vào mốc chung 60kcal,
// không phải mốc socola 80kcal; còn "sữa socola" không khớp keys mốc chung
// nên vẫn rơi đúng vào mốc socola.
const REFERENCE_PER100 = [
  {
    keys: ["sua tuoi", "milk", "whole milk"],
    kind: "volume",
    per: { calories: 60, protein: 3.2, fat: 3.3, carbs: 4.8, fiber: 0, sugar: 4.8, sodium: 44 },
  },
  {
    keys: ["sua socola", "chocolate milk"],
    kind: "volume",
    per: { calories: 80, protein: 3.2, fat: 2.6, carbs: 10.5, fiber: 0, sugar: 10, sodium: 55 },
  },
  {
    keys: ["com trang", "com", "rice", "cooked rice"],
    kind: "mass",
    per: { calories: 130, protein: 2.7, fat: 0.3, carbs: 28.2, fiber: 0.4, sugar: 0.1, sodium: 1 },
  },
];

const REFERENCE_UNITS = [
  {
    keys: ["sushi", "mieng sushi"],
    units: ["mieng", "cai", "piece", "pcs"],
    per: { calories: 50, protein: 2.2, fat: 0.8, carbs: 8.5, fiber: 0.3, sugar: 1, sodium: 120 },
  },
  {
    keys: ["chuoi", "banana"],
    units: ["qua", "trai", "cai"],
    per: { calories: 105, protein: 1.3, fat: 0.4, carbs: 27, fiber: 3.1, sugar: 14.4, sodium: 1 },
  },
  {
    keys: ["pho", "pho bo", "pho ga"],
    units: ["to", "bat", "phan", "bowl", "serving"],
    per: { calories: 480, protein: 28, fat: 12, carbs: 62, fiber: 3, sugar: 5, sodium: 950 },
  },
  {
    keys: ["com tam"],
    units: ["phan", "dia", "plate", "serving"],
    per: { calories: 650, protein: 32, fat: 22, carbs: 78, fiber: 4, sugar: 7, sodium: 1100 },
  },
  {
    // CHỈ bánh ngọt/tráng miệng. KHÔNG dùng key trần "banh" — refMatches khớp
    // substring nên "banh" sẽ nuốt nhầm "banh mi", "banh xeo", "banh cuon"... →
    // gán 300kcal bánh ngọt cho món mặn. Chỉ giữ cụm rõ nghĩa là đồ ngọt.
    keys: ["banh ngot", "banh kem", "banh bong lan", "banh gato", "cake", "pastry", "sponge cake"],
    units: ["mieng", "lat", "slice", "piece"],
    per: { calories: 300, protein: 4, fat: 14, carbs: 40, fiber: 1.2, sugar: 24, sodium: 220 },
  },
];

function lookupReferencePer100(base, kind) {
  const key = canonKey(base);
  if (!key) return null;
  return REFERENCE_PER100.find((r) => r.kind === kind && refMatches(key, r)) || null;
}

function lookupReferenceUnit(base, unitLabel) {
  const key = canonKey(base);
  const unit = normKey(unitLabel);
  if (!key || !unit) return null;
  return REFERENCE_UNITS.find((r) =>
    refMatches(key, r) && (r.units || []).some((u) => normKey(u) === unit)
  ) || null;
}

async function getAnchor(key) {
  if (memAnchors.has(key)) return memAnchors.get(key);
  try {
    const { data, error } = await supabase
      .from("nutrition_anchors")
      .select("per_unit, source, confidence, verified")
      .eq("key", key)
      .limit(1);
    if (!error && data && data[0]) {
      memAnchors.set(key, data[0]);
      // Đo mức dùng (fire-and-forget) — không chặn/không ảnh hưởng determinism.
      bumpAnchorUsage(key);
      return data[0];
    }
  } catch {
    /* bảng chưa tạo -> chỉ dùng memory cache, không chặn flow */
  }
  return null;
}

// Cập nhật hit_count + last_used_at cho anchor (analytics/self-healing). Bỏ qua lỗi.
function bumpAnchorUsage(key) {
  try {
    supabase.rpc("increment_anchor_hit", { anchor_key: key }).then(() => {}, () => {});
  } catch { /* RPC chưa tạo -> bỏ qua, không ảnh hưởng flow */ }
}

// Ghi mốc CÓ XẾP HẠNG NGUỒN (A+B): không bao giờ HẠ CẤP một mốc đang tốt hơn
// hoặc đã được admin verify. Nguồn tốt hơn (hoặc bằng) mới được ghi đè.
async function saveAnchor(key, kind, perUnit, source, confidence) {
  const conf = confidence || sourceConfidence(source);
  const existing = memAnchors.get(key);
  // Không hạ cấp: mốc cũ verified, hoặc nguồn cũ hạng cao hơn nguồn mới → giữ nguyên.
  if (existing && sourceRank(existing.source, existing.verified) > sourceRank(source, false)) {
    return;
  }
  const entry = { per_unit: perUnit, source, confidence: conf, verified: false };
  memAnchors.set(key, entry);
  try {
    await supabase.from("nutrition_anchors").upsert({
      key, kind, per_unit: perUnit, source, confidence: conf,
      updated_at: new Date().toISOString(), last_used_at: new Date().toISOString(),
    });
  } catch {
    /* không có bảng cũng không sao — memory cache vẫn giữ trong warm lambda */
  }
}

/* =========================================================
 * 4. NGUỒN DỮ LIỆU CHUẨN (Yêu cầu #5)
 *    Ưu tiên: USDA → OpenFoodFacts → FOODS DB (suất VN) → AI.
 * ========================================================= */
async function fetchJsonWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "calorie-ai/1.0" } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** USDA FoodData Central — per 100g. Cần env FDC_API_KEY (không có thì bỏ qua). */
async function usdaPer100(query) {
  const apiKey = process.env.FDC_API_KEY;
  if (!apiKey) return null;
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(query)}&pageSize=1` +
    `&dataType=${encodeURIComponent("Foundation,SR Legacy,Survey (FNDDS)")}`;
  const data = await fetchJsonWithTimeout(url);
  const nutrients = data?.foods?.[0]?.foodNutrients;
  if (!Array.isArray(nutrients)) return null;
  const byId = (...ids) => {
    const hit = nutrients.find((x) => ids.includes(x.nutrientId));
    return hit && Number.isFinite(Number(hit.value)) ? Number(hit.value) : null;
  };
  const per = {
    calories: byId(1008, 2047, 2048), // Energy kcal
    protein: byId(1003),
    fat: byId(1004),
    carbs: byId(1005),
    fiber: byId(1079),
    sugar: byId(2000),
    sodium: byId(1093), // mg
  };
  return per.calories != null && per.protein != null ? per : null;
}

/** OpenFoodFacts — per 100g/100ml, miễn phí, có sản phẩm Việt Nam.
 *  Trong 5 kết quả đầu, ưu tiên sản phẩm có TÊN khớp nhiều token với truy vấn
 *  nhất (tránh lấy nhầm biến thể ít liên quan chỉ vì nó đứng đầu). */
async function offPer100(query) {
  const url =
    "https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1" +
    `&page_size=5&fields=product_name,nutriments&search_terms=${encodeURIComponent(query)}`;
  const data = await fetchJsonWithTimeout(url);
  const products = Array.isArray(data?.products) ? data.products : [];
  const qTokens = normKey(query).split(" ").filter(Boolean);

  let best = null;
  let bestScore = -1;
  for (const p of products) {
    const nu = p?.nutriments || {};
    const kcal = Number(nu["energy-kcal_100g"]);
    const prot = Number(nu["proteins_100g"]);
    if (!Number.isFinite(kcal) || kcal <= 0 || !Number.isFinite(prot)) continue;
    const name = normKey(p?.product_name);
    const nameTokens = name.split(" ").filter(Boolean);
    // Bắt buộc tên sản phẩm chứa ĐỦ mọi token của truy vấn (tránh khớp lạc đề);
    // trong số đó ưu tiên tên NGẮN nhất (ít từ thừa nhất = sát món gốc nhất).
    if (!qTokens.every((tk) => name.includes(tk))) continue;
    const score = 1000 - nameTokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = nu;
    }
  }
  if (!best) return null;
  const num = (k) => (Number.isFinite(Number(best[k])) ? Number(best[k]) : null);
  return {
    calories: Number(best["energy-kcal_100g"]),
    protein: Number(best["proteins_100g"]),
    fat: num("fat_100g"),
    carbs: num("carbohydrates_100g"),
    fiber: num("fiber_100g"),
    sugar: num("sugars_100g"),
    sodium: num("sodium_100g") != null ? num("sodium_100g") * 1000 : null, // g -> mg
  };
}

/* =========================================================
 * 5. AI ANCHOR (temperature 0 — cùng câu hỏi luôn cùng đáp án)
 * ========================================================= */
const safeJson = (raw) => {
  let s = String(raw || "").trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, "$1")); } catch {} }
  return null;
};

const ANCHOR_JSON_SPEC = `Trả về DUY NHẤT một JSON object (không markdown, không giải thích):
{"calories":<number kcal>,"protein":<number g>,"fat":<number g>,"carbs":<number g>,"fiber":<number g>,"sugar":<number g>,"sodium":<number mg>}`;

async function callAnchorAI(sys) {
  const completion = await llm.chat.completions.create({
    model: LLM_MODEL,
    messages: [{ role: "system", content: sys }],
    response_format: { type: "json_object" },
    // Deterministic tuyệt đối: cùng món -> cùng mốc, không "AI bị loạn"
    temperature: 0,
    top_p: 1,
    seed: 42,
    max_tokens: 220,
    extra_body: { chat_template_kwargs: { enable_thinking: false } },
  });
  const obj = safeJson(completion.choices?.[0]?.message?.content);
  if (!obj) return null;
  const per = {};
  for (const k of NUT_KEYS) per[k] = toNum(obj[k]);
  return per.calories != null || per.protein != null ? per : null;
}

/** Mốc trên đúng 100ml hoặc 100g — TUYỆT ĐỐI không ước theo khẩu phần. */
function per100Prompt(base, kind) {
  const unit = kind === "volume" ? "100ml" : "100g";
  return `Bạn là chuyên gia dữ liệu dinh dưỡng (USDA / Bảng thành phần thực phẩm Việt Nam).
NHIỆM VỤ: cho GIÁ TRỊ DINH DƯỠNG CHUẨN trên ĐÚNG ${unit} của thực phẩm: "${base}".
QUY TẮC:
- KHÔNG ước theo khẩu phần, ly, hộp hay suất — CHỈ trên đúng ${unit}.
- Dùng số liệu bảng thành phần thực phẩm chuẩn, không bịa số.
- Tham chiếu: sữa tươi ~60kcal/100ml | sữa socola ~80kcal/100ml | nước ngọt ~42kcal/100ml |
  cơm trắng ~130kcal/100g | thịt gà ~165kcal/100g | chuối ~89kcal/100g.
${ANCHOR_JSON_SPEC}`;
}

/** Mốc trên đúng 1 đơn vị đếm ("1 miếng sushi", "1 quả chuối", "1 tô phở"...). */
function perUnitPrompt(base, unitLabel, mealLabel) {
  return `Bạn là chuyên gia dinh dưỡng quốc tế, am hiểu ẩm thực Việt Nam và thế giới.
NHIỆM VỤ: cho giá trị dinh dưỡng của ĐÚNG 1 ${unitLabel} "${base}" cỡ TRUNG BÌNH.
${mealLabel ? `Bữa: ${mealLabel}.` : ""}
Hiểu đúng tên vùng miền: "bắp"="ngô" | "heo"="lợn" | "khoai mì"="sắn" | "trái"="quả".
Tham chiếu khẩu phần chuẩn (để định cỡ, không copy mù):
- 1 miếng sushi ~40-60kcal | 1 miếng bánh ngọt ~250-350kcal | 1 quả chuối ~90-105kcal
- 1 tô phở ~450-500kcal | 1 phần cơm tấm ~600-700kcal | 1 ổ bánh mì thịt ~500kcal
- 1 quả trứng ~70kcal | 1 lát bánh mì ~80kcal | 1 viên chả ~50-70kcal
KHÔNG bịa số. Chỉ tính cho ĐÚNG 1 ${unitLabel}, không tính cả phần/cả hộp.
${ANCHOR_JSON_SPEC}`;
}

/* =========================================================
 * 6. PIPELINE CHÍNH
 * ========================================================= */
const fmtOut = (v, suffix) => (v == null ? null : `${v}${suffix}`);

function buildResult({ food, amount, nums, source, confidence }) {
  return {
    food,
    amount,
    calories: nums.calories,
    protein: fmtOut(nums.protein, "g"),
    fat: fmtOut(nums.fat, "g"),
    carbs: fmtOut(nums.carbs, "g"),
    fiber: fmtOut(nums.fiber, "g"),
    sugar: fmtOut(nums.sugar, "g"),
    sodium: nums.sodium == null ? null : `${Math.round(nums.sodium)}mg`,
    source,
    confidence, // 'high' | 'medium' | 'low'
    estimated: confidence !== "high",
  };
}

const findExactInFoodsDB = (name, foodsDB) => {
  const key = canonKey(name);
  if (!key) return null;
  return (foodsDB || []).find((f) => canonKey(f.description) === key) || null;
};

const trimQty = (q) => (Number.isInteger(q) ? String(q) : String(q).replace(".", ","));

/** Ước tính dinh dưỡng NHẤT QUÁN cho 1 món (text). Trả null nếu mọi nguồn đều hỏng.
 *  foodsDB: rows bảng foods (per suất chuẩn) — dùng cho đơn vị đếm dạng "suất". */
export async function estimateFoodSmart({ food, mealLabel = "", foodsDB = [], traceId = "" }) {
  const original = String(food || "").trim();
  if (!original) return null;
  const parsed = parseQuantity(original);
  const logTag = traceId ? `${traceId} | nutrition` : "nutrition";

  // ── A. Đơn vị ĐO ĐƯỢC (ml/g): mốc /100 + scale tuyến tính ──────────────
  if (parsed && (parsed.kind === "volume" || parsed.kind === "mass")) {
    const qtyBase = parsed.kind === "volume" ? parsed.ml : parsed.g; // ml hoặc g
    const cacheKey = `${parsed.kind}:${canonKey(parsed.baseFood)}`;
    let anchor = await getAnchor(cacheKey);
    if (!anchor) {
      let perUnit = await usdaPer100(parsed.baseFood);
      let source = "usda";
      if (!perUnit) { perUnit = await offPer100(parsed.baseFood); source = "off"; }
      if (!perUnit) {
        const ref = lookupReferencePer100(parsed.baseFood, parsed.kind);
        if (ref) { perUnit = ref.per; source = "vn_ref"; }
      }
      if (!perUnit) {
        try { perUnit = await callAnchorAI(per100Prompt(parsed.baseFood, parsed.kind)); source = "ai"; }
        catch (e) { console.warn(`[${logTag}] anchor AI:`, e.message); }
      }
      if (perUnit) {
        anchor = { per_unit: perUnit, source, confidence: sourceConfidence(source) };
        await saveAnchor(cacheKey, parsed.kind, perUnit, source);
      }
    }
    if (anchor) {
      const scaled = scaleLinear(anchor.per_unit, qtyBase / 100);
      const nums = validateNumericNutrition(scaled, { trustCalories: anchor.source !== "ai" });
      console.log(`[${logTag}] scale ${qtyBase}${parsed.kind === "volume" ? "ml" : "g"} × mốc/100 (${anchor.source}): "${parsed.baseFood}" -> ${nums.calories}kcal`);
      return buildResult({
        food: original,
        amount: `${trimQty(parsed.qty)} ${parsed.unit}`,
        nums,
        source: `${anchor.source}_per100`,
        confidence: anchor.verified ? "high" : (anchor.confidence || sourceConfidence(anchor.source)),
      });
    }
    // không lấy được mốc -> rơi xuống nhánh đếm bên dưới (coi là 1 phần)
  }

  // ── B. Đơn vị ĐẾM hoặc không có định lượng: mốc /1 đơn vị × số lượng ────
  const isCount = parsed?.kind === "count";
  const count = isCount ? parsed.qty : 1;
  const unitLabel = isCount ? parsed.unit : "phần";
  const servingLike = isCount ? parsed.serving : true;
  const base = (isCount && parsed.baseFood) || original;

  // B1. FOODS DB — chỉ hợp lệ khi đơn vị là 1 SUẤT chuẩn (phần/tô/bát/đĩa...);
  //     "1 miếng X" không được lấy số liệu cả suất của X.
  if (servingLike) {
    // Exact/alias match only (no embeddings anywhere in this project).
    const hit = findExactInFoodsDB(base, foodsDB) || findExactInFoodsDB(original, foodsDB);
    if (hit) {
      const scaled = scaleLinear(hit, count);
      const nums = validateNumericNutrition(scaled);
      // Dòng foods đã ADMIN VERIFY → tin cao; AI tích luỹ chưa duyệt → medium.
      const conf = hit.verified ? "high" : "medium";
      return buildResult({
        food: count === 1 ? (hit.description || original) : original,
        amount: `${trimQty(count)} ${unitLabel}`,
        nums,
        source: hit.verified ? "foods_verified" : "foods",
        confidence: conf,
      });
    }
  }

  // B2. AI mốc /1 đơn vị (temp 0 + cache) rồi × số lượng.
  const cacheKey = `unit:${normKey(unitLabel)}:${canonKey(base)}`;
  let anchor = await getAnchor(cacheKey);
  if (!anchor) {
    const ref = lookupReferenceUnit(base, unitLabel);
    if (ref) {
      anchor = { per_unit: ref.per, source: "vn_ref", confidence: "high" };
      await saveAnchor(cacheKey, "unit", ref.per, "vn_ref", "high");
    }
  }
  if (!anchor) {
    try {
      const perUnit = await callAnchorAI(perUnitPrompt(base, unitLabel, mealLabel));
      if (perUnit) {
        anchor = { per_unit: perUnit, source: "ai", confidence: "medium" };
        await saveAnchor(cacheKey, "unit", perUnit, "ai");
      }
    } catch (e) {
      console.warn(`[${logTag}] per-unit AI:`, e.message);
    }
  }
  if (anchor) {
    const scaled = scaleLinear(anchor.per_unit, count);
    const nums = validateNumericNutrition(scaled);
    console.log(`[${logTag}] ${count} ${unitLabel} × mốc/đơn vị (${anchor.source}): "${base}" -> ${nums.calories}kcal`);
    return buildResult({
      food: original,
      amount: `${trimQty(count)} ${unitLabel}`,
      nums,
      source: anchor.source === "vn_ref" ? "vn_ref_per_unit" : "ai_per_unit",
      confidence: anchor.verified ? "high" : (anchor.confidence || sourceConfidence(anchor.source)),
    });
  }

  return null; // caller tự fallback (giữ hành vi cũ)
}

export async function resolveNutrition({ meal, food, mealLabel = "", foodsDB = [], traceId = "" }) {
  const sourceMeal = meal && typeof meal === "object" ? meal : {};
  const foodName = String(food || sourceMeal.description || sourceMeal.food || "").trim();
  const amount = String(sourceMeal.amount || "").trim();
  const query = [amount, foodName].filter(Boolean).join(" ").trim() || foodName;
  const smart = await estimateFoodSmart({ food: query, mealLabel, foodsDB, traceId });
  const base = smart || {
    food: foodName || "Món ăn",
    amount: amount || "1 phần",
    calories: sourceMeal.calories ?? 0,
    protein: sourceMeal.protein ?? "0g",
    fat: sourceMeal.fat ?? "0g",
    carbs: sourceMeal.carbs ?? "0g",
    fiber: sourceMeal.fiber ?? "0g",
    sugar: sourceMeal.sugar ?? "0g",
    sodium: sourceMeal.sodium ?? "0mg",
    source: sourceMeal.source || "ai_raw",
    confidence: sourceMeal.confidence || "low",
    estimated: true,
  };
  const fixed = validateAndFixNutrition(base, {
    trustCalories: String(base.source || "").startsWith("usda") || String(base.source || "").startsWith("off"),
  });
  return {
    ...sourceMeal,
    ...base,
    food: foodName || base.food,
    description: foodName || base.food || base.description || "Món ăn",
    amount: base.amount || amount || "1 phần",
    calories: fixed.calories,
    protein: fixed.protein,
    fat: fixed.fat,
    carbs: fixed.carbs,
    fiber: fixed.fiber,
    sugar: fixed.sugar,
    sodium: fixed.sodium,
    corrected: Boolean(fixed.corrected || sourceMeal.corrected),
    confidence: base.confidence || "low",
    estimated: base.estimated !== false,
  };
}
