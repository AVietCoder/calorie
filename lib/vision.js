/**
 * lib/vision.js — Nhận diện MÓN ĂN từ ảnh với độ chính xác cao nhất:
 *
 *   1) GEMINI (Google) — nhận diện món ăn (đặc biệt món Việt) chính xác,
 *      rẻ, có bậc miễn phí. BẬT bằng cách đặt biến môi trường GEMINI_API_KEY.
 *   2) QWEN (vLLM local) — mặc định khi KHÔNG đặt GEMINI_API_KEY (100% local,
 *      0 token cloud). Sử dụng mm_processor_kwargs tối ưu cho Qwen2.5-VL.
 *
 * Cơ chế: nếu có GEMINI_API_KEY thì thử Gemini trước; lỗi -> tự fallback về Qwen.
 *
 * ENV:
 *   GEMINI_API_KEY     khoá Google AI Studio. Để trống = chỉ dùng Qwen.
 *   GEMINI_MODEL       mặc định "gemini-2.0-flash".
 *   VISION_PROVIDER    "gemini" | "qwen". Mặc định auto-detect theo GEMINI_API_KEY.
 *   QWEN_MIN_PIXELS    min pixels cho Qwen VL (mặc định 200704 = 448×448).
 *   QWEN_MAX_PIXELS    max pixels cho Qwen VL (mặc định 2007040 = 4× min).
 */
import { llm, LLM_VISION_MODEL } from "./llm.js";
import { caloriesRange } from "./nutrition.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const VISION_PROVIDER = (
  process.env.VISION_PROVIDER || (GEMINI_KEY ? "gemini" : "qwen")
).toLowerCase();

// ── Qwen VL pixel budget (mm_processor_kwargs) ──────────────────────────────
// Tham khảo: vllm serve Qwen2.5-VL-32B-Instruct \
//   --mm-processor-kwargs '{"min_pixels": 200704, "max_pixels": 3211264}'
// 200704 = 448 × 448  (ngưỡng tối thiểu để mô hình nhìn đủ chi tiết)
// 3211264 = 448 × 448 × 16 (~3.2MP) — nâng từ 2MP để ĐẾM tốt các vật thể nhỏ
// (nhiều miếng sushi/bánh trong 1 ảnh). H100 80GB còn dư VRAM; nếu server cũ
// bị chậm/OOM thì hạ lại bằng env QWEN_MAX_PIXELS=2007040.
const QWEN_MIN_PIXELS = parseInt(process.env.QWEN_MIN_PIXELS || "200704", 10);
const QWEN_MAX_PIXELS = parseInt(process.env.QWEN_MAX_PIXELS || "3211264", 10);

// ── Debug (dev-only): trace VLM raw → parsed để xác định CHÍNH XÁC món bị mất ở
// bước nào (VLM không thấy? parser bỏ? …). Bật ở production bằng VISION_DEBUG=1.
const VISION_DEBUG = process.env.VISION_DEBUG === "1" || process.env.NODE_ENV !== "production";
function debugRaw(tag, text) {
  if (!VISION_DEBUG) return;
  const s = String(text || "");
  console.log(`[vision:debug] ${tag} RAW (${s.length} chars): ${s.slice(0, 900)}`);
}
function debugParsed(tag, obj) {
  if (!VISION_DEBUG || !obj) return;
  const items = Array.isArray(obj.items) ? obj.items : [];
  console.log(
    `[vision:debug] ${tag} PARSED → is_food=${obj.is_food} food="${obj.food || obj.reason || ""}" ` +
    `conf=${obj.confidence || "?"} calo=${obj.calories} range=[${obj.calories_min}-${obj.calories_max}] ` +
    `items=${items.length}${items.length ? " (" + items.map((i) => `${i.name}×${i.quantity}`).join(", ") + ")" : ""}`
  );
}

// JSON schema cho guided decoding của vLLM (guided_json) — ÉP model trả đúng
// cấu trúc có items[] { name, quantity, calories_per_unit } thay vì chỉ dặn
// trong prompt. Field nào không bắt buộc thì optional để case is_food=false
// vẫn hợp lệ.
const VISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    is_food: { type: "boolean" },
    reason: { type: "string" },
    food: { type: "string" },
    amount: { type: "string" },
    // Per-item enumeration. One entry per DISTINCT dish/component in the image
    // (main / protein / carb / vegetable / soup / sauce / drink / dessert), OR
    // per counted unit for identical pieces. Unlimited length.
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string" }, // main|protein|carb|vegetable|soup|sauce|drink|dessert|other
          quantity: { type: "number" },
          confidence: { type: "string" }, // high|medium|low
          // Evidence-first: what was actually observed (shape/texture/position/context) — NOT color alone.
          evidence: { type: "array", items: { type: "string" } },
          // When ≥2 plausible identities, list them with a rough probability each.
          alternative_candidates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                probability: { type: "number" }, // 0..1
              },
              required: ["name"],
            },
          },
          calories_per_unit: { type: "number" },
          calories_min_per_unit: { type: "number" },
          calories_max_per_unit: { type: "number" },
          protein_per_unit: { type: "number" },
          fat_per_unit: { type: "number" },
          carbs_per_unit: { type: "number" },
        },
        required: ["name", "quantity", "calories_per_unit"],
      },
    },
    // Mandatory meal checklist — model must mark present / not_visible for each.
    meal_completeness_check: {
      type: "object",
      properties: {
        protein: { type: "string" },
        carb: { type: "string" },
        vegetable: { type: "string" },
        soup: { type: "string" },
        sauce: { type: "string" },
        drink: { type: "string" },
        dessert: { type: "string" },
      },
    },
    confidence: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    alternative_candidates: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, probability: { type: "number" } },
        required: ["name"],
      },
    },
    calories: { type: "number" },
    calories_min: { type: "number" },
    calories_max: { type: "number" },
    protein: { type: "string" },
    fat: { type: "string" },
    carbs: { type: "string" },
    fiber: { type: "string" },
    sugar: { type: "string" },
    sodium: { type: "string" },
    uncertainty_note: { type: "string" },
  },
  required: ["is_food"],
};

