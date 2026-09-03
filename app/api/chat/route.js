import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase.js";
import { retrieveKnowledge, buildKnowledgeSection } from "../../../lib/knowledge.js";
import { llm as openai, LLM_MODEL, LLM_VISION_MODEL, chatBody } from "../../../lib/llm.js";
import { analyzeFoodImage, visionProvider, computeTotalsFromItems } from "../../../lib/vision.js";
// Pipeline dinh dưỡng DÙNG CHUNG với Plan (Bug #1/#4): resolveNutrition tách định
// lượng → mốc chuẩn có cache (USDA → OpenFoodFacts → tham chiếu → AI temp 0) →
// scale tuyến tính → validation Atwater. validateAndFixNutrition là fallback cuối.
import { validateAndFixNutrition, resolveNutrition } from "../../../lib/nutrition.js";
// D: lưu ảnh đã phân tích vào "Nhật ký ảnh món ăn" (fire-and-forget).
import { saveFoodPhoto } from "../../../lib/food-diary.js";
// E: ghi nhật ký sử dụng AI (fire-and-forget).
import { logUsage } from "../../../lib/usage-log.js";
import { CORS_HEADERS, corsJson, corsOptions } from "../../../lib/cors.js";

export const maxDuration = 300;

// Express-shaped `res` shim so the entire handler body below (ported from the
// old api/chat.js) keeps every `res.status(n).json(x)` call site UNCHANGED —
// `.json()` itself returns the real NextResponse the Route Handler must return.
function makeRes() {
  const self = {
    _status: 200,
    status(n) { self._status = n; return self; },
    json(body) { return corsJson(NextResponse, body, { status: self._status }); },
    end() { return new NextResponse(null, { status: self._status, headers: CORS_HEADERS }); },
    setHeader() { return self; },
  };
  return self;
}

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

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

// Vá JSON bị CẮT CỤT (model chạm max_tokens giữa chừng): items nằm CUỐI object
// nên gần như mọi ca cắt cụt rơi vào giữa items → bỏ hẳn đuôi items rồi đóng "}".
// Không được thì thử cắt tại từng "}" từ cuối lên và tự đóng các ngoặc còn thiếu.
const repairTruncatedJson = (raw) => {
  const s = String(raw || "").trim();
  if (!s.startsWith("{")) return null;
  const tryP = (t) => { try { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1")); } catch { return null; } };
  // 1) Bỏ đuôi items dở dang, giữ các field tổng phía trước
  const noItems = s.replace(/,\s*"items"\s*:\s*\[[\s\S]*$/, "}");
  if (noItems !== s) { const p = tryP(noItems); if (p) return p; }
  // 2) Cắt tại từng "}" từ CUỐI về đầu, đếm ngoặc ngoài chuỗi rồi tự đóng phần thiếu
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] !== "}") continue;
    let cand = s.slice(0, i + 1);
    let dObj = 0, dArr = 0, inStr = false, esc = false, bad = false;
    for (const ch of cand) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") dObj++;
      else if (ch === "}") dObj--;
      else if (ch === "[") dArr++;
      else if (ch === "]") dArr--;
      if (dObj < 0 || dArr < 0) { bad = true; break; }
    }
    if (bad || inStr) continue;
    const p = tryP(cand + "]".repeat(dArr) + "}".repeat(dObj));
    if (p) return p;
  }
  return null;
};

