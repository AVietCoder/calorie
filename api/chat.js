import { IncomingForm } from "formidable";
import fs from "fs";
import { supabase } from "../lib/supabase.js";
import { retrieveKnowledge, buildKnowledgeSection } from "../lib/knowledge.js";
import { llm as openai, LLM_MODEL, LLM_VISION_MODEL } from "../lib/llm.js";
import { analyzeFoodImage, visionProvider } from "../lib/vision.js";

export const config = {
  api: { bodyParser: false },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

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

// Strip <think>...</think>
const stripThinkBlocks = (text = "") =>
  String(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

// Tolerant <data> extractor
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

// Xoá ký tự CJK
const stripCJK = (text = "") =>
  String(text)
    .replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uFF00-\uFF9F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();

const stripDataBlocks = (text = "") =>
  String(text)
    .replace(/<data>[\s\S]*?<\/data>/gi, "")
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .replace(/\{[^{}]*["']?calories["']?\s*:[\s\S]*?\}/gi, "")
    .replace(/^\s*(Dữ liệu ước tính|Dữ liệu dinh dưỡng|Ước tính dinh dưỡng|Thông tin dinh dưỡng|JSON)\s*:?\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Strip các tiêu đề bước lọt ra ngoài từ vision model
const stripInternalSteps = (text = "") =>
  String(text)
    .replace(/^\s*Bước\s+\d+\s*[—–-][\s\S]*?(?=\n[^\n]|\n\n|$)/gim, "")
    .replace(/^\s*(QUAN SÁT|NHẬN DIỆN CHÍNH XÁC|ĐẦU RA|QUY TRÌNH NỘI TÂM)\s*[:\-–].*$/gim, "")
    .replace(/^\s*(a\)|b\)|c\)|d\)|e\))[\s\S]*?(?=\n[^\s]|\n\n|$)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const MEAL_TIME_REGEX = /\b(sáng|trưa|chiều|tối|bữa phụ|bua phu|ăn lúc|lúc nào|mấy giờ)\b/i;
const FOLLOW_UP = "Bạn có thể cho mình biết bạn ăn vào sáng, trưa, tối hay bữa phụ không?";

const appendMealTimeFollowUp = (reply, message) => {
  const text = String(reply || "").trim();
  if (!text) return FOLLOW_UP;
  if (MEAL_TIME_REGEX.test(String(message || ""))) return text;
  const lower = text.toLowerCase();
  if (
    lower.includes("sáng, trưa, tối hay bữa phụ") ||
    lower.includes("bạn có thể cho") ||
    lower.includes("bữa phụ không") ||
    lower.includes("ăn vào lúc nào")
  ) return text;
  return `${text}\n\n${FOLLOW_UP}`;
};

// ─── DB HELPERS ──────────────────────────────────────────────────────────────

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

// ─── INTENT DETECTION ────────────────────────────────────────────────────────

const FOOD_MENTION_RE = /\b(ăn|uống|món|tô|bát|đĩa|ly|cốc|miếng|phần|gram|kg|kcal|calo|bữa|phở|bún|cơm|bánh|thịt|cá|rau|trái|quả|sữa|trứng|đậu|gà|heo|bò|tôm|mực|ốc|canh|lẩu|xôi|cháo|mì|hủ tiếu|pizza|burger|kfc|sandwich|salad|yogurt|yến mạch|oats|protein|smoothie|sinh tố)\b/i;
// Chỉ những câu THỰC SỰ muốn đổi thực đơn mới vào nhánh coach (nặng). Các câu kiểu
// "lỡ ăn / vừa ăn" là GHI NHẬN món -> để nhánh analyze (nhanh) xử lý + hỏi lại bữa.
const UPDATE_RE = /\b(đổi|sửa|thay|cập nhật|thứ [2-7]|chủ nhật|ngày mai|thực đơn|kế hoạch ăn)\b/i;
const CASUAL_RE = /\b(thời tiết|bóng đá|phim|nhạc|code|lập trình|chính trị|kinh tế|đầu tư|crypto|game|trò chơi|học|thi|công việc|tình yêu|yêu|hẹn hò|du lịch|vui|buồn|chán|stress|mệt|ngủ)\b/i;

const detectIntent = (message = "") => {
  const msg = String(message);
  if (UPDATE_RE.test(msg)) return "coach";
  if (FOOD_MENTION_RE.test(msg)) return "analyze";
  if (CASUAL_RE.test(msg)) return "casual";
  return "coach";
};

// ─── PROMPT: ANALYZE ─────────────────────────────────────────────────────────

const buildAnalyzePrompt = ({ profile, foodsDB, knowledgeBlock = "" }) => {
  const topFoods = Array.isArray(foodsDB) ? foodsDB.slice(0, 20) : [];
  const foodsSection = topFoods.length > 0
    ? `\nKHO MÓN ĂN (20 món phổ biến nhất):\n${formatFoodsForPrompt(topFoods)}\nNếu món khớp → dùng số liệu từ đây, ghi "(theo dữ liệu đã lưu)".\n`
    : "";

  return `Bạn là chuyên gia dinh dưỡng AI, am hiểu sâu ẩm thực Việt Nam 3 miền, luôn thân thiện và tư vấn đến nơi đến chốn.

THÔNG TIN NGƯỜI DÙNG: Mục tiêu: ${profile.goal ?? "N/A"} | Calo/ngày: ${profile.target_calories || "1500-1800"} kcal | Bệnh lý: ${profile.disease || "không có"}.
${foodsSection}${knowledgeBlock ? knowledgeBlock + "\n" : ""}
NHIỆM VỤ: Người dùng nhắc đến một món ăn hoặc hỏi về dinh dưỡng/sức khỏe ăn uống. Hãy:
1. Nhận diện món và ước lượng calo, protein, fat, carbs đầy đủ.
2. Nhận xét ngắn gọn về mức độ phù hợp với mục tiêu của người dùng.
3. Nếu cần, gợi ý điều chỉnh nhỏ (ăn kèm gì, tránh gì) — thực tế và hữu ích.
4. Điền mealData đầy đủ nếu người dùng nhắc một món cụ thể.

QUY TẮC REPLY:
- Thân thiện, tự nhiên như người bạn hiểu dinh dưỡng. Không cứng nhắc.
- Không dùng markdown (không ###, không **bold**, không gạch đầu dòng).
- Nếu là câu hỏi kiến thức chung (không nhắc món cụ thể) → trả lời rõ ràng, không có mealData.

TRẢ VỀ JSON THUẦN (KHÔNG markdown, KHÔNG dấu \`\`\`):
{"reply":"...","mealData":{"calories":số,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg","description":"tên món tiếng Việt"}}

Nếu không có món cụ thể: {"reply":"...","mealData":null}

VÍ DỤ — "tôi vừa ăn phở bò":
{"reply":"Phở bò khoảng 450 kcal, khá cân bằng protein và carbs — ổn cho bữa sáng hoặc trưa. Nếu bạn đang giảm cân thì lưu ý phần nước dùng có thể nhiều muối, nên hạn chế uống hết nước nhé.","mealData":{"calories":450,"protein":"30g","fat":"12g","carbs":"55g","fiber":"3g","sugar":"5g","sodium":"900mg","description":"Phở bò"}}

CHỈ JSON, không thêm bất kỳ chữ nào khác. /no_think`;
};

// ─── PROMPT: COACH ───────────────────────────────────────────────────────────

const buildCoachPrompt = ({
  profile, currentPlan, currentDayName, dayOfWeek, message,
  isQueryOnly, isDeadlinePassed, foodsDB, knowledgeBlock = "",
}) => {
  let prompt = `Bạn là HLV Dinh dưỡng AI thông minh, thân thiện và am hiểu sâu ẩm thực Việt Nam.
Luôn tư vấn đến nơi đến chốn — không trả lời chung chung, không qua loa.

HÔM NAY LÀ: ${currentDayName} (day ${dayOfWeek} trong thực đơn).
QUY TẮC NGÀY: day 1=Thứ 2 | day 2=Thứ 3 | day 3=Thứ 4 | day 4=Thứ 5 | day 5=Thứ 6 | day 6=Thứ 7 | day 7=Chủ Nhật

Người dùng vừa nhắn: "${message}"

THÔNG TIN NGƯỜI DÙNG
Giới tính: ${profile.gender ?? "N/A"} | Năm sinh: ${profile.birth_year ?? "N/A"} | Chiều cao: ${profile.height ?? "N/A"}cm | Cân nặng: ${profile.weight ?? "N/A"}kg
Mục tiêu: ${profile.goal ?? "N/A"} | Bệnh lý: ${profile.disease || "Không có"} | Macro ưu tiên: ${profile.focus_macro ?? "N/A"}
Calo mục tiêu/ngày: ${profile.target_calories || "1500-1800"} kcal | Lý do: ${profile.reason || "N/A"}
${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
THỰC ĐƠN 7 NGÀY HIỆN TẠI
${JSON.stringify(currentPlan)}

KHOÁ MÓN ĂN CÓ SẴN (FOODS DATABASE)
${formatFoodsForPrompt(foodsDB)}

QUY TẮC FOODS DATABASE:
- Ưu tiên dùng món từ danh sách khi xây dựng/cập nhật thực đơn.
- Nếu món đã có → dùng CHÍNH XÁC số liệu từ đó.
- Nếu chưa có → tự ước tính hợp lý.

PHÂN LOẠI NHIỆM VỤ:
1) update_plan — có đủ ngày + bữa + món → cập nhật thực đơn.
2) analyze_only — hỏi kiến thức / nói món ăn chưa có ngày bữa.
3) ask_clarify — muốn đổi nhưng thiếu ngày hoặc bữa.

QUY TẮC XỬ LÝ:
- Chỉ nói tên món, không có ngày/bữa → analyze_only, KHÔNG đổi plan.
- Thiếu ngày hoặc bữa → ask_clarify, hỏi rõ ràng cái còn thiếu.
- isQueryOnly = ${isQueryOnly} → nếu true thì LUÔN analyze_only dù có đủ thông tin.
- Reply phải tự nhiên, thân thiện. Không dùng markdown.

ĐỊNH DẠNG MỖI BỮA (đủ 10 trường):
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
- action = analyze_only hoặc ask_clarify → trả về MẢNG RỖNG [].

QUY TẮC mealData:
- Điền khi action = analyze_only VÀ người dùng nhắc một món cụ thể.
- null khi chỉ hỏi kiến thức chung, hoặc action = update_plan / ask_clarify.

VÍ DỤ — "tôi vừa ăn 1 tô phở bò":
{"reply":"Phở bò khoảng 450 kcal, khá cân bằng. Bạn ăn vào bữa nào để mình ghi nhận nhé?","action":"analyze_only","needsClarification":false,"clarifyQuestion":"","newPlan":[],"mealData":{"calories":450,"protein":"30g","fat":"12g","carbs":"55g","fiber":"3g","sugar":"5g","sodium":"900mg","description":"Phở bò"}}

VÍ DỤ — "đổi trưa thứ 3 thành bún chả":
{"reply":"Đã đổi bữa trưa thứ 3 thành bún chả (~500 kcal). Mình tái cân bằng bữa tối thứ 3 nhẹ hơn một chút để tổng ngày vẫn đạt mục tiêu nhé.","action":"update_plan","needsClarification":false,"clarifyQuestion":"","newPlan":[...đủ 7 ngày...],"mealData":null}

NHIỆM VỤ A — Báo đã ăn + đủ ngày/bữa:
- Ước lượng calo + macro đầy đủ. Cập nhật đúng ngày/bữa.
- Tái cân bằng các bữa còn lại trong ngày để tổng calo ~ ${profile.target_calories || "1500-1800"} kcal (±150 kcal).
- Tái cấu trúc 1-2 ngày sau nếu ngày hiện tại dư/thiếu >150 kcal.

NHIỆM VỤ B — Chỉ nói món, không có ngày/bữa:
- Phân tích calo + macro + nhận xét tác động đến mục tiêu. Không thay đổi plan.

NHIỆM VỤ C — Thiếu ngày hoặc bữa:
- Hỏi lại rõ ràng đúng phần còn thiếu. Không thay đổi plan.

NHIỆM VỤ D — Đủ ngày/bữa, muốn đổi món:
- Cập nhật + tái cân bằng ngày đó + tái cấu trúc nếu cần.

/no_think`;

  if (isDeadlinePassed) {
    prompt += `\n\n[QUAN TRỌNG]: Đã VƯỢT DEADLINE. KHÔNG cập nhật thực đơn (luôn analyze_only). Chúc mừng thành quả và gợi ý vào LỘ TRÌNH để bắt đầu chu kỳ mới.`;
  }

  return prompt;
};

// ─── PROMPT: CASUAL ───────────────────────────────────────────────────────────

const buildCasualPrompt = (profile) =>
  `Bạn là trợ lý thân thiện của ứng dụng dinh dưỡng, luôn vui vẻ và gần gũi.
Tên người dùng: ${profile.username || "bạn"}.

Người dùng đang nhắn tin ngoài chủ đề ăn uống/dinh dưỡng.
Hãy:
- Trả lời ngắn gọn, thân thiện, tự nhiên — như người bạn thật sự.
- Nhẹ nhàng cho họ biết mình chuyên về dinh dưỡng và ăn uống.
- Nếu phù hợp, gợi ý họ hỏi mình về chủ đề sức khỏe/ăn uống.
- KHÔNG từ chối lạnh lùng, KHÔNG cứng nhắc.

TRẢ VỀ JSON THUẦN:
{"reply":"..."}
/no_think`;

// ─── POST-PROCESSING: Correct common visual misidentification ─────────────────

const VISUAL_CORRECTIONS = [
  {
    detect: /bí đao nhồi thịt|bí đao hầm thịt/i,
    signal: /gân|nhăn|đắng|khổ|mướp đắng|bitter/i,
    correct: "Khổ qua nhồi thịt",
  },
  {
    detect: /phở/i,
    signal: /sợi tròn|mắm ruốc|sả|ớt đỏ|nước đỏ|đỏ cay/i,
    correct: "Bún bò Huế",
  },
  {
    detect: /bún bò/i,
    signal: /cua|riêu|cà chua|mắm tôm|ốc/i,
    correct: "Bún riêu cua",
  },
];

const correctCommonMisidentification = (rawReply, nutritionData) => {
  if (!nutritionData?.description) return nutritionData;
  const replyLower = String(rawReply).toLowerCase();
  for (const rule of VISUAL_CORRECTIONS) {
    if (rule.detect.test(nutritionData.description) && rule.signal.test(replyLower)) {
      console.log(`[vision-correct] "${nutritionData.description}" -> "${rule.correct}" (signal matched)`);
      return { ...nutritionData, description: rule.correct };
    }
  }
  return nutritionData;
};

// ─── PROMPT: VISION / IMAGE ANALYSIS ─────────────────────────────────────────

const buildNutritionPrompt = (foodsDB = [], knowledgeBlock = "") => {
  const topFoods = Array.isArray(foodsDB) ? foodsDB.slice(0, 20) : [];
  const foodsSection = topFoods.length > 0
    ? `\nKHO MÓN ĂN (20 phổ biến nhất):\n${formatFoodsForPrompt(topFoods)}\nNếu khớp -> dùng số liệu từ đây.\n`
    : "";

  return `Bạn là chuyên gia dinh dưỡng AI, am hiểu sâu ẩm thực Việt Nam 3 miền.
Nhiệm vụ: nhìn ảnh -> nhận diện món ăn -> ước tính dinh dưỡng -> trình bày kết quả thân thiện.

NGÔN NGỮ: Trả lời 100% TIẾNG VIỆT có dấu. KHÔNG dùng chữ Hán/Trung/Nhật.

TRƯỚC KHI VIẾT (chỉ suy nghĩ nội tâm, KHÔNG in ra):
- Quan sát màu sắc, kết cấu bề mặt (gân nổi/trơn), loại sợi (dẹt=phở|tròn=bún), nước dùng, topping
- Xác định đúng tên món rồi mới viết reply

QUY TẮC NHẬN DIỆN:
• Vỏ XANH ĐẬM + GÂN NỔI/NHĂN + nhân thịt viên = Khổ qua nhồi thịt
• Vỏ XANH NHẠT + TRƠN LÁNG + thịt trắng dày = Bí đao nhồi thịt
• Nước đỏ cay + sả + mắm ruốc + sợi tròn = Bún bò Huế (KHÔNG phải phở)
• Nước đục chua + cà chua + cua = Bún riêu cua
• Cơm hạt nhỏ trên ĐĨA + sườn nướng ± trứng = Cơm tấm
• Không chắc → chọn món Việt phổ biến gần nhất, không bịa
${foodsSection}${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
NẾU KHÔNG PHẢI MÓN ĂN: trả về <error>mô tả ngắn thứ nhìn thấy</error>

NẾU LÀ MÓN ĂN — VIẾT REPLY THEO ĐÚNG CẤU TRÚC NÀY:

**[Tên món]** — [1 câu mô tả hương vị / đặc điểm nổi bật]

**Dinh dưỡng ước tính:**
Năng lượng: [X] kcal
Protein: [X]g | Chất béo: [X]g | Carbs: [X]g
Chất xơ: [X]g | Đường: [X]g | Natri: [X]mg

[1-2 câu tư vấn phù hợp mục tiêu — thân thiện, thực tế]

<data>{"calories":số,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg","description":"tên món tiếng Việt"}</data>

QUY TẮC QUAN TRỌNG:
- KHÔNG in tiêu đề "Bước", "QUAN SÁT", "NHẬN DIỆN", "ĐẦU RA" hay bất kỳ nhãn quy trình nào
- CHỈ dùng in đậm (**...**) cho TÊN MÓN và dòng "Dinh dưỡng ước tính:" — KHÔNG dùng ## hay gạch đầu dòng
- KHÔNG hỏi về bữa ăn trong phần reply ảnh
- Sau </data> KHÔNG viết thêm gì

VÍ DỤ ĐẦU RA:

**Khổ qua nhồi thịt** — món canh thanh mát, dân dã với vị đắng nhẹ đặc trưng của khổ qua.

**Dinh dưỡng ước tính:**
Năng lượng: 200 kcal
Protein: 18g | Chất béo: 8g | Carbs: 12g
Chất xơ: 3g | Đường: 2g | Natri: 400mg

Món này ít calo, giàu vitamin C và rất hợp với chế độ giảm cân. Bạn có thể ăn thoải mái mà không lo vượt mức nhé!
<data>{"calories":200,"protein":"18g","fat":"8g","carbs":"12g","fiber":"3g","sugar":"2g","sodium":"400mg","description":"Khổ qua nhồi thịt"}</data>

**Cơm tấm sườn trứng** — bữa ăn đậm đà, no lâu với lớp sườn nướng thơm lừng.

**Dinh dưỡng ước tính:**
Năng lượng: 680 kcal
Protein: 35g | Chất béo: 22g | Carbs: 82g
Chất xơ: 3g | Đường: 6g | Natri: 850mg

Món này khá đầy đủ dưỡng chất, phù hợp bữa trưa năng động. Nếu đang kiểm soát calo, bạn có thể ăn nửa phần cơm để giảm bớt nhé!
<data>{"calories":680,"protein":"35g","fat":"22g","carbs":"82g","fiber":"3g","sugar":"6g","sodium":"850mg","description":"Cơm tấm sườn trứng"}</data>

/no_think`;
};

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

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
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    };
    const resolvedDayText = formatDate(mealDayText === "hôm nay" ? now : mealDayText);
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const dayNames = ["", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"];
    const currentDayName = dayNames[dayOfWeek];

    // ── IMAGE PATH ─────────────────────────────────────────────────────────────
    if (imageFile) {
      const userContent = [];
      if (message) userContent.push({ type: "text", text: message });
      const base64Image = fs.readFileSync(imageFile.filepath).toString("base64");
      userContent.push({ type: "image_url", image_url: { url: `data:${imageFile.mimetype};base64,${base64Image}` } });

      let aiReply;
      let nutritionData = null;

      // Ưu tiên provider mạnh hơn (Gemini) nếu được cấu hình; lỗi -> tự về Qwen.
      if (visionProvider() === "gemini") {
        try {
          const food = await analyzeFoodImage({
            base64: base64Image,
            mimeType: imageFile.mimetype,
            note: message,
          });
          if (food && food.is_food === false) {
            const reply = `Ảnh này mình không nhận ra là món ăn${food.reason ? ` (mình thấy: ${food.reason})` : ""}. Bạn gửi giúp mình ảnh món ăn hoặc đồ uống nhé!`;
            return res.status(200).json({ reply, username: profile.username });
          }
          if (food && food.food) {
            nutritionData = {
              calories: food.calories,
              protein: food.protein,
              fat: food.fat,
              carbs: food.carbs,
              fiber: food.fiber,
              sugar: food.sugar,
              sodium: food.sodium,
              description: food.food,
            };
            const dd = (v) => (v && String(v).trim() ? v : "?");
            aiReply = [
              `**${food.food}**${food.amount ? ` (${food.amount})` : ""}`,
              ``,
              `**Dinh dưỡng ước tính:**`,
              `Năng lượng: ${food.calories || "?"} kcal`,
              `Protein: ${dd(food.protein)} | Chất béo: ${dd(food.fat)} | Carbs: ${dd(food.carbs)}`,
              `Chất xơ: ${dd(food.fiber)} | Đường: ${dd(food.sugar)} | Natri: ${dd(food.sodium)}`,
            ].join("\n");
          }
        } catch (e) {
          console.error("[chat-image] vision lỗi, dùng Qwen:", e.message);
        }
      }

      // Mặc định / fallback: Qwen (mô tả hội thoại + <data>)
      if (aiReply === undefined) {
        const completion = await openai.chat.completions.create({
          model: LLM_VISION_MODEL,
          messages: [
            { role: "system", content: buildNutritionPrompt(foodsDB, knowledgeBlock) },
            ...history.slice(-6),
            { role: "user", content: userContent },
          ],
          max_tokens: 1200,
          temperature: 0,
          top_p: 1,
          extra_body: { chat_template_kwargs: { enable_thinking: false } },
        });

        aiReply = stripCJK(stripThinkBlocks(completion.choices[0]?.message?.content || ""));

        // Ảnh không phải món ăn
        const errMatch = aiReply.match(/<error>([\s\S]*?)<\/error>/i);
        if (errMatch) {
          const seen = errMatch[1].trim();
          const reply = `Ảnh này mình không nhận ra là món ăn${seen ? ` (mình thấy: ${seen})` : ""}. Bạn gửi giúp mình ảnh món ăn hoặc đồ uống nhé!`;
          return res.status(200).json({ reply, username: profile.username });
        }

        aiReply = stripInternalSteps(aiReply);
        nutritionData = extractDataBlock(aiReply);
        if (nutritionData?.description) {
          nutritionData.description = stripCJK(String(nutritionData.description));
          nutritionData = correctCommonMisidentification(aiReply, nutritionData);
        }
      }
      if (nutritionData?.description) {
        const existing = findFoodInDB(foodsDB, nutritionData.description);
        if (existing) {
          nutritionData = {
            ...nutritionData,
            ...Object.fromEntries(
              ["calories", "protein", "fat", "carbs", "fiber", "sugar", "sodium"]
                .filter((k) => existing[k] != null)
                .map((k) => [k, existing[k]])
            ),
          };
        } else {
          await saveFoodRecord(nutritionData);
        }
        aiReply = `${stripDataBlocks(aiReply)}\n${buildDataTag(nutritionData)}`;
      }

      const userHistoryLabel = nutritionData?.description
        ? `Phân tích món ăn: ${nutritionData.description}`
        : message || "[Đã gửi ảnh món ăn]";

      const newHistory = truncateHistory([
        ...history,
        { role: "user", content: userHistoryLabel },
        { role: "assistant", content: aiReply },
      ], 20);

      await supabase.from("profiles").update({
        chat_history: newHistory,
        ...(nutritionData ? { last_detected_meal: nutritionData } : {}),
      }).eq("id", user.id);

      return res.status(200).json({ reply: aiReply, username: profile.username });
    }

    // ── TEXT PATH ──────────────────────────────────────────────────────────────
    let finalMessage = message;
    const isMealFollowup = followupType === "meal_time_update" && pendingMealData && mealTime;

    if (isMealFollowup) {
      finalMessage = `Bạn đã ăn ${pendingMealData.description || "món ăn"} vào buổi ${mealTime}, ngày ${resolvedDayText}.
Thông tin: Calories: ${pendingMealData.calories || "N/A"} kcal | Protein: ${pendingMealData.protein || "N/A"} | Fat: ${pendingMealData.fat || "N/A"} | Carbs: ${pendingMealData.carbs || "N/A"} | Fiber: ${pendingMealData.fiber || "N/A"} | Sugar: ${pendingMealData.sugar || "N/A"} | Sodium: ${pendingMealData.sodium || "N/A"}
Hãy cập nhật thực đơn 7 ngày tương ứng và điều chỉnh hợp lý nếu cần.`;
    }

    const intent = isMealFollowup
      ? "coach"
      : effectiveIsQueryOnly
        ? "analyze"
        : detectIntent(finalMessage);

    console.log(`[chat] intent=${intent} queryOnly=${effectiveIsQueryOnly} msg="${finalMessage.slice(0, 60)}"`);

    let aiReply = "";
    let action = "analyze_only";
    let needsClarification = false;
    let clarifyQuestion = "";
    let resultMealData = null;

    // ── CASUAL PATH ────────────────────────────────────────────────────────────
    if (intent === "casual") {
      const casualCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: buildCasualPrompt(profile) },
          ...history.slice(-4),
          { role: "user", content: finalMessage },
        ],
        response_format: { type: "json_object" },
        max_tokens: 300,
        temperature: 0.5,
        extra_body: { chat_template_kwargs: { enable_thinking: false } },
      });

      const rawContent = casualCompletion.choices[0]?.message?.content || "{}";
      const result = safeJsonParse(stripThinkBlocks(rawContent)) || {};
      aiReply = stripCJK(String(result.reply || "Haha, chủ đề này mình chưa rành lắm. Bạn hỏi mình về chuyện ăn uống đi, mình tư vấn số 1 luôn!"));
      action = "analyze_only";

    // ── ANALYZE PATH ──────────────────────────────────────────────────────────
    } else if (intent === "analyze") {
      const analyzeCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: buildAnalyzePrompt({ profile, foodsDB, knowledgeBlock }) },
          ...history.slice(-4),
          { role: "user", content: finalMessage },
        ],
        response_format: { type: "json_object" },
        max_tokens: 700,
        temperature: 0.2,
        extra_body: { chat_template_kwargs: { enable_thinking: false } },
      });

      const rawContent = analyzeCompletion.choices[0]?.message?.content || "{}";
      const result = safeJsonParse(stripThinkBlocks(rawContent)) || {};
      aiReply = stripCJK(String(result.reply || ""));
      resultMealData = (result.mealData && typeof result.mealData === "object") ? result.mealData : null;
      action = "analyze_only";

    // ── COACH PATH ────────────────────────────────────────────────────────────
    } else {
      const coachCompletion = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          {
            role: "system", content: buildCoachPrompt({
              profile, currentPlan, currentDayName, dayOfWeek,
              message: finalMessage, isQueryOnly: effectiveIsQueryOnly,
              isDeadlinePassed, foodsDB, knowledgeBlock,
            }),
          },
          ...history.slice(-6),
          { role: "user", content: finalMessage },
        ],
        response_format: { type: "json_object" },
        max_tokens: 3500,
        temperature: 0.2,
        extra_body: { chat_template_kwargs: { enable_thinking: false } },
      });

      const rawContent = coachCompletion.choices[0]?.message?.content || "{}";
      const result = safeJsonParse(stripThinkBlocks(rawContent)) || {};

      aiReply = stripCJK(String(result.reply || ""));
      action = String(result.action || "analyze_only");
      needsClarification = Boolean(result.needsClarification);
      clarifyQuestion = String(result.clarifyQuestion || "");

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
      if (resultMealData?.description) {
        resultMealData.description = stripCJK(String(resultMealData.description));
      }
    }

    if (intent !== "casual" && (action === "analyze_only" || (!needsClarification && action === "ask_clarify"))) {
      aiReply = appendMealTimeFollowUp(aiReply, finalMessage);
    }

    if (action === "analyze_only" && !isMealFollowup && resultMealData?.description) {
      aiReply = `${stripDataBlocks(aiReply)}\n${buildDataTag(resultMealData)}`;
    }

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