export function visionProvider() {
  return VISION_PROVIDER === "gemini" && GEMINI_KEY ? "gemini" : "qwen";
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Xoá ký tự CJK (Hán/Nhật/Hàn) model đôi khi lẫn vào. */
const stripCJK = (t = "") =>
  String(t)
    .replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uFF00-\uFF9F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

/** Bóc JSON từ text model trả về.
 *  Thứ tự ưu tiên: JSON thuần → ```json block → {} đầu tiên → <data> tag (fallback Qwen hội thoại)
 */
const extractJson = (text = "") => {
  const s = String(text);
  const tryParse = (raw) => {
    if (!raw) return null;
    try { return JSON.parse(raw.trim().replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
  };
  // Vá JSON bị cắt cụt giữa items[] (chạm max_tokens): bỏ đuôi items dở dang,
  // giữ các field tổng phía trước — thẻ kcal vẫn hiển thị được.
  const repairItemsTail = (raw) => {
    const t = String(raw || "").trim();
    if (!t.startsWith("{")) return null;
    const cut = t.replace(/,\s*"items"\s*:\s*\[[\s\S]*$/, "}");
    return cut !== t ? tryParse(cut) : null;
  };
  // 1. Thử parse trực tiếp (model trả JSON thuần)
  const direct = tryParse(s);
  if (direct) return direct;
  // 2. ```json ... ``` block
  let m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) { const p = tryParse(m[1]) || repairItemsTail(m[1]); if (p) return p; }
  // 3. Khối {} lớn nhất (từ đầu đến cuối)
  m = s.match(/\{[\s\S]*\}/);
  if (m) { const p = tryParse(m[0]); if (p) return p; }
  // 3b. JSON mở nhưng không bao giờ đóng (bị cắt cụt) → vá đuôi items
  m = s.match(/\{[\s\S]*$/);
  if (m) { const p = repairItemsTail(m[0]); if (p) return p; }
  // 4. Fallback: Qwen trả hội thoại thay vì JSON → bóc <data> tag (giống chat.js)
  const dataM = s.match(/<data>([\s\S]*?)<\/data>/i);
  if (dataM) {
    const p = tryParse(dataM[1]);
    if (p && ("calories" in p || "description" in p)) {
      // Chuyển về format is_food=true để normalizeFood xử lý được
      return {
        is_food: true,
        food: p.description || "",
        amount: p.amount || "1 phần",
        calories: p.calories,
        protein: p.protein,
        fat: p.fat,
        carbs: p.carbs,
        fiber: p.fiber,
        sugar: p.sugar,
        sodium: p.sodium,
      };
    }
  }
  return null;
};

const asStr = (v) => (v == null ? "" : String(v));

/** Tính tổng dinh dưỡng từ items[] bằng CODE (không tin phép cộng của model —
 *  model hay tính sai số học, nhất là khi ảnh có nhiều món giống nhau).
 *  total = Σ quantity × <chất>_per_unit. Trả null nếu items không dùng được.
 *  Export cho api/chat.js dùng lại trên khối <data> của luồng chat Qwen. */
export function computeTotalsFromItems(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  let hasP = false, hasF = false, hasC = false, count = 0, valid = 0;
  for (const it of items) {
    const qty = Number(it?.quantity);
    const cal = Number(it?.calories_per_unit);
    // Bỏ QUA item số liệu hỏng thay vì huỷ TOÀN BỘ danh sách (RCA: 1 item xấu
    // trước đây khiến mọi món biến mất). Các item còn lại vẫn được cộng tổng.
    if (!Number.isFinite(qty) || qty <= 0 || qty > 500 || !Number.isFinite(cal) || cal < 0) continue;
    valid++;
    totals.calories += qty * cal;
    count += qty;
    const p = Number(it?.protein_per_unit);
    const f = Number(it?.fat_per_unit);
    const c = Number(it?.carbs_per_unit);
    if (Number.isFinite(p)) { totals.protein += qty * p; hasP = true; }
    if (Number.isFinite(f)) { totals.fat += qty * f; hasF = true; }
    if (Number.isFinite(c)) { totals.carbs += qty * c; hasC = true; }
  }
  if (valid === 0 || totals.calories <= 0) return null;
  return {
    calories: Math.round(totals.calories),
    protein: hasP ? Math.round(totals.protein * 10) / 10 : null,
    fat: hasF ? Math.round(totals.fat * 10) / 10 : null,
    carbs: hasC ? Math.round(totals.carbs * 10) / 10 : null,
    count,
  };
}

const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
/** Chuẩn hoá confidence về high|medium|low. */
const normConf = (c) => {
  const s = String(c || "").toLowerCase().trim();
  if (["high", "cao", "chắc chắn", "chac chan"].includes(s)) return "high";
  if (["low", "thấp", "thap", "không chắc", "khong chac"].includes(s)) return "low";
  return "medium";
};
const cleanEvidence = (arr) =>
  (Array.isArray(arr) ? arr : []).map((e) => stripCJK(asStr(e))).filter(Boolean).slice(0, 8);
const cleanCandidates = (arr) =>
  (Array.isArray(arr) ? arr : [])
    .map((a) => ({ name: stripCJK(asStr(a?.name)), probability: _num(a?.probability) }))
    .filter((a) => a.name)
    .slice(0, 5);

/** Chuẩn hoá 1 item — GIỮ MỌI item (không loại vì số liệu lẻ), giữ đủ macro,
 *  bổ sung confidence/evidence/candidate + khoảng calo cho từng món. */
function sanitizeItem(it = {}) {
  const quantity = _num(it.quantity) ?? 1;
  const cpu = _num(it.calories_per_unit);
  const confidence = normConf(it.confidence);
  const out = {
    name: stripCJK(asStr(it.name)) || "Món",
    category: asStr(it.category) || "other",
    quantity,
    confidence,
    evidence: cleanEvidence(it.evidence),
    alternative_candidates: cleanCandidates(it.alternative_candidates),
    calories_per_unit: cpu != null ? Math.round(cpu) : null,
    protein_per_unit: _num(it.protein_per_unit),
    fat_per_unit: _num(it.fat_per_unit),
    carbs_per_unit: _num(it.carbs_per_unit),
  };
  // Tổng calo cho món này + KHOẢNG (min/max). Ưu tiên min/max/1-đơn-vị model cho;
  // nếu không có thì suy từ confidence.
  const total = cpu != null ? Math.round(cpu * quantity) : null;
  out.calories = total;
  const minPU = _num(it.calories_min_per_unit);
  const maxPU = _num(it.calories_max_per_unit);
  if (minPU != null && maxPU != null && maxPU >= minPU) {
    out.calories_min = Math.round(minPU * quantity);
    out.calories_max = Math.round(maxPU * quantity);
  } else if (total != null) {
    const r = caloriesRange(total, confidence);
    out.calories_min = r.min;
    out.calories_max = r.max;
  } else {
    out.calories_min = null;
    out.calories_max = null;
  }
  return out;
}

/** Chuẩn hoá object trả về từ model thành format thống nhất.
 *  Backward-compatible: mọi field cũ (food/amount/calories/protein...) giữ nguyên;
 *  các field MỚI (items đầy đủ, confidence, evidence, alternative_candidates,
 *  meal_completeness_check, calories_min/max, uncertainty_note) là bổ sung. */
function normalizeFood(obj = {}) {
  if (obj.is_food === false) {
    return { is_food: false, reason: stripCJK(asStr(obj.reason)) };
  }
  const confidence = normConf(obj.confidence);
  const out = {
    is_food: true,
    food: stripCJK(asStr(obj.food || obj.description)) || "Món ăn",
    amount: asStr(obj.amount) || "1 phần",
    calories: obj.calories != null ? Math.round(Number(obj.calories)) || 0 : 0,
    protein: asStr(obj.protein),
    fat: asStr(obj.fat),
    carbs: asStr(obj.carbs),
    fiber: asStr(obj.fiber),
    sugar: asStr(obj.sugar),
    sodium: asStr(obj.sodium),
    // ── field MỚI (backward-compatible) ─────────────────────────────────────
    confidence,
    evidence: cleanEvidence(obj.evidence),
    alternative_candidates: cleanCandidates(obj.alternative_candidates),
    uncertainty_note: stripCJK(asStr(obj.uncertainty_note)),
  };

  // meal_completeness_check: chuẩn hoá về present|not_visible cho từng nhóm.
  if (obj.meal_completeness_check && typeof obj.meal_completeness_check === "object") {
    const mc = {};
    for (const k of ["protein", "carb", "vegetable", "soup", "sauce", "drink", "dessert"]) {
      const v = String(obj.meal_completeness_check[k] || "").toLowerCase();
      mc[k] = v.includes("present") || v.includes("có") ? "present" : "not_visible";
    }
    out.meal_completeness_check = mc;
  }

  // items[]: GIỮ TẤT CẢ (RCA fix — không còn all-or-nothing). Tổng vẫn do CODE
  // tính từ các item hợp lệ (model hay cộng sai).
  if (Array.isArray(obj.items) && obj.items.length) {
    out.items = obj.items.map(sanitizeItem);
    const totals = computeTotalsFromItems(obj.items);
    if (totals) {
      out.calories = totals.calories;
      if (totals.protein != null) out.protein = `${totals.protein}g`;
      if (totals.fat != null) out.fat = `${totals.fat}g`;
      if (totals.carbs != null) out.carbs = `${totals.carbs}g`;
      // amount phản ánh SỐ LƯỢNG khi chỉ có 1 loại món đếm nhiều đơn vị.
      if (out.items.length === 1 && totals.count > 1) {
        const amtNum = parseFloat(String(out.amount || "").trim());
        if (!Number.isFinite(amtNum) || Math.round(amtNum) !== Math.round(totals.count)) {
          out.amount = `${totals.count} cái`;
        }
      }
    }
  }

  // Khoảng calo TỔNG: nếu có items thì cộng khoảng từng món; nếu không thì suy
  // từ confidence tổng. Ưu tiên min/max model cho ở cấp cao nếu hợp lệ.
  const topMin = _num(obj.calories_min);
  const topMax = _num(obj.calories_max);
  if (Array.isArray(out.items) && out.items.length) {
    let sMin = 0, sMax = 0, ok = true;
    for (const it of out.items) {
      if (it.calories_min == null || it.calories_max == null) { ok = false; break; }
      sMin += it.calories_min; sMax += it.calories_max;
    }
    if (ok) { out.calories_min = Math.round(sMin); out.calories_max = Math.round(sMax); }
  }
  if (out.calories_min == null || out.calories_max == null) {
    if (topMin != null && topMax != null && topMax >= topMin) {
      out.calories_min = Math.round(topMin); out.calories_max = Math.round(topMax);
    } else {
      const r = caloriesRange(out.calories, confidence);
      out.calories_min = r.min; out.calories_max = r.max;
    }
  }
  return out;
}

// ── Prompt chung cho cả Gemini và Qwen ───────────────────────────────────────
const VISION_PROMPT_VI = `Bạn là chuyên gia dinh dưỡng quốc tế, ĐẶC BIỆT SÂU về ẩm thực Việt Nam.
Nhiệm vụ: nhìn ảnh (kèm ghi chú nếu có) → nhận diện CHÍNH XÁC món ăn/đồ uống → ước tính dinh dưỡng.

ƯU TIÊN HÀNG ĐẦU - ẨM THỰC VIỆT NAM:
- Khi một món có thể là món Việt HOẶC món nước ngoài, HÃY ƯU TIÊN tên món Việt Nam nếu hình ảnh có bất kỳ dấu hiệu Việt nào (bát/tô/đĩa đơn giản, rau thơm, nước mắm, nước dùng trong, cơm/bún/phở, cách trình bày gia đình).
- Ví dụ: canh rau củ nhồi thịt → ưu tiên "Khổ qua nhồi thịt" / "Mướp đắng nhồi thịt" nếu thấy vỏ xanh gồ ghề; nếu vỏ nhạt trơn thì mới xem xét "Bí đao nhồi thịt".
- Nếu thực sự là món quốc tế (pizza, sushi, burger, ramen...) thì vẫn nhận diện đúng và trả về tên quốc tế.

PHẠM VI NHẬN DIỆN — KHÔNG GIỚI HẠN QUỐC GIA:
Nhận diện BẤT KỲ món ăn nào: Việt Nam, Hàn Quốc, Nhật Bản, Trung Quốc, Ý, Mỹ, Thái Lan...
Gọi tên món bằng tiếng Việt (hoặc tên gốc phổ biến nếu không có bản dịch chuẩn):
- Tteokbokki (bánh gạo cay Hàn) | Sushi | Ramen | Pasta | Pizza | Burger | Pad Thai...
- KHÔNG bao giờ từ chối phân tích với lý do "không phải món Việt".

NHẬN DIỆN CHÍNH XÁC (quan sát kỹ trước khi kết luận):
MÓN VIỆT — phân biệt chi tiết:
• Sợi dẹt trắng + nước trong = Phở ≠ Bún (sợi tròn) ≠ Bún bò Huế (sợi tròn + nước đỏ cay + sả)
• Nước đục chua + cà chua + cua/ốc = Bún riêu
• Cơm hạt nhỏ trên ĐĨA + sườn nướng ± trứng ốp la = Cơm tấm
• BÚN CHẢ (Hà Nội) — RẤT HAY nhầm thành "Bò lúc lắc"/"Cơm tấm", món PHỔ BIẾN nên ưu tiên:
  - Có BÁT NƯỚC CHẤM cam/nâu LOÃNG, bên trong NGÂM CHẢ MIẾNG (thịt băm nướng dẹt tròn) và/hoặc THỊT BA CHỈ NƯỚNG cháy cạnh, thường có đu đủ/cà rốt thái lát nổi trong nước.
  - LUÔN kèm ĐĨA BÚN (sợi trắng) RIÊNG + RỔ RAU SỐNG. Thấy thịt nướng ngâm nước chấm + bún riêng + rau sống → là BÚN CHẢ, KHÔNG phải bò lúc lắc/cơm tấm.
• CƠM TẤM ≠ BÒ LÚC LẮC (RẤT HAY NHẦM — quan sát kỹ):
  - CƠM TẤM: đĩa CÓ CƠM + MIẾNG THỊT NƯỚNG DẸT (sườn heo, KHÔNG cắt khối) + thường có TRỨNG ỐP LA + CHẢ TRỨNG (miếng vuông vàng/cam) + bì + dưa leo, cà chua, đồ chua. Thấy đủ cơm + trứng ốp la + chả/bì → là Cơm tấm, KHÔNG phải bò lúc lắc.
  - BÒ LÚC LẮC (chỉ gọi khi ĐỦ 3): (1) thịt BÒ cắt KHỐI VUÔNG nâu đều (KHÔNG phải miếng nướng cháy cạnh/chả/ba chỉ), (2) XÀO KHÔ trên đĩa (KHÔNG có bát nước chấm loãng ngâm thịt), (3) rõ hành tây + ớt chuông. Thiếu 1 dấu hiệu — nhất là khi có BÚN/bát nước chấm/rau sống/thịt nướng → KHÔNG gọi là bò lúc lắc.
• KHỔ QUA / MƯỚP ĐẮNG NHỒI THỊT (quan trọng):
  - Quả xanh đậm, DA GỒ GHỀ/CÓ GAI MỀM (không phải lá), hình thùy/elip dài 10-20cm.
  - Thường bị CẮT NGANG hoặc NHỒI thịt xay vào ruột, nấu trong nước dùng/canh trong.
  - KHÔNG phải Chèo tôm chua (chèo là loại sốt/súp màu đỏ/cam, có tôm, không có quả xanh nhồi thịt).
  - KHÔNG phải Bí đao (vỏ nhạt, trơn láng, hình trụ dài, không gồ ghề).
  - Tên chuẩn: "Khổ qua nhồi thịt" hoặc "Mướp đắng nhồi thịt" (hai tên cùng một món).
• Vỏ XANH NHẠT + TRƠN LÁNG + thịt trắng dày = Bí đao nhồi thịt
• Canh chua: nướ trong/ngả vàng, có cà chua, đậu bắp, thơm, rau thơm, cá/tôm — khác với khổ qua nhồi thịt.

MÓN QUỐC TẾ — một số ví dụ nhận diện:
• Bánh gạo trụ ngắn + sốt đỏ cay = Tteokbokki (Hàn Quốc)
• Mì vàng + nước đậm + thịt heo/gà = Ramen (Nhật)
• Cơm cuộn rong biển = Gimbap/Sushi cuộn
• Mì dẹt + sốt kem/cà chua + pho mát = Pasta
• Bánh tròn dẹt + nhân thịt + rau = Burger/Sandwich

KHẨU PHẦN & THÀNH PHẦN — PHÂN TÍCH THEO ẢNH (BẮT BUỘC):
- QUAN SÁT kỹ SỐ LƯỢNG và KÍCH THƯỚC THỰC TẾ trong ảnh: đếm số miếng/cái/lát/viên, ước lượng cỡ bát/đĩa/ly và độ đầy.
- "amount" phải mô tả ĐÚNG khẩu phần nhìn thấy (vd "1 miếng nhỏ", "2 lát", "nửa bát", "1 tô lớn ~500ml") — KHÔNG mặc định "1 phần" khi ảnh cho thấy ít/nhiều hơn một suất thông thường.
- calories và macro phải TÍNH THEO ĐÚNG KHẨU PHẦN ĐÓ, KHÔNG dùng số liệu suất chuẩn khi ảnh chỉ có một phần nhỏ.
  Ví dụ: 1 miếng sushi lẻ ~40-60 kcal — KHÔNG trả 350-450 kcal của cả phần sushi.
- Nhận diện các THÀNH PHẦN CHÍNH nhìn thấy (vd cơm, cá hồi, bơ, rong biển) và dùng chúng để ước tính chính xác hơn.
- Chỉ khi ảnh là một suất người lớn thông thường mới dùng amount dạng "1 phần"/"1 tô"/"1 đĩa".

QUY TRÌNH SUY LUẬN — LIỆT KÊ BẰNG CHỨNG TRƯỚC KHI KẾT LUẬN (BẮT BUỘC):
- TUYỆT ĐỐI KHÔNG kết luận chỉ dựa vào MÀU SẮC. Với mỗi món, TRƯỚC TIÊN ghi BẰNG CHỨNG quan sát vào "evidence": HÌNH DẠNG, KẾT CẤU/BỀ MẶT, VỊ TRÍ (trong bát / trên đĩa / ngập nước dùng...), NGỮ CẢNH món đi kèm.
- Khi có ≥2 khả năng hợp lý, tự nêu ĐIỂM KHÁC BIỆT THEN CHỐT rồi mới chọn (CÁCH LÀM CHUNG, tự áp dụng cho MỌI cặp dễ nhầm):
  · Ví dụ xương hầm vs thịt nướng: xương thuôn dài, bề mặt nhẵn/bóng, NẰM NGẬP trong nước dùng; thịt nướng có vệt cháy khô theo thớ, nằm trên bề mặt KHÔ RÁO.
  · Ví dụ trái cây: phân biệt theo KÍCH THƯỚC, LOẠI GAI/VỎ, RUỘT khi bổ — KHÔNG theo màu vỏ (chôm chôm: quả nhỏ ~3-5cm, gai MỀM như sợi tóc, ruột trắng trong; sầu riêng: quả RẤT TO, gai CỨNG nhọn, ruột múi vàng; vải/nhãn: vỏ sần/nhẵn, KHÔNG gai).
  · Ví dụ súp: nước TRONG/SÁNH + KHÔNG chua + thịt XÉ SỢI + nấm = "Súp" (súp gà/cua), KHÔNG phải "canh chua" (canh chua PHẢI có vị chua + cà chua/me/dứa). VIÊN TRÒN VÀNG/TRẮNG NGÀ nhỏ trong súp thường là TRỨNG CÚT hoặc NGÔ — KHÔNG phải "hạt đậu".
- Gán "confidence" (high|medium|low) cho từng món theo độ mạnh bằng chứng.
- Bằng chứng YẾU hoặc MÂU THUẪN → ĐỪNG chốt 1 đáp án chắc nịch: đặt confidence="low" và điền "alternative_candidates" gồm các khả năng kèm xác suất (0..1).

PHÂN BIỆT MÓN NƯỚC VIỆT (theo NƯỚC DÙNG + LOẠI SỢI + TOPPING — KHÔNG theo màu tổng thể):
- Phở: sợi dẹt trắng, nước TRONG, bò/gà, hành + rau thơm.
- Bún riêu: sợi bún TRÒN, nước ĐỤC chua + CÀ CHUA, gạch cua nổi, đậu phụ/ốc — cục sậm màu trong tô THƯỜNG là gạch cua/tiết/xương, KHÔNG phải "thịt nướng".
- Bún bò Huế: sợi tròn TO, nước đỏ CAY + sả, giò heo/chả.
- Hủ tiếu: sợi nhỏ dai, nước trong ngọt, thịt bằm/tôm. Miến: sợi trong nhỏ. Bánh canh: sợi bột trắng đục to, nước sánh.

LIỆT KÊ ĐỦ MÓN — CHECKLIST BẮT BUỘC (chống BỎ SÓT món):
- Duyệt LẦN LƯỢT: món chính / đạm / tinh bột / rau / canh-súp / nước chấm-sốt / đồ uống / tráng miệng. Với MỖI nhóm điền "meal_completeness_check": "present" nếu THẤY, "not_visible" nếu không — KHÔNG im lặng bỏ nhóm nào.
- Mỗi món/thành phần KHÁC LOẠI nhìn thấy = MỘT phần tử "items" riêng (đặt "category" đúng nhóm). Món GIỐNG HỆT lặp lại → gộp 1 item với "quantity" = số đếm được.
- SELF-CHECK trước khi chốt: "Còn món nào NHÌN THẤY mà mình CHƯA liệt kê không?" — nếu còn thì THÊM vào items.
- KHÔNG tự cộng tổng — hệ thống nhân quantity × số/1-đơn-vị. Chỉ cần đếm đúng + số 1 đơn vị đúng.

KHOẢNG CALO — KHÔNG trả số tuyệt đối (Yêu cầu #3):
- Mỗi món cho "calories_per_unit" + KHOẢNG 1 đơn vị "calories_min_per_unit"/"calories_max_per_unit". Bề rộng khoảng TỈ LỆ NGHỊCH confidence: high → hẹp (~±10%), medium → vừa (~±16%), low → rộng (~±25%).
- Điền "uncertainty_note" (1 câu) lý do có khoảng: khẩu phần chưa rõ, dầu mỡ/nước sốt ẩn...

QUY TẮC ĐẦU RA:
- Calo và macro phải NHẤT QUÁN (số trong text = số trong JSON)
- Nếu ảnh KHÔNG phải món ăn/đồ uống (vật dụng, phong cảnh, con người...) → trả: {"is_food": false, "reason": "<mô tả ngắn>"}
- Đồ uống CÓ THỂ có calo (trà sữa, nước ép, sinh tố...) → phân tích bình thường

CHỈ TRẢ VỀ DUY NHẤT 1 JSON hợp lệ (không markdown, không giải thích):
{"is_food": true, "food": "<tên món chính hoặc mô tả mâm>", "confidence": "high|medium|low", "evidence": ["<bằng chứng 1>", "<bằng chứng 2>"], "alternative_candidates": [{"name":"<khả năng khác>","probability":<0..1>}], "amount": "<khẩu phần nhìn thấy>",
 "items": [{"name": "<tên phần tử>", "category": "<main|protein|carb|vegetable|soup|sauce|drink|dessert>", "quantity": <số đếm được>, "confidence": "high|medium|low", "evidence": ["<bằng chứng>"], "alternative_candidates": [{"name":"<khả năng khác>","probability":<0..1>}], "calories_per_unit": <kcal/1 đơn vị>, "calories_min_per_unit": <kcal>, "calories_max_per_unit": <kcal>, "protein_per_unit": <g>, "fat_per_unit": <g>, "carbs_per_unit": <g>}],
 "meal_completeness_check": {"protein":"present|not_visible","carb":"...","vegetable":"...","soup":"...","sauce":"...","drink":"...","dessert":"..."},
 "calories": <tổng kcal>, "calories_min": <kcal>, "calories_max": <kcal>, "protein": "<số>g", "fat": "<số>g", "carbs": "<số>g", "fiber": "<số>g", "sugar": "<số>g", "sodium": "<số>mg", "uncertainty_note": "<1 câu>"}`;

const VISION_PROMPT_EN = `You are an international nutrition expert with DEEP knowledge of Vietnamese cuisine.
Task: look at the image (plus any note) → identify the food/drink PRECISELY → estimate nutrition.

VIETNAMESE-CUISINE PRIORITY:
- When a dish could be Vietnamese OR foreign, prefer the Vietnamese name if the image shows any Vietnamese cues (simple bowl/plate, herbs, fish sauce, clear broth, rice/bún/phở, home-style plating).
- If it is clearly an international dish (pizza, sushi, burger, ramen...) return the correct international name.

RECOGNITION SCOPE — NO COUNTRY LIMIT:
Recognize ANY cuisine: Vietnamese, Korean, Japanese, Chinese, Italian, American, Thai...
Name the dish in English or its common international name — but keep authentic Vietnamese names (Phở, Bánh mì, Bún bò Huế, Gỏi cuốn, Cơm tấm, Bún riêu, Bún chả, Khổ qua nhồi thịt...) as proper nouns.
NEVER refuse because it "is not Vietnamese".

ACCURATE RECOGNITION (observe carefully before deciding):
VIETNAMESE DISHES — fine distinctions:
• White flat noodle + clear broth = Phở ≠ Bún (round noodle) ≠ Bún bò Huế (round noodle + spicy red broth + lemongrass)
• Cloudy sour broth + tomato + crab/snail = Bún riêu
• Small broken-rice grains on a PLATE + grilled chop ± sunny-side egg = Cơm tấm
• BÚN CHẢ (Hanoi) — VERY often mistaken for "Bò lúc lắc"/"Cơm tấm"; a COMMON dish, consider first:
  - A BOWL of thin orange/brown DIPPING SAUCE with GRILLED PORK PATTIES (flat round discs) and/or CHARRED PORK BELLY soaking in it, often sliced papaya/carrot in the sauce.
  - ALWAYS with a SEPARATE plate of BÚN (white vermicelli) + a basket of FRESH HERBS. Grilled meat soaking in dipping sauce + separate vermicelli + herbs → Bún chả, NOT bò lúc lắc/cơm tấm.
• CƠM TẤM ≠ BÒ LÚC LẮC (VERY commonly confused):
  - CƠM TẤM: plate with RICE + FLAT GRILLED PORK CHOP (not cubed) + usually SUNNY-SIDE EGG + EGG MEATLOAF (orange square) + pork skin + cucumber, tomato, pickled veg. Rice + fried egg + meatloaf → Cơm tấm, NOT bò lúc lắc.
  - BÒ LÚC LẮC (only when ALL 3 hold): (1) BEEF in EVEN BROWN CUBES (not a charred grilled slice/patties/belly), (2) STIR-FRIED DRY on a plate (NO bowl of thin dipping sauce soaking the meat), (3) visible ONION + BELL PEPPER. Missing any — especially with BÚN/dipping bowl/fresh herbs/grilled meat → NOT bò lúc lắc.
• Bitter melon stuffed with pork (Khổ qua / Mướp đắng nhồi thịt):
  - Dark green fruit, BUMPY skin, oblong 10-20cm, usually cross-cut with minced pork.
  - NOT winter melon (pale, smooth, cylindrical).
• PALE GREEN + SMOOTH skin + thick white flesh = winter melon stuffed with pork (Bí đao nhồi thịt).
• Canh chua: light clear/yellowish broth with tomato, okra, pineapple, herbs, fish/shrimp — different from stuffed bitter melon.

INTERNATIONAL DISHES — examples:
• Short cylindrical rice cakes + spicy red sauce = Tteokbokki (Korea)
• Yellow noodles + rich broth + pork/chicken = Ramen (Japan)
• Rice wrapped in seaweed = Gimbap / Sushi roll
• Flat noodles + cream/tomato sauce + cheese = Pasta
• Round flat bun + meat patty + veg = Burger / Sandwich

PORTION & INGREDIENTS — ANALYZE FROM IMAGE (MANDATORY):
- OBSERVE actual QUANTITY and SIZE: count pieces/slices/rolls, estimate bowl/plate/glass size and fullness.
- "amount" must describe the VISIBLE portion (e.g. "1 small piece", "2 slices", "half a bowl", "1 large bowl ~500ml"). Do NOT default to "1 serving" when the image shows less/more.
- calories and macros must match THAT portion — do NOT reuse full-serving numbers for a single piece.
  Example: one sushi piece ~40-60 kcal — NOT 350-450 kcal for a whole set.
- Identify the MAIN VISIBLE INGREDIENTS (rice, salmon, avocado, seaweed...) and use them for better estimation.
- Only use "1 serving" / "1 bowl" / "1 plate" when the image really shows a normal adult portion.

REASONING PROTOCOL — LIST EVIDENCE BEFORE CONCLUDING (MANDATORY):
- NEVER decide from COLOR alone. For each dish, FIRST record observed EVIDENCE into "evidence": SHAPE, TEXTURE/SURFACE, POSITION (in bowl / on plate / submerged in broth...), and the CONTEXT of accompanying dishes.
- When ≥2 identities are plausible, state the KEY DIFFERENCE before choosing (a GENERAL method, apply it to ANY confusable pair):
  · e.g. stewed bone vs grilled meat: a bone is elongated, smooth/glossy, SUBMERGED in broth; grilled meat has dry char along the grain, sitting on a DRY surface.
  · e.g. fruit: distinguish by SIZE, SPINE/SKIN type, FLESH when opened — NOT by skin color (rambutan: small ~3-5cm, SOFT hair-like spines, translucent white flesh; durian: VERY large, HARD sharp spikes, yellow segmented flesh; lychee/longan: bumpy/smooth skin, NO spines).
  · e.g. soup: CLEAR/thickened broth + NOT sour + SHREDDED protein + mushroom = "Súp" (chicken/crab soup), NOT "canh chua" (sour soup MUST be sour + tomato/tamarind/pineapple). Small round yellow/off-white balls in soup are usually QUAIL EGGS or CORN — NOT "beans".
- Assign a per-item "confidence" (high|medium|low) based on evidence strength.
- If evidence is WEAK or CONFLICTING → do NOT commit to one answer: set confidence="low" and fill "alternative_candidates" with options and probabilities (0..1).

VIETNAMESE NOODLE SOUPS (distinguish by BROTH + NOODLE + TOPPING — NOT overall color):
- Phở: flat white noodle, CLEAR broth, beef/chicken, scallion + herbs.
- Bún riêu: ROUND vermicelli, CLOUDY sour broth + TOMATO, floating crab paste, tofu/snail — a dark lump in the bowl is USUALLY crab paste / blood / bone, NOT "grilled meat".
- Bún bò Huế: thick round noodle, spicy RED broth + lemongrass, pork knuckle/chả.
- Hủ tiếu: thin chewy noodle, clear sweet broth. Miến: thin glass noodle. Bánh canh: thick opaque tapioca noodle, thick broth.

ENUMERATE EVERY DISH — MANDATORY CHECKLIST (prevent MISSING dishes):
- Go through each group: main / protein / carb / vegetable / soup / sauce / drink / dessert. For EACH, fill "meal_completeness_check" with "present" if SEEN, "not_visible" otherwise — never silently skip a group.
- Each DISTINCT dish/component you see = ONE separate "items" entry (set "category"). IDENTICAL repeated pieces → one item with "quantity" = the count.
- SELF-CHECK before finalizing: "Is there any dish VISIBLE in the image I have NOT listed?" — if so, ADD it to items.
- Do NOT pre-sum — the system multiplies quantity × per-unit. Just count right and give correct per-unit numbers.

CALORIE RANGE — do NOT return a single absolute number (Requirement #3):
- Per item give "calories_per_unit" + a per-unit range "calories_min_per_unit"/"calories_max_per_unit". Range width is INVERSELY tied to confidence: high → narrow (~±10%), medium → moderate (~±16%), low → wide (~±25%).
- Fill "uncertainty_note" (one sentence): why the range exists (unknown portion, hidden oil/sauce...).

OUTPUT RULES:
- Calories and macros must be CONSISTENT (numbers in text = numbers in JSON)
- If the image is NOT food/drink (object, scenery, person...) → return: {"is_food": false, "reason": "<short description>"}
- Drinks CAN have calories (bubble tea, juice, smoothie...) → analyze normally.

RETURN EXACTLY ONE VALID JSON (no markdown, no explanation):
{"is_food": true, "food": "<main dish name or meal description>", "confidence": "high|medium|low", "evidence": ["<evidence 1>", "<evidence 2>"], "alternative_candidates": [{"name":"<other option>","probability":<0..1>}], "amount": "<visible portion>",
 "items": [{"name": "<item name>", "category": "<main|protein|carb|vegetable|soup|sauce|drink|dessert>", "quantity": <count>, "confidence": "high|medium|low", "evidence": ["<evidence>"], "alternative_candidates": [{"name":"<other option>","probability":<0..1>}], "calories_per_unit": <kcal per 1 unit>, "calories_min_per_unit": <kcal>, "calories_max_per_unit": <kcal>, "protein_per_unit": <g>, "fat_per_unit": <g>, "carbs_per_unit": <g>}],
 "meal_completeness_check": {"protein":"present|not_visible","carb":"...","vegetable":"...","soup":"...","sauce":"...","drink":"...","dessert":"..."},
 "calories": <total kcal>, "calories_min": <kcal>, "calories_max": <kcal>, "protein": "<n>g", "fat": "<n>g", "carbs": "<n>g", "fiber": "<n>g", "sugar": "<n>g", "sodium": "<n>mg", "uncertainty_note": "<one sentence>"}`;

// Quy tắc đặt tên món — sửa lỗi model cứ ghi "bánh mì baguette" (Lỗi #6).
const NAMING_RULES_VI = `
QUY TẮC ĐẶT TÊN MÓN (BẮT BUỘC):
- Với món ĐÃ BẢN ĐỊA HOÁ ở Việt Nam, ưu tiên tên Việt + nguyên liệu Việt.
  Ví dụ: ổ bánh mì kẹp kiểu Việt → "Bánh mì thịt nướng" hoặc "Bánh mì".
  TUYỆT ĐỐI KHÔNG gọi là "baguette" hay "bánh mì baguette".
- Nếu không chắc biến thể cụ thể → dùng TÊN CHUNG NGẮN GỌN ("Bánh mì", "Cơm", "Bún")
  thay vì thêm từ nước ngoài gây sai lệch.
- Chỉ giữ tên quốc tế khi món RÕ RÀNG là món nước ngoài (pizza, sushi, ramen, tteokbokki...).`;

const NAMING_RULES_EN = `
NAMING RULES (MANDATORY):
- For dishes localized in Vietnam, prefer the Vietnamese name.
  Example: a Vietnamese-style filled bread → "Bánh mì thịt nướng" or "Bánh mì".
  NEVER call it "baguette" or "bánh mì baguette".
- If unsure of a specific variant → use the SHORT GENERIC name ("Bánh mì", "Rice", "Noodles")
  instead of adding a misleading foreign word.
- Keep the international name only when the dish is CLEARLY foreign (pizza, sushi, ramen, tteokbokki...).`;

// Quy tắc ngôn ngữ + đặt tên theo lang (Lỗi #3).
function visionLangRule(lang) {
  if (String(lang).toLowerCase() === "en") {
    return `
LANGUAGE — ABSOLUTE RULE: The "food" field, the "reason" field, and every string in the JSON must be in natural English, EXCEPT authentic Vietnamese dish names (Phở, Bánh mì, Bún bò Huế, Gỏi cuốn, Cơm tấm, Bún riêu, Bún chả, Khổ qua nhồi thịt...) which stay in Vietnamese as proper nouns. Do NOT mix Vietnamese sentences into English fields.`;
  }
  return `
NGÔN NGỮ — BẮT BUỘC: Mọi chuỗi trong JSON đều bằng TIẾNG VIỆT có dấu. TUYỆT ĐỐI KHÔNG dùng chữ Hán/Trung/Nhật, KHÔNG chèn câu tiếng Anh.`;
}

/** Ghép prompt vision theo ngôn ngữ + quy tắc đặt tên. */
function buildVisionPrompt(lang) {
  const isEn = String(lang).toLowerCase() === "en";
  const base = isEn ? VISION_PROMPT_EN : VISION_PROMPT_VI;
  const naming = isEn ? NAMING_RULES_EN : NAMING_RULES_VI;
  return `${base}\n${naming}\n${visionLangRule(lang)}`;
}

// Tiêu đề khối ngữ cảnh hội thoại — dùng khi người dùng gửi LẠI ảnh để phân tích lại
// sau khi đã chỉnh sửa cho AI (Lỗi #1: "AI không thấy dữ liệu cũ").
function reanalyzeHeader(lang) {
  return String(lang).toLowerCase() === "en"
    ? `CONVERSATION CONTEXT — the user may be re-sending this image to CORRECT a previous analysis.
Read the messages below, RE-EXAMINE the image carefully, and PRIORITIZE the user's latest
correction over any earlier identification. If the user says the dish is X (e.g. "it's Vietnamese
bánh mì, not baguette"), name it the way the user asked.`
    : `NGỮ CẢNH HỘI THOẠI — người dùng có thể đang gửi LẠI ảnh để CHỈNH LẠI kết quả phân tích trước đó.
Hãy đọc các tin nhắn bên dưới, NHÌN KỸ LẠI ảnh, và ƯU TIÊN chỉnh sửa MỚI NHẤT của người dùng
hơn là nhận diện cũ. Nếu người dùng nói món là X (vd: "đây là bánh mì Việt Nam, không phải baguette"),
hãy đặt tên đúng theo yêu cầu của người dùng.`;
}

// Ghép khối ngữ cảnh (contextNote) + ghi chú hiện tại (note) thành phần bổ sung cho prompt.
function buildContextSection(lang, note, contextNote) {
  const isEn = String(lang).toLowerCase() === "en";
  let out = "";
  if (contextNote && contextNote.trim()) {
    out += `\n\n${reanalyzeHeader(lang)}\n${contextNote.trim()}`;
  }
  if (note && note.trim()) {
    out += isEn
      ? `\n\nUser's note (HIGH PRIORITY — if it conflicts with what you see, follow the user): ${note.trim()}
NOTE-MISMATCH RULE: if the note clearly does NOT match the dish in the image (e.g. a stale name from a previous analysis), ANALYZE THE IMAGE and ignore the note. NEVER return {"is_food": false} just because the image differs from the note.`
      : `\n\nGhi chú từ người dùng (ƯU TIÊN CAO — nếu mâu thuẫn với hình, hãy theo người dùng): ${note.trim()}
QUY TẮC KHI GHI CHÚ LỆCH ẢNH: nếu ghi chú RÕ RÀNG KHÔNG khớp với món trong ảnh (vd tên món cũ còn sót lại từ lần phân tích trước), hãy PHÂN TÍCH THEO ẢNH và bỏ qua ghi chú. TUYỆT ĐỐI KHÔNG trả {"is_food": false} chỉ vì ảnh khác ghi chú.`;
  }
  return out;
}

// ── Gemini backend ────────────────────────────────────────────────────────────

async function analyzeWithGemini({ base64, mimeType, note, lang = "vi", contextNote = "" }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const promptText = buildVisionPrompt(lang) + buildContextSection(lang, note, contextNote);
  const body = {
    contents: [
      {
        parts: [
          { text: promptText },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Gemini HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  debugRaw("gemini", text);
  const obj = extractJson(text);
  if (!obj) throw new Error("Gemini: không đọc được JSON từ response");
  return normalizeFood(obj);
}

// ── Qwen VL backend ──────────────────────────────────────────────────────────
// Sử dụng mm_processor_kwargs để cải thiện nhận diện ảnh phức tạp
// (độ phân giải cao hơn giúp phân biệt chi tiết như gân/vỏ rau củ)

async function analyzeWithQwen({ base64, mimeType, note, lang = "vi", contextNote = "" }) {
  const userContent = [];
  // Ngữ cảnh hội thoại + ghi chú (Lỗi #1) — đặt TRƯỚC ảnh để model đọc trước khi nhìn.
  const ctxSection = buildContextSection(lang, note, contextNote);
  if (ctxSection.trim()) userContent.push({ type: "text", text: ctxSection.trim() });
  userContent.push({
    type: "image_url",
    image_url: { url: `data:${mimeType};base64,${base64}` },
  });
  // Nhắc lại JSON ở user turn — Qwen VL tuân thủ tốt hơn khi instruction xuất hiện gần ảnh
  userContent.push({
    type: "text",
    text: "Chỉ trả về 1 JSON duy nhất, không giải thích, không markdown.",
  });

  // Tham số decoding ĐỒNG NHẤT với luồng Chat: temperature 0 + top_p 1 + seed
  // cố định → cùng 1 ảnh luôn ra cùng 1 kết quả giữa các lần bấm.
  const baseParams = {
    model: LLM_VISION_MODEL,
    max_tokens: 3000, // JSON giờ có evidence/candidate/range cho từng món — cần rộng để KHÔNG cắt cụt (mất món)

    temperature: 0,
    top_p: 1,
    seed: 42,
    messages: [
      { role: "system", content: buildVisionPrompt(lang) },
      { role: "user", content: userContent },
    ],
    // ── mm_processor_kwargs: điều chỉnh độ phân giải xử lý ảnh ──────────────
    // min_pixels: 200704 (448×448) — đủ để nhìn rõ chi tiết (gân vỏ rau, màu nước dùng, loại sợi)
    // max_pixels: 3211264 (~3.2MP) — đếm tốt vật thể nhỏ (nhiều miếng sushi/bánh)
    // Không thiết lập → Qwen dùng mặc định thấp hơn → mất chi tiết trên ảnh phức tạp
    extra_body: {
      chat_template_kwargs: { enable_thinking: false },
      mm_processor_kwargs: {
        min_pixels: QWEN_MIN_PIXELS,
        max_pixels: QWEN_MAX_PIXELS,
      },
    },
  };

  // Ưu tiên guided_json (vLLM ép output đúng schema có items[]); nếu bản vLLM
  // của server không hỗ trợ tham số này thì tự retry KHÔNG guided (prompt vẫn
  // yêu cầu JSON nên extractJson xử lý được).
  let completion;
  try {
    completion = await llm.chat.completions.create({
      ...baseParams,
      extra_body: { ...baseParams.extra_body, guided_json: VISION_JSON_SCHEMA },
    });
  } catch (e) {
    console.warn("[vision] guided_json không chạy được, retry thường:", e.message);
    completion = await llm.chat.completions.create(baseParams);
  }

  const raw = completion.choices?.[0]?.message?.content || "";
  // Bóc <think>...</think> trước khi parse JSON
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  debugRaw("qwen", text);
  const obj = extractJson(text);
  if (!obj) {
    // Log đủ context để debug nhưng không throw ngay — trả 502 ở tầng trên
    console.error(`[vision] Qwen không trả JSON. Raw preview: ${text.slice(0, 300)}`);
    throw new Error(`Qwen: không đọc được JSON từ response`);
  }
  return normalizeFood(obj);
}

// ── Hàm phân tích chính ──────────────────────────────────────────────────────

/**
 * Phân tích ảnh món ăn. Tự chọn Gemini (nếu có key) → fallback Qwen.
 *
 * @param {{ base64: string, mimeType?: string, note?: string, lang?: string, contextNote?: string }} p
 *   contextNote: ngữ cảnh hội thoại gần đây (món đã nhận diện trước + phản hồi/chỉnh sửa của
 *   người dùng) để model phân tích LẠI cho đúng khi người dùng gửi lại ảnh (Lỗi #1).
 * @returns {Promise<object>} object đã chuẩn hoá (xem normalizeFood)
 */
export async function analyzeFoodImage({ base64, mimeType = "image/jpeg", note = "", lang = "vi", contextNote = "" }) {
  let result;
  if (visionProvider() === "gemini") {
    try {
      console.log("[vision] Sử dụng Gemini để nhận diện món ăn...");
      result = await analyzeWithGemini({ base64, mimeType, note, lang, contextNote });
    } catch (e) {
      console.error("[vision] Gemini lỗi, fallback Qwen:", e.message);
    }
  }
  if (!result) {
    console.log(`[vision] Sử dụng Qwen VL (min_pixels=${QWEN_MIN_PIXELS}, max_pixels=${QWEN_MAX_PIXELS})...`);
    result = await analyzeWithQwen({ base64, mimeType, note, lang, contextNote });
  }
  debugParsed("analyzeFoodImage", result);
  return result;
}

export default analyzeFoodImage;