// Tolerant <data> extractor
const extractDataBlock = (text = "") => {
  const s = String(text);
  const tryParse = (raw) => {
    if (!raw) return null;
    try { return JSON.parse(raw.trim().replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
  };
  let m = s.match(/<data>([\s\S]*?)<\/data>/i);
  if (m) {
    const p = tryParse(m[1]) || repairTruncatedJson(m[1]);
    if (p) return p;
  }
  // <data> mở nhưng THIẾU </data> (reply bị cắt cụt) → vá phần JSON còn lại
  m = s.match(/<data>\s*(\{[\s\S]*)$/i);
  if (m) { const p = tryParse(m[1]) || repairTruncatedJson(m[1]); if (p && p.description) return p; }
  m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) { const p = tryParse(m[1]); if (p && ("calories" in p || "description" in p)) return p; }
  // Khối {} lớn nhất (GREEDY — object có items lồng nhau cần match tới } cuối)
  m = s.match(/\{[\s\S]*\}/);
  if (m) {
    const p = tryParse(m[0]) || repairTruncatedJson(m[0]);
    if (p && p.description != null && p.calories != null) return p;
  }
  // Quét từng object nhỏ — bắt buộc có description để KHÔNG nhặt nhầm phần tử
  // items con (chúng có "calories_per_unit" nên cũng khớp /calories/).
  for (const obj of (s.match(/\{[\s\S]*?\}/g) || [])) {
    if (/["']?calories["']?\s*:/.test(obj) && /["']?description["']?\s*:/.test(obj)) {
      const p = tryParse(obj);
      if (p) return p;
    }
  }
  return null;
};

// Bóc phản hồi JSON của model một cách CHỊU LỖI. Model local (qwen VL) thỉnh
// thoảng trả về: (a) kèm 1 khối <think>…</think> lạc ra ngoài, (b) JSON bị CẮT
// CỤT do chạm max_tokens (rõ nhất ở coach vì newPlan rất dài), hoặc (c) trả
// PROSE thay vì JSON như yêu cầu. Trước đây cả 3 ca đều rơi về reply RỖNG →
// bong bóng "Xin lỗi, mình chưa xử lý được câu này". Hàm này luôn cố cứu ra một
// object có "reply" dùng được (song song với độ bền của nhánh vision).
// Model "degenerate": lặp vô hạn 1 ký tự (!!!!!, 44444) hoặc 1 cụm ngắn cho tới
// khi chạm max_tokens → JSON hỏng dạng {"!!!!!!!…". Thu gọn các đoạn lặp bất
// thường để phần JSON hợp lệ PHÍA TRƯỚC còn parse/salvage được. CHỈ dùng ở nhánh
// salvage (sau khi parse thường đã hỏng) nên không đụng vào JSON hợp lệ.
const collapseDegenerate = (s = "") =>
  String(s)
    .replace(/([^\s\\])\1{6,}/g, "$1$1$1")   // 1 ký tự lặp ≥7 lần → 3
    .replace(/(\S{2,4})\1{5,}/g, "$1$1");     // cụm 2-4 ký tự lặp ≥6 lần → 2

// Chuỗi "rác" (quá ngắn, còn đoạn lặp, hoặc <40% là chữ/số) → coi như KHÔNG có
// reply để rơi về câu fallback thân thiện thay vì hiện "!!! / {"!!! ra UI.
const looksJunkReply = (s = "") => {
  const t = String(s).trim();
  if (t.length < 2) return true;
  // Chặn các ca model tự lặp: "!!!!", "!!!!!!", "444444", "okokok..."
  if (/([^\s\\])\1{4,}/.test(t)) return true;
  if (/(\S{2,8})\1{4,}/.test(t)) return true;
  // Nếu gần như toàn dấu câu/ký tự rác thì không được xem là reply hợp lệ.
  const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  return letters < Math.max(2, t.length * 0.4);
};

const safeReplyText = (s = "") => {
  const t = stripCJK(stripThinkBlocks(stripDataBlocks(String(s || "")))).trim();
  return looksJunkReply(t) ? "" : t;
};

const buildAnalyzeFallbackReply = ({ mealData, profile, finalMessage = "", isEn = false }) => {
  const name = stripCJK(String(mealData?.description || mealData?.food || "")).trim();
  if (name) {
    const advice = buildShortAdvice(mealData, profile, isEn ? "English" : "");
    return isEn
      ? `${name} — ${advice}`
      : `${name} — ${advice}`;
  }
  const msg = String(finalMessage || "").trim();
  return isEn
    ? `I can help with that nutrition question. If you want exact calories and macros, tell me the food name plus the amount you ate.`
    : `Mình có thể hỗ trợ câu hỏi dinh dưỡng này. Nếu bạn muốn tính calo và macro chính xác, hãy gửi tên món kèm định lượng bạn ăn nhé.`;
};

const buildCasualFallbackReply = ({ profile, isEn = false }) => {
  const name = stripCJK(String(profile?.username || (isEn ? "friend" : "bạn"))).trim();
  return isEn
    ? `Hi ${name}! I’m here and ready to help with food, calories, macros, or meal planning.`
    : `Chào ${name}! Mình đây, sẵn sàng hỗ trợ bạn về món ăn, calo, macro hoặc thực đơn nhé.`;
};

const buildCoachFallbackReply = ({ isMealFollowup = false, pendingMealData = null, mealTime = "", isEn = false }) => {
  const name = stripCJK(String(pendingMealData?.description || (isEn ? "that dish" : "món đó"))).trim();
  if (isMealFollowup && pendingMealData?.description) {
    return isEn
      ? `Logged ${name} for ${mealTime || "that meal"}. I’ve updated the plan based on what you ate.`
      : `Mình đã ghi nhận ${name} cho bữa ${mealTime || "này"} và cập nhật thực đơn theo món bạn đã ăn.`;
  }
  return isEn
    ? `I couldn’t update the meal plan automatically just now. Please tell me the day, meal, and dish again so I can adjust it.`
    : `Mình chưa cập nhật thực đơn tự động được ở lượt này. Bạn gửi lại giúp mình ngày, bữa và món muốn đổi để mình chỉnh nhé.`;
};

const parseModelJson = (rawContent) => {
  const cleaned = stripThinkBlocks(String(rawContent || "")).trim();
  if (!cleaned) return {};

  // 1) parse thẳng
  let obj = safeJsonParse(cleaned);

  // 2) JSON nằm trong ```code``` , lẫn trong text, hoặc bị cắt cụt/degenerate.
  //    Thử cả bản gốc lẫn bản đã thu gọn đoạn lặp (chống {"!!!!…).
  const salvage = (src) => {
    const fenced = src.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) { const p = safeJsonParse(fenced[1]) || repairTruncatedJson(fenced[1]); if (p) return p; }
    const braced = src.match(/\{[\s\S]*\}/);
    if (braced) { const p = safeJsonParse(braced[0]) || repairTruncatedJson(braced[0]); if (p) return p; }
    return repairTruncatedJson(src);
  };
  if (!obj || typeof obj !== "object") obj = salvage(cleaned);
  if (!obj || typeof obj !== "object") obj = salvage(collapseDegenerate(cleaned));

  if (obj && typeof obj === "object") {
    // JSON cắt cụt NGAY GIỮA chuỗi "reply" → repair có thể mất field reply. Vá lại.
    if (obj.reply == null || obj.reply === "") {
      const rm = collapseDegenerate(cleaned).match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (rm) {
        let val; try { val = JSON.parse(`"${rm[1].replace(/"+\s*$/, "")}"`); } catch { val = rm[1]; }
        if (!looksJunkReply(val)) obj.reply = val;
      }
    }
    return obj;
  }

  // 3) Hoàn toàn không phải JSON → lấy field "reply" nếu có, nếu không dùng chính prose.
  const collapsed = collapseDegenerate(cleaned);
  const rm = collapsed.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
  if (rm) {
    let val; try { val = JSON.parse(`"${rm[1].replace(/"+\s*$/, "")}"`); } catch { val = rm[1]; }
    if (!looksJunkReply(val)) return { reply: val };
  }
  const prose = stripDataBlocks(collapsed).replace(/^[`\s]*\{?\s*/, "").replace(/[`\s}]*$/, "").trim();
  return { reply: looksJunkReply(prose) ? "" : prose };
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
    // Khẩu phần đã tính (vd "2 quả", "300ml") — client hiện tại bỏ qua field lạ
    // nên an toàn; giữ lại để hiển thị/ghi nhận đúng định lượng về sau.
    ...(n.amount ? { amount: n.amount } : {}),
    // Độ tin cậy nhận diện → client dùng để hiển thị KHOẢNG dinh dưỡng (min-max).
    ...(n.confidence ? { confidence: n.confidence } : {}),
  })}</data>`;

// Quét lịch sử chat từ DƯỚI LÊN, lấy MÓN ĐÃ PHÂN TÍCH gần nhất (khối <data> ở tin
// nhắn assistant mới nhất). Đây là nguồn "đúng thứ tự" cho tính năng "phân tích lại
// món gần nhất" — chính xác hơn last_detected_meal (có thể bị lệch).
const findLastAnalyzedMealFromHistory = (history = []) => {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m || m.role !== "assistant") continue;
    const data = extractDataBlock(String(m.content || ""));
    if (data && (data.description || data.calories != null)) return data;
  }
  return null;
};

// Xoá ký tự CJK
const stripCJK = (text = "") =>
  String(text)
    .replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uFF00-\uFF9F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();

// Khẩu phần "chuẩn 1 suất" (1 phần/tô/bát/đĩa/ổ/ly...) — chỉ khi đó mới dùng số liệu
// foods DB (override) hoặc lưu ngược vào DB. Khẩu phần lẻ ("1 miếng", "nửa bát"...)
// giữ nguyên số vision tính theo ảnh (tránh 1 miếng sushi bị đè thành cả phần 350kcal
// và tránh làm nhiễm foods DB — lỗi "AI bị loạn").
const isStandardPortion = (amount = "") => {
  const a = String(amount || "").toLowerCase().trim();
  if (!a) return true; // không rõ khẩu phần -> giữ hành vi cũ
  return /^(1|một|mot)\s*(phần|phan|tô|to|bát|bat|chén|chen|đĩa|dĩa|dia|ổ|o|ly|cốc|coc|hộp|hop|suất|suat)(?!\p{L})/u.test(a)
    && !/(?<!\p{L})(nhỏ|nho|mini|bé|be)(?!\p{L})/u.test(a);
};

const stripDataBlocks = (text = "") =>
  String(text)
    .replace(/<data>[\s\S]*?<\/data>/gi, "")
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .replace(/\{[^{}]*["']?calories["']?\s*:[\s\S]*?\}/gi, "")
    .replace(/^\s*(Dữ liệu ước tính|Dữ liệu dinh dưỡng|Ước tính dinh dưỡng|Thông tin dinh dưỡng|Khối dữ liệu|JSON)\s*:?\s*$/gim, "")
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

const MEAL_TIME_REGEX = /\b(sáng|trưa|chiều|tối|bữa phụ|bua phu|ăn lúc|lúc nào|mấy giờ|breakfast|lunch|dinner|snack)\b/i;
const FOLLOW_UP_VI = "Bạn có thể cho mình biết bạn ăn vào sáng, trưa, tối hay bữa phụ không?";
const FOLLOW_UP_EN = "Could you let me know whether you had this for breakfast, lunch, dinner, or as a snack?";
const followUpText = (lang) => (lang === "en" ? FOLLOW_UP_EN : FOLLOW_UP_VI);

// Lỗi #2: chỉ hỏi "ăn vào bữa nào" khi người dùng THỰC SỰ vừa ăn / muốn GHI NHẬN một món.
// Câu hỏi kiến thức, chỉnh sửa tên món, hay trò chuyện thường → KHÔNG hỏi bữa ăn.
// Dùng ranh giới \p{L} (cờ 'u') vì \b của JS hỏng với dấu tiếng Việt ("ăn", "uống"...).
const EATEN_INTENT_RE = new RegExp(
  `(?<!\\p{L})(?:ăn|uống|nhậu|măm|mằm|đớp|chén|nạp|thưởng thức|dùng bữa|ate|eat|eaten|eating|drank|drink|drinking|had (?:a|some|this|it)|just had)(?!\\p{L})`,
  "iu"
);

// Loại bỏ câu hỏi "bạn ăn vào bữa nào" (do model tự chèn) khi KHÔNG phải tình huống ghi nhận
// bữa ăn. Xoá cả câu canned lẫn biến thể model tự sinh (câu kết thúc bằng "?" có từ khoá bữa ăn).
const stripMealTimeQuestion = (reply = "") => {
  let t = String(reply);
  t = t.split(FOLLOW_UP_VI).join("").split(FOLLOW_UP_EN).join("");
  t = t.replace(
    /[^.!?\n]*?(sáng[,\s]+trưa|trưa[,\s]+tối|bữa nào|bữa phụ không|ăn vào (?:buổi|bữa|sáng|lúc)|which meal|breakfast[,\s]+lunch|for breakfast, lunch)[^.!?\n]*[?？]/gi,
    ""
  );
  return t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
};

// Ghép ngữ cảnh hội thoại gần đây (món đã nhận diện trước + tin nhắn/chỉnh sửa của người dùng)
// để cấp cho model vision khi người dùng gửi LẠI ảnh (Lỗi #1: "AI không thấy dữ liệu cũ").
const buildVisionContextNote = (history = [], lastMeal = null, isEn = false) => {
  const parts = [];
  if (lastMeal?.description) {
    parts.push(isEn
      ? `Earlier in this chat, this dish was identified as "${lastMeal.description}". The user may be re-sending the image to correct that. Re-examine the image and honor any correction the user makes below.`
      : `Trước đó trong cuộc trò chuyện, món này từng được nhận diện là "${lastMeal.description}". Người dùng có thể gửi lại ảnh để chỉnh lại kết quả này. Hãy nhìn kỹ lại ảnh và tôn trọng chỉnh sửa của người dùng ở bên dưới.`);
  }
  const recentUser = (Array.isArray(history) ? history : [])
    .filter((m) => m?.role === "user")
    .map((m) => stripCJK(String(m.content || "")).trim())
    .filter(Boolean)
    .slice(-3);
  if (recentUser.length) {
    parts.push((isEn
      ? "Recent messages from the user (may contain the correction):"
      : "Các tin nhắn gần đây của người dùng (có thể chứa phần chỉnh sửa):")
      + "\n" + recentUser.map((s) => `- ${s}`).join("\n"));
  }
  return parts.join("\n\n");
};

const appendMealTimeFollowUp = (reply, message, lang = "vi") => {
  const followUp = followUpText(lang);
  const text = String(reply || "").trim();
  if (!text) return followUp;
  if (MEAL_TIME_REGEX.test(String(message || ""))) return text;
  const lower = text.toLowerCase();
  if (
    lower.includes("sáng, trưa, tối hay bữa phụ") ||
    lower.includes("bạn có thể cho") ||
    lower.includes("bữa phụ không") ||
    lower.includes("ăn vào lúc nào") ||
    lower.includes("breakfast, lunch, dinner") ||
    lower.includes("which meal") ||
    lower.includes("for breakfast")
  ) return text;
  return `${text}\n\n${followUp}`;
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
    // Provenance (A+B): ghi rõ nguồn + độ tin để lookup xếp hạng & chống nhiễm.
    // Món do vision/AI tích luỹ → chưa verify; admin duyệt sau (bundle F).
    source: meal.source && String(meal.source).length <= 20 ? String(meal.source) : "ai",
    confidence: ["high", "medium", "low"].includes(meal.confidence) ? meal.confidence : "medium",
    verified: false,
  };
};

// Xếp hạng nguồn (đồng bộ SOURCE_RANK trong lib/nutrition.js). verified = cao nhất.
const FOODS_SRC_RANK = { manual: 6, usda: 5, off: 4, vn_ref: 4, foods: 2, db: 2, ai: 1 };
const foodsRank = (src, verified) =>
  verified ? 100 : (FOODS_SRC_RANK[String(src || "").toLowerCase()] ?? 0);

const saveFoodRecord = async (meal) => {
  try {
    const record = normalizeFoodRecord(meal);
    if (!record.description || record.calories == null) return;
    const { data: existing } = await supabase.from("foods").select("id, source, verified")
      .eq("description", record.description).maybeSingle();
    // Mặc định GIỮ NGUYÊN (Bug #1 — determinism): cùng một món luôn ra cùng số giữa
    // các ngày, không để LLM đè số mới mỗi lần. NGOẠI LỆ (H2): nếu bản ghi cũ là
    // 'ai'/chưa verify mà bản mới đến từ NGUỒN HẠNG CAO HƠN (USDA/OFF/vn_ref/manual
    // hoặc đã verify) → cho phép NÂNG CẤP để sửa số sai bị "đóng băng" từ lần đầu.
    // Nguồn ngang hoặc thấp hơn KHÔNG được đè (giữ determinism).
    if (existing) {
      if (foodsRank(record.source, record.verified) > foodsRank(existing.source, existing.verified)) {
        const { error } = await supabase.from("foods").update(record).eq("id", existing.id);
        if (error) console.log("Nâng cấp foods thất bại:", error.message);
      }
      return;
    }
    const { error } = await supabase.from("foods").insert(record).select();
    if (error) console.log("Thêm thất bại:", error.message);
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

// Bảng foods TỰ PHÌNH (mỗi món phân tích 1 suất chuẩn được insert) → không được
// tải vô hạn mỗi request. Ưu tiên dòng đã verify, rồi dùng nhiều nhất, và cap lại.
// Món hiếm không lọt cap vẫn được resolveNutrition tính lại (deterministic) nên
// không mất tính năng, chỉ mất "override từ DB" cho vài món ít gặp.
const FOODS_DB_CAP = 2000;
const fetchFoodsDB = async () => {
  try {
    const { data, error } = await supabase.from("foods")
      .select("description, calories, protein, fat, carbs, fiber, sugar, sodium, source, confidence, verified")
      .order("verified", { ascending: false })
      .order("hit_count", { ascending: false })
      .limit(FOODS_DB_CAP);
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

// So khớp tên món với foods DB: CHỈ khớp CHÍNH XÁC sau khi chuẩn hóa (bỏ dấu,
// gộp khoảng trắng). Bỏ khớp mờ includes() hai chiều — nó khiến "Sushi cá hồi"
// lấy nhầm số liệu của "Sushi" (và ngược lại) → sai món / sai số (Bug #1/#3).
const normFoodKey = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const findFoodInDB = (foods, name = "") => {
  const needle = normFoodKey(name);
  if (!Array.isArray(foods) || !needle) return null;
  return foods.find((f) => normFoodKey(f.description) === needle) || null;
};

// ─── INTENT DETECTION ────────────────────────────────────────────────────────

// Từ chỉ ĐƠN VỊ / HÀNH ĐỘNG ăn uống — KHÔNG nêu tên món nào.
const FOOD_GENERIC_WORDS =
  "ăn|uống|món|tô|bát|đĩa|ly|cốc|miếng|phần|gram|kg|kcal|calo|bữa|protein";
// Từ NÊU ĐÍCH DANH một món / nguyên liệu.
const FOOD_DISH_WORDS =
  "phở|bún|cơm|bánh|thịt|cá|rau|trái|quả|sữa|trứng|đậu|gà|heo|bò|tôm|mực|ốc|canh|lẩu|xôi|cháo|mì|hủ tiếu|pizza|burger|kfc|sandwich|salad|yogurt|yến mạch|oats|smoothie|sinh tố";

// PHẢI dùng (?<!\p{L}) … (?!\p{L}) với cờ 'u', KHÔNG được dùng \b.
//
// \b của JS chỉ biết [A-Za-z0-9_], nên chữ có dấu bị coi là KHÔNG phải chữ và
// sinh ra ranh giới giả ngay giữa từ. Hậu quả đo được: /\btô\b/ KHỚP vào chữ
// "tôi" (ranh giới giả nằm giữa "ô" và "i"). Mà gần như mọi câu tiếng Việt đều
// bắt đầu bằng "tôi", nên MỌI tin nhắn đều bị xếp là "có nhắc tới món ăn":
// "tôi bị gan nhiễm mỡ" cũng bị đưa vào nhánh phân tích món, rồi cả câu đó bị
// đem đi tra dinh dưỡng và hiện thẻ calo + bảng xác nhận bữa ăn.
const FOOD_MENTION_RE = new RegExp(
  `(?<!\\p{L})(?:${FOOD_GENERIC_WORDS}|${FOOD_DISH_WORDS})(?!\\p{L})`, "iu");
const FOOD_DISH_RE = new RegExp(`(?<!\\p{L})(?:${FOOD_DISH_WORDS})(?!\\p{L})`, "iu");

// Câu XIN LỜI KHUYÊN / khai bệnh — KHÔNG phải câu khai báo một món vừa ăn.
// "tôi bị tiểu đường thì nên ăn gì" có chữ "ăn" nhưng không nêu món nào; đem cả
// câu đi tra dinh dưỡng thì ra một thẻ calo vô nghĩa.
const ADVICE_QUESTION_RE = new RegExp(
  "(?<!\\p{L})(?:" +
  "(?:nên|không nên|có nên|được|có được|nên tránh|kiêng)\\s+(?:ăn|uống)|" +
  "(?:ăn|uống)\\s+(?:gì|j|thế nào|như thế nào|sao|được không|đc không)|" +
  "(?:tôi|mình|em|con|cháu|bố|mẹ|ba|má)\\s+(?:bị|mắc|đang bị|hay bị)|" +
  "mắc bệnh|bệnh lý|tiểu đường|đái tháo đường|gan nhiễm mỡ|mỡ máu|" +
  "huyết áp|dạ dày|gout|gút|suy thận|tim mạch|cholesterol" +
  ")(?!\\p{L})", "iu");
// Chỉ những câu THỰC SỰ muốn đổi thực đơn mới vào nhánh coach (nặng). Các câu kiểu
// "lỡ ăn / vừa ăn" là GHI NHẬN món -> để nhánh analyze (nhanh) xử lý + hỏi lại bữa.
const UPDATE_RE = /\b(đổi|sửa|thay|cập nhật|thứ [2-7]|chủ nhật|ngày mai|thực đơn|kế hoạch ăn)\b/i;
// NGƯỜI DÙNG MUỐN TẠO LẠI TOÀN BỘ thực đơn tuần (không phải chỉnh 1 bữa). Yêu cầu
// động từ tạo/làm/lên... + "lại|mới" gần với danh từ kế hoạch → tránh nhầm "đổi bữa trưa".
const FULL_REGEN_RE = /\b(tạo|làm|lên|dựng|xây|lập)\b[^\n]{0,15}\b(lại|mới)\b[^\n]{0,15}\b(thực đơn|lịch ăn|kế hoạch|menu|lộ trình)\b|\b(tạo|làm|lên|dựng|xây|lập)\b[^\n]{0,15}\b(thực đơn|lịch ăn|kế hoạch|menu|lộ trình)\b[^\n]{0,10}\b(mới|lại)\b/i;
const CASUAL_RE = /\b(thời tiết|bóng đá|phim|nhạc|code|lập trình|chính trị|kinh tế|đầu tư|crypto|game|trò chơi|học|thi|công việc|tình yêu|yêu|hẹn hò|du lịch|vui|buồn|chán|stress|mệt|ngủ)\b/i;

const detectIntent = (message = "") => {
  const msg = String(message);
  if (UPDATE_RE.test(msg)) return "coach";
  // Hỏi nên ăn gì / khai bệnh → câu hỏi DINH DƯỠNG, cho vào nhánh analyze.
  // Để rơi xuống "coach" (mặc định cuối hàm) thì vừa nặng hơn (2500 token) vừa
  // là nhánh DUY NHẤT được phép ghi đè weekly_plan — không đáng rủi ro cho một
  // câu hỏi kiến thức.
  if (ADVICE_QUESTION_RE.test(msg)) return "analyze";
  if (FOOD_MENTION_RE.test(msg)) return "analyze";
  if (CASUAL_RE.test(msg)) return "casual";
  return "coach";
};

// Người dùng muốn xem/phân tích LẠI món vừa phân tích gần nhất (không gửi ảnh mới).
// Vd: "phân tích lại món gần nhất", "món vừa rồi", "ảnh ban nãy", "analyze my latest meal"...
// Bắt rộng: 1 từ chỉ "gần nhất" (VN + EN) đứng GẦN 1 từ chỉ món/ảnh/phân tích (≤40 ký tự),
// theo cả 2 chiều. Giới hạn khoảng cách để KHÔNG bắt nhầm câu phân tích món thường.
const RECALL_REC =
  "(gần nhất|gần đây nhất|gần đây|mới nhất|mới đây|cuối cùng|vừa rồi|vừa nãy|vừa xong|ban nãy|lúc nãy|khi nãy|hồi nãy|nãy giờ|trước đó|lúc trước|hồi trước|(?:vừa|mới|vừa mới)\\s+(?:gửi|gởi|ăn|hỏi|nhắn|chụp|đăng|up|upload|uploaded|sent|phân tích)|latest|lastest|last|previous|prior|recent|most recent|just\\s+(?:now|sent|uploaded|analyzed|asked))";
const RECALL_NOUN =
  "(món ăn|món|bữa ăn|bữa|tấm ảnh|bức ảnh|ảnh|hình|phân tích|dish|meal|food|image|photo|picture)";
// "phân tích lại / xem (xét) lại / coi lại / re-analyze"... tự thân đã là ý muốn xem lại
// món trước đó. Bắt rộng nhiều động từ + "lại" (khoảng cách ≤15 ký tự để chèn "giúp mình"...).
const RECALL_REANALYZE =
  "(?:(?:phân tích|phân tích giúp|xem xét|xem|coi|kiểm tra|đánh giá|tính)[\\s\\S]{0,15}lại)|(?:nhắc lại)|(?:re-?analy[sz]e)|(?:analy[sz]e[\\s\\S]{0,10}again)";
// "món (ăn) trước / (đó)", "tấm ảnh trước"... — danh từ chỉ món/ảnh đứng ngay trước "trước".
// (?!\\s*khi) để KHÔNG bắt "trước khi ăn" (chỉ thời điểm, không phải nhắc lại món cũ).
const RECALL_NOUN_PREV =
  `(?:${RECALL_NOUN})[\\s\\S]{0,25}trước(?!\\s*khi)(?:\\s+đó)?`;
const RECALL_RECENT_RE = new RegExp(
  `(?:${RECALL_REC}[\\s\\S]{0,40}${RECALL_NOUN})|(?:${RECALL_NOUN}[\\s\\S]{0,40}${RECALL_REC})|(?:${RECALL_REANALYZE})|(?:${RECALL_NOUN_PREV})`,
  "i"
);

// Nếu tin nhắn NÊU ĐÍCH DANH một món cụ thể (phở, cơm, pizza...) hoặc đang nói về THỰC ĐƠN/
// KẾ HOẠCH thì người dùng muốn phân tích/đổi CHÍNH thứ đó — KHÔNG phải "nhắc lại món trước".
// Dùng ranh giới \p{L} (cờ 'u') thay cho \b: \b của JS hỏng với dấu tiếng Việt — "mì" sẽ khớp
// nhầm trong "mình", còn "phở"/"bò" (kết thúc bằng nguyên âm có dấu) lại KHÔNG khớp được.
const RECALL_BLOCK_TOKENS =
  "phở|bún|cơm|bánh|thịt|cá|rau|sữa|trứng|đậu|gà|heo|bò|tôm|mực|ốc|canh|lẩu|xôi|cháo|mì|hủ tiếu|pizza|burger|kfc|sandwich|salad|yogurt|yến mạch|oats|smoothie|sinh tố|taco|sushi|ramen|pasta|steak|tteokbokki|gimbap|thực đơn|kế hoạch|lộ trình|plan|menu|lịch|schedule";
const RECALL_BLOCK_RE = new RegExp(`(?<!\\p{L})(?:${RECALL_BLOCK_TOKENS})(?!\\p{L})`, "iu");

// ─── PROMPT: ANALYZE ─────────────────────────────────────────────────────────

const buildAnalyzePrompt = ({ profile, foodsDB, knowledgeBlock = "", langInstruction = "", recentMealBlock = "" }) => {
  const topFoods = Array.isArray(foodsDB) ? foodsDB.slice(0, 20) : [];
  const isEn = /english/i.test(langInstruction);

  if (isEn) {
    const foodsSection = topFoods.length > 0
      ? `\nFOOD DATABASE (top 20):\n${formatFoodsForPrompt(topFoods)}\nIf the dish matches, use these stored values and note "(from saved data)".\n`
      : "";
    return `LANGUAGE — ABSOLUTE RULE: Every field in the JSON reply MUST be in natural English. The "reply" string in particular must be 100% English — no Vietnamese sentences, no Vietnamese headings. Keep authentic Vietnamese dish names (Phở, Bánh mì, Bún bò Huế, Gỏi cuốn, Cơm tấm...) as proper nouns.

You are an AI nutrition expert with deep knowledge of Vietnamese and international cuisine — friendly and thorough.

USER INFO: Goal: ${profile.goal ?? "N/A"} | Calories/day: ${profile.target_calories || "1500-1800"} kcal | Condition: ${profile.disease || "none"}.
${recentMealBlock}${foodsSection}${knowledgeBlock ? knowledgeBlock + "\n" : ""}
TASK: The user mentioned a food or asked a nutrition/health question. You must:
1. Identify the dish and estimate calories, protein, fat, carbs fully.
2. Briefly assess how well it fits the user's goal.
3. If needed, suggest small adjustments (what to pair, what to avoid) — practical and useful.
4. Fill mealData fully if the user mentioned a specific dish.

