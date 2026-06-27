import { IncomingForm } from "formidable";
import fs from "fs";
import { supabase } from "../lib/supabase.js";
import { analyzeFoodImage } from "../lib/vision.js";

// Formidable cần tự xử lý body (multipart) -> tắt bodyParser mặc định của Vercel.
export const config = {
  api: {
    bodyParser: false,
  },
};

const getFirst = (value) => (Array.isArray(value) ? value[0] : value ?? null);
const normalizeText = (value) => {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
};

const parseNumber = (val) => {
  if (val == null) return null;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
};
const asStr = (v) => (v == null ? null : String(v).trim());

// Chuẩn hóa tên món để so khớp với FOODS DB (bỏ dấu, gộp khoảng trắng).
const normalizeFoodName = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripCJK = (text = "") =>
  String(text)
    .replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uFF00-\uFF9F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const fetchFoodsDB = async () => {
  try {
    const { data, error } = await supabase
      .from("foods")
      .select("description, calories, protein, fat, carbs, fiber, sugar, sodium");
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // ── Xác thực ─────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, error: "Không tìm thấy mã xác thực" });
  }
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return res
      .status(401)
      .json({ success: false, error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });
  }

  try {
    const form = new IncomingForm();
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, parsedFields, parsedFiles) => {
        if (err) return reject(err);
        resolve([parsedFields, parsedFiles]);
      });
    });

    const note = normalizeText(getFirst(fields.note) ?? getFirst(fields.message));
    const imageFile = getFirst(files.image) ?? getFirst(files.photo) ?? getFirst(files.file);

    if (!imageFile) {
      return res.status(400).json({ success: false, error: "Thiếu ảnh để phân tích." });
    }

    const imageBuffer = fs.readFileSync(imageFile.filepath);
    const base64Image = imageBuffer.toString("base64");
    const mimetype = imageFile.mimetype || "image/jpeg";

    // ── Nhận diện ảnh qua vision.js (Gemini → Qwen JSON → Qwen <data> fallback) ──
    let obj;
    try {
      obj = await analyzeFoodImage({ base64: base64Image, mimeType: mimetype, note });
    } catch (e) {
      console.error("[analyze-food] vision lỗi:", e.message);
      // Fallback: Qwen hội thoại với <data> tag (cách chat.js xử lý thành công)
      try {
        console.log("[analyze-food] Thử fallback Qwen <data> path...");
        const { llm, LLM_VISION_MODEL } = await import("../lib/llm.js");
        const QWEN_MIN_PIXELS = parseInt(process.env.QWEN_MIN_PIXELS || "200704", 10);
        const QWEN_MAX_PIXELS = parseInt(process.env.QWEN_MAX_PIXELS || "2007040", 10);
        const FALLBACK_PROMPT = `Bạn là chuyên gia dinh dưỡng. Nhìn ảnh và nhận diện CHÍNH XÁC món ăn hoặc đồ uống, rồi ước tính dinh dưỡng.

QUY TẮC NHẬN DIỆN:
- Quan sát LOẠI THỰC PHẨM chính (sợi, cơm, bánh, thịt, hải sản, rau/củ, tráng miệng, đồ uống).
- Quan sát SỐT/MÀU/NƯỚC dùng: trong/trắng, đỏ cay, vàng curry, nâu đậm, xanh herb.
- Phân biệt rõ: phở (sợi dẹt, nước trong) ≠ bún (sợi tròn) ≠ bún bò Huế (nước đỏ cay) ≠ bún riêu (nước đục chua).
- Khổ qua (vỏ xanh đậm, gân nổi) ≠ bí đao (vỏ nhạt, trơn).
- Món quốc tế: Tteokbokki, Ramen, Sushi, Gimbap, Pasta, Pizza, Burger, Pad Thai, Dim Sum, Steak...
- Nếu không chắc: chọn tên phổ biến nhất phù hợp, không bịa.

TRẢ Lời NGẬN GỌN theo mẫu:
**Tên món** — 1 câu tư vấn ngắn (KHÔNG liệt kê số dinh dưỡng).
Rồi KẾT THÚC bằng DUY NHẤT một dòng JSON:
<data>{"calories":NNN,"protein":"NNg","fat":"NNg","carbs":"NNg","fiber":"NNg","sugar":"NNg","sodium":"NNmg","description":"Tên món"}</data>
Nếu KHÔNG phải món ăn/ đồ uống: <data>{"calories":0,"protein":"0g","fat":"0g","carbs":"0g","fiber":"0g","sugar":"0g","sodium":"0mg","description":"NOT_FOOD"}</data>`;
        const userContent = [];
        if (note) userContent.push({ type: "text", text: `Món: ${note}` });
        userContent.push({ type: "image_url", image_url: { url: `data:${mimetype};base64,${base64Image}` } });
        const completion = await llm.chat.completions.create({
          model: LLM_VISION_MODEL,
          max_tokens: 600,
          temperature: 0,
          top_p: 1,
          messages: [
            { role: "system", content: FALLBACK_PROMPT },
            { role: "user", content: userContent },
          ],
          extra_body: {
            chat_template_kwargs: { enable_thinking: false },
            mm_processor_kwargs: { min_pixels: QWEN_MIN_PIXELS, max_pixels: QWEN_MAX_PIXELS },
          },
        });
        const raw = (completion.choices?.[0]?.message?.content || "")
          .replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        const dataM = raw.match(/<data>([\s\S]*?)<\/data>/i);
        if (dataM) {
          const parsed = JSON.parse(dataM[1].trim().replace(/,\s*([}\]])/g, "$1"));
          if (parsed.description === "NOT_FOOD") {
            return res.status(200).json({ success: false, notFood: true, error: "Ảnh không phải món ăn." });
          }
          obj = {
            is_food: true,
            food: String(parsed.description || "").replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "").trim() || (note || "Món ăn"),
            amount: "1 phần",
            calories: parsed.calories ?? 0,
            protein: String(parsed.protein || "0g"),
            fat: String(parsed.fat || "0g"),
            carbs: String(parsed.carbs || "0g"),
            fiber: String(parsed.fiber || "0g"),
            sugar: String(parsed.sugar || "0g"),
            sodium: String(parsed.sodium || "0mg"),
          };
          console.log("[analyze-food] fallback <data> thành công:", obj.food);
        } else {
          throw new Error("Fallback cũng không bóc được <data>");
        }
      } catch (fallbackErr) {
        console.error("[analyze-food] fallback thất bại:", fallbackErr.message);
        return res.status(502).json({ success: false, error: "Không phân tích được ảnh. Thử lại nhé!" });
      }
    }

    if (!obj) {
      return res.status(502).json({ success: false, error: "Không phân tích được ảnh. Thử lại nhé!" });
    }

    // ── Ảnh không phải món ăn ────────────────────────────────────────────
    // Chỉ trả notFood khi vision.js chắc chắn không phải thực phẩm (is_food === false).
    // Món ăn quốc tế (Tteokbokki, Sushi...) luôn is_food = true sau fix vision.js.
    if (obj.is_food === false) {
      return res.status(200).json({
        success: false,
        notFood: true,
        error: obj.reason
          ? `Ảnh không phải món ăn (${stripCJK(String(obj.reason))}). Vui lòng chụp lại món ăn.`
          : "Ảnh không phải món ăn. Vui lòng chụp lại món ăn.",
      });
    }

    // ── Chuẩn hoá kết quả vision ─────────────────────────────────────────
    // Đồng nhất tên field: dùng cả `food` (tên hiển thị) lẫn `description` (key DB)
    // để frontend không bị trống khi đọc theo key khác nhau.
    const foodName = stripCJK(asStr(obj.food) || asStr(obj.description)) || (note ? note : "Món ăn");
    let food = {
      food: foodName,           // key frontend dùng để điền "Tên món"
      description: foodName,    // key DB / chat.js dùng
      amount: asStr(obj.amount) || "1 phần",
      calories: parseNumber(obj.calories) ?? 0,
      protein: asStr(obj.protein),
      fat: asStr(obj.fat),
      carbs: asStr(obj.carbs),
      fiber: asStr(obj.fiber),
      sugar: asStr(obj.sugar),
      sodium: asStr(obj.sodium),
      source: "ai",
    };

    // ── DB lookup: ưu tiên số liệu đã xác minh nếu món đã có trong DB ───
    try {
      const foodsDB = await fetchFoodsDB();
      const key = normalizeFoodName(foodName);
      const hit = key
        ? foodsDB.find((f) => normalizeFoodName(f.description) === key) ||
          foodsDB.find((f) => normalizeFoodName(f.description).includes(key)) ||
          foodsDB.find((f) => key.includes(normalizeFoodName(f.description)))
        : null;

      if (hit) {
        const dbName = hit.description || foodName;
        food = {
          ...food,
          food: dbName,
          description: dbName,
          calories: hit.calories != null ? Math.round(Number(hit.calories)) : food.calories,
          protein: hit.protein != null ? String(hit.protein) : food.protein,
          fat: hit.fat != null ? String(hit.fat) : food.fat,
          carbs: hit.carbs != null ? String(hit.carbs) : food.carbs,
          fiber: hit.fiber != null ? String(hit.fiber) : food.fiber,
          sugar: hit.sugar != null ? String(hit.sugar) : food.sugar,
          sodium: hit.sodium != null ? String(hit.sodium) : food.sodium,
          source: "db",
        };
        console.log(`[analyze-food] DB hit: "${dbName}" (${food.calories} kcal)`);
      } else {
        // Lưu món mới vào DB để lần sau có sẵn
        const newRecord = {
          description: foodName,
          calories: food.calories,
          protein: food.protein,
          fat: food.fat,
          carbs: food.carbs,
          fiber: food.fiber,
          sugar: food.sugar,
          sodium: food.sodium,
        };
        supabase.from("foods").insert(newRecord).then(({ error }) => {
          if (error) console.warn("[analyze-food] Lưu foods DB:", error.message);
        });
      }
    } catch (dbErr) {
      console.warn("[analyze-food] DB lookup lỗi (không chặn):", dbErr.message);
    }

    console.log(`[analyze-food] ✅ "${food.food}" | ${food.calories} kcal | source=${food.source}`);
    return res.status(200).json({ success: true, food });

  } catch (err) {
    console.error("analyze-food error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Lỗi phân tích ảnh: " + (err?.message || "unknown") });
  }
}
