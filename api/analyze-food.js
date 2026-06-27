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

    // ── Nhận diện ảnh qua vision.js (Gemini → fallback Qwen) ─────────────
    let obj;
    try {
      obj = await analyzeFoodImage({ base64: base64Image, mimeType: mimetype, note });
    } catch (e) {
      console.error("[analyze-food] vision lỗi:", e.message);
      return res
        .status(502)
        .json({ success: false, error: "Không đọc được kết quả phân tích. Vui lòng thử lại." });
    }

    if (!obj) {
      return res
        .status(502)
        .json({ success: false, error: "Không đọc được kết quả phân tích. Vui lòng thử lại." });
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