REPLY RULES:
- Friendly, natural, like a nutrition-savvy friend. Not stiff.
- Do NOT list calorie/protein/fat/carbs numbers in the reply — those appear in the nutrition card on the right.
- Only state the DISH NAME + practical ADVICE (1-2 sentences).
- No markdown (no ###, no **bold**, no bullets).
- If it is a general knowledge question (no specific dish) → answer clearly, no mealData.
- Only ask "which meal did you eat it at (breakfast/lunch/dinner/snack)?" when the user CLEARLY says they JUST ATE / ATE a dish to log it. If it is a knowledge question, a name correction, or small talk → NEVER ask about meal time.

RETURN PURE JSON (no markdown, no \`\`\`):
{"reply":"...","mealData":{"calories":number,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg","description":"dish name (WITHOUT quantity)","amount":"EXACT amount the user stated"}}

mealData RULES (IMPORTANT):
- "description": ONLY the base dish name, NO quantity (e.g. "Banana", NOT "2 bananas").
- "amount": copy EXACTLY the amount the user stated ("2 pieces", "300ml", "half a bowl", "3 slices"...). If not stated → "1 serving".
- The system will recompute the final numbers from description + amount — just give your best estimate.
- CONSISTENCY: mealData.calories MUST be the TOTAL for the ENTIRE amount the user stated (e.g. "2 bananas" → total for 2, not per banana). Protein/fat/carbs/fiber/sugar/sodium likewise are TOTALS for that amount. If — against the rules — the reply mentions any calorie/macro number, it MUST equal mealData.calories exactly. Never let the reply text and the card disagree.

If no specific dish: {"reply":"...","mealData":null}

EXAMPLE — "I just ate a bowl of pho":
{"reply":"Pho is fairly balanced in protein and carbs — a solid breakfast or lunch. If you're cutting weight, try not to finish the broth since it can be salty.","mealData":{"calories":450,"protein":"30g","fat":"12g","carbs":"55g","fiber":"3g","sugar":"5g","sodium":"900mg","description":"Phở bò","amount":"1 bowl"}}
EXAMPLE — "I had 300ml of chocolate milk":
{"reply":"Chocolate milk tastes great but is quite sugary — mornings or post-workout are the best time to have it.","mealData":{"calories":240,"protein":"10g","fat":"8g","carbs":"32g","fiber":"0g","sugar":"30g","sodium":"165mg","description":"Chocolate milk","amount":"300ml"}}

ONLY JSON, no other text. /no_think`;
  }

  const foodsSection = topFoods.length > 0
    ? `\nKHO MÓN ĂN (20 món phổ biến nhất):\n${formatFoodsForPrompt(topFoods)}\nNếu món khớp → dùng số liệu từ đây, ghi "(theo dữ liệu đã lưu)".\n`
    : "";

  return `NGÔN NGỮ — BẮT BUỘC: Toàn bộ chuỗi "reply" trong JSON PHẢI 100% TIẾNG VIỆT có dấu. KHÔNG có câu tiếng Anh nào (trừ tên món quốc tế). Giữ nguyên tên món Việt đặc trưng.

Bạn là chuyên gia dinh dưỡng AI, am hiểu sâu ẩm thực Việt Nam 3 miền, luôn thân thiện và tư vấn đến nơi đến chốn.

THÔNG TIN NGƯỜI DÙNG: Mục tiêu: ${profile.goal ?? "N/A"} | Calo/ngày: ${profile.target_calories || "1500-1800"} kcal | Bệnh lý: ${profile.disease || "không có"}.
${recentMealBlock}${foodsSection}${knowledgeBlock ? knowledgeBlock + "\n" : ""}
NHIỆM VỤ: Người dùng nhắc đến một món ăn hoặc hỏi về dinh dưỡng/sức khỏe ăn uống. Hãy:
1. Nhận diện món và ước lượng calo, protein, fat, carbs đầy đủ.
2. Nhận xét ngắn gọn về mức độ phù hợp với mục tiêu của người dùng.
3. Nếu cần, gợi ý điều chỉnh nhỏ (ăn kèm gì, tránh gì) — thực tế và hữu ích.
4. Điền mealData đầy đủ nếu người dùng nhắc một món cụ thể.

QUY TẮC REPLY:
- Thân thiện, tự nhiên như người bạn hiểu dinh dưỡng. Không cứng nhắc.
- KHÔNG liệt kê số calo/protein/fat/carbs trong reply — thông tin đó đã hiển thị ở thẻ dinh dưỡng bên phải.
- Chỉ nêu TÊN MÓN + LỜI TƯ VẤN thực tế (1-2 câu).
- Không dùng markdown (không ###, không **bold**, không gạch đầu dòng).
- Nếu là câu hỏi kiến thức chung (không nhắc món cụ thể) → trả lời rõ ràng, không có mealData.
- CHỈ hỏi "bạn ăn vào bữa nào (sáng/trưa/tối/bữa phụ)" khi người dùng NÓI RÕ HỌ VỪA/ĐÃ ĂN một món để GHI NHẬN. Nếu chỉ hỏi kiến thức, chỉnh sửa/góp ý tên món, hay trò chuyện → TUYỆT ĐỐI KHÔNG hỏi về bữa ăn.

TRẢ VỀ JSON THUẦN (KHÔNG markdown, KHÔNG dấu \`\`\`):
{"reply":"...","mealData":{"calories":số,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg","description":"tên món (KHÔNG kèm số lượng)","amount":"ĐÚNG định lượng người dùng nói"}}

QUY TẮC mealData (QUAN TRỌNG):
- "description": CHỈ tên món gốc, KHÔNG chứa số lượng (vd "Chuối", KHÔNG phải "2 quả chuối").
- "amount": chép ĐÚNG định lượng người dùng nêu ("2 quả", "300ml", "nửa tô", "3 lát"...). Không nêu → "1 phần".
- Hệ thống sẽ TỰ tính lại con số cuối cùng từ description + amount — bạn cứ điền ước tính tốt nhất.
- NHẤT QUÁN: mealData.calories PHẢI là TỔNG cho ĐÚNG định lượng người dùng nêu (vd "2 quả chuối" → tổng cho 2 quả, không phải 1 quả). Protein/fat/carbs/fiber/sugar/sodium cũng là TỔNG theo định lượng đó. Nếu — trái quy tắc — trong reply có bất kỳ số calo/macro nào, số đó PHẢI khớp CHÍNH XÁC với mealData.calories. TUYỆT ĐỐI KHÔNG được để chữ nói một tổng và thẻ hiển thị tổng khác.

Nếu không có món cụ thể: {"reply":"...","mealData":null}

VÍ DỤ — "tôi vừa ăn phở bò":
{"reply":"Phở bò khá cân bằng protein và carbs, ổn cho bữa sáng hoặc trưa. Nếu đang giảm cân thì nhớ hạn chế uống hết nước dùng vì có thể nhiều muối nhé.","mealData":{"calories":450,"protein":"30g","fat":"12g","carbs":"55g","fiber":"3g","sugar":"5g","sodium":"900mg","description":"Phở bò","amount":"1 tô"}}
VÍ DỤ — "mình uống 300ml sữa socola":
{"reply":"Sữa socola ngon nhưng khá nhiều đường, uống buổi sáng hoặc sau tập là hợp lý nhất nhé.","mealData":{"calories":240,"protein":"10g","fat":"8g","carbs":"32g","fiber":"0g","sugar":"30g","sodium":"165mg","description":"Sữa socola","amount":"300ml"}}

CHỈ JSON, không thêm bất kỳ chữ nào khác. /no_think`;
};

// ─── PROMPT: COACH ───────────────────────────────────────────────────────────

const buildCoachPrompt = ({
  profile, currentPlan, currentDayName, dayOfWeek, message,
  isQueryOnly, isDeadlinePassed, foodsDB, knowledgeBlock = "", langInstruction = "", recentMealBlock = "",
}) => {
  const isEn = /english/i.test(langInstruction);
  let prompt;

  if (isEn) {
    prompt = `LANGUAGE — ABSOLUTE RULE: The "reply" and "clarifyQuestion" strings in your JSON MUST be 100% natural English. No Vietnamese sentences, no Vietnamese headings. Keep authentic Vietnamese dish names (Phở, Bánh mì, Bún bò Huế, Cơm tấm...) as proper nouns. "meal" values remain in the fixed Vietnamese label set ("Sáng"/"Trưa"/"Tối"/"Phụ") because they are storage keys.

You are a smart, friendly AI Nutrition Coach with deep knowledge of Vietnamese cuisine. Always give thorough advice — never generic filler.

TODAY IS: ${currentDayName} (day ${dayOfWeek} in the plan).
DAY MAPPING: day 1=Monday | day 2=Tuesday | day 3=Wednesday | day 4=Thursday | day 5=Friday | day 6=Saturday | day 7=Sunday

The user just wrote: "${message}"

USER INFO
Gender: ${profile.gender ?? "N/A"} | Birth year: ${profile.birth_year ?? "N/A"} | Height: ${profile.height ?? "N/A"}cm | Weight: ${profile.weight ?? "N/A"}kg
Goal: ${profile.goal ?? "N/A"} | Condition: ${profile.disease || "none"} | Focus macro: ${profile.focus_macro ?? "N/A"}
Target calories/day: ${profile.target_calories || "1500-1800"} kcal | Reason: ${profile.reason || "N/A"}
${recentMealBlock}${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
CURRENT 7-DAY PLAN (compact)
${JSON.stringify((currentPlan || []).map(d => ({
  day: d.day,
  meals: (d.meals || []).map(m => ({ meal: m.meal, food: m.food, calories: m.calories }))
})))}

NOTE: When updating (action=update_plan), newPlan MUST include the FULL 7 days, each meal with all 10 fields: meal, food, amount, calories, protein, fat, carbs, fiber, sugar, sodium.

AVAILABLE FOODS (top 20 — prefer these):
${formatFoodsForPrompt((foodsDB || []).slice(0, 20))}

FOODS DATABASE RULES:
- Prefer foods from the list when building/updating the plan; if the food exists → use its exact numbers; if not → estimate reasonably.

CLASSIFICATION & HANDLING:
- update_plan: FULL day + meal + food given → update that day/meal, estimate calories+macros; rebalance remaining meals of the day so the day totals ~${profile.target_calories || "1500-1800"} kcal (±150); reshape 1-2 later days if off by >150 kcal.
- analyze_only: pure knowledge question, OR a food name without a day/meal → DO NOT change the plan; analyze + comment on goal impact.
- ask_clarify: wants a change but MISSING day or meal → ask for the missing part, DO NOT change the plan.
- isQueryOnly = ${isQueryOnly}: if true, ALWAYS analyze_only.
- Reply naturally, friendly, NO markdown.
- Only ask "which meal did you eat it at (breakfast/lunch/dinner/snack)?" when the user CLEARLY says they JUST ATE / ATE a dish to log it. Knowledge questions, name corrections or small talk → NEVER ask about meal time.

PER-MEAL FORMAT (all 10 fields — the "meal" values stay in Vietnamese as storage keys):
{"meal":"Sáng|Trưa|Tối|Phụ","food":"...","amount":"...","calories":number,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg"}

RETURN PURE JSON (no markdown):
{"reply":"...","action":"update_plan|analyze_only|ask_clarify","needsClarification":true/false,"clarifyQuestion":"...","newPlan":[...],"mealData":null or {...10 fields + "description"}}
- newPlan: FULL 7 days if update_plan; [] if analyze_only/ask_clarify.
- mealData: fill when analyze_only + specific dish; null for knowledge / update_plan / ask_clarify.
  mealData MUST include "amount" = the EXACT amount the user stated ("2 pieces", "300ml", "half a bowl"...; not stated → "1 serving")
  and "description" = the base dish name WITHOUT any quantity. The system recomputes numbers from description + amount.

EXAMPLES:
- "I just ate a bowl of pho" -> {"reply":"Pho is nicely balanced, great for breakfast or lunch. Which meal did you have it at so I can log it?","action":"analyze_only","needsClarification":false,"clarifyQuestion":"","newPlan":[],"mealData":{"calories":450,"protein":"30g","fat":"12g","carbs":"55g","fiber":"3g","sugar":"5g","sodium":"900mg","description":"Phở bò"}}
- "[MEAL CONFIRM] ate Phở bò for Sáng on Monday" -> {"reply":"Logged pho for Monday breakfast — I'll rebalance lunch and dinner to keep you on target.","action":"update_plan","needsClarification":false,"clarifyQuestion":"","newPlan":[...full 7 days...],"mealData":null}
- "swap Tuesday lunch to bún chả" -> {"reply":"Swapped Tuesday lunch to bún chả and lightened dinner to balance the day.","action":"update_plan","needsClarification":false,"clarifyQuestion":"","newPlan":[...full 7 days...],"mealData":null}

/no_think`;

    if (isDeadlinePassed) {
      prompt += `\n\n[IMPORTANT]: The DEADLINE has PASSED. DO NOT update the plan (always analyze_only). Congratulate the user and nudge them toward the ROADMAP to start a new cycle.`;
    }

    return prompt;
  }

  prompt = `NGÔN NGỮ — BẮT BUỘC: Chuỗi "reply" và "clarifyQuestion" trong JSON PHẢI 100% TIẾNG VIỆT có dấu. KHÔNG câu tiếng Anh nào (trừ tên món quốc tế). Giữ nguyên tên món Việt đặc trưng.

Bạn là HLV Dinh dưỡng AI thông minh, thân thiện và am hiểu sâu ẩm thực Việt Nam.
Luôn tư vấn đến nơi đến chốn — không trả lời chung chung, không qua loa.

HÔM NAY LÀ: ${currentDayName} (day ${dayOfWeek} trong thực đơn).
QUY TẮC NGÀY: day 1=Thứ 2 | day 2=Thứ 3 | day 3=Thứ 4 | day 4=Thứ 5 | day 5=Thứ 6 | day 6=Thứ 7 | day 7=Chủ Nhật

Người dùng vừa nhắn: "${message}"

THÔNG TIN NGƯỜI DÙNG
Giới tính: ${profile.gender ?? "N/A"} | Năm sinh: ${profile.birth_year ?? "N/A"} | Chiều cao: ${profile.height ?? "N/A"}cm | Cân nặng: ${profile.weight ?? "N/A"}kg
Mục tiêu: ${profile.goal ?? "N/A"} | Bệnh lý: ${profile.disease || "Không có"} | Macro ưu tiên: ${profile.focus_macro ?? "N/A"}
Calo mục tiêu/ngày: ${profile.target_calories || "1500-1800"} kcal | Lý do: ${profile.reason || "N/A"}
${recentMealBlock}${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
THỰC ĐƠN 7 NGÀY HIỆN TẠI (dạng gọn)
${JSON.stringify((currentPlan || []).map(d => ({
  day: d.day,
  meals: (d.meals || []).map(m => ({
    meal: m.meal,
    food: m.food,
    calories: m.calories,
  }))
})))}

LƯU Ý: Khi cập nhật (action=update_plan), newPlan PHẢI trả về ĐẦY ĐỦ 7 ngày, mỗi bữa ĐỦ 10 trường: meal, food, amount, calories, protein, fat, carbs, fiber, sugar, sodium.

KHO MÓN ĂN CÓ SẴN (20 món phổ biến — ưu tiên dùng):
${formatFoodsForPrompt((foodsDB || []).slice(0, 20))}

QUY TẮC FOODS DATABASE:
- Ưu tiên dùng món từ danh sách khi xây/cập nhật thực đơn; món đã có → dùng CHÍNH XÁC số liệu đó; chưa có → tự ước tính hợp lý.

PHÂN LOẠI & XỬ LÝ:
- update_plan: có ĐỦ ngày + bữa + món → cập nhật đúng ngày/bữa, ước lượng calo+macro đầy đủ; tái cân bằng các bữa còn lại trong ngày để tổng ~ ${profile.target_calories || "1500-1800"} kcal (±150); tái cấu trúc 1-2 ngày sau nếu lệch >150 kcal.
- analyze_only: chỉ hỏi kiến thức, HOẶC nói tên món mà CHƯA có ngày/bữa → KHÔNG đổi plan; phân tích + nhận xét tác động tới mục tiêu.
- ask_clarify: muốn đổi nhưng THIẾU ngày hoặc bữa → hỏi lại đúng phần còn thiếu, KHÔNG đổi plan.
- isQueryOnly = ${isQueryOnly}: nếu true thì LUÔN analyze_only.
- Reply tự nhiên, thân thiện, KHÔNG markdown.
- CHỈ hỏi "bạn ăn vào bữa nào (sáng/trưa/tối/bữa phụ)" khi người dùng NÓI RÕ HỌ VỪA/ĐÃ ĂN một món để GHI NHẬN. Nếu chỉ hỏi kiến thức, chỉnh sửa/góp ý tên món, hay trò chuyện → TUYỆT ĐỐI KHÔNG hỏi về bữa ăn.

ĐỊNH DẠNG MỖI BỮA (đủ 10 trường):
{"meal":"Sáng|Trưa|Tối|Phụ","food":"...","amount":"...","calories":số,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg"}

CHỈ TRẢ JSON THUẦN (KHÔNG markdown):
{"reply":"...","action":"update_plan|analyze_only|ask_clarify","needsClarification":true/false,"clarifyQuestion":"...","newPlan":[...],"mealData":null hoặc {...10 trường + "description"}}
- newPlan: ĐỦ 7 ngày nếu update_plan; [] nếu analyze_only/ask_clarify.
- mealData: điền khi analyze_only + có món cụ thể; null nếu hỏi kiến thức / update_plan / ask_clarify.
  mealData PHẢI có "amount" = ĐÚNG định lượng người dùng nêu ("2 quả", "300ml", "nửa tô"...; không nêu → "1 phần")
  và "description" = CHỈ tên món gốc KHÔNG kèm số lượng. Hệ thống tự tính lại con số từ description + amount.

VÍ DỤ:
- "tôi vừa ăn 1 tô phở bò" -> {"reply":"Phở bò khá cân bằng, ổn cho bữa sáng/trưa. Bạn ăn vào bữa nào để mình ghi nhận nhé?","action":"analyze_only","needsClarification":false,"clarifyQuestion":"","newPlan":[],"mealData":{"calories":450,"protein":"30g","fat":"12g","carbs":"55g","fiber":"3g","sugar":"5g","sodium":"900mg","description":"Phở bò"}}
- "[XÁC NHẬN BỮA ĂN] ăn Phở bò bữa Sáng Thứ 2" -> {"reply":"Đã ghi nhận phở bò cho bữa sáng thứ 2, mình tái cân bằng trưa và tối để đạt mục tiêu nhé.","action":"update_plan","needsClarification":false,"clarifyQuestion":"","newPlan":[...đủ 7 ngày...],"mealData":null}
- "đổi trưa thứ 3 thành bún chả" -> {"reply":"Đã đổi bữa trưa thứ 3 thành bún chả, mình chỉnh bữa tối nhẹ hơn để cân bằng ngày nhé.","action":"update_plan","needsClarification":false,"clarifyQuestion":"","newPlan":[...đủ 7 ngày...],"mealData":null}

/no_think`;

  if (isDeadlinePassed) {
    prompt += `\n\n[QUAN TRỌNG]: Đã VƯỢT DEADLINE. KHÔNG cập nhật thực đơn (luôn analyze_only). Chúc mừng thành quả và gợi ý vào LỘ TRÌNH để bắt đầu chu kỳ mới.`;
  }

  return prompt;
};

