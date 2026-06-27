/**
 * lib/vision.js — Nhận diện MÓN ĂN từ ảnh (mọi nền ẩm thực thế giới).
 *
 * Đặc điểm:
 *  - Nhận diện món ăn từ BẤT KỲ nền ẩm thực nào (không mặc định món Việt).
 *  - Hỗ trợ NHIỀU MÓN trong một ảnh (mảng items).
 *  - Trả về ĐỘ TIN CẬY (confidence 0..1) cho từng món; KHÔNG đoán ẩu khi tin cậy thấp.
 *  - Hai nguồn (phối hợp): Gemini (nếu có GEMINI_API_KEY) -> fallback Qwen (vLLM local).
 *
 * Lưu ý: "ưu tiên món Việt" CHỈ áp dụng cho gợi ý thực đơn/tư vấn (ở coach prompt),
 * KHÔNG áp dụng cho bước nhận diện này.
 */
import { llm, LLM_VISION_MODEL } from "./llm.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const VISION_PROVIDER = (
  process.env.VISION_PROVIDER || (GEMINI_KEY ? "gemini" : "qwen")
).toLowerCase();
export const MIN_CONFIDENCE = Number(process.env.VISION_MIN_CONFIDENCE || 0.55);

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
const toNum = (v) => {
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

function normItem(it = {}) {
  return {
    food: stripCJK(asStr(it.food || it.name || it.description)) || "Món ăn",
    confidence: clamp01(it.confidence),
    amount: stripCJK(asStr(it.amount)) || "1 phần",
    calories: Math.round(toNum(it.calories)),
    protein: asStr(it.protein),
    fat: asStr(it.fat),
    carbs: asStr(it.carbs),
    fiber: asStr(it.fiber),
    sugar: asStr(it.sugar),
    sodium: asStr(it.sodium),
  };
}

// Cộng dồn dinh dưỡng nhiều món (để hiện tổng cho cả đĩa/bữa).
function sumNutrition(items) {
  const g = (k) => items.reduce((s, it) => s + toNum(it[k]), 0);
  const round = (x) => Math.round(x);
  return {
    calories: round(items.reduce((s, it) => s + (it.calories || 0), 0)),
    protein: `${round(g("protein"))}g`,
    fat: `${round(g("fat"))}g`,
    carbs: `${round(g("carbs"))}g`,
    fiber: `${round(g("fiber"))}g`,
    sugar: `${round(g("sugar"))}g`,
    sodium: `${round(g("sodium"))}mg`,
  };
}

// Chuẩn hoá output thô -> { is_food, reason, items[], primary, total, confident }
function normalize(obj = {}) {
  if (obj && obj.is_food === false) {
    return { is_food: false, reason: stripCJK(asStr(obj.reason)), items: [] };
  }
  let rawItems = Array.isArray(obj.items) ? obj.items : null;
  if (!rawItems) {
    if (obj.food || obj.description || obj.calories != null) rawItems = [obj];
    else rawItems = [];
  }
  const items = rawItems
    .map(normItem)
    .filter((it) => (it.food && it.food !== "Món ăn") || it.calories > 0);
  if (items.length === 0) {
    return { is_food: false, reason: stripCJK(asStr(obj.reason)) || "không nhận ra món ăn", items: [] };
  }
  items.sort((a, b) => b.confidence - a.confidence);
  const primary = items[0];
  const total = items.length > 1
    ? sumNutrition(items)
    : {
        calories: primary.calories, protein: primary.protein, fat: primary.fat,
        carbs: primary.carbs, fiber: primary.fiber, sugar: primary.sugar, sodium: primary.sodium,
      };
  const confident = primary.confidence >= MIN_CONFIDENCE;
  return { is_food: true, items, primary, total, confident };
}

const PROMPT = `Bạn là chuyên gia dinh dưỡng AI nhận diện món ăn từ ẢNH, am hiểu ẩm thực TOÀN THẾ GIỚI
(Việt Nam, Trung Hoa, Nhật, Hàn, Thái, Ấn, Âu, Mỹ, Trung Đông, Mexico...).

NGÔN NGỮ TRẢ VỀ: chỉ TIẾNG VIỆT có dấu. TUYỆT ĐỐI KHÔNG dùng chữ Hán/Trung/Nhật trong giá trị JSON.
Tên món: dùng tên tiếng Việt nếu là món Việt; món nước ngoài dùng tên phổ biến (có thể kèm phiên âm).

NGUYÊN TẮC NHẬN DIỆN:
- KHÔNG mặc định là món Việt. Nhận diện đúng theo những gì NHÌN THẤY, thuộc bất kỳ nền ẩm thực nào.
- Nếu trong ảnh có NHIỀU MÓN tách biệt (vd cơm + canh + món mặn), liệt kê TỪNG MÓN riêng.
- Với MỖI món, cho "confidence" 0..1 theo mức độ chắc chắn khi nhìn ảnh.
- KHÔNG ĐOÁN ẨU: nếu không chắc, đặt confidence THẤP (<0.5) và đặt tên khái quát
  (vd "món xào không rõ", "súp không rõ loại") thay vì bịa tên cụ thể.
- Phân biệt kỹ món dễ nhầm (sợi phở/bún/nui/mì; cháo mặn vs chè ngọt; cơm tấm vs bánh mì...).
- Ước lượng dinh dưỡng theo khẩu phần thực tế nhìn trong ảnh.

Nếu ảnh KHÔNG phải món ăn/đồ uống → trả: {"is_food": false, "reason": "<mô tả ngắn>"}.

CHỈ TRẢ VỀ DUY NHẤT 1 JSON hợp lệ (không markdown, không giải thích):
{
  "is_food": true,
  "items": [
    {"food": "<tên món>", "confidence": <0..1>, "amount": "<khẩu phần>",
     "calories": <số kcal>, "protein": "<số>g", "fat": "<số>g", "carbs": "<số>g",
     "fiber": "<số>g", "sugar": "<số>g", "sodium": "<số>mg"}
  ]
}`;

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
    throw new Error(`Gemini HTTP ${r.status}: ${t.slice(0, 180)}`);
  }
  const data = await r.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  const obj = extractJson(text);
  if (!obj) throw new Error("Gemini: không đọc được JSON");
  return normalize(obj);
}

async function analyzeWithQwen({ base64, mimeType, note }) {
  const userContent = [];
  if (note) userContent.push({ type: "text", text: `Ghi chú từ người dùng: ${note}` });
  userContent.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } });
  const completion = await llm.chat.completions.create({
    model: LLM_VISION_MODEL,
    max_tokens: 900,
    temperature: 0,
    top_p: 1,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user", content: userContent },
    ],
    extra_body: { chat_template_kwargs: { enable_thinking: false },      mm_processor_kwargs: {
        min_pixels: QWEN_MIN_PIXELS,
        max_pixels: QWEN_MAX_PIXELS,
      }, },
  });
  const text = completion.choices?.[0]?.message?.content || "";
  const obj = extractJson(text);
  if (!obj) throw new Error("Qwen: không đọc được JSON");
  return normalize(obj);
}

/**
 * Nhận diện món ăn từ ảnh. Tự chọn Gemini (nếu có key) rồi fallback Qwen.
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