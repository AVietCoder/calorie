import { IncomingForm } from "formidable";
import fs from "fs";
import { supabase } from "../lib/supabase.js";
// Local LLM (vLLM) via OpenAI-compatible client. See lib/llm.js.
import { llm as openai, LLM_VISION_MODEL } from "../lib/llm.js";

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

// Chuẩn hóa tên món để so khớp CHÍNH XÁC với FOODS DB (bỏ dấu, gộp khoảng trắng).
const normalizeFoodName = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
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

const extractJson = (text = "") => {
  const raw = String(text).trim();
  // Thử nguyên khối trước.
  try {
    return JSON.parse(raw);
  } catch {}
  // Bóc khối JSON đầu tiên nếu model lỡ kèm chữ/markdown.
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
};

// Strip <think>...</think> blocks emitted by Qwen2.5-VL-32B-Instruct before JSON.
// Xoá ký tự Trung/Hán mà model đôi khi lẫn vào (tiếng Việt không dùng dải này).
const stripCJK = (text = "") =>
  String(text)
    .replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uFF00-\uFF9F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const stripThinkBlocks = (text = "") =>
  String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

const buildPhotoPrompt = () => `
Bạn là chuyên gia dinh dưỡng AI, am hiểu sâu ẩm thực Việt Nam 3 miền Bắc - Trung - Nam.
Nhiệm vụ: nhìn ẢNH (kèm ghi chú nếu có) và nhận diện MÓN ĂN/ĐỒ UỐNG rồi ước tính dinh dưỡng.

⚠️ NGÔN NGỮ (BẮT BUỘC): chỉ dùng TIẾNG VIỆT có dấu. TUYỆT ĐỐI KHÔNG dùng chữ Hán/Trung/Nhật.
Nếu không chắc món gì, chọn món Việt PHỔ BIẾN gần nhất về hình thức, KHÔNG bịa và KHÔNG nói "không nhận diện được" khi rõ ràng là món ăn.

QUY TẮC NHẬN DIỆN MÓN VIỆT (RẤT QUAN TRỌNG):
- MẶC ĐỊNH coi đây là MÓN ĂN VIỆT NAM trừ khi có dấu hiệu rõ ràng là món nước ngoài.
- Nhận diện dựa trên đặc điểm trực quan: loại nước dùng, sợi (phở dẹt, bún tròn, hủ tiếu, miến, mì),
  topping (chả, giò, thịt, hải sản), rau ăn kèm, nước chấm, kiểu bát/đĩa/tô.
- Phân biệt CHÍNH XÁC các món dễ nhầm:
  • phở bò (bánh phở dẹt, nước trong) ≠ bún bò Huế (bún tròn, nước đỏ cay) ≠ bún riêu ≠ hủ tiếu.
  • cơm tấm (sườn/bì/chả) ≠ cơm gà ≠ cơm chiên.
  • bánh cuốn ≠ bánh ướt; bánh xèo ≠ bánh khọt.
  • gỏi cuốn (tươi) ≠ chả giò/nem rán (chiên giòn).
  • KHỔ QUA / mướp đắng nhồi thịt: vỏ xanh ĐẬM, bề mặt CÓ GÂN NỔI nhăn nhúm/u lồi, ruột đặc thịt viên ≠ BÍ ĐAO (vỏ xanh nhạt, trơn láng, thịt trắng dày). Khi thấy vỏ xanh đậm + gân lồi → KHỔ QUA, KHÔNG phải bí đao.
- Ước tính theo khẩu phần người Việt thực tế (1 tô phở ~ 400-500g; 1 đĩa cơm tấm ~ 1 phần đầy đủ; 1 ổ bánh mì).
- "food" đặt bằng TÊN MÓN VIỆT cụ thể, có dấu tiếng Việt (vd: "Bún bò Huế", "Cơm tấm sườn bì chả").

KIỂM TRA ẢNH:
- Nếu ảnh KHÔNG phải thực phẩm/đồ uống, trả về: {"is_food": false, "reason": "<mô tả ngắn thứ nhìn thấy>"}.

ĐẦU RA: chỉ trả về DUY NHẤT một JSON object hợp lệ (không markdown, không giải thích):
{
  "is_food": true,
  "food": "<tên món tiếng Việt>",
  "amount": "<khẩu phần, vd: 1 tô (450g)>",
  "calories": <number kcal>,
  "protein": "<số + g>",
  "fat": "<số + g>",
  "carbs": "<số + g>",
  "fiber": "<số + g>",
  "sugar": "<số + g>",
  "sodium": "<số + mg>"
}
/no_think
`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // ── Xác thực (giống /api/chat) ───────────────────────────────────────────
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

    const userContent = [];
    if (note) {
      userContent.push({ type: "text", text: `Ghi chú từ người dùng: ${note}` });
    }
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mimetype};base64,${base64Image}` },
    });

    const completion = await openai.chat.completions.create({
      model: LLM_VISION_MODEL,
      max_tokens: 700,
      temperature: 0,   // greedy = ổn định, cùng ảnh cho cùng kết quả
      top_p: 1,
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
      messages: [
        { role: "system", content: buildPhotoPrompt() },
        { role: "user", content: userContent },
      ],
    });

    const rawContent = completion.choices?.[0]?.message?.content ?? "";
    const raw = stripThinkBlocks(rawContent);
    const obj = extractJson(raw);

    if (!obj) {
      return res
        .status(502)
        .json({ success: false, error: "Không đọc được kết quả phân tích. Vui lòng thử lại." });
    }

    if (obj.is_food === false) {
      return res.status(200).json({
        success: false,
        notFood: true,
        error: obj.reason
          ? `Ảnh không phải món ăn (${stripCJK(String(obj.reason))}). Vui lòng chụp lại món ăn.`
          : "Ảnh không phải món ăn. Vui lòng chụp lại món ăn.",
      });
    }

    let food = {
      food: stripCJK(asStr(obj.food)) || (note ? note : "Món ăn"),
      amount: asStr(obj.amount) || "1 phần",
      calories: parseNumber(obj.calories),
      protein: asStr(obj.protein),
      fat: asStr(obj.fat),
      carbs: asStr(obj.carbs),
      fiber: asStr(obj.fiber),
      sugar: asStr(obj.sugar),
      sodium: asStr(obj.sodium),
      source: "ai",
    };

    // Nếu món này đã có trong FOODS DB (khớp CHÍNH XÁC) -> ưu tiên số liệu DB đã xác minh.
    try {
      const foodsDB = await fetchFoodsDB();
      const key = normalizeFoodName(food.food);
      const hit = key
        ? foodsDB.find((f) => normalizeFoodName(f.description) === key)
        : null;
      if (hit) {
        food = {
          ...food,
          food: hit.description || food.food,
          calories: hit.calories != null ? Math.round(Number(hit.calories)) : food.calories,
          protein: hit.protein != null ? String(hit.protein) : food.protein,
          fat: hit.fat != null ? String(hit.fat) : food.fat,
          carbs: hit.carbs != null ? String(hit.carbs) : food.carbs,
          fiber: hit.fiber != null ? String(hit.fiber) : food.fiber,
          sugar: hit.sugar != null ? String(hit.sugar) : food.sugar,
          sodium: hit.sodium != null ? String(hit.sodium) : food.sodium,
          source: "db",
        };
      }
    } catch {
      /* DB optional: lỗi tra cứu không chặn kết quả AI */
    }

    return res.status(200).json({ success: true, food });
  } catch (err) {
    console.error("analyze-food error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Lỗi phân tích ảnh: " + (err?.message || "unknown") });
  }
}