// ─── PROMPT: CASUAL ───────────────────────────────────────────────────────────

const buildCasualPrompt = (profile, langInstruction = "") => {
  const isEn = /english/i.test(langInstruction);
  if (isEn) {
    return `LANGUAGE — ABSOLUTE RULE: The "reply" string MUST be 100% natural English. No Vietnamese sentences.

You are the friendly assistant of a nutrition app — cheerful and warm.
User's name: ${profile.username || "friend"}.

The user is chatting about something OFF the nutrition/food topic.
You should:
- Reply briefly, friendly, natural — like a real friend.
- Gently remind them that your specialty is nutrition and eating.
- Where fitting, suggest they ask you about health/food topics.
- Do NOT reject coldly, do NOT be stiff.

RETURN PURE JSON:
{"reply":"..."}
/no_think`;
  }
  return `NGÔN NGỮ — BẮT BUỘC: Chuỗi "reply" PHẢI 100% TIẾNG VIỆT có dấu.

Bạn là trợ lý thân thiện của ứng dụng dinh dưỡng, luôn vui vẻ và gần gũi.
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
};

// ─── POST-PROCESSING: Correct common visual misidentification ─────────────────

const VISUAL_CORRECTIONS = [
  {
    detect: /bí đao nhồi thịt|bí đao hầm thịt/i,
    signal: /gân|nhăn|đắng|khổ|mướp đắng|bitter/i,
    correct: "Khổ qua nhồi thịt",
  },
  {
    // AI đôi khi nhầm khổ qua/mướp đắng nhồi thịt thành chèo tôm chua (do cùng miền Trung / màu xanh?)
    detect: /chèo|tôm chua/i,
    signal: /gồ ghề|gai|gân|nhồi|quả xanh|mướp đắng|khổ qua|vỏ xanh|ruột nhồi/i,
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
  {
    // AI hay nhầm BÚN CHẢ (chả miếng + ba chỉ nướng NGÂM nước chấm + BÚN sợi riêng +
    // rau sống) thành "Bò lúc lắc". Dấu hiệu Bún chả: có BÚN (sợi) + ít nhất 1 tín hiệu
    // nước chấm/thịt nướng/chả/rau sống. Bò lúc lắc KHÔNG có bún, KHÔNG có bát nước chấm.
    detect: /bò lúc lắc|bo luc lac|shaking beef|beef\s*(?:cube|slice|steak)/i,
    signal: /(?=[\s\S]*(?<!\p{L})(?:bún|bun|vermicelli|noodles?)(?!\p{L}))[\s\S]*(?<!\p{L})(?:nước chấm|nuoc cham|chấm|dipping|chả|ba chỉ|ba rọi|thịt nướng|nướng|grilled|rau sống|rau thơm|herbs|đu đủ)(?!\p{L})/iu,
    correct: "Bún chả",
  },
  {
    // AI hay nhầm Cơm tấm (sườn nướng miếng dẹt + cơm tấm + trứng ốp la + chả trứng + đồ chua)
    // thành "Bò lúc lắc" (thực chất là thịt bò cắt KHỐI xào, KHÔNG kèm cơm+trứng ốp la+chả trên đĩa).
    // Dấu hiệu Cơm tấm: có CƠM/RICE + TRỨNG ỐP LA/EGG cùng đĩa (bò lúc lắc không có bộ này).
    detect: /bò lúc lắc|bo luc lac|shaking beef|beef\s*(?:cube|slice|steak)|(?:cube|slice)[a-z\s]*beef/i,
    // Cần: có CƠM/RICE + có TRỨNG/EGG + ít nhất 1 dấu hiệu ĐẶC TRƯNG cơm tấm
    // (đồ chua/pickled/củ cải/chả/bì/sườn). Bò lúc lắc ốp la thường kèm xà lách/khoai
    // tây (không có bộ này) nên không bị sửa nhầm.
    // Ranh giới (?<!\p{L})/(?!\p{L}) cờ 'u' vì \b của JS hỏng với dấu tiếng Việt
    // ("đồ chua", "củ cải": đ/ủ không phải word-char nên \b không khớp).
    signal: /(?=[\s\S]*(?<!\p{L})(?:cơm|rice)(?!\p{L}))(?=[\s\S]*(?<!\p{L})(?:trứng|ốp la|egg)(?!\p{L}))[\s\S]*(?<!\p{L})(?:sườn|pork chop|chả|bì|đồ chua|pickled|củ cải|daikon)(?!\p{L})/iu,
    correct: "Cơm tấm",
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

// Khi correction đổi tên món, đồng bộ tên trong PHẦN CHỮ của reply để thẻ dinh dưỡng và
// đoạn văn không mâu thuẫn (vd card ghi "Cơm tấm" nhưng text vẫn ghi "Bò lúc lắc").
const syncCorrectedNameInReply = (rawReply, oldName, newName) => {
  if (!oldName || !newName || oldName === newName) return rawReply;
  try {
    const re = new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return String(rawReply).replace(re, newName);
  } catch {
    return rawReply;
  }
};

// Tư vấn ngắn gọn dựa trên mục tiêu và dinh dưỡng (KHÔNG liệt kê số chi tiết)
const buildShortAdvice = (nutritionData, profile, langInstruction = "") => {
  const goal = String(profile?.goal || "").toLowerCase();
  const cals = Number(nutritionData?.calories) || 0;
  const isEn = langInstruction.includes("English");
  if (goal.includes("giảm") || goal.includes("lose") || goal.includes("weight loss")) {
    return cals > 600
      ? (isEn ? `This dish is quite heavy — enjoy it in moderation and reduce oil/sugar if possible.` : `Món này khá nặng, nên ăn vừa phải và giảm dầu mỡ/đường nếu có thể nhé.`)
      : (isEn ? `This dish is fine for weight loss — just keep your portions in check.` : `Món này khá ổn cho chế độ giảm cân, nhớ giữ phần ăn vừa phải.`);
  }
  if (goal.includes("tăng") || goal.includes("gain") || goal.includes("muscle")) {
    return cals > 400
      ? (isEn ? `This dish is calorie-dense — great for your muscle gain / bulking goal.` : `Món này có nhiều năng lượng, tốt cho mục tiêu tăng cân/tăng cơ.`)
      : (isEn ? `This dish works, but consider pairing it with an extra protein source to hit your goal.` : `Món này được, bạn có thể kết hợp thêm nguồn protein để đạt mục tiêu nhé.`);
  }
  return isEn
    ? `This dish can fit a balanced diet. Detailed nutrition is shown in the card on the right.`
    : `Món này có thể phù hợp với chế độ cân bằng của bạn. Chi tiết dinh dưỡng mình để ở thẻ bên phải.`;
};

// ─── PROMPT: VISION / IMAGE ANALYSIS ─────────────────────────────────────────

const buildNutritionPrompt = (foodsDB = [], knowledgeBlock = "", profile = {}, langInstruction = "") => {
  const topFoods = Array.isArray(foodsDB) ? foodsDB.slice(0, 20) : [];
  const isEn = /english/i.test(langInstruction);

  if (isEn) {
    const foodsSection = topFoods.length > 0
      ? `\nFOOD DATABASE (top 20):\n${formatFoodsForPrompt(topFoods)}\nIf the dish matches, use these stored values.\n`
      : "";
    return `LANGUAGE — ABSOLUTE RULE: Your ENTIRE reply MUST be in natural English. Every heading, bullet, sentence, and example must be English. NEVER emit Vietnamese words or headings such as "Phù hợp với mục tiêu của bạn" or "Gợi ý điều chỉnh". Keep authentic Vietnamese proper-noun dish names ("Phở", "Bánh mì", "Bún bò Huế", "Gỏi cuốn", "Cơm tấm") in Vietnamese; translate everything else.

You are an AI nutrition expert with deep knowledge of Vietnamese and international cuisine.
Task: look at the image → identify the food/drink → estimate nutrition → present a friendly, structured answer.

RECOGNITION SCOPE — NO COUNTRY LIMIT:
Recognize ANY dish from any cuisine. NEVER refuse because it "is not Vietnamese".
Name each dish in English or its common international name. Keep authentic Vietnamese names as proper nouns
(Phở, Bánh mì, Bún bò Huế, Gỏi cuốn, Cơm tấm...) — do NOT translate them.

NAMING RULES (MANDATORY):
- For Vietnamese-localized dishes, use the Vietnamese name (never call a Vietnamese sandwich "baguette"; say "Bánh mì").
- If unsure of a specific variant, use the short generic name ("Bánh mì", "Rice", "Noodles") without extra foreign words.

RECOGNITION PROCESS (think silently, do NOT write it out):
1. Identify the cuisine (Vietnamese / Korean / Japanese / Italian / Chinese / Thai / Indian...).
2. Identify the main food type: noodles, rice, bread, meat, seafood, vegetables, dessert...
3. Observe sauce/color/broth: clear/white, spicy red, curry yellow, dark brown, herb green...
4. Observe garnishes: egg, bean sprouts, herbs, tofu, mushrooms, fried onion...
5. Combine the above to pick the most PRECISE name — never a vague generic name.

COMMONLY CONFUSED PAIRS:
• Phở (flat noodles, clear/light-brown broth, thinly sliced meat) ≠ Bún (round noodles) ≠ Hủ tiếu (clear white noodles, sweet broth).
• Bún bò Huế (round noodles, spicy red broth, crab cake, pork knuckle) ≠ Bún riêu (cloudy sour broth, tomato, crab paste) ≠ Bún thịt nướng (dry, grilled pork over noodles).
• Cơm tấm (broken-rice grains, grilled pork chop, shredded pork skin, egg meatloaf) ≠ plain steamed rice.
• BÚN CHẢ (Hanoi) — VERY often mistaken for "Bò lúc lắc" or "Cơm tấm". It is a COMMON dish, consider it first:
  - Signature: a BOWL of thin orange/light-brown DIPPING SAUCE with GRILLED PORK PATTIES (flat round minced-pork discs) and/or CHARRED PORK BELLY soaking in it, often sliced PAPAYA/CARROT floating in the sauce.
  - ALWAYS served with a SEPARATE plate of BÚN (white rice vermicelli) + a big basket of FRESH HERBS.
  - If you see grilled meat SOAKING in a thin dipping sauce + separate white vermicelli + lots of fresh herbs → it is definitely BÚN CHẢ, NEVER "bò lúc lắc" or "cơm tấm".
• CƠM TẤM ≠ BÒ LÚC LẮC (very commonly confused):
  - CƠM TẤM: PLATE with RICE + FLAT GRILLED PORK CHOP (not cubed) + usually SUNNY-SIDE EGG, EGG MEATLOAF (orange/yellow square), shredded pork skin, cucumber, tomato, pickled veg. Rice + fried egg + meatloaf together → definitely Cơm tấm.
  - BÒ LÚC LẮC (STRICT — only use this name when ALL 3 hold): (1) BEEF in EVEN BROWN CUBES (not a charred grilled slice, not patties/belly), (2) STIR-FRIED DRY on a PLATE (NO bowl of thin dipping sauce soaking the meat), (3) visible ONION + BELL PEPPER. If ANY is missing — especially if there is BÚN, a dipping-sauce bowl, fresh herbs, or the meat is grilled/patties → do NOT call it bò lúc lắc.
• Bitter melon stuffed with pork ("Khổ qua nhồi thịt" / "Mướp đắng nhồi thịt" — same dish):
  - Dark-green fruit, BUMPY skin, oblong 10-20cm, usually cross-cut with minced pork inside.
  - NOT winter melon (pale, smooth, cylindrical).
• Chè / fruit yogurt / ice cream / cakes: distinguish clearly from savory dishes.
• Bubble tea / coffee / smoothie / juice: name the drink type and toppings (tapioca, jelly, cream...).

INTERNATIONAL DISHES:
• Tteokbokki: short cylindrical rice cakes, spicy red sauce, often with quail eggs.
• Ramen: yellow curly noodles, rich broth, chashu, seaweed, soft egg.
• Sushi: vinegared rice + seafood/meat on or in seaweed. Gimbap (Korean): seaweed outside, rice + many veg/ham fillings.
• Pasta: flat/twisted/tube noodles, cream/tomato/pesto sauce, often cheese.
• Pizza: flat baked base, tomato + cheese + toppings (distinguish thin-crisp / thick / stuffed-crust).
• Burger: bun with a meat patty, veg, cheese, sauce.
• Pad Thai: flat Thai stir-fried noodles, orange color, tofu, shrimp, sprouts, peanuts.
• Dim Sum: dumplings/buns in a steamer.
• Steak: thick beef slice with grain, usually sauce/vegetables.
• If unsure, pick the most likely common name — NEVER invent.

EVIDENCE-BASED RECOGNITION — DO NOT GUESS BY COLOR (MANDATORY):
- Before naming a dish, observe SHAPE, TEXTURE/SURFACE, POSITION, CONTEXT — never conclude from color alone.
- With ≥2 plausible options, state the key difference before choosing; weak evidence → pick the most common/safe name, never invent.
- Use the CORRECT name (distinguish by SIZE + SPINE/SKIN + FLESH, not color):
  • Red skin, SOFT hair-like spines, translucent WHITE flesh, small ~3-5cm = "Chôm chôm" (rambutan) — NOT mulberry ("dâu tằm"), NOT durian ("sầu riêng").
  • Durian: VERY large, HARD sharp spikes, yellow segmented flesh. Lychee/longan: bumpy/smooth skin, NO spines.
- SOUP (distinguish by BROTH, not color):
  • CLEAR/thickened broth, NOT sour, NO tomato, with SHREDDED protein + mushroom + herbs = "Súp" (e.g. súp gà / chicken soup, crab soup) — NOT "canh chua" (sour soup REQUIRES a sour taste + tomato/tamarind/pineapple/okra).
  • Small ROUND yellowish/off-white balls in soup/congee are usually QUAIL EGGS (trứng cút) or CORN kernels — NOT "beans". Quail egg: smooth glossy ball ~2-3cm; corn: small even bright-yellow kernels.
  • Shredded white strands = chicken (gà xé) or crab/fish — read the grain; don't default to "cá lóc" (snakehead fish).
- Assign a "confidence" (high|medium|low) by evidence strength and put it in <data>.

PORTION & INGREDIENTS (MANDATORY — analyze from image):
- OBSERVE the actual QUANTITY and SIZE: count pieces/slices/rolls, estimate bowl/plate/glass size and fullness; encode in amount (e.g. "1 small piece", "2 slices", "half a bowl", "1 large bowl ~500ml").
- calories and macros must match the VISIBLE portion — do NOT reuse a full-serving number when the image shows only a small piece (e.g. 1 sushi piece ~40-60 kcal, NOT 350-450 kcal for a whole set).
- If N identical items appear → count N, compute calories for ONE, then calories = N × per-unit (macros too).
- Use "1 serving" only when the image shows a normal adult portion or lacks a reference object.
${foodsSection}${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
IF NOT A FOOD/DRINK (object, scenery, person...):
→ return <error>short description of what you see</error>

IF IT IS A FOOD — WRITE A NATURAL, FRIENDLY REPLY WITH THIS EXACT STRUCTURE (English only):

1) One opening sentence identifying the dish + VISIBLE ingredients:
   e.g. "This is a bowl of **[dish name]** with [main ingredients you can see]."

2) **Fit with your goal:**
   2-3 sentences on how the dish fits (or does not) your goal of "${profile.goal || "your goal"}"${profile.disease && profile.disease !== "không có" && profile.disease !== "none" ? ` and your condition "${profile.disease}"` : ""} — explain the REASON, practical and clear.

3) **Suggested adjustments:**
   - 2-4 bullet suggestions (what to pair with, what to reduce/swap/avoid) to make the dish fit your goal better.

4) Data block (MANDATORY, at the END, VALID JSON on ONE line — broken JSON breaks the system):
<data>{"calories":[CAL],"protein":"[PRO]g","fat":"[FAT]g","carbs":"[CARB]g","fiber":"[FIB]g","sugar":"[SUG]g","sodium":"[SOD]mg","description":"[DISH NAME]","amount":"[PORTION]","confidence":"[high|medium|low]","items":[{"name":"[NAME]","quantity":[N],"calories_per_unit":[KC],"protein_per_unit":[P1],"fat_per_unit":[F1],"carbs_per_unit":[C1]}]}</data>
- "confidence": recognition certainty (high/medium/low) — the system uses it to show a nutrition RANGE (higher confidence → narrower range).
- "amount": visible portion in the image, e.g. "3 pieces", "1 small piece", "1 serving". 3 cookies in the image → "3 pieces", NOT "1 serving".
- "items": one entry per ITEM TYPE. quantity = integer count in the image; *_per_unit = plain numbers for ONE unit only. The system multiplies quantity × per_unit — do NOT pre-sum.
- Counts in the prose ("with 3 cookies") must match items[].quantity.

