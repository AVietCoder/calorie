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

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const VISION_PROVIDER = (
  process.env.VISION_PROVIDER || (GEMINI_KEY ? "gemini" : "qwen")
).toLowerCase();

// ── Qwen VL pixel budget (mm_processor_kwargs) ──────────────────────────────
// Tham khảo: vllm serve Qwen2.5-VL-32B-Instruct \
//   --mm-processor-kwargs '{"min_pixels": 200704, "max_pixels": 2007040}'
// 200704 = 448 × 448  (ngưỡng tối thiểu để mô hình nhìn đủ chi tiết)
// 2007040 = 448 × 448 × 10  (giới hạn trên — tránh OOM, đủ cho ảnh HD)
const QWEN_MIN_PIXELS = parseInt(process.env.QWEN_MIN_PIXELS || "200704", 10);
const QWEN_MAX_PIXELS = parseInt(process.env.QWEN_MAX_PIXELS || "2007040", 10);

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

/** Bóc JSON từ text model trả về (xử lý markdown code block + trailing comma). */
const extractJson = (text = "") => {
  const s = String(text);
  const tryParse = (raw) => {
    if (!raw) return null;
    try { return JSON.parse(raw.trim().replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
  };
  // Ưu tiên ```json ... ``` block
  let m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) { const p = tryParse(m[1]); if (p) return p; }
  // Lấy khối {} đầu tiên
  m = s.match(/\{[\s\S]*\}/);
  if (m) { const p = tryParse(m[0]); if (p) return p; }
  return tryParse(s);
};

const asStr = (v) => (v == null ? "" : String(v));

/** Chuẩn hoá object trả về từ model thành format thống nhất. */
function normalizeFood(obj = {}) {
  if (obj.is_food === false) {
    return { is_food: false, reason: stripCJK(asStr(obj.reason)) };
  }
  return {
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
  };
}

// ── Prompt chung cho cả Gemini và Qwen ───────────────────────────────────────
const VISION_PROMPT = `Bạn là chuyên gia dinh dưỡng am hiểu sâu ẩm thực Việt Nam 3 miền.
Nhìn ảnh (kèm ghi chú nếu có) và nhận diện CHÍNH XÁC món ăn, rồi ước tính dinh dưỡng.

NGÔN NGỮ: chỉ TIẾNG VIỆT có dấu. TUYỆT ĐỐI KHÔNG dùng chữ Hán/Trung/Nhật.

NHẬN DIỆN (nhìn kỹ từng chi tiết trước khi kết luận, KHÔNG bịa):
- Phân biệt sợi: phở (dẹt, trắng trong) ≠ bún (tròn, trắng) ≠ nui (ống ngắn) ≠ mì (vàng) ≠ hủ tiếu/miến.
- Phân biệt nước dùng: trong = phở/hủ tiếu; đỏ cay + sả = bún bò Huế; chua đục = bún riêu.
- Đĩa cơm trắng + sườn nướng ± trứng ốp la = CƠM TẤM (không phải cơm gà hay bánh mì).
- Vỏ XANH ĐẬM + GÂN NỔI/NHĂN + nhân thịt viên = Khổ qua nhồi thịt (KHÔNG phải bí đao).
- Vỏ XANH NHẠT + TRƠN LÁNG + thịt trắng dày = Bí đao nhồi thịt.
- Cháo (gạo nhừ, mặn) ≠ chè (ngọt); canh ≠ súp ≠ lẩu.
- Không chắc → chọn món Việt PHỔ BIẾN gần nhất về hình thức, không bịa.
- Ước theo khẩu phần Việt thực tế (1 tô ~400-500g; 1 đĩa cơm đầy đủ; 1 ổ bánh mì).

Nếu ảnh KHÔNG phải món ăn/đồ uống → trả: {"is_food": false, "reason": "<mô tả ngắn>"}.

CHỈ TRẢ VỀ DUY NHẤT 1 JSON hợp lệ (không markdown, không giải thích):
{"is_food": true, "food": "<tên món tiếng Việt>", "amount": "<khẩu phần>", "calories": <số kcal>, "protein": "<số>g", "fat": "<số>g", "carbs": "<số>g", "fiber": "<số>g", "sugar": "<số>g", "sodium": "<số>mg"}`;

// ── Gemini backend ────────────────────────────────────────────────────────────

async function analyzeWithGemini({ base64, mimeType, note }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const promptText = VISION_PROMPT + (note ? `\n\nGhi chú từ người dùng: ${note}` : "");
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
  const obj = extractJson(text);
  if (!obj) throw new Error("Gemini: không đọc được JSON từ response");
  return normalizeFood(obj);
}

// ── Qwen VL backend ──────────────────────────────────────────────────────────
// Sử dụng mm_processor_kwargs để cải thiện nhận diện ảnh phức tạp
// (độ phân giải cao hơn giúp phân biệt chi tiết như gân/vỏ rau củ)

async function analyzeWithQwen({ base64, mimeType, note }) {
  const userContent = [];
  if (note) userContent.push({ type: "text", text: `Ghi chú từ người dùng: ${note}` });
  userContent.push({
    type: "image_url",
    image_url: { url: `data:${mimeType};base64,${base64}` },
  });

  const completion = await llm.chat.completions.create({
    model: LLM_VISION_MODEL,
    max_tokens: 800,
    temperature: 0,
    top_p: 1,
    messages: [
      { role: "system", content: VISION_PROMPT },
      { role: "user", content: userContent },
    ],
    // ── mm_processor_kwargs: điều chỉnh độ phân giải xử lý ảnh ──────────────
    // min_pixels: 200704 (448×448) — đủ để nhìn rõ chi tiết (gân vỏ rau, màu nước dùng, loại sợi)
    // max_pixels: 2007040 — cho phép ảnh HD, tránh resize mất chi tiết
    // Không thiết lập → Qwen dùng mặc định thấp hơn → mất chi tiết trên ảnh phức tạp
    extra_body: {
      chat_template_kwargs: { enable_thinking: false },
      mm_processor_kwargs: {
        min_pixels: QWEN_MIN_PIXELS,
        max_pixels: QWEN_MAX_PIXELS,
      },
    },
  });

  const raw = completion.choices?.[0]?.message?.content || "";
  // Bóc <think>...</think> trước khi parse JSON
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const obj = extractJson(text);
  if (!obj) throw new Error(`Qwen: không đọc được JSON. Preview: ${text.slice(0, 200)}`);
  return normalizeFood(obj);
}

// ── Hàm phân tích chính ──────────────────────────────────────────────────────

/**
 * Phân tích ảnh món ăn. Tự chọn Gemini (nếu có key) → fallback Qwen.
 *
 * @param {{ base64: string, mimeType?: string, note?: string }} p
 * @returns {Promise<object>} object đã chuẩn hoá (xem normalizeFood)
 */
export async function analyzeFoodImage({ base64, mimeType = "image/jpeg", note = "" }) {
  if (visionProvider() === "gemini") {
    try {
      console.log("[vision] Sử dụng Gemini để nhận diện món ăn...");
      return await analyzeWithGemini({ base64, mimeType, note });
    } catch (e) {
      console.error("[vision] Gemini lỗi, fallback Qwen:", e.message);
    }
  }
  console.log(`[vision] Sử dụng Qwen VL (min_pixels=${QWEN_MIN_PIXELS}, max_pixels=${QWEN_MAX_PIXELS})...`);
  return await analyzeWithQwen({ base64, mimeType, note });
}

export default analyzeFoodImage;
