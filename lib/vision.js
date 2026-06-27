/**
 * lib/vision.js — Nhận diện MÓN ĂN từ ảnh, có thể "phối hợp" 2 nguồn:
 *
 *   1) GEMINI (Google) — nhận diện món ăn (đặc biệt món Việt) chính xác hơn Qwen,
 *      rẻ, có bậc miễn phí. BẬT bằng cách đặt biến môi trường GEMINI_API_KEY.
 *   2) QWEN (vLLM local) — mặc định khi KHÔNG đặt GEMINI_API_KEY (giữ 100% local,
 *      0 token cloud).
 *
 * Cơ chế: nếu có GEMINI_API_KEY thì thử Gemini trước; lỗi -> tự fallback về Qwen.
 * Trả về object chuẩn hoá: { is_food, food, calories, protein, fat, carbs, fiber, sugar, sodium, reason }
 *
 * ENV:
 *   GEMINI_API_KEY   khoá Google AI Studio (https://aistudio.google.com/apikey). Để trống = chỉ dùng Qwen.
 *   GEMINI_MODEL     mặc định "gemini-2.0-flash" (nhanh, rẻ). Có thể đổi "gemini-2.5-flash".
 *   VISION_PROVIDER  "gemini" | "qwen". Mặc định "gemini" nếu có key, ngược lại "qwen".
 */
import { llm, LLM_VISION_MODEL } from "./llm.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const VISION_PROVIDER = (
  process.env.VISION_PROVIDER || (GEMINI_KEY ? "gemini" : "qwen")
).toLowerCase();

export function visionProvider() {
  return VISION_PROVIDER === "gemini" && GEMINI_KEY ? "gemini" : "qwen";
}

// Xoá ký tự Trung/Hán/Nhật model đôi khi lẫn vào (tiếng Việt không dùng dải này).
const stripCJK = (t = "") =>
  String(t)
    .replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uFF00-\uFF9F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const extractJson = (text = "") => {
  const s = String(text);
  const tryParse = (raw) => {
    if (!raw) return null;
    try { return JSON.parse(raw.trim().replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
  };
  let m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) { const p = tryParse(m[1]); if (p) return p; }
  m = s.match(/\{[\s\S]*\}/);
  if (m) { const p = tryParse(m[0]); if (p) return p; }
  return tryParse(s);
};

const asStr = (v) => (v == null ? "" : String(v));

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

const PROMPT = `Bạn là chuyên gia dinh dưỡng am hiểu sâu ẩm thực Việt Nam 3 miền.
Nhìn ảnh (kèm ghi chú nếu có) và nhận diện CHÍNH XÁC món ăn, rồi ước tính dinh dưỡng.

NGÔN NGỮ: chỉ TIẾNG VIỆT có dấu. TUYỆT ĐỐI KHÔNG dùng chữ Hán/Trung/Nhật.

NHẬN DIỆN (nhìn kỹ trước khi kết luận, KHÔNG bịa):
- Phân biệt sợi: phở (dẹt) ≠ bún (tròn) ≠ nui (ống ngắn) ≠ mì (vàng) ≠ hủ tiếu/miến.
- Phân biệt mặn/ngọt: cháo (gạo nhừ, mặn) ≠ chè (ngọt). canh ≠ súp ≠ lẩu.
- Đĩa cơm trắng + thịt nướng/sườn + trứng ốp la = CƠM TẤM (không phải bánh mì).
- Vỏ xanh đậm gân nổi + nhân thịt = khổ qua nhồi thịt; vỏ xanh nhạt trơn = bí đao nhồi thịt.
- Không chắc → chọn món Việt PHỔ BIẾN gần nhất về hình thức.
- Ước theo khẩu phần Việt thực tế (1 tô ~400-500g; 1 đĩa cơm đầy đủ).

Nếu ảnh KHÔNG phải món ăn/đồ uống → trả: {"is_food": false, "reason": "<mô tả ngắn>"}.

CHỈ TRẢ VỀ DUY NHẤT 1 JSON hợp lệ (không markdown, không giải thích):
{"is_food": true, "food": "<tên món tiếng Việt>", "amount": "<khẩu phần, vd: 1 tô (450g)>", "calories": <số kcal>, "protein": "<số>g", "fat": "<số>g", "carbs": "<số>g", "fiber": "<số>g", "sugar": "<số>g", "sodium": "<số>mg"}`;

async function analyzeWithGemini({ base64, mimeType, note }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT + (note ? `\n\nGhi chú từ người dùng: ${note}` : "") },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
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
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("");
  const obj = extractJson(text);
  if (!obj) throw new Error("Gemini: không đọc được JSON");
  return normalizeFood(obj);
}

async function analyzeWithQwen({ base64, mimeType, note }) {
  const userContent = [];
  if (note) userContent.push({ type: "text", text: `Ghi chú từ người dùng: ${note}` });
  userContent.push({
    type: "image_url",
    image_url: { url: `data:${mimeType};base64,${base64}` },
  });
  const completion = await llm.chat.completions.create({
    model: LLM_VISION_MODEL,
    max_tokens: 700,
    temperature: 0,
    top_p: 1,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user", content: userContent },
    ],
    extra_body: { chat_template_kwargs: { enable_thinking: false } },
  });
  const text = completion.choices?.[0]?.message?.content || "";
  const obj = extractJson(text);
  if (!obj) throw new Error("Qwen: không đọc được JSON");
  return normalizeFood(obj);
}

/**
 * Nhận diện món ăn từ ảnh. Tự chọn Gemini (nếu có key) rồi fallback Qwen.
 * @param {{ base64: string, mimeType?: string, note?: string }} p
 * @returns {Promise<object>} object chuẩn hoá (xem normalizeFood)
 */
export async function analyzeFoodImage({ base64, mimeType = "image/jpeg", note = "" }) {
  if (visionProvider() === "gemini") {
    try {
      return await analyzeWithGemini({ base64, mimeType, note });
    } catch (e) {
      console.error("[vision] Gemini lỗi, fallback Qwen:", e.message);
    }
  }
  return await analyzeWithQwen({ base64, mimeType, note });
}

export default analyzeFoodImage;