CONSISTENCY CHECK (MANDATORY — the card is built from <data>; text and card must agree):
- The top-level "calories" MUST equal Σ(items[].quantity × items[].calories_per_unit). Same for protein / fat / carbs (unit "g"). Compute the sum yourself before writing <data>; if it doesn't match, FIX the top-level numbers, not the items.
- items[].quantity MUST equal the exact number of units you actually see in the image AND match any count mentioned in the prose ("3 cookies" → quantity:3).
- "amount" MUST reflect the TOTAL visible portion (e.g. "3 pieces", "2 slices", "1 large bowl"), NEVER "1 serving" when the image shows multiple units.
- If — against the rules — any calorie/macro number leaks into the prose, it MUST match the top-level number in <data> exactly. Never write one total in the prose and a different total in <data>.

MANDATORY RULES:
- NEVER list calorie / protein / fat / carbs / fiber / sugar / sodium numbers in the prose. NEVER write a "Nutrition estimate" section. Numbers live ONLY inside <data>.
- Use **bold** for the dish name and the two headings "Fit with your goal:" and "Suggested adjustments:". Use "-" bullets for the suggestions.
- Do NOT print process labels ("Step", "OBSERVE", "IDENTIFY"...). Do NOT ask about meal time. Nothing after </data>.
- LANGUAGE CHECK: before you finish, re-read your reply — if ANY Vietnamese heading or sentence appears (other than authentic dish proper nouns), rewrite it in English.

EXAMPLE:
This is a piece of **California roll sushi**, with vinegared rice, seaweed, crab stick, avocado, and cucumber.

**Fit with your goal:**
A single roll piece is light and moderate in calories, so it fits a weight-management routine as long as you keep the total pieces in check. The refined rice and sauces can add hidden sugar and sodium, so pace yourself if you are watching either.

**Suggested adjustments:**
- Skip or halve the soy sauce to lower sodium.
- Pair with a side of edamame or miso soup to add protein and fiber.
- Choose sashimi or brown-rice rolls for a leaner, higher-protein option.
<data>{"calories":45,"protein":"1.2g","fat":"1g","carbs":"8g","fiber":"0.5g","sugar":"1g","sodium":"90mg","description":"California roll sushi","amount":"1 piece","confidence":"high","items":[{"name":"california roll piece","quantity":1,"calories_per_unit":45,"protein_per_unit":1.2,"fat_per_unit":1,"carbs_per_unit":8}]}</data>

EXAMPLE 2 — image with MULTIPLE identical items (count 3, per-unit values, do NOT pre-sum):
<data>{"calories":540,"protein":"12g","fat":"30g","carbs":"60g","fiber":"3g","sugar":"30g","sodium":"300mg","description":"Chocolate chip cookie","amount":"3 pieces","confidence":"medium","items":[{"name":"chocolate chip cookie","quantity":3,"calories_per_unit":180,"protein_per_unit":4,"fat_per_unit":10,"carbs_per_unit":20}]}</data>

/no_think`;
  }

  const foodsSection = topFoods.length > 0
    ? `\nKHO MÓN ĂN (20 phổ biến nhất):\n${formatFoodsForPrompt(topFoods)}\nNếu khớp -> dùng số liệu từ đây.\n`
    : "";

  return `NGÔN NGỮ — BẮT BUỘC: Toàn bộ câu trả lời PHẢI 100% TIẾNG VIỆT có dấu đầy đủ. Mọi tiêu đề, gạch đầu dòng, câu văn và ví dụ phải bằng tiếng Việt. TUYỆT ĐỐI KHÔNG viết tiêu đề tiếng Anh như "Fit with your goal" hay "Suggested adjustments". KHÔNG dùng chữ Hán/Trung/Nhật.

Bạn là chuyên gia dinh dưỡng AI, am hiểu ẩm thực Việt Nam và quốc tế.
Nhiệm vụ: nhìn ảnh → nhận diện món ăn/đồ uống → ước tính dinh dưỡng → trình bày kết quả thân thiện.

PHẠM VI NHẬN DIỆN — KHÔNG GIỚI HẠN QUỐC GIA:
Nhận diện BẤT KỲ món ăn nào từ bất kỳ nền ẩm thực nào. KHÔNG từ chối với lý do "không phải món Việt".
Gọi tên bằng tiếng Việt (hoặc tên quốc tế nếu không có bản dịch chuẩn):
Tteokbokki | Ramen | Sushi | Pasta | Pizza | Burger | Pad Thai | Dim Sum | Steak...

QUY TẮC ĐẶT TÊN MÓN (BẮT BUỘC):
- Món đã BẢN ĐỊA HOÁ ở Việt Nam → ưu tiên tên Việt + nguyên liệu Việt.
  Ví dụ: ổ bánh mì kẹp kiểu Việt → "Bánh mì thịt nướng" hoặc "Bánh mì".
  TUYỆT ĐỐI KHÔNG gọi là "baguette" hay "bánh mì baguette".
- Không chắc biến thể → dùng tên chung ngắn gọn ("Bánh mì", "Cơm", "Bún"), KHÔNG thêm từ nước ngoài.

ƯU TIÊN HÀNG ĐẦU - ẨM THỰC VIỆT NAM:
- Khi món vừa có thể là Việt vừa có thể là nước ngoài, HÃY ƯU TIÊN tên món Việt nếu thấy dấu hiệu Việt (bát/tô/đĩa đơn giản, rau thơm, nước dùng trong, cơm/bún/phở, trình bày gia đình).
- Nếu rõ ràng là món quốc tế (pizza, sushi, burger, ramen, pasta...) thì vẫn trả tên quốc tế chính xác.

QUY TRÌNH NHẬN DIỆN (nghĩ trong đầu, KHÔNG viết ra):
1. Xác định nền ẩm thực (Việt / Hàn / Nhật / Ý / Trung / Thái / Ấn...).
2. Xác định LOẠI THỰC PHẨM chính: sợi, cơm, bánh, bánh mì, thịt, hải sản, rau/củ, tráng miệng...
3. Quan sát SỐT/MÀU/NƯỚC dùng: trong/trắng, đỏ cay, vàng curry, nâu sốt đậm, xanh herb...
4. Quan sát PHỤ GIA: trứng, giá, rau thơm, đậu phụ, nấm, hành phi...
5. Dựa vào 4 điểm trên để chọn TÊN CHÍNH XÁC NHẤT, không dùng tên chung chung.

PHÂN BIỆT DỄ NHẦM LẪN:
• Phở (sợi dẹt, nước trong/nâu nhạt, thịt thái mỏng) ≠ Bún (sợi tròn) ≠ Hủ tiếu (sợi trắng trong, nước ngọt).
• Bún bò Huế (sợi tròn, nước đỏ cay, chả cua, gió heo) ≠ Bún riêu (nước đục chua, cà chua, riêu cua) ≠ Bún thịt nướng (không nước nhiều, thịt nướng trên bún).
• Cơm tấm (hạt cơm tấm nhỏ, sườn nướng, bì, chả trứng) ≠ Cơm trắng thổi thường.
• BÚN CHẢ (Hà Nội) — RẤT HAY bị nhầm thành "Bò lúc lắc" hoặc "Cơm tấm". ĐÂY LÀ MÓN PHỔ BIẾN, ưu tiên cân nhắc:
  - Dấu hiệu ĐẶC TRƯNG: có 1 BÁT/CHÉN NƯỚC CHẤM màu cam/nâu nhạt LOÃNG, bên trong NGÂM CHẢ MIẾNG (thịt băm nướng dẹt tròn) và/hoặc THỊT BA CHỈ NƯỚNG cháy cạnh, thường có ĐU ĐỦ/CÀ RỐT thái lát nổi trong nước chấm.
  - LUÔN ăn kèm 1 ĐĨA/RỔ BÚN (sợi trắng) RIÊNG + 1 RỔ RAU SỐNG/rau thơm nhiều.
  - Nếu ảnh có: THỊT NƯỚNG cháy cạnh NGÂM trong nước chấm loãng + BÚN sợi trắng để riêng + nhiều rau sống → CHẮC CHẮN là BÚN CHẢ, TUYỆT ĐỐI KHÔNG gọi là "bò lúc lắc" hay "cơm tấm".
• CƠM TẤM ≠ BÒ LÚC LẮC (rất hay nhầm):
  - CƠM TẤM: ĐĨA CÓ CƠM + MIẾNG THỊT NƯỚNG DẸT (sườn heo nướng, không cắt khối) + THƯỜNG có TRỨNG ỐP LA, CHẢ TRỨNG (miếng vuông vàng/cam), BÌ, dưa leo, cà chua, ĐỒ CHUA (cà rốt/củ cải). Có đủ bộ cơm+trứng ốp la+chả → CHẮC CHẮN là Cơm tấm.
  - BÒ LÚC LẮC (điều kiện NGHIÊM NGẶT — chỉ gọi tên này khi ĐỦ CẢ 3): (1) thịt BÒ cắt KHỐI VUÔNG NÂU ĐỀU (không phải miếng nướng cháy cạnh, không phải chả/ba chỉ), (2) XÀO KHÔ trên ĐĨA (KHÔNG có bát nước chấm/nước sốt loãng ngâm thịt), (3) nhìn rõ HÀNH TÂY + ỚT CHUÔNG. Nếu THIẾU bất kỳ dấu hiệu nào — nhất là khi có BÚN, có bát nước chấm, có rau sống, hoặc thịt là miếng nướng/chả → KHÔNG được gọi là bò lúc lắc.
• KHỔ QUA / MƯỚP ĐẮNG NHỒI THỊT:
  - Quả xanh đậm, DA GỒ GHỀ/CÓ GAI MỀM, hình thùy/elip dài 10-20cm, thường cắt ngang hoặc nhồi thịt xay vào ruột.
  - KHÔNG phải Chèo tôm chua (chèo là sốt/súp màu đỏ/cam có tôm, không quả xanh nhồi thịt).
  - KHÔNG phải Bí đao (vỏ nhạt, trơn láng, hình trụ dài, không gồ ghề).
  - Hai tên "Khổ qua nhồi thịt" và "Mướp đắng nhồi thịt" là cùng một món.
• Chè / chè thái / sữa chua trái cây / kem / bánh ngọt: phân biệt rõ tráng miệng và món mặn.
• Trà sữa / cà phê / sinh tố / nước ép: gọi đúng loại đồ uống và đặc điểm (trân châu, thạch, kem...).

MÓN QUỐC TẾ:
• Tteokbokki: bánh gạo trụ ngắn, sốt đỏ cay, thường có trứng cút lát.
• Ramen: mì vàng xoăn, nước sút đậm, thịt xá xíu, rong biển, trứng lòng đào.
• Sushi: cơm trộn giấm + hải sản/thịt trên/nằm trong rong biển. Gimbap (Hàn): rong biển bên ngoài, cơm + nhiều rau củ/thịt xông khói.
• Pasta: mì dẹt/xoăn/dống, sốt kem/cà chua/pesto, thường có pho mát rắc.
• Pizza: đế bẹt nướng, phủ sốt cà chua + pho mát + topping. Phân biệt kiểu đế (mỏng giòn / dày xốp / viền nhồn phô mai).
• Burger: bánh mì kẹp thịt viên, rau, pho mát, sốt.
• Pad Thai: mì xào Thái dẹt, màu vàng cam, đậu phụ, tôm, giá, đậu phụng.
• Dim Sum: bánh bao/bánh há cảo/bánh xếp trong xửng hấp.
• Steak: thịt bò cắt lát dày, có vân, thường kèm sốt/rau củ.
• Không chắc → chọn tên món phổ biến nhất phù hợp, KHÔNG bịa.

NHẬN DIỆN DỰA TRÊN BẰNG CHỨNG — KHÔNG ĐOÁN THEO MÀU (BẮT BUỘC):
- Trước khi kết luận tên món, quan sát HÌNH DẠNG, KẾT CẤU/BỀ MẶT, VỊ TRÍ, NGỮ CẢNH — TUYỆT ĐỐI KHÔNG kết luận chỉ vì màu sắc.
- Khi có ≥2 khả năng, nêu điểm khác biệt then chốt rồi mới chọn; bằng chứng yếu → chọn tên PHỔ BIẾN & AN TOÀN nhất, KHÔNG bịa.
- DÙNG ĐÚNG TÊN TIẾNG VIỆT (lỗi rất hay gặp — phân biệt theo KÍCH THƯỚC + LOẠI GAI/VỎ + RUỘT, KHÔNG theo màu):
  • Quả vỏ ĐỎ, GAI MỀM như sợi tóc, ruột TRẮNG TRONG, quả nhỏ ~3-5cm = "Chôm chôm" — KHÔNG phải "dâu tằm", KHÔNG phải "sầu riêng".
  • Sầu riêng: quả RẤT TO, gai CỨNG nhọn, ruột múi VÀNG. Vải/nhãn: vỏ sần/nhẵn, KHÔNG gai, ruột trắng.
- SÚP / CANH (phân biệt theo NƯỚC DÙNG, KHÔNG theo màu):
  • Nước dùng TRONG/SÁNH, KHÔNG chua, KHÔNG cà chua, có thịt XÉ SỢI + nấm + rau mùi = "Súp" (vd súp gà, súp cua) — KHÔNG phải "canh chua". Canh chua BẮT BUỘC có vị CHUA + cà chua/me/dứa/đậu bắp.
  • VIÊN TRÒN NHỎ MÀU VÀNG/TRẮNG NGÀ trong súp/cháo thường là TRỨNG CÚT (quả trứng cút bóc vỏ) hoặc hạt NGÔ — KHÔNG phải "hạt đậu"/"đậu vàng". Trứng cút: tròn nhẵn, bóng, ~2-3cm; ngô: hạt nhỏ đều màu vàng tươi.
  • Sợi trắng xé trong súp: gà xé (thớ sợi, mềm) hoặc cua/cá — nhìn thớ để phân biệt, đừng mặc định "cá lóc".
- Gán độ tin cậy "confidence" (high|medium|low) theo độ mạnh bằng chứng và điền vào <data>.

ƯỚC LƯỢNG KHẨU PHẦN & THÀNH PHẦN (BẮT BUỘC — PHÂN TÍCH THEO ẢNH):
- QUAN SÁT kỹ SỐ LƯỢNG và KÍCH THƯỚC THỰC TẾ trong ảnh: đếm số miếng/cái/lát/viên, ước lượng cỡ bát/tô/đĩa/ly và độ đầy; ghi vào amount (vd "1 miếng nhỏ", "2 lát", "nửa bát", "1 tô lớn ~500ml").
- calories và macro phải TÍNH THEO ĐÚNG KHẨU PHẦN NHÌN THẤY, KHÔNG dùng số liệu suất chuẩn khi ảnh chỉ có một phần nhỏ (vd 1 miếng sushi lẻ ~40-60 kcal, KHÔNG phải 350-450 kcal của cả phần).
- Nhận diện các THÀNH PHẦN CHÍNH nhìn thấy trong ảnh để ước tính chính xác hơn.
- NHIỀU PHẦN TỬ GIỐNG NHAU: nếu ảnh có N miếng/cái giống nhau → ĐẾM N trước, tính calo cho ĐÚNG 1 cái, rồi calories = N × calo mỗi cái (macro cũng nhân N). KHÔNG trả calo của 1 cái khi ảnh có nhiều cái.
- Chỉ khi ảnh là một suất người lớn thông thường (hoặc không có vật tham chiếu) mới dùng "1 phần".
${foodsSection}${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
NẾU KHÔNG PHẢI MÓN ĂN/ĐỒ UỐNG (là vật dụng, phong cảnh, con người...):
→ trả về <error>mô tả ngắn thứ nhìn thấy</error>

NẾU LÀ MÓN ĂN — VIẾT REPLY TỰ NHIÊN, THÂN THIỆN, ĐÚNG CẤU TRÚC SAU (100% TIẾNG VIỆT):

1) Mở đầu 1 câu nhận diện món + thành phần NHÌN THẤY:
   vd: "Đây là món **[Tên món]**, gồm [liệt kê các thành phần chính nhìn thấy trong ảnh]."

2) **Phù hợp với mục tiêu của bạn:**
   2-3 câu đánh giá món này hợp / không hợp với mục tiêu "${profile.goal || "của bạn"}"${profile.disease && profile.disease !== "không có" ? ` và tình trạng "${profile.disease}"` : ""} — nói rõ LÝ DO, thực tế, dễ hiểu.

3) **Gợi ý điều chỉnh:**
   - 2-4 gạch đầu dòng gợi ý thực tế (ăn kèm gì, giảm/thay/tránh gì) để món phù hợp hơn với mục tiêu.

4) Khối dữ liệu (BẮT BUỘC, đặt CUỐI CÙNG, JSON HỢP LỆ trên MỘT dòng — sai JSON là hỏng cả hệ thống):
<data>{"calories":[CAL],"protein":"[PRO]g","fat":"[FAT]g","carbs":"[CARB]g","fiber":"[FIB]g","sugar":"[SUG]g","sodium":"[SOD]mg","description":"[TÊN MÓN]","amount":"[KHẨU PHẦN]","confidence":"[high|medium|low]","items":[{"name":"[TÊN]","quantity":[N],"calories_per_unit":[KC],"protein_per_unit":[P1],"fat_per_unit":[F1],"carbs_per_unit":[C1]}]}</data>
- "confidence": độ chắc chắn khi nhận diện món (high/medium/low) — hệ thống dùng để hiển thị KHOẢNG dinh dưỡng (tin cao → khoảng hẹp).
- "amount": khẩu phần NHÌN THẤY trong ảnh, vd "3 cái", "1 miếng nhỏ", "1 phần". Ảnh có 3 cái bánh → "3 cái", KHÔNG ghi "1 phần".
- "items": mỗi LOẠI phần tử một mục. quantity = SỐ NGUYÊN đếm được trong ảnh; các *_per_unit = CHỈ LÀ SỐ (không kèm chữ), là dinh dưỡng của ĐÚNG 1 đơn vị. Hệ thống tự nhân quantity × per_unit — bạn KHÔNG tự cộng tổng, chỉ cần ĐẾM ĐÚNG.
- Số lượng trong phần CHỮ (vd "gồm 3 chiếc bánh") phải KHỚP quantity trong items.

