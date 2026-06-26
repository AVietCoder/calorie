import { IncomingForm } from "formidable";
import fs from "fs";
import { supabase } from "../lib/supabase.js";
import { retrieveKnowledge, buildKnowledgeSection } from "../lib/knowledge.js";
import { llm as openai, LLM_MODEL, LLM_VISION_MODEL } from "../lib/llm.js";

export const config = {
  api: { bodyParser: false },
};

// ─── helpers ────────────────────────────────────────────────────────────────

const getFirst = (v) => (Array.isArray(v) ? v[0] : v ?? null);
const normalizeText = (v) =>
  Array.isArray(v) ? String(v[0] ?? "").trim() : String(v ?? "").trim();

const normalizeHistory = (history) => {
  if (!Array.isArray(history)) return [];
  return history
    .filter((i) => i?.role && i.content != null)
    .map((i) => ({
      role: i.role,
      content: Array.isArray(i.content) ? JSON.stringify(i.content) : String(i.content),
    }));
};

const truncateHistory = (history, max = 20) => {
  if (!Array.isArray(history)) return [];
  return history.length <= max ? history : history.slice(-max);
};

const safeJsonParse = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

// ─── FIX A: Strip <think>…</think> blocks.
// Qwen2.5-VL-32B-Instruct emits a thinking block before the JSON even when
// response_format=json_object is set and /no_think is in the prompt.
// Without this, safeJsonParse sees garbage and returns {} → mealData lost.
const stripThinkBlocks = (text = "") =>
  String(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

// Tolerant <data> extractor — handles <data>, ```json, or bare object.
const extractDataBlock = (text = "") => {
  const s = String(text);
  const tryParse = (raw) => {
    if (!raw) return null;
    try { return JSON.parse(raw.trim().replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
  };
  let m = s.match(/<data>([\s\S]*?)<\/data>/i);
  if (m) { const p = tryParse(m[1]); if (p) return p; }
  m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) { const p = tryParse(m[1]); if (p && ("calories" in p || "description" in p)) return p; }
  for (const obj of (s.match(/\{[\s\S]*?\}/g) || [])) {
    if (/["']?calories["']?\s*:/.test(obj)) { const p = tryParse(obj); if (p) return p; }
  }
  return null;
};

const buildDataTag = (n = {}) =>
  `<data>${JSON.stringify({
    calories: n.calories ?? 0,
    protein: n.protein ?? "0g",
    fat: n.fat ?? "0g",
    carbs: n.carbs ?? "0g",
    fiber: n.fiber ?? "0g",
    sugar: n.sugar ?? "0g",
    sodium: n.sodium ?? "0mg",
    description: n.description ?? "Món ăn",
  })}</data>`;

const stripDataBlocks = (text = "") =>
  String(text).replace(/<data>[\s\S]*?<\/data>/gi, "").replace(/```(?:json)?[\s\S]*?```/gi, "").trim();

const MEAL_TIME_REGEX = /\b(sáng|trưa|chiều|tối|bữa phụ|bua phu|ăn lúc|lúc nào|mấy giờ)\b/i;
const FOLLOW_UP = "Bạn có thể cho tôi biết bạn ăn vào sáng, trưa, tối hay bữa phụ không?";

const appendMealTimeFollowUp = (reply, message) => {
  const text = String(reply || "").trim();
  if (!text) return FOLLOW_UP;
  if (MEAL_TIME_REGEX.test(String(message || ""))) return text;
  const lower = text.toLowerCase();
  if (
    lower.includes("sáng, trưa, tối hay bữa phụ") ||
    lower.includes("bạn có thể cho tôi biết bạn ăn vào") ||
    lower.includes("bữa phụ không") ||
    lower.includes("ăn vào lúc nào")
  ) return text;
  return `${text}\n\n${FOLLOW_UP}`;
};

// ─── DB helpers ─────────────────────────────────────────────────────────────

const normalizeFoodRecord = (meal) => {
  const parseNum = (val) => {
    if (val == null) return null;
    const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
    return isNaN(n) ? null : n;
  };
  return {
    calories: parseNum(meal.calories),
    protein: meal.protein != null ? String(meal.protein) : null,
    fat: meal.fat != null ? String(meal.fat) : null,
    carbs: meal.carbs != null ? String(meal.carbs) : null,
    fiber: meal.fiber != null ? String(meal.fiber) : null,
    sugar: meal.sugar != null ? String(meal.sugar) : null,
    sodium: meal.sodium != null ? String(meal.sodium) : null,
    description: String(meal.description || meal.food || "Không rõ").trim(),
  };
};

const saveFoodRecord = async (meal) => {
  try {
    const record = normalizeFoodRecord(meal);
    if (!record.description || record.calories == null) return;
    const { data: existing } = await supabase.from("foods").select("id")
      .eq("description", record.description).maybeSingle();
    if (existing) {
      await supabase.from("foods").update({ ...record, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      const { error } = await supabase.from("foods").insert(record).select();
      if (error) console.log("Thêm thất bại:", error.message);
    }
  } catch (err) { console.error("❌ Lỗi lưu foods:", err.message); }
};

const savePlanToFoods = async (plan) => {
  if (!Array.isArray(plan)) return;
  const promises = [];
  for (const day of plan)
    for (const meal of (Array.isArray(day.meals) ? day.meals : []))
      if (meal && (meal.food || meal.description)) promises.push(saveFoodRecord(meal));
  await Promise.all(promises);
};

const fetchFoodsDB = async () => {
  try {
    const { data, error } = await supabase.from("foods")
      .select("description, calories, protein, fat, carbs, fiber, sugar, sodium")
      .order("description", { ascending: true });
    if (error || !data) return [];
    return data;
  } catch (err) { console.error("❌ Lỗi fetch foods:", err.message); return []; }
};

const formatFoodsForPrompt = (foods) => {
  if (!Array.isArray(foods) || foods.length === 0) return "(Chưa có dữ liệu)";
  return foods
    .map((f) => `- ${f.description} | ${f.calories ?? "?"}kcal | P:${f.protein ?? "?"} | F:${f.fat ?? "?"} | C:${f.carbs ?? "?"} | Fi:${f.fiber ?? "?"} | Su:${f.sugar ?? "?"} | Na:${f.sodium ?? "?"}`)
    .join("\n");
};

const findFoodInDB = (foods, name = "") => {
  if (!Array.isArray(foods) || !name) return null;
  const needle = name.toLowerCase().trim();
  return (
    foods.find((f) => f.description?.toLowerCase().trim() === needle) ||
    foods.find((f) => f.description?.toLowerCase().includes(needle)) ||
    foods.find((f) => needle.includes(f.description?.toLowerCase().trim())) ||
    null
  );
};

// ─── FIX B: Split prompt by intent ──────────────────────────────────────────
// PROBLEM: mọi tin nhắn đều chạy qua coach prompt đầy đủ (plan 7 ngày + toàn
// bộ foodsDB) → input khổng lồ. Khi analyze_only, model lại copy nguyên plan
// cũ vào newPlan → thêm 1500+ token output → 32B mất 60-120 giây.
//
// SOLUTION:
//   • buildAnalyzePrompt  — không có plan, chỉ 20 món foods. max_tokens 400.
//   • buildCoachPrompt    — đầy đủ context, chỉ gọi khi thực sự cần update/clarify.
//
// detectIntent() pre-check local trước khi gọi LLM.

const FOOD_MENTION_RE = /\b(ăn|uống|món|tô|bát|đĩa|ly|cốc|miếng|phần|gram|kg|kcal|calo|bữa|phở|bún|cơm|bánh|thịt|cá|rau|trái|quả|sữa|trứng|đậu|gà|heo|bò|tôm|mực|ốc|canh|lẩu|xôi|cháo|mì|hủ tiếu|pizza|burger|kfc|sandwich|salad|yogurt|yến mạch|oats|protein|smoothie|sinh tố)\b/i;
const UPDATE_RE = /\b(đổi|sửa|thay|cập nhật|ghi nhận|lỡ ăn|vừa ăn vào|sáng nay|trưa nay|tối nay|hôm nay ăn|thứ [2-7]|chủ nhật|ngày mai|thực đơn)\b/i;

// Returns "analyze" | "coach"
const detectIntent = (message = "") => {
  const msg = String(message);
  if (UPDATE_RE.test(msg)) return "coach";   // muốn update → full coach
  if (FOOD_MENTION_RE.test(msg)) return "analyze"; // chỉ nhắc đến món → lean
  return "coach";                            // mọi thứ còn lại → coach
};

// ─── ANALYZE PROMPT (lean — no plan, top-20 foods) ──────────────────────────
const buildAnalyzePrompt = ({ profile, foodsDB, knowledgeBlock = "" }) => {
  const topFoods = Array.isArray(foodsDB) ? foodsDB.slice(0, 20) : [];
  const foodsSection = topFoods.length > 0
    ? `\nKHO MÓN ĂN (20 món phổ biến nhất):\n${formatFoodsForPrompt(topFoods)}\nNếu món khớp → dùng số liệu từ đây, ghi "(theo dữ liệu đã lưu)".\n`
    : "";

  return `Bạn là chuyên gia dinh dưỡng AI, am hiểu ẩm thực Việt Nam.
Mục tiêu người dùng: ${profile.goal ?? "N/A"} | Calo/ngày: ${profile.target_calories || "1500-1800"} kcal | Bệnh lý: ${profile.disease || "không có"}.
${foodsSection}${knowledgeBlock ? knowledgeBlock + "\n" : ""}
NHIỆM VỤ: Người dùng nhắc đến một món ăn hoặc hỏi về dinh dưỡng. Hãy:
1. Phân tích ngắn gọn (calo, macro, nhận xét phù hợp mục tiêu).
2. Điền mealData đầy đủ nếu người dùng nhắc một món cụ thể.

TRẢ VỀ JSON (KHÔNG markdown, KHÔNG \`\`\`json):
{"reply":"...","mealData":{"calories":số,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg","description":"tên món tiếng Việt"}}

Nếu không có món cụ thể (chỉ hỏi kiến thức chung): {"reply":"...","mealData":null}

VÍ DỤ - "tôi vừa ăn phở bò":
{"reply":"Phở bò khoảng 450 kcal, cân bằng protein-carb tốt.","mealData":{"calories":450,"protein":"30g","fat":"12g","carbs":"55g","fiber":"3g","sugar":"5g","sodium":"900mg","description":"Phở bò"}}

CHỈ JSON, không thêm bất kỳ chữ nào khác. /no_think`;
};

// ─── COACH PROMPT (full context) ────────────────────────────────────────────
const buildCoachPrompt = ({
  profile, currentPlan, currentDayName, dayOfWeek, message,
  isQueryOnly, isDeadlinePassed, foodsDB, knowledgeBlock = "",
}) => {
  let prompt = `Bạn là HLV Dinh dưỡng AI thông minh, thân thiện và am hiểu ẩm thực Việt Nam.

HÔM NAY LÀ: ${currentDayName} (Tương ứng "day": ${dayOfWeek} trong thực đơn).

QUY TẮC ÁNH XẠ NGÀY:
day 1=Thứ 2 | day 2=Thứ 3 | day 3=Thứ 4 | day 4=Thứ 5 | day 5=Thứ 6 | day 6=Thứ 7 | day 7=Chủ Nhật

Người dùng vừa nhắn: "${message}"

THÔNG TIN NGƯỜI DÙNG
Giới tính: ${profile.gender ?? "N/A"} | Năm sinh: ${profile.birth_year ?? "N/A"} | Chiều cao: ${profile.height ?? "N/A"}cm | Cân nặng: ${profile.weight ?? "N/A"}kg
Mục tiêu: ${profile.goal ?? "N/A"} | Bệnh lý: ${profile.disease || "Không có"} | Macro ưu tiên: ${profile.focus_macro ?? "N/A"}
Calo mục tiêu/ngày: ${profile.target_calories || "1500-1800"} kcal | Lý do: ${profile.reason || "N/A"}
${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
THỰC ĐƠN 7 NGÀY HIỆN TẠI
${JSON.stringify(currentPlan)}

KHOMÉNI ĂN CÓ SẴN (FOODS DATABASE)
${formatFoodsForPrompt(foodsDB)}

QUY TẮC FOODS DATABASE:
- Ưu tiên dùng món từ danh sách khi xây dựng/cập nhật thực đơn.
- Nếu món đã có → dùng CHÍNH XÁC số liệu từ đó.
- Nếu chưa có → tự ước tính.

MỤC TIÊU XỬ LÝ:
1) update_plan — đủ thông tin (ngày + bữa + món) để cập nhật thực đơn.
2) analyze_only — chỉ hỏi kiến thức / nói món ăn không có ngày bữa.
3) ask_clarify — muốn đổi nhưng thiếu ngày hoặc bữa.

QUY TẮC QUAN TRỌNG:
- Chỉ nói tên món không có ngày/bữa → analyze_only, không đổi plan.
- Thiếu ngày hoặc bữa → ask_clarify, hỏi lại.
- isQueryOnly = ${isQueryOnly} → nếu true thì LUÔN analyze_only.

ĐỊNH DẠNG MỖI BỮA (bắt buộc đủ 10 trường):
{"meal":"Sáng|Trưa|Tối|Phụ","food":"...","amount":"...","calories":số,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg"}

PHẢN HỒI BẮT BUỘC — CHỈ JSON THUẦN, KHÔNG markdown:
{
  "reply": "...",
  "action": "update_plan"|"analyze_only"|"ask_clarify",
  "needsClarification": true/false,
  "clarifyQuestion": "...",
  "newPlan": [...],
  "mealData": null hoặc {"calories":số,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg","description":"tên món"}
}

QUY TẮC newPlan:
- action = update_plan → trả về thực đơn 7 ngày ĐẦY ĐỦ đã cập nhật.
- action = analyze_only hoặc ask_clarify → trả về MẢNG RỖng []. Backend tự giữ plan cũ.

QUY TẮC mealData:
- Điền khi action = analyze_only VÀ người dùng nhắc một món cụ thể.
- null khi chỉ hỏi kiến thức chung, hoặc action = update_plan / ask_clarify.

VÍ DỤ — "tôi vừa ăn 1 tô phở bò":
{"reply":"Một tô phở bò khoảng 450 kcal, khá cân bằng. Bạn ăn vào bữa nào để mình ghi nhận nhé?","action":"analyze_only","needsClarification":false,"clarifyQuestion":"","newPlan":[],"mealData":{"calories":450,"protein":"30g","fat":"12g","carbs":"55g","fiber":"3g","sugar":"5g","sodium":"900mg","description":"Phở bò"}}

VÍ DỤ — "đổi trưa thứ 3 thành bún chả":
{"reply":"Đã đổi bữa trưa thứ 3 thành bún chả (~500 kcal)...","action":"update_plan","needsClarification":false,"clarifyQuestion":"","newPlan":[...đủ 7 ngày...],"mealData":null}

NHIỆM VỤ A — Báo đã ăn + đủ ngày/bữa:
- Ước lượng calo + macro đầy đủ.
- Cập nhật đúng ngày/bữa.
- Tái cân bằng các bữa còn lại trong ngày để tổng calo ~ ${profile.target_calories || "1500-1800"} kcal (±150 kcal).
- Tái cấu trúc 1-2 ngày sau nếu ngày hiện tại dư/thiếu >150 kcal.

NHIỆM VỤ B — Chỉ nói món, không có ngày/bữa:
- Phân tích calo + macro + nhận xét tác động đến mục tiêu.
- Không thay đổi plan.

NHIỆM VỤ C — Thiếu ngày hoặc bữa:
- Hỏi lại rõ ràng. Không thay đổi plan.

NHIỆM VỤ D — Đủ ngày/bữa, muốn đổi món:
- Cập nhật + tái cân bằng ngày đó + tái cấu trúc nếu cần.

/no_think`;

  if (isDeadlinePassed) {
    prompt += `\n\n[QUAN TRỌNG]: Đã VƯỢT DEADLINE. KHÔNG cập nhật thực đơn (luôn analyze_only). Chúc mừng và khuyên vào LỘ TRÌNH để bắt đầu chu kỳ mới.`;
  }

  return prompt;
};

// ─── NUTRITION PROMPT (image analysis) ──────────────────────────────────────
const buildNutritionPrompt = (foodsDB = [], knowledgeBlock = "") => {
  const topFoods = Array.isArray(foodsDB) ? foodsDB.slice(0, 20) : [];
  const foodsSection = topFoods.length > 0
    ? `\nKHO MÓN ĂN (20 phổ biến nhất):\n${formatFoodsForPrompt(topFoods)}\nNếu khớp → dùng số liệu từ đây, ghi "(theo dữ liệu đã lưu)".\n`
    : "";

  return `Bạn là chuyên gia dinh dưỡng AI, am hiểu sâu ẩm thực Việt Nam 3 miền.
Nhiệm vụ: nhìn ảnh/đọc mô tả và phân tích MÓN ĂN.

QUY TẮC NHẬN DIỆN (NHÌN KỸ TRƯỚC KHI KẾT LUẬN — đừng đoán ẩu):
- Quan sát kết cấu, màu sắc, thành phần trước khi đặt tên món.
- Phân biệt MẶN vs NGỌT: cháo (gạo nấu nhừ, MẶN, thường có thịt/hành) ≠ chè (đồ NGỌT, đậu/nước cốt dừa). canh ≠ súp ≠ lẩu.
- Phân biệt: phở bò (bánh phở dẹt, nước trong) ≠ bún bò Huế (bún tròn, nước đỏ cay) ≠ bún riêu ≠ hủ tiếu.
- Mặc định là món Việt trừ khi rõ ràng món nước ngoài. Ước theo khẩu phần Việt thực tế (1 tô ~400-500g).
${foodsSection}${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
NẾU ẢNH KHÔNG PHẢI MÓN ĂN / ĐỒ UỐNG:
- Trả về ĐÚNG: <error>mô tả ngắn thứ nhìn thấy</error>
- KHÔNG kèm <data>, KHÔNG phân tích dinh dưỡng.

NẾU LÀ MÓN ĂN — TRẢ VỀ ĐÚNG ĐỊNH DẠNG NÀY, KHÔNG GÌ KHÁC:
1. Một hoặc hai câu nhận xét NGẮN GỌN, thân thiện. KHÔNG viết dài.
2. TUYỆT ĐỐI KHÔNG dùng markdown: không "###", không gạch đầu dòng, không "**in đậm**", không liệt kê.
3. KHÔNG hỏi "bạn ăn vào bữa nào" — giao diện đã có nút chọn buổi/ngày riêng.
4. Kết thúc bằng ĐÚNG MỘT thẻ <data>JSON</data> (KHÔNG dùng \`\`\`json). JSON trên MỘT dòng, đủ 8 trường:
   {"calories":số,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg","description":"tên món tiếng Việt"}
5. Sau </data> KHÔNG viết thêm gì.

Ví dụ (đúng — ngắn gọn):
Canh bí đao nhồi thịt khá thanh đạm, ít calo, hợp với chế độ giảm cân.
<data>{"calories":225,"protein":"22g","fat":"7g","carbs":"18g","fiber":"4g","sugar":"3g","sodium":"350mg","description":"Bí đao nhồi thịt"}</data>

/no_think`;
};

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Không tìm thấy mã xác thực" });

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });

  const form = new IncomingForm();

  try {
    const [fields, files] = await new Promise((resolve, reject) =>
      form.parse(req, (err, f, fi) => err ? reject(err) : resolve([f, fi]))
    );

    const message = normalizeText(getFirst(fields.message));
    const imageFile = getFirst(files.image);
    const isQueryOnly = String(getFirst(fields.isQueryOnly) ?? "false") === "true";
    const followupType = normalizeText(getFirst(fields.followupType));
    const mealDataRaw = normalizeText(getFirst(fields.mealData));
    const mealTime = normalizeText(getFirst(fields.mealTime));
    const mealDayText = normalizeText(getFirst(fields.mealDayText)) || normalizeText(getFirst(fields.mealDayValue));
    const pendingMealData = safeJsonParse(mealDataRaw);

    if (!message && !imageFile) return res.status(400).json({ error: "Thiếu dữ liệu." });

    const [{ data: profile, error: profileError }, foodsDB] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      fetchFoodsDB(),
    ]);

    if (profileError || !profile) return res.status(404).json({ error: "Người dùng không tồn tại" });

    const knowledge = await retrieveKnowledge({ message, disease: profile.disease, topK: 6 });
    const knowledgeBlock = buildKnowledgeSection(knowledge);
    if (knowledge.chunks.length)
      console.log(`📚 [chat] ${knowledge.chunks.length} đoạn (mode=${knowledge.mode}, bệnh=${knowledge.usedDiseaseKeys.join(",") || "—"})`);

    let history = normalizeHistory(profile.chat_history || []);
    let currentPlan = Array.isArray(profile.weekly_plan) ? profile.weekly_plan : [];
    const now = new Date();
    let isDeadlinePassed = false;
    if (profile.deadline) {
      const d = new Date(profile.deadline);
      d.setHours(23, 59, 59, 999);
      isDeadlinePassed = now > d;
    }
    const effectiveIsQueryOnly = isQueryOnly || isDeadlinePassed;

    const formatDate = (di) => {
      const d = new Date(di);
      return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
    };
    const resolvedDayText = formatDate(mealDayText === "hôm nay" ? now : mealDayText);
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const dayNames = ["","Thứ 2","Thứ 3","Thứ 4","Thứ 5","Thứ 6","Thứ 7","Chủ Nhật"];
    const currentDayName = dayNames[dayOfWeek];

    // ── IMAGE PATH ────────────────────────────────────────────────────────────
    if (imageFile) {
      const userContent = [];
      if (message) userContent.push({ type: "text", text: message });
      const base64Image = fs.readFileSync(imageFile.filepath).toString("base64");
      userContent.push({ type: "image_url", image_url: { url: `data:${imageFile.mimetype};base64,${base64Image}` } });

      const completion = await openai.chat.completions.create({
        model: LLM_VISION_MODEL,
        messages: [
          { role: "system", content: buildNutritionPrompt(foodsDB, knowledgeBlock) },
          ...history.slice(-6),  // FIX C: ít turn hơn → nhanh hơn
          { role: "user", content: userContent },
        ],
        max_tokens: 1200,        // đủ chỗ cho nhận xét ngắn + thẻ <data> đầy đủ (tránh cụt)
        temperature: 0.3,
        // FIX E: tắt thinking qua vLLM extra_body (hoạt động mọi version Qwen-VL)
        extra_body: { chat_template_kwargs: { enable_thinking: false } },
      });

      let aiReply = stripThinkBlocks(completion.choices[0]?.message?.content || "");

      // Ảnh KHÔNG phải món ăn -> xin lỗi nhẹ nhàng, KHÔNG hiện thẻ chọn bữa.
      const errMatch = aiReply.match(/<error>([\s\S]*?)<\/error>/i);
      if (errMatch) {
        const seen = errMatch[1].trim();
        const reply = `Xin lỗi, đây không phải là món ăn nên mình không phân tích dinh dưỡng được${seen ? ` (mình thấy: ${seen})` : ""}. Bạn gửi giúp mình ảnh món ăn nhé!`;
        return res.status(200).json({ reply, username: profile.username });
      }

      let nutritionData = extractDataBlock(aiReply);
      if (nutritionData?.description) {
        const existing = findFoodInDB(foodsDB, nutritionData.description);
        if (existing) {
          nutritionData = { ...nutritionData, ...Object.fromEntries(
            ["calories","protein","fat","carbs","fiber","sugar","sodium"]
              .filter(k => existing[k] != null).map(k => [k, existing[k]])
          )};
        } else {
          await saveFoodRecord(nutritionData);
        }
        aiReply = `${stripDataBlocks(aiReply)}\n${buildDataTag(nutritionData)}`;
      }

      const newHistory = truncateHistory([
        ...history,
        { role: "user", content: message || "[ảnh]" },
        { role: "assistant", content: aiReply },
      ], 20);

      await supabase.from("profiles").update({
        chat_history: newHistory,
        ...(nutritionData ? { last_detected_meal: nutritionData } : {}),
      }).eq("id", user.id);

      return res.status(200).json({ reply: aiReply, username: profile.username });
    }

    // ── TEXT PATH ─────────────────────────────────────────────────────────────
    let finalMessage = message;
    const isMealFollowup = followupType === "meal_time_update" && pendingMealData && mealTime;

    if (isMealFollowup) {
      finalMessage = `Bạn đã ăn ${pendingMealData.description || "món ăn"} vào buổi ${mealTime}, ngày ${resolvedDayText}.
Thông tin: Calories: ${pendingMealData.calories || "N/A"} kcal | Protein: ${pendingMealData.protein || "N/A"} | Fat: ${pendingMealData.fat || "N/A"} | Carbs: ${pendingMealData.carbs || "N/A"} | Fiber: ${pendingMealData.fiber || "N/A"} | Sugar: ${pendingMealData.sugar || "N/A"} | Sodium: ${pendingMealData.sodium || "N/A"}
Hãy cập nhật thực đơn 7 ngày tương ứng và điều chỉnh hợp lý nếu cần.`;
    }

    // FIX B: Route đến lean analyze prompt hoặc full coach prompt
    const intent = isMealFollowup ? "coach" : effectiveIsQueryOnly ? "analyze" : detectIntent(finalMessage);
    console.log(`[chat] intent=${intent} queryOnly=${effectiveIsQueryOnly} msg="${finalMessage.slice(0,60)}"`);

    let aiReply = "";
    let action = "analyze_only";
    let needsClarification = false;
    let clarifyQuestion = "";
    let resultMealData = null;

    if (intent === "analyze") {
      // ── LEAN PATH: không có plan, foodsDB top-20, max_tokens 400 ─────────
      const analyzeCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: buildAnalyzePrompt({ profile, foodsDB, knowledgeBlock }) },
          ...history.slice(-4),  // FIX C: ít turn hơn
          { role: "user", content: finalMessage },
        ],
        response_format: { type: "json_object" },
        max_tokens: 700,         // reply ngắn + mealData, tránh cụt
        temperature: 0.2,
        // FIX E: tắt thinking
        extra_body: { chat_template_kwargs: { enable_thinking: false } },
      });

      const rawContent = analyzeCompletion.choices[0]?.message?.content || "{}";
      const raw = stripThinkBlocks(rawContent);
      const result = safeJsonParse(raw) || {};

      aiReply = String(result.reply || "");
      resultMealData = (result.mealData && typeof result.mealData === "object") ? result.mealData : null;
      action = "analyze_only";

    } else {
      // ── FULL COACH PATH: update/clarify cần context đầy đủ ───────────────
      const coachCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: buildCoachPrompt({
            profile, currentPlan, currentDayName, dayOfWeek,
            message: finalMessage, isQueryOnly: effectiveIsQueryOnly,
            isDeadlinePassed, foodsDB, knowledgeBlock,
          })},
          ...history.slice(-6),
          { role: "user", content: finalMessage },
        ],
        response_format: { type: "json_object" },
        max_tokens: 6000,        // update_plan 7 ngày đầy đủ, tránh JSON cụt
        temperature: 0.2,
        // FIX E: tắt thinking
        extra_body: { chat_template_kwargs: { enable_thinking: false } },
      });

      const rawContent = coachCompletion.choices[0]?.message?.content || "{}";
      const raw = stripThinkBlocks(rawContent);
      const result = safeJsonParse(raw) || {};

      aiReply = String(result.reply || "");
      action = String(result.action || "analyze_only");
      needsClarification = Boolean(result.needsClarification);
      clarifyQuestion = String(result.clarifyQuestion || "");

      // FIX F: analyze_only/ask_clarify → backend giữ plan cũ, model trả [].
      // update_plan → chỉ chấp nhận nếu mảng không rỗng.
      if (action === "update_plan" && Array.isArray(result.newPlan) && result.newPlan.length > 0) {
        currentPlan = result.newPlan;
        await supabase.from("profiles").update({ weekly_plan: currentPlan, plan_updated_at: now }).eq("id", user.id);
        savePlanToFoods(currentPlan).catch((e) => console.error("❌ savePlanToFoods:", e.message));
      }

      resultMealData = (result.mealData && typeof result.mealData === "object") ? result.mealData : null;
      if (!resultMealData?.description) {
        const inline = extractDataBlock(aiReply);
        if (inline?.description) resultMealData = inline;
      }
    }

    // Append câu hỏi bữa ăn nếu chưa hỏi
    if (action === "analyze_only" || (!needsClarification && action === "ask_clarify")) {
      aiReply = appendMealTimeFollowUp(aiReply, finalMessage);
    }

    // Gắn <data> tag để frontend hiện meal confirmation card
    if (action === "analyze_only" && !isMealFollowup && resultMealData?.description) {
      aiReply = `${stripDataBlocks(aiReply)}\n${buildDataTag(resultMealData)}`;
    }

    // Lưu history
    const newHistory = truncateHistory([
      ...history,
      { role: "user", content: finalMessage },
      { role: "assistant", content: aiReply },
    ], 20);

    await supabase.from("profiles").update({ chat_history: newHistory }).eq("id", user.id);

    return res.status(200).json({
      success: true,
      reply: aiReply,
      action,
      needsClarification,
      clarifyQuestion,
      newPlan: currentPlan,
      username: profile.username,
      isDeadlinePassed,
    });

  } catch (err) {
    console.error("❌ Lỗi API:", err);
    return res.status(500).json({ error: "Lỗi Server", details: err.message });
  }
}