KIỂM TRA NHẤT QUÁN (BẮT BUỘC — thẻ dinh dưỡng lấy từ <data>; CHỮ và THẺ phải khớp nhau):
- Trường "calories" cấp cao PHẢI bằng Σ(items[].quantity × items[].calories_per_unit). Tương tự cho protein / fat / carbs (đơn vị "g"). TỰ CỘNG trước khi viết <data>; nếu lệch, SỬA số cấp cao cho khớp, KHÔNG sửa items.
- items[].quantity PHẢI bằng ĐÚNG số đơn vị bạn thực sự thấy trong ảnh VÀ khớp bất kỳ số đếm nào nêu trong phần chữ ("3 chiếc bánh" → quantity:3).
- "amount" PHẢI phản ánh TỔNG khẩu phần nhìn thấy (vd "3 cái", "2 lát", "1 tô lớn"), KHÔNG được ghi "1 phần" khi ảnh có nhiều đơn vị.
- Nếu — trái quy tắc — có bất kỳ số calo/macro nào lọt vào phần CHỮ, số đó PHẢI bằng đúng số cấp cao trong <data>. TUYỆT ĐỐI KHÔNG được để chữ nói một tổng calo, thẻ hiển thị tổng khác.

QUY TẮC BẮT BUỘC:
- TUYỆT ĐỐI KHÔNG liệt kê số calo / protein / chất béo / carbs / chất xơ / đường / muối trong phần CHỮ, KHÔNG viết mục "Dinh dưỡng ước tính". Các số chỉ nằm trong <data> để hiển thị ở thẻ bên phải.
- Dùng **in đậm** cho tên món + 2 tiêu đề "Phù hợp với mục tiêu của bạn:" và "Gợi ý điều chỉnh:". Dùng gạch đầu dòng "-" cho phần gợi ý.
- KHÔNG in nhãn quy trình ("Bước", "QUAN SÁT", "NHẬN DIỆN"...). KHÔNG hỏi về bữa ăn. Sau </data> KHÔNG viết thêm gì.
- KIỂM TRA NGÔN NGỮ trước khi kết thúc: nếu có bất kỳ câu/tiêu đề tiếng Anh nào (trừ tên món quốc tế), viết lại bằng tiếng Việt.

VÍ DỤ:
Đây là món **Cơm tấm sườn bì chả**, gồm sườn nướng, bì, chả trứng, dưa leo, cà chua và trứng ốp la.

**Phù hợp với mục tiêu của bạn:**
Món này khá nhiều năng lượng và chất béo bão hoà từ sườn nướng, bì và trứng chiên, nên nếu bạn đang kiểm soát cân nặng thì cần để ý khẩu phần kẻo dễ vượt mức calo trong ngày.

**Gợi ý điều chỉnh:**
- Giảm bớt lượng cơm để hạ carbs và năng lượng.
- Ưu tiên phần thịt nạc, hạn chế bì và phần mỡ.
- Ăn kèm thêm rau xanh để tăng chất xơ và no lâu hơn.
<data>{"calories":650,"protein":"35g","fat":"24g","carbs":"70g","fiber":"4g","sugar":"6g","sodium":"1200mg","description":"Cơm tấm sườn bì chả","amount":"1 phần","confidence":"high","items":[{"name":"cơm tấm sườn bì chả","quantity":1,"calories_per_unit":650,"protein_per_unit":35,"fat_per_unit":24,"carbs_per_unit":70}]}</data>

VÍ DỤ 2 — ảnh có NHIỀU cái giống nhau (đếm 3 cái, số liệu cho 1 cái, KHÔNG tự cộng):
<data>{"calories":540,"protein":"12g","fat":"30g","carbs":"60g","fiber":"3g","sugar":"30g","sodium":"300mg","description":"Bánh quy chocolate chip","amount":"3 cái","confidence":"medium","items":[{"name":"bánh quy chocolate chip","quantity":3,"calories_per_unit":180,"protein_per_unit":4,"fat_per_unit":10,"carbs_per_unit":20}]}</data>

/no_think`;
};


// ─── MEAL PLAN HELPERS ──────────────────────────────────────────────────────

/**
 * Áp trực tiếp một món ăn đã xác nhận vào đúng ngày/bữa trong weekly_plan.
 * Dùng làm fallback khi AI coach không tự update plan (trả analyze_only).
 * 
 * @param {{ plan, mealData, mealTime, mealDayText, dayOfWeek }} args
 * @returns {Array|null} plan mới hoặc null nếu không xác định được ngày/bữa
 */
const MEAL_LABEL_MAP = {
  sáng: "Sáng", sang: "Sáng",
  trưa: "Trưa", trua: "Trưa",
  tối: "Tối", toi: "Tối", chiều: "Tối", chieu: "Tối",
  "bữa phụ": "Phụ", "bua phu": "Phụ", phụ: "Phụ", phu: "Phụ",
};

const normalizeMealLabel = (label = "") => {
  const l = label.toLowerCase().trim();
  return MEAL_LABEL_MAP[l] || null;
};

/**
 * Xác định dayIndex (1-7) từ mealDayText hoặc dayOfWeek hiện tại.
 * mealDayText có thể là: "hôm nay", "YYYY-MM-DD", "DD/MM/YYYY", "thứ 2"...
 */
const resolveDayIndex = (mealDayText, dayOfWeek) => {
  if (!mealDayText || mealDayText === "hôm nay" || mealDayText === "today") {
    // Dùng ngày hiện tại (dayOfWeek đã chuẩn hoá 1-7)
    return dayOfWeek;
  }

  const lower = String(mealDayText).toLowerCase().trim();

  // Thứ 2..7, Chủ Nhật
  const dayNameMap = {
    "thứ 2": 1, "thứ hai": 1,
    "thứ 3": 2, "thứ ba": 2,
    "thứ 4": 3, "thứ tư": 3,
    "thứ 5": 4, "thứ năm": 4,
    "thứ 6": 5, "thứ sáu": 5,
    "thứ 7": 6, "thứ bảy": 6,
    "chủ nhật": 7,
  };
  for (const [k, v] of Object.entries(dayNameMap)) {
    if (lower.includes(k)) return v;
  }

  // ISO date YYYY-MM-DD
  const isoMatch = mealDayText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (!isNaN(d.getTime())) return d.getDay() === 0 ? 7 : d.getDay();
  }

  // DD/MM/YYYY
  const vnMatch = mealDayText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (vnMatch) {
    const d = new Date(Number(vnMatch[3]), Number(vnMatch[2]) - 1, Number(vnMatch[1]));
    if (!isNaN(d.getTime())) return d.getDay() === 0 ? 7 : d.getDay();
  }

  return null; // Không xác định được
};

const applyMealToPlan = ({ plan, mealData, mealTime, mealDayText, dayOfWeek }) => {
  if (!Array.isArray(plan) || plan.length === 0) return null;
  const mealLabel = normalizeMealLabel(mealTime);
  if (!mealLabel) {
    console.warn(`[applyMealToPlan] Không nhận diện được bữa: "${mealTime}"`);
    return null;
  }
  const dayIdx = resolveDayIndex(mealDayText, dayOfWeek);
  if (!dayIdx) {
    console.warn(`[applyMealToPlan] Không xác định được ngày từ: "${mealDayText}"`);
    return null;
  }

  // Clone sâu plan
  const next = plan.map((d) => ({
    day: d.day,
    meals: Array.isArray(d.meals) ? d.meals.map((m) => ({ ...m })) : [],
  }));

  // Tìm ngày tương ứng (grouped plan: {day, meals:[...]})
  let dayEntry = next.find((d) => Number(d.day) === dayIdx);
  if (!dayEntry) {
    // Nếu plan là flat array [{day, meal, food, ...}]
    // thì không thể áp grouped — trả null, để chat.js tiếp tục bình thường
    return null;
  }

  const updatedMeal = {
    meal: mealLabel,
    food: mealData.description || mealData.food || "Món ăn",
    amount: mealData.amount || "1 phần",
    calories: mealData.calories ?? 0,
    protein: mealData.protein || "0g",
    fat: mealData.fat || "0g",
    carbs: mealData.carbs || "0g",
    fiber: mealData.fiber || "0g",
    sugar: mealData.sugar || "0g",
    sodium: mealData.sodium || "0mg",
    isActuallyEaten: true, // Đánh dấu đây là món user thực sự ăn (không phải gợi ý)
  };

  const idx = dayEntry.meals.findIndex((m) => m.meal === mealLabel);
  if (idx !== -1) {
    dayEntry.meals[idx] = { ...dayEntry.meals[idx], ...updatedMeal };
  } else {
    dayEntry.meals.push(updatedMeal);
  }
  return next;
};

// Content "hỏng" = rỗng HOẶC degenerate (model lặp vô hạn 1 ký tự/cụm ngắn tới khi
// chạm max_tokens → không thể parse). Phát hiện để tự retry thay vì trả rác ra UI.
const _degenerate = (t = "") => /([^\s\\])\1{19,}/.test(t) || /(\S{2,4})\1{9,}/.test(t);
const _badContent = (c) => {
  const t = String(c?.choices?.[0]?.message?.content || "").trim();
  return !t || _degenerate(t);
};

// Gọi LLM an toàn. Hai lớp phòng thủ (các endpoint xử lý response_format khác nhau):
//   1) endpoint trả 400 vì không hỗ trợ response_format → retry không kèm.
//   2) endpoint trả 200 nhưng content RỖNG/DEGENERATE (model yếu đôi khi ra chuỗi
//      trống hoặc {"!!!!…) → retry (đổi seed + phạt lặp mạnh hơn, bỏ
//      response_format) để lấy được văn bản thật.
// Mọi body đi qua chatBody() để bỏ tham số chỉ-vLLM-hiểu trước khi lên mạng.
// Nhờ vậy chat không còn "im lặng" hay hiện JSON rác.
async function safeChatCreate(openai, payload, options = {}) {
  const { fallbackJson = null, label = "chat" } = options;
  const clonePayload = (src) => ({
    ...src,
    messages: Array.isArray(src.messages) ? src.messages.map((m) => ({ ...m })) : src.messages,
  });

  const makeSynthetic = (obj) => ({
    choices: [{ message: { content: JSON.stringify(obj || { reply: "" }) }, finish_reason: "fallback" }],
  });

  // QUAN TRỌNG: khi call gốc chạy temperature 0 mà ra rỗng/degenerate, đổi seed
  // không đủ. Phải nâng nhiệt + bỏ JSON mode/guided decoding ở các bước sau.
  const warmT = Math.max(0.65, Number(payload.temperature) || 0);
  const promptLen = payload.messages?.reduce((acc, m) => acc + String(m.content || "").length, 0) || 0;

  const variants = [];
  variants.push({ name: "original", body: clonePayload(payload) });

  {
    const f = clonePayload(payload);
    f.temperature = warmT;
    f.top_p = 0.9;
    f.max_tokens = Math.max(Number(f.max_tokens) || 0, 900);
    if (typeof f.seed === "number") f.seed += 7;
    // Phạt lặp đặt THẲNG top-level: cả OpenAI lẫn vLLM đều đọc ở đây.
    // (repetition_penalty là tham số riêng của vLLM và trước giờ nằm trong
    //  extra_body nên chưa từng có hiệu lực — bỏ hẳn, xem chatBody().)
    f.frequency_penalty = 0.8;
    f.presence_penalty = 0.45;
    variants.push({ name: "warm-json", body: f });
  }

  {
    const f = clonePayload(payload);
    delete f.response_format;
    delete f.extra_body;
    f.temperature = warmT;
    f.top_p = 0.92;
    f.max_tokens = Math.max(Number(f.max_tokens) || 0, 900);
    if (typeof f.seed === "number") f.seed += 17;
    variants.push({ name: "warm-bare", body: f });
  }

  {
    const f = clonePayload(payload);
    delete f.response_format;
    delete f.extra_body;
    f.temperature = 0.85;
    f.top_p = 0.95;
    f.max_tokens = Math.max(Number(f.max_tokens) || 0, 1200);
    if (typeof f.seed === "number") f.seed += 31;
    const lastUserIdx = Array.isArray(f.messages)
      ? [...f.messages].map((m, i) => [m, i]).reverse().find(([m]) => m?.role === "user")?.[1]
      : -1;
    if (lastUserIdx >= 0) {
      f.messages[lastUserIdx] = {
        ...f.messages[lastUserIdx],
        content: String(f.messages[lastUserIdx].content || "") +
          "\n\nNếu câu trả lời trước bị rỗng hoặc lặp dấu câu, hãy trả JSON ngắn hợp lệ ngay bây giờ. Không lặp ký tự. Không dùng markdown.",
      };
    }
    variants.push({ name: "anti-degenerate-bare", body: f });
  }

  let lastErr = null;
  for (const variant of variants) {
    try {
      const res = await openai.chat.completions.create(chatBody(variant.body));
      const content = res?.choices?.[0]?.message?.content || "";
      if (!_badContent(res) && !looksJunkReply(stripThinkBlocks(content))) return res;
      console.warn(`[safeChatCreate] ${label}/${variant.name}: content rỗng/degenerate (finish=${res?.choices?.[0]?.finish_reason || "?"}, chars=${String(content).length}, promptChars=${promptLen})`);
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.response?.status || err?.statusCode;
      console.warn(`[safeChatCreate] ${label}/${variant.name}: LLM lỗi status=${status}, promptChars=${promptLen}, err=${err?.message || err}`);

      // Một số endpoint không hỗ trợ response_format. Bỏ nó và thử tiếp variant sau.
      if (!(status === 400 && variant.body.response_format)) {
        continue;
      }
    }
  }

  // Tuyệt đối không trả content rỗng/rác ra UI. Nếu provider vẫn lỗi/rỗng sau mọi retry,
  // trả JSON fallback do code tạo để frontend luôn có reply hợp lệ.
  if (fallbackJson) {
    console.warn(`[safeChatCreate] ${label}: dùng fallbackJson sau khi model rỗng/degenerate.`);
    return makeSynthetic(fallbackJson);
  }

  if (lastErr) throw lastErr;
  return makeSynthetic({ reply: "" });
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(request) {
  const _t0 = Date.now();
  const res = makeRes();

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return res.status(401).json({ error: "Không tìm thấy mã xác thực" });

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });

  try {
    const formData = await request.formData();
    const fields = {};
    for (const [k, v] of formData.entries()) if (typeof v === "string") fields[k] = v;
    const imageFile = formData.get("image"); // Web File (or null) — no formidable

    const message = normalizeText(getFirst(fields.message));
    const isQueryOnly = String(getFirst(fields.isQueryOnly) ?? "false") === "true";
    const followupType = normalizeText(getFirst(fields.followupType));
    const mealDataRaw = normalizeText(getFirst(fields.mealData));
    const mealTime = normalizeText(getFirst(fields.mealTime));
    const mealDayText = normalizeText(getFirst(fields.mealDayText)) || normalizeText(getFirst(fields.mealDayValue));
    const pendingMealData = safeJsonParse(mealDataRaw);
    // Món đang HIỂN THỊ ở thẻ dinh dưỡng phía client (nguồn "sự thật" cho "món gần nhất":
    // đúng thứ tự người dùng nhìn thấy, không bị lệch như history/last_detected_meal ở server).
    const clientLastMeal = safeJsonParse(normalizeText(getFirst(fields.lastClientMeal)));
    // Cờ client báo đây là GỬI LẠI ảnh cũ kèm chỉnh sửa (re-analyze). Chỉ khi đó
    // mới bơm ngữ cảnh hội thoại vào vision; ẢNH MỚI luôn được phân tích với
    // context SẠCH (system + ảnh + câu hỏi) — tránh món trước "dẫn sai" món sau.
    const isReanalyze = normalizeText(getFirst(fields.reanalyze)) === "1";

    // ── LANGUAGE ──────────────────────────────────────────────────────────────
    const userLang = normalizeText(getFirst(fields.lang)) || "vi";
    const isEn = userLang === "en";
    const langInstruction = isEn
      ? "LANGUAGE — ABSOLUTE RULE: Respond ONLY in natural English. Even though the instructions and the examples below are written in Vietnamese, and even if the user's message or the chat history is in Vietnamese, your ENTIRE reply — every sentence, including the greeting and any follow-up question — MUST be in English. Never output any Vietnamese."
      : "NGÔN NGỮ — BẮT BUỘC: Trả lời 100% bằng TIẾNG VIỆT có dấu đầy đủ. KHÔNG dùng tiếng Anh hay ngôn ngữ khác.";
    // Nhắc lại ở cuối lượt user (đòn bẩy mạnh nhất để model chọn đúng ngôn ngữ đầu ra)
    const langReminder = isEn ? "\n\n[Reply in English only.]" : "";

    if (!message && !imageFile) return res.status(400).json({ error: "Thiếu dữ liệu." });

    const [{ data: profile, error: profileError }, foodsDB] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      fetchFoodsDB(),
    ]);

    if (profileError || !profile) return res.status(404).json({ error: "Người dùng không tồn tại" });

    // topK 6→5, maxChars 4500→2800: prompt gọn hơn → giảm mạnh ca model trả CONTENT
    // RỖNG ở nhánh analyze/coach (json_object + temp 0 + prompt DÀI dễ chốt EOS sớm).
    // Vẫn đủ ngữ cảnh KB cho tư vấn theo bệnh lý.
    const knowledge = await retrieveKnowledge({ message, disease: profile.disease, topK: 5, maxChars: 2800 });
    const knowledgeBlock = buildKnowledgeSection(knowledge);
    if (knowledge.chunks.length)
      console.log(`📚 [chat] ${knowledge.chunks.length} đoạn (mode=${knowledge.mode}, bệnh=${knowledge.usedDiseaseKeys.join(",") || "—"})`);

    let history = normalizeHistory(profile.chat_history || []);
    let currentPlan = Array.isArray(profile.weekly_plan) ? profile.weekly_plan : [];

    // Món đã phân tích GẦN NHẤT. Ưu tiên món CLIENT đang hiển thị (đúng thứ tự người dùng thấy),
    // rồi mới quét lịch sử từ DƯỚI LÊN, cuối cùng fallback last_detected_meal. Tránh lỗi recall
    // trả về món CŨ không khớp thẻ đang hiển thị. Tính SỚM để cấp ngữ cảnh cho vision (Lỗi #1).
    const lastAnalyzedMeal =
      (clientLastMeal && clientLastMeal.description)
        ? clientLastMeal
        : (findLastAnalyzedMealFromHistory(history) || profile.last_detected_meal || null);

    const now = new Date();
    let isDeadlinePassed = false;
    if (profile.deadline) {
      const d = new Date(profile.deadline);
      d.setHours(23, 59, 59, 999);
      isDeadlinePassed = now > d;
    }
    const effectiveIsQueryOnly = isQueryOnly || isDeadlinePassed;

    const formatDate = (di) => {
      let d = new Date(di);
      // "thứ 2", chuỗi rỗng... không phải ngày hợp lệ → dùng hôm nay (tránh "NaN/NaN/NaN")
      if (isNaN(d.getTime())) d = now;
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
      const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
      const base64Image = imageBuffer.toString("base64");
      userContent.push({ type: "image_url", image_url: { url: `data:${imageFile.type};base64,${base64Image}` } });

      let aiReply;
      let nutritionData = null;

      // Ưu tiên provider mạnh hơn (Gemini) nếu được cấu hình; lỗi -> tự về Qwen.
      if (visionProvider() === "gemini") {
        try {
          const food = await analyzeFoodImage({
            base64: base64Image,
            mimeType: imageFile.type,
            note: message,
            lang: userLang,
            // Lỗi #1: ngữ cảnh (món nhận diện trước + chỉnh sửa của user) CHỈ khi client
            // báo đây là gửi-lại-ảnh-để-sửa. Ảnh MỚI phân tích với context sạch —
            // không để món trước (vd cookies) dẫn sai món sau (vd sushi).
            contextNote: isReanalyze ? buildVisionContextNote(history, lastAnalyzedMeal, isEn) : "",
          });
          if (food && food.is_food === false) {
            const reply = isEn
              ? `I couldn't recognize any food in this image${food.reason ? ` (I see: ${food.reason})` : ""}. Please send a photo of a dish or drink instead!`
              : `Ảnh này mình không nhận ra là món ăn${food.reason ? ` (mình thấy: ${food.reason})` : ""}. Bạn gửi giúp mình ảnh món ăn hoặc đồ uống nhé!`;
            return res.status(200).json({ reply, username: profile.username });
          }
          if (food && food.food) {
            // Lưu nutritionData tạm — aiReply sẽ được build SAU khi DB lookup hoàn tất
            // để đảm bảo số liệu trong text = số liệu trong <data> JSON (không lệch nhau)
            nutritionData = {
              calories: food.calories,
              protein: food.protein,
              fat: food.fat,
              carbs: food.carbs,
              fiber: food.fiber,
              sugar: food.sugar,
              sodium: food.sodium,
              description: food.food,
              amount: food.amount || "1 phần",
              _geminiReplyPending: true, // flag: build reply sau khi DB override xong
            };
          }
        } catch (e) {
          console.error("[chat-image] vision lỗi, dùng Qwen:", e.message);
        }
      }

      // Mặc định / fallback: Qwen (mô tả hội thoại + <data>)
      if (aiReply === undefined) {
        const completion = await safeChatCreate(openai, {
          model: LLM_VISION_MODEL,
          // Mỗi lượt phân tích ẢNH = context SẠCH (system + ảnh + câu hỏi hiện tại).
          // CHỈ kèm history khi client báo gửi-lại-ảnh-để-sửa (re-analyze) — tránh
          // ảnh/kết quả trước rò rỉ vào lượt phân tích ảnh mới ("sushi thành cookies").
          messages: [
            { role: "system", content: buildNutritionPrompt(foodsDB, knowledgeBlock, profile, langInstruction) },
            ...(isReanalyze ? history.slice(-6) : []),
            { role: "user", content: isEn ? [...userContent, { type: "text", text: "[Reply in English only.]" }] : userContent },
          ],
          // 1600: reply hội thoại + <data> kèm items[] dài hơn trước — tránh bị cắt
          // cụt giữa JSON (nguyên nhân thẻ kcal không hiển thị).
          max_tokens: 1600,
          temperature: 0,
          top_p: 1,
          seed: 42,
        });

        aiReply = stripCJK(stripThinkBlocks(completion.choices[0]?.message?.content || ""));

        // Ảnh không phải món ăn
        const errMatch = aiReply.match(/<error>([\s\S]*?)<\/error>/i);
        if (errMatch) {
          const seen = errMatch[1].trim();
          const reply = isEn
            ? `I couldn't recognize any food in this image${seen ? ` (I see: ${seen})` : ""}. Please send a photo of a dish or drink instead!`
            : `Ảnh này mình không nhận ra là món ăn${seen ? ` (mình thấy: ${seen})` : ""}. Bạn gửi giúp mình ảnh món ăn hoặc đồ uống nhé!`;
          return res.status(200).json({ reply, username: profile.username });
        }

        aiReply = stripInternalSteps(aiReply);
        nutritionData = extractDataBlock(aiReply);
        if (nutritionData?.description) {
          nutritionData.description = stripCJK(String(nutritionData.description));
          const beforeName = nutritionData.description;
          nutritionData = correctCommonMisidentification(aiReply, nutritionData);
          // Đồng bộ tên đã sửa vào phần chữ để card & đoạn văn không mâu thuẫn.
          if (nutritionData.description !== beforeName) {
            aiReply = syncCorrectedNameInReply(aiReply, beforeName, nutritionData.description);
          }
        }
      }
      if (nutritionData?.description) {
        // ── NHÂN TỔNG THEO SỐ LƯỢNG BẰNG CODE (fix "3 cái bánh vẫn 180 kcal") ──
        // Model chỉ ĐẾM (items[].quantity) + cho số liệu 1 đơn vị; code tự nhân
        // Σ quantity × per_unit — không tin phép cộng của model. Đồng thời sửa
        // amount phản ánh đúng số lượng ("3 cái") để isStandardPortion bên dưới
        // KHÔNG cho DB override đè số liệu 1-suất lên khẩu phần nhiều cái.
        const itemTotals = computeTotalsFromItems(nutritionData.items);
        if (itemTotals) {
          nutritionData.calories = itemTotals.calories;
          if (itemTotals.protein != null) nutritionData.protein = `${itemTotals.protein}g`;
          if (itemTotals.fat != null) nutritionData.fat = `${itemTotals.fat}g`;
          if (itemTotals.carbs != null) nutritionData.carbs = `${itemTotals.carbs}g`;
          // count > 1 mà amount không khớp số đếm (vd model ghi "1 phần" dù đếm
          // được 3 items) -> LUÔN sửa amount theo số đếm; nếu không, isStandardPortion
          // vẫn true và DB override sẽ đè số 1-suất lên khẩu phần nhiều cái.
          if (itemTotals.count > 1) {
            const amtNum = parseFloat(String(nutritionData.amount || "").trim());
            if (!Number.isFinite(amtNum) || Math.round(amtNum) !== Math.round(itemTotals.count)) {
              nutritionData.amount = `${itemTotals.count} cái`;
            }
          }
        }
        // Validation trước khi dùng/lưu: chặn số âm + Atwater (kcal ~ 4P+4C+9F ±15%)
        // -> số liệu vision luôn tự nhất quán trước khi vào DB hay trả về client.
        {
          const fixedNut = validateAndFixNutrition(nutritionData);
          nutritionData = {
            ...nutritionData,
            calories: fixedNut.calories,
            protein: fixedNut.protein,
            fat: fixedNut.fat,
            carbs: fixedNut.carbs,
            fiber: fixedNut.fiber,
            sugar: fixedNut.sugar,
            sodium: fixedNut.sodium,
          };
        }
        // Chỉ override/lưu DB khi là MỘT SUẤT CHUẨN — khẩu phần lẻ giữ nguyên số
        // vision tính theo ảnh (yêu cầu: phân tích đúng định lượng nhìn thấy).
        const standardPortion = isStandardPortion(nutritionData.amount);
        const existing = standardPortion ? findFoodInDB(foodsDB, nutritionData.description) : null;
        if (existing) {
          // DB override: dùng số liệu chuẩn từ DB thay số AI ước tính
          nutritionData = {
            ...nutritionData,
            ...Object.fromEntries(
              ["calories", "protein", "fat", "carbs", "fiber", "sugar", "sodium"]
                .filter((k) => existing[k] != null)
                .map((k) => [k, existing[k]])
            ),
          };
        } else if (standardPortion) {
          await saveFoodRecord(nutritionData);
        }

        // ── Build Gemini reply SAU khi có nutritionData CUỐI CÙNG (đã qua DB override) ──
        // Build ngắn gọn: tên món + tư vấn thực tế. Số liệu để trong <data> cho sidebar.
        if (nutritionData._geminiReplyPending) {
          delete nutritionData._geminiReplyPending;
          const shortAdvice = buildShortAdvice(nutritionData, profile, langInstruction);
          aiReply = `**${nutritionData.description}**${nutritionData.amount && nutritionData.amount !== "1 phần" ? ` (${nutritionData.amount})` : ""} — ${shortAdvice}`;
        }

        // Gắn <data> tag vào cuối reply (cả Gemini lẫn Qwen path)
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

      // D: lưu ảnh vào nhật ký (chỉ khi nhận diện được món; fire-and-forget)
      if (nutritionData?.description) {
        saveFoodPhoto({ userId: user.id, buffer: imageBuffer, analysis: nutritionData, conversationRef: "chat" });
      }
      logUsage({ userId: user.id, kind: "chat_image", durationMs: Date.now() - _t0 }); // E

      return res.status(200).json({ reply: aiReply, username: profile.username });
    }

    // ── TEXT PATH ──────────────────────────────────────────────────────────────
    let finalMessage = message;
    const isMealFollowup = followupType === "meal_time_update" && pendingMealData && mealTime;

    // ── ĐÃ HOÀN THÀNH LỘ TRÌNH (qua deadline): không cập nhật nữa, chúc mừng người dùng ──
    if (isMealFollowup && isDeadlinePassed) {
      const dishName = stripCJK(String(pendingMealData.description || (isEn ? "this dish" : "món ăn")));
      const reply = isEn
        ? `Congratulations on brilliantly completing your entire nutrition journey! ` +
          `This is a milestone to be truly proud of — it shows real commitment and dedication to your health. ` +
          `Since the journey has wrapped up, I'll hold off on logging "${dishName}" into your menu. ` +
          `Whenever you're ready for a new chapter, just head to the Plan section to set your next goal and I'll be right there with you.`
        : `Chúc mừng bạn đã xuất sắc hoàn thành trọn vẹn lộ trình dinh dưỡng của mình! ` +
          `Đây là một cột mốc rất đáng tự hào, cho thấy bạn đã thực sự kiên trì và nghiêm túc với sức khỏe của bản thân. ` +
          `Vì lộ trình đã khép lại nên mình tạm dừng việc ghi món "${dishName}" vào thực đơn. ` +
          `Khi sẵn sàng cho chặng đường mới, bạn chỉ cần vào mục Lộ trình để đặt mục tiêu tiếp theo, mình sẽ đồng hành cùng bạn ngay nhé.`;
      return res.status(200).json({
        success: true,
        reply: stripCJK(reply),
        action: "analyze_only",
        planCompleted: true,
        isDeadlinePassed: true,
        username: profile.username,
      });
    }

    if (isMealFollowup) {
      // Xác định dayIndex (1-7) để AI coach biết chính xác ngày cần update trong plan
      const followupDayIndex = dayOfWeek === 0 ? 7 : dayOfWeek; // CN=0 -> 7
      const mealLabelNorm = {
        sáng: "Sáng", trưa: "Trưa", tối: "Tối", chiều: "Tối",
        "bữa phụ": "Phụ", phụ: "Phụ",
      }[String(mealTime).toLowerCase().trim()] || mealTime;

      finalMessage = `[XÁC NHẬN BỮA ĂN THỰC TẾ - BẮT BUỘC UPDATE PLAN]
Người dùng đã ăn: "${pendingMealData.description || "món ăn"}"
Bữa: ${mealLabelNorm} | Ngày trong tuần: day ${followupDayIndex} (${currentDayName}) | Ngày: ${resolvedDayText}
Calories: ${pendingMealData.calories ?? "N/A"} kcal | Protein: ${pendingMealData.protein || "N/A"} | Fat: ${pendingMealData.fat || "N/A"} | Carbs: ${pendingMealData.carbs || "N/A"} | Fiber: ${pendingMealData.fiber || "N/A"} | Sugar: ${pendingMealData.sugar || "N/A"} | Sodium: ${pendingMealData.sodium || "N/A"}

YÊU CẦU BẮT BUỘC:
1. action PHẢI LÀ "update_plan".
2. Thay thế ĐÚNG bữa ${mealLabelNorm} của ngày ${followupDayIndex} (${currentDayName}) bằng món người dùng vừa ăn.
3. Tái cân bằng các bữa còn lại trong ngày để tổng calo ~ ${profile.target_calories || "1500-1800"} kcal (+/-150 kcal).
4. Trả về newPlan ĐẦY ĐỦ 7 ngày, KHÔNG để mảng rỗng.
Nếu không thể update thì trả về analyze_only và newPlan=[].`;
    }

    // recentMealBlock: cấp NGỮ CẢNH cho LLM (lastAnalyzedMeal đã tính sớm ở trên) -> dù KHÔNG
    // khớp keyword nào, model vẫn có dữ liệu đúng để trả lời "món gần nhất" (không đoán bừa).
    const recentMealBlock = lastAnalyzedMeal?.description
      ? (isEn
          ? `\nMOST RECENTLY ANALYZED DISH: "${lastAnalyzedMeal.description}" (${lastAnalyzedMeal.calories ?? "?"} kcal | P:${lastAnalyzedMeal.protein ?? "?"} F:${lastAnalyzedMeal.fat ?? "?"} C:${lastAnalyzedMeal.carbs ?? "?"}). If the user refers to their "last / latest / most recent / previous / just-eaten" dish or meal, answer based on THIS dish.\n`
          : `\nMÓN VỪA PHÂN TÍCH GẦN NHẤT: "${lastAnalyzedMeal.description}" (${lastAnalyzedMeal.calories ?? "?"} kcal | P:${lastAnalyzedMeal.protein ?? "?"} F:${lastAnalyzedMeal.fat ?? "?"} C:${lastAnalyzedMeal.carbs ?? "?"}). Nếu người dùng nhắc tới "món gần nhất / vừa rồi / mới nhất / cuối cùng / vừa ăn", hãy trả lời DỰA VÀO món này.\n`)
      : "";

    // ── RECALL: xem/phân tích LẠI món vừa phân tích gần nhất (không có ảnh mới) ──
    // Khớp keyword -> trả nhanh, KHÔNG gọi LLM. Không khớp -> vẫn để LLM xử lý,
    // nhưng LLM đã được cấp recentMealBlock nên vẫn trả lời đúng món gần nhất.
    if (!isMealFollowup && RECALL_RECENT_RE.test(finalMessage) && !RECALL_BLOCK_RE.test(finalMessage)) {
      const recentMeal = lastAnalyzedMeal;
      if (recentMeal?.description) {
        const name = stripCJK(String(recentMeal.description || "món ăn"));
        const advice = buildShortAdvice(recentMeal, profile, langInstruction);
        let recallReply = isEn
          ? `Here's the most recent dish I analyzed — **${name}**. ${advice}`
          : `Đây là món bạn vừa phân tích gần nhất — **${name}**. ${advice}`;
        recallReply = `${stripDataBlocks(recallReply)}\n${buildDataTag(recentMeal)}`;

        const recallHistory = truncateHistory([
          ...history,
          { role: "user", content: finalMessage },
          { role: "assistant", content: recallReply },
        ], 20);
        // Đồng bộ last_detected_meal = món vừa recall để server & thẻ hiển thị không lệch nhau.
        await supabase.from("profiles").update({
          chat_history: recallHistory,
          last_detected_meal: recentMeal,
        }).eq("id", user.id);

        return res.status(200).json({
          success: true,
          reply: recallReply,
          action: "analyze_only",
          needsClarification: false,
          clarifyQuestion: "",
          newPlan: currentPlan,
          username: profile.username,
          isDeadlinePassed,
        });
      }
      // Không có món đã lưu -> nhắc người dùng gửi ảnh/mô tả (thay vì AI trả lời lạc đề).
      const noRecall = isEn
        ? "I don't have a recently analyzed dish saved yet. Please send a food photo or describe the dish and I'll analyze it!"
        : "Mình chưa lưu món nào vừa phân tích gần đây. Bạn gửi ảnh hoặc mô tả món ăn để mình phân tích nhé!";
      return res.status(200).json({
        success: true,
        reply: noRecall,
        action: "analyze_only",
        needsClarification: false,
        clarifyQuestion: "",
        newPlan: currentPlan,
        username: profile.username,
        isDeadlinePassed,
      });
    }

    const intent = isMealFollowup
      ? "coach"
      : effectiveIsQueryOnly
        ? "analyze"
        : detectIntent(finalMessage);

    console.log(`[chat] intent=${intent} queryOnly=${effectiveIsQueryOnly} msg="${finalMessage.slice(0, 60)}"`);

    // ── NGƯỜI DÙNG NHẮN "TẠO LẠI THỰC ĐƠN" → tái tạo TOÀN BỘ tuần ──────────────
    // Không cần nút: chỉ cần nhắn. Dùng CHUNG bộ tạo ROBUST của /api/coach-dynamic
    // (force_regenerate) — đã có completeness-guard + đủ 4 bữa/ngày kể cả bữa Phụ —
    // để KHÔNG nhân đôi logic tạo thực đơn.
    if (!isMealFollowup && !effectiveIsQueryOnly && !isDeadlinePassed && FULL_REGEN_RE.test(finalMessage)) {
      try {
        const origin = new URL(request.url).origin;
        const rr = await fetch(`${origin}/api/coach-dynamic`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ force_regenerate: true }),
        });
        const dd = await rr.json().catch(() => ({}));
        if (rr.ok && dd.success && Array.isArray(dd.newPlan) && dd.newPlan.length) {
          const reply = isEn
            ? "Done! I regenerated your full 7-day plan — 4 meals a day including a snack. Open the **Plan** tab to see it. 🍽️"
            : "Đã xong! Mình vừa **tạo lại thực đơn 7 ngày** đầy đủ — 4 bữa mỗi ngày, có cả **bữa Phụ**. Bạn mở tab **Lịch (PLAN)** để xem nhé! 🍽️";
          const regenHistory = truncateHistory([
            ...history,
            { role: "user", content: finalMessage },
            { role: "assistant", content: reply },
          ], 20);
          await supabase.from("profiles").update({ chat_history: regenHistory }).eq("id", user.id);
          logUsage({ userId: user.id, kind: "chat_regen_plan", durationMs: Date.now() - _t0 });
          return res.status(200).json({
            success: true, reply, action: "update_plan", needsClarification: false,
            clarifyQuestion: "", newPlan: dd.newPlan, username: profile.username, isDeadlinePassed,
          });
        }
        console.warn(`[chat] full-regen: coach-dynamic không trả plan hợp lệ (HTTP ${rr.status})`);
      } catch (e) {
        console.warn("[chat] full-regen internal call lỗi:", e.message);
      }
      // Lỗi → rơi xuống luồng coach thường bên dưới (vẫn cố gắng cập nhật)
    }

    // FAST PATH: Với câu hỏi phân tích món/định lượng rõ ràng, resolveNutrition đã cho số
    // deterministic (log: [nutrition] scale ...). Không cần gọi LLM chỉ để viết 1 câu,
    // tránh lỗi provider Qwen trả content rỗng hoặc lặp toàn dấu "!".
    // Điều kiện vào fast path phải CHẶT, vì nhánh này lấy NGUYÊN VĂN tin nhắn làm
    // tên món (`description: finalMessage`) rồi tra dinh dưỡng cho nó. Chỉ cần
    // câu không thực sự nêu tên món là ra một thẻ calo bịa cho chính câu hỏi của
    // người dùng, kèm bảng "Xác nhận bữa ăn" — đúng lỗi đang thấy.
    //   • FOOD_DISH_RE: phải nêu ĐÍCH DANH một món/nguyên liệu. Chỉ có "ăn",
    //     "bữa", "phần"… thì chẳng có món nào để tra.
    //   • !ADVICE_QUESTION_RE: câu xin lời khuyên / khai bệnh thì để LLM trả lời,
    //     đừng đem cả câu đi tra calo.
    // Không khớp thì rơi xuống nhánh LLM bên dưới như mọi câu khác — không mất
    // tính năng nào, chỉ mất đường tắt vốn không dùng được cho câu đó.
    if (!isMealFollowup && intent === "analyze"
        && FOOD_DISH_RE.test(finalMessage) && !ADVICE_QUESTION_RE.test(finalMessage)) {
      const quickMeal = { description: finalMessage, amount: "1 phần" };
      try {
        const resolvedQuickMeal = await resolveNutrition({
          meal: quickMeal,
          food: finalMessage,
          mealLabel: mealTime || "",
          foodsDB,
          traceId: "chat_fast",
        });
        if (resolvedQuickMeal?.description && Number(resolvedQuickMeal.calories) > 0) {
          let quickReply = buildAnalyzeFallbackReply({ mealData: resolvedQuickMeal, profile, finalMessage, isEn });
          if (EATEN_INTENT_RE.test(finalMessage)) quickReply = appendMealTimeFollowUp(quickReply, finalMessage, userLang);
          else quickReply = stripMealTimeQuestion(quickReply);
          quickReply = `${stripDataBlocks(quickReply)}\n${buildDataTag(resolvedQuickMeal)}`;

          const quickHistory = truncateHistory([
            ...history,
            { role: "user", content: finalMessage },
            { role: "assistant", content: quickReply },
          ], 20);

          await supabase.from("profiles").update({
            chat_history: quickHistory,
            last_detected_meal: resolvedQuickMeal,
          }).eq("id", user.id);

          logUsage({ userId: user.id, kind: "chat_text", durationMs: Date.now() - _t0 });
          return res.status(200).json({
            success: true,
            reply: quickReply,
            action: "analyze_only",
            needsClarification: false,
            clarifyQuestion: "",
            newPlan: currentPlan,
            username: profile.username,
            isDeadlinePassed,
          });
        }
      } catch (e) {
        console.warn("[chat_fast] resolveNutrition lỗi, chuyển qua LLM:", e.message);
      }
    }

    let aiReply = "";
    let action = "analyze_only";
    let needsClarification = false;
    let clarifyQuestion = "";
    let resultMealData = null;

    // ── CASUAL PATH ────────────────────────────────────────────────────────────
    if (intent === "casual") {
      const casualFallback = buildCasualFallbackReply({ profile, isEn });
      const casualCompletion = await safeChatCreate(openai, {
        model: LLM_MODEL,
        messages: [
          { role: "system", content: buildCasualPrompt(profile, langInstruction) },
          ...history.slice(-4),
          { role: "user", content: finalMessage + langReminder },
        ],
        response_format: { type: "json_object" },
        max_tokens: 300,
        temperature: 0.5,
        // Chống "lặp vô hạn" (444444/!!!!!!/CJK) khiến JSON hỏng → reply rỗng. Đặt
        // Phạt CỐ ĐỊNH nên vẫn deterministic. Đặt top-level: cả OpenAI lẫn vLLM đều đọc.
        frequency_penalty: 0.5, presence_penalty: 0.3,
      }, { label: "casual", fallbackJson: { reply: casualFallback } });

      const rawContent = casualCompletion.choices[0]?.message?.content || "{}";
      const result = parseModelJson(rawContent);
      aiReply = safeReplyText(result.reply) || casualFallback;
      action = "analyze_only";

    // ── ANALYZE PATH ──────────────────────────────────────────────────────────
    } else if (intent === "analyze") {
      const analyzeFallback = buildAnalyzeFallbackReply({ mealData: null, profile, finalMessage, isEn });
      const analyzeCompletion = await safeChatCreate(openai, {
        model: LLM_MODEL,
        messages: [
          { role: "system", content: buildAnalyzePrompt({ profile, foodsDB, knowledgeBlock, langInstruction, recentMealBlock }) },
          ...history.slice(-4),
          { role: "user", content: finalMessage + langReminder },
        ],
        response_format: { type: "json_object" },
        // Rộng hơn (700→1100): khi có knowledgeBlock (KB PDF) prompt dài, reply dễ
        // bị cắt cụt giữa chừng → JSON hỏng. Cho thêm chỗ để hoàn tất JSON.
        max_tokens: 1100,
        // Deterministic (Bug #1): cùng câu hỏi luôn cùng nhận diện món/định lượng.
        // Con số cuối cùng do resolveNutrition tính lại nên toàn pipeline lặp lại được.
        temperature: 0,
        top_p: 1,
        seed: 42,
        // Chống lặp (phạt CỐ ĐỊNH nên vẫn deterministic).
        frequency_penalty: 0.5, presence_penalty: 0.3,
      }, { label: "analyze", fallbackJson: { reply: analyzeFallback, mealData: null } });

      const rawContent = analyzeCompletion.choices[0]?.message?.content || "{}";
      const result = parseModelJson(rawContent);
      resultMealData = (result.mealData && typeof result.mealData === "object") ? result.mealData : null;
      aiReply = safeReplyText(result.reply) || buildAnalyzeFallbackReply({ mealData: resultMealData, profile, finalMessage, isEn });
      action = "analyze_only";

    // ── COACH PATH ────────────────────────────────────────────────────────────
    } else {
      const coachFallback = buildCoachFallbackReply({ isMealFollowup, pendingMealData, mealTime, isEn });
      const coachCompletion = await safeChatCreate(openai, {
        model: LLM_MODEL,
        messages: [
          {
            role: "system", content: buildCoachPrompt({
              profile, currentPlan, currentDayName, dayOfWeek,
              message: finalMessage, isQueryOnly: effectiveIsQueryOnly,
              isDeadlinePassed, foodsDB, knowledgeBlock, langInstruction, recentMealBlock,
            }),
          },
          ...history.slice(-4),
          { role: "user", content: finalMessage + langReminder },
        ],
        response_format: { type: "json_object" },
        max_tokens: 2500,
        temperature: 0.2,
        // Chống lặp vô hạn khiến JSON plan hỏng.
        frequency_penalty: 0.5, presence_penalty: 0.3,
      }, { label: "coach", fallbackJson: {
        reply: coachFallback,
        action: isMealFollowup ? "analyze_only" : "ask_clarify",
        needsClarification: !isMealFollowup,
        clarifyQuestion: isMealFollowup ? "" : coachFallback,
        newPlan: [],
        mealData: null,
      } });

      const rawContent = coachCompletion.choices[0]?.message?.content || "{}";
      const result = parseModelJson(rawContent);

      aiReply = safeReplyText(result.reply) || coachFallback;
      action = String(result.action || "analyze_only");
      needsClarification = Boolean(result.needsClarification);
      clarifyQuestion = String(result.clarifyQuestion || "");

      if (action === "update_plan" && Array.isArray(result.newPlan) && result.newPlan.length > 0) {
        currentPlan = result.newPlan;
        await supabase.from("profiles").update({ weekly_plan: currentPlan, plan_updated_at: now }).eq("id", user.id);
        savePlanToFoods(currentPlan).catch((e) => console.error("❌ savePlanToFoods:", e.message));
        console.log(`[chat] ✅ Đã cập nhật weekly_plan (${currentPlan.length} ngày) sau coach update_plan`);
      }

      // ── FIX: Nếu isMealFollowup=true nhưng AI trả analyze_only (không tự update plan),
      //         ta tự áp món vừa ăn vào đúng ngày/bữa tương ứng trong plan hiện tại.
      //         Điều này đảm bảo thời khóa biểu LUÔN được cập nhật sau khi user xác nhận bữa.
      if (isMealFollowup && action !== "update_plan" && pendingMealData && mealTime) {
        const updatedPlan = applyMealToPlan({
          plan: currentPlan,
          mealData: pendingMealData,
          mealTime,
          mealDayText,
          dayOfWeek,
        });
        if (updatedPlan) {
          currentPlan = updatedPlan;
          await supabase.from("profiles").update({ weekly_plan: currentPlan, plan_updated_at: now }).eq("id", user.id);
          savePlanToFoods(currentPlan).catch((e) => console.error("❌ savePlanToFoods (fallback):", e.message));
          console.log(`[chat] ✅ Fallback: Đã áp món "${pendingMealData.description}" vào bữa ${mealTime} ngày ${mealDayText}`);
          action = "update_plan";
        }
      }

      resultMealData = (result.mealData && typeof result.mealData === "object") ? result.mealData : null;
      if (!resultMealData?.description) {
        const inline = extractDataBlock(aiReply);
        if (inline?.description) resultMealData = inline;
      }
    }

    // Guard reply RỖNG: nếu model "degenerate" làm JSON hỏng → reply parse ra rỗng,
    // đừng để người dùng thấy bong bóng trống. Trả câu thân thiện gợi ý thử lại.
    if (!safeReplyText(aiReply)) {
      aiReply = intent === "casual"
        ? buildCasualFallbackReply({ profile, isEn })
        : intent === "analyze"
          ? buildAnalyzeFallbackReply({ mealData: resultMealData, profile, finalMessage, isEn })
          : buildCoachFallbackReply({ isMealFollowup, pendingMealData, mealTime, isEn });
    } else {
      aiReply = safeReplyText(aiReply);
    }

    // ── PIPELINE DINH DƯỠNG THỐNG NHẤT (Bug #1 + #4) ─────────────────────────
    // Mọi mealData của Chat (analyze lẫn coach) đi qua CÙNG engine với Plan:
    // resolveNutrition = parseQuantity → mốc chuẩn cached (USDA → OpenFoodFacts →
    // tham chiếu VN → AI temp 0) → scale tuyến tính → Atwater. LLM chỉ NHẬN DIỆN
    // món + định lượng; CON SỐ do engine tính → lặp lại y hệt giữa các lần gọi.
    // Engine không tính được → giữ số LLM nhưng vẫn validate (hành vi cũ).
    if (resultMealData?.description) {
      resultMealData.description = stripCJK(String(resultMealData.description));
      try {
        resultMealData = await resolveNutrition({
          meal: resultMealData,
          food: resultMealData.description,
          mealLabel: mealTime || "",
          foodsDB,
          traceId: "chat",
        });
      } catch (e) {
        console.warn("[chat] resolveNutrition lỗi, dùng số LLM + validation:", e.message);
        const fixedNut = validateAndFixNutrition(resultMealData);
        resultMealData = {
          ...resultMealData,
          calories: fixedNut.calories,
          protein: fixedNut.protein,
          fat: fixedNut.fat,
          carbs: fixedNut.carbs,
          fiber: fixedNut.fiber,
          sugar: fixedNut.sugar,
          sodium: fixedNut.sodium,
        };
      }
    }

    // Chỉ hỏi "bạn ăn vào bữa nào" khi (Lỗi #2):
    //   (1) chưa xác nhận bữa (không phải meal followup response),
    //   (2) không phải hội thoại casual,
    //   (3) THỰC SỰ nhận diện được một MÓN CỤ THỂ để ghi nhận (có mealData),
    //   (4) người dùng THỰC SỰ vừa ăn / muốn ghi nhận (EATEN_INTENT_RE) — KHÔNG hỏi khi
    //       chỉ hỏi kiến thức, chỉnh sửa tên món, hay trò chuyện.
    // Ngược lại: nếu model TỰ chèn câu hỏi bữa ăn dù không phải tình huống ghi nhận -> XOÁ đi.
    const wantsMealLog =
      !isMealFollowup &&
      intent !== "casual" &&
      resultMealData?.description &&
      EATEN_INTENT_RE.test(finalMessage) &&
      // "tôi bị tiểu đường thì nên ăn gì" có chữ "ăn" nên EATEN_INTENT_RE vẫn
      // khớp, nhưng đó là câu XIN LỜI KHUYÊN chứ không phải khai báo vừa ăn —
      // hỏi lại "bạn ăn vào bữa nào?" là lạc đề.
      !ADVICE_QUESTION_RE.test(finalMessage) &&
      (action === "analyze_only" || (!needsClarification && action === "ask_clarify"));

    if (wantsMealLog) {
      aiReply = appendMealTimeFollowUp(aiReply, finalMessage, userLang);
    } else if (!isMealFollowup) {
      aiReply = stripMealTimeQuestion(aiReply);
    }

    if (action === "analyze_only" && !isMealFollowup && resultMealData?.description) {
      aiReply = `${stripDataBlocks(aiReply)}\n${buildDataTag(resultMealData)}`;
    }

    const newHistory = truncateHistory([
      ...history,
      { role: "user", content: finalMessage },
      { role: "assistant", content: aiReply },
    ], 20);

    // Lưu món vừa phân tích để sau này "phân tích lại món gần nhất" tìm được.
    await supabase.from("profiles").update({
      chat_history: newHistory,
      ...(resultMealData?.description ? { last_detected_meal: resultMealData } : {}),
    }).eq("id", user.id);

    logUsage({ userId: user.id, kind: "chat_text", durationMs: Date.now() - _t0 }); // E
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
