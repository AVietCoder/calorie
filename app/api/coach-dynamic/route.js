import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase.js";
import { retrieveKnowledge, buildKnowledgeSection } from "../../../lib/knowledge.js";
// Local LLM (vLLM) via OpenAI-compatible client. See lib/llm.js.
import { llm as openai, LLM_MODEL } from "../../../lib/llm.js";
// Pipeline dinh dưỡng nhất quán: chuẩn hóa đơn vị (ml/l/g/kg/muỗng/ly/quả/miếng...),
// mốc /100g|ml hoặc /1 đơn vị (USDA → OpenFoodFacts → FOODS DB → AI temp 0, có cache)
// rồi scale TUYẾN TÍNH toàn bộ chất + validation Atwater. Xem lib/nutrition.js.
import { estimateFoodSmart } from "../../../lib/nutrition.js";
// E: ghi nhật ký sử dụng AI (fire-and-forget).
import { logUsage } from "../../../lib/usage-log.js";
import { CORS_HEADERS, corsJson, corsOptions } from "../../../lib/cors.js";

export const maxDuration = 300;

// Express-shaped `res` shim — see app/api/chat/route.js for the rationale.
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

const MODEL = LLM_MODEL;
const DEBUG =
  process.env.DEBUG_COACH === "1" || process.env.NODE_ENV !== "production";

const MEALS_PER_DAY = ["Sáng", "Trưa", "Tối", "Phụ"];
const TOTAL_DAYS = 7;

/** Ngân sách thời gian cho TOÀN BỘ các lượt gọi LLM của một request sinh plan.
 *
 *  Từ khi chuyển sang sinh SONG SONG theo ngày (xem generatePlanByDays), một
 *  lượt sinh đầy đủ đo được ~10s nên ngân sách này gần như không bao giờ chạm
 *  tới. Vẫn giữ làm phanh cuối: nếu server LLM chậm bất thường hay vài ngày
 *  phải bù lại, ngân sách bảo đảm còn thời gian LƯU "plan tốt nhất có thể" và
 *  trả lời tử tế, thay vì bị maxDuration=300 cắt ngang và mất trắng. */
const AI_BUDGET_MS = 210_000;
const outOfBudget = (deadline) => Number.isFinite(deadline) && Date.now() >= deadline;

/**
 * Chống sinh trùng: mỗi user chỉ có MỘT lượt sinh plan đang chạy.
 *
 * Bấm hai lần, hoặc mở app rồi mở luôn web, là hai request cùng vào nhánh sinh
 * và cùng gọi 7 lượt LLM — gấp đôi tải, hai kết quả ghi đè nhau, và người dùng
 * nhận về thực đơn của lượt nào tới sau. Ở đây request thứ hai KHÔNG sinh mới
 * mà chờ chính lượt đang chạy rồi dùng chung kết quả.
 *
 * GIỚI HẠN đã biết: Map nằm trong bộ nhớ của MỘT instance serverless, nên hai
 * request rơi vào hai instance khác nhau vẫn lọt. Nó chặn được đúng ca phổ biến
 * nhất (double-tap, cùng phiên, instance đang ấm). Muốn chặn tuyệt đối thì phải
 * có khoá trong DB — việc đó cần thêm cột nên để riêng.
 */
const inFlightPlans = new Map();

function dedupePlanRun(userId, run) {
  const existing = inFlightPlans.get(userId);
  if (existing) return { promise: existing, deduped: true };
  const p = run().finally(() => inFlightPlans.delete(userId));
  inFlightPlans.set(userId, p);
  return { promise: p, deduped: false };
}

/* =========================================================
 * 0. DEBUG / LOGGER
 * ========================================================= */
const log = {
  info: (s, d) => console.log(`ℹ️  [${s}]`, d ?? ""),
  warn: (s, d) => console.warn(`⚠️  [${s}]`, d ?? ""),
  error: (s, e) =>
    console.error(`❌ [${s}]`, e?.message || e, e?.stack || ""),
  step: (s) => console.log(`➡️  [${s}] ...`),
};
const newTraceId = () =>
  `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const sendError = (res, status, stage, message, extra = {}) => {
  log.error(stage, message);
  return res.status(status).json({
    success: false,
    error: message,
    stage,
    diagnostics: DEBUG ? extra : undefined,
  });
};

/* =========================================================
 * 1. HELPERS
 * ========================================================= */
const setCorsHeaders = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const getAuthUser = async (req) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return { error: "Thiếu Authorization header", status: 401, detail: {} };
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return {
      error: "Token không hợp lệ hoặc đã hết hạn",
      status: 401,
      detail: { supabaseError: error?.message },
    };
  }
  return { user };
};

const normalizeFoodName = (name = "") =>
  String(name).trim().toLowerCase().replace(/\s+/g, " ");

const parseNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Cắt phần JSON cân bằng ngoặc {} hoặc [] đầu tiên, BỎ QUA nội dung trong chuỗi.
// Vá được ca model "degenerate" (lặp vô hạn 444444/!!!!!! rồi chạm max_tokens) —
// khi đó object mở nhưng không đóng: ta tự đóng các ngoặc còn thiếu và parse thử.
const balancedSalvage = (s) => {
  const open = s.search(/[[{]/);
  if (open < 0) return null;
  const tryP = (t) => { try { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1")); } catch { return null; } };
  let dObj = 0, dArr = 0, inStr = false, esc = false, lastClose = -1;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") dObj++;
    else if (ch === "}") { dObj--; if (dObj >= 0 && dArr >= 0) lastClose = i; }
    else if (ch === "[") dArr++;
    else if (ch === "]") { dArr--; if (dObj >= 0 && dArr >= 0) lastClose = i; }
    if (dObj === 0 && dArr === 0 && lastClose === i) {
      const p = tryP(s.slice(open, i + 1));
      if (p) return p;
    }
  }
  // Không có điểm đóng cân bằng hoàn chỉnh → thử đóng tại lần đóng hợp lệ cuối cùng,
  // rồi tự bù các ngoặc còn thiếu (JSON bị cắt cụt giữa chừng vì degenerate/truncate).
  if (lastClose > open) { const p = tryP(s.slice(open, lastClose + 1)); if (p) return p; }
  if (!inStr && (dObj > 0 || dArr > 0)) {
    const p = tryP(s.slice(open) + "]".repeat(Math.max(0, dArr)) + "}".repeat(Math.max(0, dObj)));
    if (p) return p;
  }
  return null;
};

// Model "degenerate": lặp vô hạn 1 ký tự (!!!!!, 44444) hoặc 1 cụm ngắn cho tới
// khi chạm max_tokens → JSON hỏng dạng {"!!!!!!!…". Thu gọn các đoạn lặp bất
// thường để phần JSON hợp lệ PHÍA TRƯỚC còn salvage được. Chỉ dùng ở nhánh salvage.
const collapseDegenerate = (s = "") =>
  String(s)
    .replace(/([^\s\\])\1{6,}/g, "$1$1$1")   // 1 ký tự lặp ≥7 lần → 3
    .replace(/(\S{2,4})\1{5,}/g, "$1$1");     // cụm 2-4 ký tự lặp ≥6 lần → 2

// Phát hiện phản hồi "rác/degenerate" NGAY TRÊN RAW trước khi parse: rỗng, chỉ
// gồm 1 ký tự lặp (!!!!!, 44444) hoặc cụm ngắn lặp (okokok), hoặc không có JSON.
const looksJunkReply = (raw = "") => {
  const t = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!t) return true;
  if (!/[{\[]/.test(t)) return true;                 // không có JSON nào
  const c = t.replace(/\s+/g, "");
  if (/(.)\1{15,}/.test(c)) return true;             // 1 ký tự lặp ≥16 lần
  if (/(.{2,5})\1{8,}/.test(c)) return true;         // cụm 2-5 ký tự lặp ≥9 lần
  return false;
};

const safeParseAIJson = (raw) => {
  if (!raw) throw new Error("AI trả về rỗng");
  let cleaned = String(raw)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")      // bỏ khối suy nghĩ nếu lọt ra
    // Bỏ ký tự CJK/Nhật/Hàn (model đôi khi "degenerate" chèn キッチン要求...) —
    // JSON của app chỉ dùng Latin/tiếng Việt có dấu nên xoá an toàn.
    .replace(/[㐀-䶿一-鿿豈-﫿぀-ヿ＀-ﾟ]/g, "")
    .trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    // Thử salvage trên CẢ bản gốc lẫn bản đã thu gọn đoạn lặp (chống {"!!!!…).
    for (const src of [cleaned, collapseDegenerate(cleaned)]) {
      // 1) Khối JSON cân bằng ngoặc (chịu được rác đứng sau / chuỗi có ký tự lạ)
      const salvaged = balancedSalvage(src);
      if (salvaged) return salvaged;
      // 2) Cách cũ: chộp cụm [] hoặc {} lớn nhất + bỏ dấu phẩy thừa
      const m = src.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (m) {
        try { return JSON.parse(m[0]); } catch {}
        try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, "$1")); } catch {}
      }
    }
    throw new Error("AI JSON không hợp lệ. Preview: " + cleaned.slice(0, 300));
  }
};

// Tham số decode CHỐNG "lặp vô hạn": phạt lặp token để model không rơi vào vòng
// 444444/!!!!!! rồi sinh JSON hỏng. frequency/presence là chuẩn OpenAI; vLLM còn
// đọc thêm repetition_penalty trong extra_body. boost>0 dùng cho lần retry.
const antiLoopParams = (boost = 0) => ({
  frequency_penalty: 0.5 + boost,
  presence_penalty: 0.3,
  extra_body: {
    chat_template_kwargs: { enable_thinking: false },
    repetition_penalty: 1.15 + boost,
  },
});

/** Gọi LLM sinh JSON có CHỐNG LẶP + TỰ RETRY 1 lần khi parse hỏng.
 *  Degenerate thường phụ thuộc seed/thời điểm → thử lại với seed khác + phạt lặp
 *  mạnh hơn gần như luôn cứu được, thay vì bắn lỗi rác ra người dùng.
 *  @returns {Promise<{parsed:any, raw:string}>}  ném lỗi nếu cả 2 lần đều hỏng. */
const completeJsonWithRetry = async ({ messages, temperature = 0.2, max_tokens = 2000, seed = null, traceId = "", tag = "json", deadline = Infinity }) => {
  const build = (boost, seedShift, tempBump) => {
    const al = antiLoopParams(boost);
    return {
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: Math.min(1, temperature + tempBump),
      ...(seed != null ? { seed: seed + seedShift, top_p: 1 } : {}),
      max_tokens,
      frequency_penalty: al.frequency_penalty,
      presence_penalty: al.presence_penalty,
      extra_body: al.extra_body,
    };
  };
  const runOnce = async (boost, seedShift, tempBump) => {
    const c = await openai.chat.completions.create(build(boost, seedShift, tempBump));
    const raw = c.choices?.[0]?.message?.content ?? "";
    if (looksJunkReply(raw)) throw new Error("phản hồi rỗng/degenerate");
    return { parsed: safeParseAIJson(raw), raw };
  };
  // Nhiều lần thử với seed + phạt lặp + nhiệt độ TĂNG DẦN. Degenerate phụ thuộc
  // seed/thời điểm nên đổi seed gần như luôn cứu được, thay vì bắn lỗi rác ra người dùng.
  const attempts = [
    [0,   0,  0],
    [0.2, 9,  0.1],
    [0.4, 21, 0.25],
  ];
  let lastErr;
  for (let k = 0; k < attempts.length; k++) {
    if (k > 0 && outOfBudget(deadline)) {
      log.warn(`${traceId} | ${tag} hết ngân sách thời gian, dừng retry ở lần ${k}`);
      break;
    }
    try {
      return await runOnce(...attempts[k]);
    } catch (e) {
      lastErr = e;
      log.warn(`${traceId} | ${tag} lần ${k + 1} hỏng (${e.message}).${k < attempts.length - 1 ? " Retry chống lặp..." : ""}`);
    }
  }
  throw lastErr || new Error(`${tag}: hết ngân sách thời gian`);
};

const extractPlanArray = (parsed) => {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  return (
    parsed.plan ||
    parsed.days ||
    parsed.menu ||
    parsed.weekly_plan ||
    Object.values(parsed).find(Array.isArray) ||
    []
  );
};

/* =========================================================
 * 2. FOODS DATABASE
 * ========================================================= */
const fetchFoodsDB = async () => {
  try {
    const { data, error } = await supabase
      .from("foods")
      .select("description, calories, protein, fat, carbs, fiber, sugar, sodium, source, confidence, verified")
      .order("description", { ascending: true });
    if (error) {
      log.warn("fetchFoodsDB", error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    log.error("fetchFoodsDB", err);
    return [];
  }
};

/** Số món tối đa nhồi vào prompt. Bảng `foods` chỉ có tăng (mỗi lần sinh plan lại
 *  insert thêm món mới), nên KHÔNG giới hạn thì prompt phình vô hạn theo thời gian
 *  → model hết "ngân sách" context và trả plan cụt (1/7 ngày). */
const MAX_FOODS_IN_PROMPT = 120;

/** Làm sạch tên món trước khi ĐƯA VÀO hoặc GHI RA `foods.description`.
 *
 *  RCA: model đôi khi trả `food` kèm luôn số liệu, vd
 *      "'Cơm trắng + cá thu hấp' | 420kcal | P:30 | F:8 | ..."
 *  syncMissingFoodsToDB ghi NGUYÊN chuỗi đó thành description, rồi
 *  formatFoodsForPrompt lại nối THÊM một bộ số nữa vào sau → prompt chứa
 *  "... | Na:50 | 420kcal | P:3 | F:? | ..." và model học theo cái định dạng hỏng
 *  này. Cắt phần đuôi từ dấu "|" đầu tiên + bỏ nháy bao ngoài là dứt vòng lặp. */
const cleanFoodName = (raw) => {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.split("|")[0].trim();                 // bỏ mọi thứ từ "|" trở đi
  s = s.replace(/^['"«»‹›“”‘’]+|['"«»‹›“”‘’]+$/g, "").trim(); // bỏ nháy bao ngoài
  // Cú pháp in đậm/nghiêng của markdown mà model hay để lọt: "**Bún cá** (cá
  // lóc...)". Lưu nguyên thì tên món hiện ra kèm luôn dấu sao trên bảng lộ
  // trình, và còn bị ghi vào bảng `foods` rồi tái sinh ở các tuần sau.
  s = s.replace(/\*+/g, "").replace(/(^|\s)_{1,2}(\S)/g, "$1$2").replace(/(\S)_{1,2}(\s|$)/g, "$1$2").trim();
  s = s.replace(/\s*[-–—]?\s*\d+\s*kcal\b.*$/i, "").trim();   // bỏ đuôi "- 420kcal ..."
  return s.replace(/\s+/g, " ");
};

const formatFoodsForPrompt = (foods) => {
  if (!Array.isArray(foods) || foods.length === 0) return "(Chưa có dữ liệu)";
  const seen = new Set();
  const lines = [];
  for (const f of foods) {
    const name = cleanFoodName(f.description);
    if (!name) continue;
    const key = normalizeFoodName(name);
    if (seen.has(key)) continue;              // bảng đang có rất nhiều bản trùng
    seen.add(key);
    lines.push(
      `- ${name} | ${f.calories ?? "?"}kcal | P:${f.protein ?? "?"} | F:${f.fat ?? "?"} | C:${f.carbs ?? "?"} | Fi:${f.fiber ?? "?"} | Su:${f.sugar ?? "?"} | Na:${f.sodium ?? "?"}`
    );
    if (lines.length >= MAX_FOODS_IN_PROMPT) break;
  }
  return lines.length ? lines.join("\n") : "(Chưa có dữ liệu)";
};

const buildFoodsSection = (foodsDB) => {
  if (!foodsDB || foodsDB.length === 0) return "";
  return `
KHO MÓN ĂN CÓ SẴN (FOODS DATABASE)
Format: Tên món | kcal | Protein | Fat | Carbs | Fiber | Sugar | Sodium

${formatFoodsForPrompt(foodsDB)}

QUY TẮC:
1. BẮT BUỘC ưu tiên chọn món từ danh sách trên.
2. Nếu món CÓ trong danh sách → dùng CHÍNH XÁC dinh dưỡng từ đó.
3. Nếu món KHÔNG có → tự ước tính theo khẩu phần thực tế (ưu tiên món Việt, nhưng chấp nhận món quốc tế nếu user yêu cầu hoặc phù hợp).
4. Không lặp lại cùng 1 món quá 2 lần trong 7 ngày.
`;
};

const syncMissingFoodsToDB = async (plan, foodsDB) => {
  if (!Array.isArray(plan) || plan.length === 0) return 0;
  const existing = new Set(
    (foodsDB || []).map((f) => normalizeFoodName(cleanFoodName(f.description)))
  );
  const seen = new Set();
  const missing = [];
  for (const dayEntry of plan) {
    for (const meal of dayEntry.meals || []) {
      // Làm sạch TRƯỚC khi ghi: nếu model trả "Phở gà | 450kcal | P:28..." mà ta
      // lưu nguyên thì lần sinh sau prompt sẽ chứa tên món hỏng (xem cleanFoodName).
      const foodName = cleanFoodName(meal.food);
      if (!foodName) continue;
      const key = normalizeFoodName(foodName);
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      missing.push({
        description: foodName,
        calories: parseNumber(meal.calories),
        protein: parseNumber(meal.protein),
        fat: parseNumber(meal.fat),
        carbs: parseNumber(meal.carbs),
        fiber: parseNumber(meal.fiber),
        sugar: parseNumber(meal.sugar),
        sodium: parseNumber(meal.sodium),
      });
    }
  }
  if (missing.length === 0) return 0;
  const { error } = await supabase.from("foods").insert(missing);
  if (error) {
    log.error("syncMissingFoodsToDB", error);
    return 0;
  }
  return missing.length;
};

/* =========================================================
 * 3. PLAN STRUCTURE HELPERS
 * ========================================================= */

/** Trích danh sách bữa "phẳng" thuần (mỗi item = 1 bữa) từ bất kỳ format nào AI trả.
 *  Hỗ trợ:
 *   - Flat:    [{day, meal, food, ...}, ...]
 *   - Grouped: [{day, meals:[{meal, food, ...}, ...]}, ...]
 *   - Lồng:    [{day, meals:[{meals:[{...}]}]}]  (do bug AI trả lồng)
 */
// DỌN 1 bữa ăn: model (nhất là bước fill) đôi khi nhét cả "Tên | 420kcal | P:30 |
// F:8 | C:50 | Fi:5 | Su:4 | Na:50" hoặc dấu nháy vào field "food". Bóc TÊN thuần,
// và CỨU số liệu vào đúng field nếu field đó đang trống. Chạy ở toFlatMeals nên
// dọn cho MỌI đường (fill/group/flatten/hiển thị + cả plan cũ đã lưu bị bẩn).
const cleanMealFields = (meal) => {
  if (!meal || typeof meal !== "object") return meal;
  let food = String(meal.food || "").replace(/^\s*['"]+|['"]+\s*$/g, "").trim();
  const salv = { kcal: null, p: null, f: null, c: null, fi: null, su: null, na: null };
  if (food.includes("|")) {
    const parts = food.split("|");
    food = parts[0].replace(/^\s*['"]+|['"]+\s*$/g, "").trim();
    for (const seg of parts.slice(1)) {
      let m;
      if ((m = seg.match(/(\d+(?:\.\d+)?)\s*kcal/i))) salv.kcal = Number(m[1]);
      else if ((m = seg.match(/\bFi\s*[:=]?\s*(\d+(?:\.\d+)?)/i))) salv.fi = Number(m[1]);
      else if ((m = seg.match(/\bSu\s*[:=]?\s*(\d+(?:\.\d+)?)/i))) salv.su = Number(m[1]);
      else if ((m = seg.match(/\bNa\s*[:=]?\s*(\d+(?:\.\d+)?)/i))) salv.na = Number(m[1]);
      else if ((m = seg.match(/\bP\s*[:=]?\s*(\d+(?:\.\d+)?)/i))) salv.p = Number(m[1]);
      else if ((m = seg.match(/\bF\s*[:=]?\s*(\d+(?:\.\d+)?)/i))) salv.f = Number(m[1]);
      else if ((m = seg.match(/\bC\s*[:=]?\s*(\d+(?:\.\d+)?)/i))) salv.c = Number(m[1]);
    }
  }
  const out = { ...meal, food: food || "Món ăn" };
  const empty = (v) => v == null || String(v).trim() === "" || String(v).trim() === "0g";
  if ((out.calories == null || Number(out.calories) === 0) && salv.kcal != null) out.calories = salv.kcal;
  if (empty(out.protein) && salv.p != null) out.protein = `${salv.p}g`;
  if (empty(out.fat) && salv.f != null) out.fat = `${salv.f}g`;
  if (empty(out.carbs) && salv.c != null) out.carbs = `${salv.c}g`;
  if (empty(out.fiber) && salv.fi != null) out.fiber = `${salv.fi}g`;
  if (empty(out.sugar) && salv.su != null) out.sugar = `${salv.su}g`;
  if (empty(out.sodium) && salv.na != null) out.sodium = `${salv.na}mg`;

  // CHUẨN HOÁ KHẨU PHẦN (khắc phục: chỗ hiện "1 phần", chỗ chỉ "1"/"[1 phần]"/trống).
  // Bỏ [] () '' bao quanh; số trần "1" → "1 phần"; rỗng/"—"/"0" → "1 phần".
  let amount = String(out.amount ?? "").trim()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/^\((.*)\)$/, "$1")
    .replace(/^['"](.*)['"]$/, "$1")
    .trim();
  if (!amount || amount === "—" || amount === "0") amount = "1 phần";
  else if (/^\d+(?:[.,]\d+)?$/.test(amount)) amount = `${amount} phần`;
  out.amount = amount;

  // CỨU CALO nếu còn thiếu: bóc "…kcal" trong amount → cuối cùng suy Atwater từ macro.
  if (out.calories == null || Number(out.calories) === 0) {
    const km = amount.match(/(\d+(?:\.\d+)?)\s*kcal/i);
    if (km) out.calories = Math.round(Number(km[1]));
  }
  if (out.calories == null || Number(out.calories) === 0) {
    const P = parseFloat(out.protein) || 0, F = parseFloat(out.fat) || 0, C = parseFloat(out.carbs) || 0;
    const at = 4 * P + 4 * C + 9 * F;
    if (at > 0) out.calories = Math.round(at);
  }
  return out;
};

const toFlatMeals = (rawPlan) => {
  if (!Array.isArray(rawPlan)) return [];
  const out = [];

  const pushMeal = (day, meal) => {
    if (!meal || typeof meal !== "object") return;
    // Nếu meal vẫn còn nested "meals" → đệ quy bóc tiếp
    if (Array.isArray(meal.meals)) {
      meal.meals.forEach((inner) => pushMeal(day, inner));
      return;
    }
    if (!meal.meal && !meal.food) return; // bỏ qua object rỗng
    const { day: _d, ...rest } = meal;
    out.push(cleanMealFields({ ...rest, day: Number(day) }));
  };

  for (const entry of rawPlan) {
    if (!entry || typeof entry !== "object") continue;

    // Dạng grouped: { day, meals: [...] }
    if (Array.isArray(entry.meals)) {
      entry.meals.forEach((m) => pushMeal(entry.day, m));
      continue;
    }
    // Dạng flat: { day, meal, food, ... }
    if (entry.meal && entry.food) {
      pushMeal(entry.day, entry);
      continue;
    }
  }
  return out;
};

/** Gom mảng FLAT thành cấu trúc 7 ngày — KHÔNG lồng `meals` 2 lần. */
const groupPlanByDay = (rawPlan) => {
  const flat = toFlatMeals(rawPlan);
  const grouped = [];
  for (let i = 1; i <= TOTAL_DAYS; i++) {
    const meals = flat
      .filter((m) => Number(m.day) === i)
      .map(({ day, ...rest }) => rest); // ⚠️ Bỏ field `day` để KHÔNG lặp khi lưu
    grouped.push({ day: i, meals });
  }
  return grouped;
};

/** Trải cấu trúc grouped thành mảng FLAT phục vụ frontend render. */
const flattenPlan = (groupedPlan) => toFlatMeals(groupedPlan);

/** Áp các món đã đổi (modifiedMeals) lên plan gốc trong DB */
const applyModificationsToPlan = (groupedPlan, modifiedMeals) => {
  // Clone sâu
  const next = groupedPlan.map((d) => ({
    day: d.day,
    meals: (d.meals || []).map((m) => ({ ...m })),
  }));
  for (const mod of modifiedMeals) {
    const dayEntry = next.find((d) => Number(d.day) === Number(mod.day));
    if (!dayEntry) continue;
    const idx = dayEntry.meals.findIndex((m) => m.meal === mod.meal);
    if (idx === -1) {
      dayEntry.meals.push({ ...mod, isModified: true });
    } else {
      dayEntry.meals[idx] = { ...dayEntry.meals[idx], ...mod, isModified: true };
    }
  }
  return next;
};

/* =========================================================
 * 4. PROMPT BUILDERS
 * ========================================================= */
const buildProfileSection = (p) => `
HỒ SƠ NGƯỜI DÙNG
- Giới tính: ${p.gender ?? "N/A"}
- Năm sinh: ${p.birth_year ?? "N/A"}
- Chiều cao: ${p.height ?? "N/A"} cm
- Cân nặng: ${p.weight ?? "N/A"} kg
- Mục tiêu: ${p.goal ?? "N/A"}
- Lý do: ${p.reason ?? "N/A"}
- Bệnh lý: ${p.disease || "Không có"}
- Calo mục tiêu/ngày: ${p.target_calories || "1500-1800"} kcal
- Macro ưu tiên: ${p.focus_macro ?? "N/A"}
- Mức vận động: ${p.activity_level ?? "N/A"}
`;

const PLAN_FORMAT_SPEC = `
ĐỊNH DẠNG TRẢ VỀ (BẮT BUỘC):
JSON object có key "plan" là MẢNG ${TOTAL_DAYS} NGÀY. Mỗi ngày BẮT BUỘC ĐỦ 4 BỮA theo ĐÚNG thứ tự: ${MEALS_PER_DAY.join(", ")}.
⚠️ TUYỆT ĐỐI KHÔNG bỏ bữa "Phụ": bữa phụ là bữa nhẹ giữa các bữa chính (vd: sữa chua, trái cây, các loại hạt, sinh tố, bánh yến mạch, khoai lang...). MỖI ngày "meals" PHẢI có ĐỦ 4 mục Sáng + Trưa + Tối + Phụ — thiếu bất kỳ bữa nào (nhất là Phụ) là SAI.
Mỗi bữa BẮT BUỘC có đủ 10 trường: meal, food, amount, calories, protein, fat, carbs, fiber, sugar, sodium.

Ví dụ 1 ngày (PHẢI đủ 4 bữa NHƯ VẦY cho CẢ ${TOTAL_DAYS} ngày):
{
  "plan": [
    {
      "day": 1,
      "meals": [
        { "meal": "Sáng", "food": "Phở gà", "amount": "1 bát (400ml)", "calories": 450, "protein": "28g", "fat": "12g", "carbs": "58g", "fiber": "2g", "sugar": "4g", "sodium": "920mg" },
        { "meal": "Trưa", "food": "Cơm tấm sườn bì chả", "amount": "1 phần", "calories": 620, "protein": "34g", "fat": "22g", "carbs": "68g", "fiber": "3g", "sugar": "5g", "sodium": "1100mg" },
        { "meal": "Tối", "food": "Canh chua cá + cơm trắng", "amount": "1 phần", "calories": 480, "protein": "30g", "fat": "10g", "carbs": "60g", "fiber": "4g", "sugar": "6g", "sodium": "900mg" },
        { "meal": "Phụ", "food": "Sữa chua Hy Lạp + trái cây", "amount": "1 hũ", "calories": 150, "protein": "10g", "fat": "3g", "carbs": "18g", "fiber": "1g", "sugar": "12g", "sodium": "50mg" }
      ]
    }
  ]
}
Chỉ trả về JSON hợp lệ, không markdown, không giải thích.
`;

/** Ghi chú điều chỉnh calo dựa trên tuần trước — tách riêng để cả prompt cả
 *  tuần lẫn prompt từng ngày dùng chung, không chép hai bản dễ lệch nhau. */
const buildDeviationNote = (profile, calorieDeviation) => {
  if (!calorieDeviation || Math.abs(calorieDeviation.deviation) <= 100) return "";
  const over = calorieDeviation.deviation > 0;
  return `
LƯU Ý QUAN TRỌNG — ĐIỀU CHỈNH DỰA TRÊN LỊCH SỬ THỰC TẾ:
Tuần trước người dùng ăn thực tế trung bình ${calorieDeviation.avgActualPerDay} kcal/ngày,
${over ? "vượt" : "thấp hơn"} mục tiêu ${Math.abs(calorieDeviation.deviation)} kcal/ngày.
Hãy ${over ? "GIẢM nhẹ calo của thực đơn tuần này" : "TĂNG nhẹ khẩu phần tuần này"} để bù lại,
nhưng vẫn hướng về mục tiêu ${profile.target_calories || "1500-1800"} kcal/ngày.
`;
};

const buildCreatePlanPrompt = (profile, foodsDB, knowledgeBlock = "", calorieDeviation = null) => {
  let deviationNote = "";
  if (calorieDeviation && Math.abs(calorieDeviation.deviation) > 100) {
    const over = calorieDeviation.deviation > 0;
    deviationNote = `
LƯU Ý QUAN TRỌNG — ĐIỀU CHỈNH DỰA TRÊN LỊCH SỬ THỰC TẾ:
Tuần trước người dùng ăn thực tế trung bình ${calorieDeviation.avgActualPerDay} kcal/ngày,
${over ? "vượt" : "thấp hơn"} mục tiêu ${Math.abs(calorieDeviation.deviation)} kcal/ngày.
Hãy ${over ? "GIẢM nhẹ calo của thực đơn tuần này" : "TĂNG nhẹ khẩu phần tuần này"} để bù lại,
nhưng vẫn hướng về mục tiêu ${profile.target_calories || "1500-1800"} kcal/ngày.
`;
  }
  return `
Bạn là chuyên gia dinh dưỡng, am hiểu ẩm thực Việt Nam 3 miền và các món quốc tế phổ biến.

${buildProfileSection(profile)}
${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
YÊU CẦU:
- Dùng MÓN ĂN VIỆT NAM thực tế, đúng tên gọi quen thuộc (vd: phở bò, bún chả,
  cơm tấm sườn bì chả, cháo gà, bánh mì thịt, canh chua cá, rau muống luộc...).
- Ghi tên món rõ ràng, cụ thể (kèm thành phần chính), tránh tên chung chung như "cơm" hay "món mặn".
- Đa dạng giữa các ngày, không lặp món quá nhiều; cân đối đủ tinh bột - đạm - rau.
- Cân bằng theo mục tiêu (giảm cân / tăng cơ / duy trì).
- Tránh các món ảnh hưởng bệnh lý (nếu có), và ưu tiên các món hỗ trợ bệnh lý theo TÀI LIỆU CHUYÊN MÔN ở trên (nếu có).
${buildFoodsSection(foodsDB)}
${PLAN_FORMAT_SPEC}
${deviationNote}`.trim() + "\n";
};

/** Prompt cảnh báo sức khỏe: phân tích hành vi ăn uống 7 ngày gần nhất, dự đoán
 *  xu hướng tình trạng bệnh (cải thiện / duy trì / nguy cơ) và đưa lời khuyên. */
const buildHealthCheckPrompt = (profile, days, knowledgeBlock = "", lang = "vi") => {
  const isEn = String(lang).toLowerCase() === "en";
  const dayLines = (days || [])
    .map((d) => {
      const dishes = Array.isArray(d.dishes) && d.dishes.length
        ? ` | ${isEn ? "Dishes" : "Món"}: ${d.dishes.slice(0, 12).join(", ")}`
        : "";
      return `- ${d.date}: ${Math.round(Number(d.calories) || 0)} kcal | P:${Math.round(Number(d.protein) || 0)}g F:${Math.round(Number(d.fat) || 0)}g C:${Math.round(Number(d.carbs) || 0)}g${dishes}`;
    })
    .join("\n");

  if (isEn) {
    return `LANGUAGE — ABSOLUTE RULE: The "summary" and every "advice" item MUST be in natural English. No Vietnamese sentences (Vietnamese dish names like Phở, Bánh mì stay as proper nouns).

You are an AI nutrition expert with deep clinical-nutrition knowledge and Vietnamese cuisine expertise.
${buildProfileSection(profile)}
${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
LAST 7 DAYS OF INTAKE (aggregated from meals the user marked as EATEN + off-plan items):
${dayLines || "(No data yet)"}

Target calories/day: ${profile.target_calories || "1500-1800"} kcal.

TASK:
1. Evaluate the last 7 days vs. the user's calorie/macro target and condition: over/under intake, which macros are off, which dishes conflict with the condition (CROSS-CHECK the professional reference above when available).
2. Predict the health/condition TREND if the user keeps eating like this:
   - "good"   = improving
   - "stable" = holding steady, keep it up
   - "risk"   = risk of getting worse
3. Give 2-4 SHORT, PRACTICAL pieces of advice (specific foods to add/cut, habits to fix).

RULES:
- Speak naturally and friendly, NO markdown.
- Do NOT invent medical numbers; if a day is missing, judge on the available days and remind the user to mark meals as "Eaten" more consistently.
- This is nutrition guidance, NOT a medical diagnosis — if status is "risk", suggest closer monitoring or seeing a doctor.

RETURN PURE JSON (no markdown):
{"status":"good|stable|risk","summary":"2-3 sentence overview","advice":["tip 1","tip 2"]}
/no_think`;
  }

  return `NGÔN NGỮ — BẮT BUỘC: Chuỗi "summary" và từng phần tử "advice" PHẢI 100% TIẾNG VIỆT có dấu. KHÔNG câu tiếng Anh.

Bạn là chuyên gia dinh dưỡng AI, am hiểu sâu về dinh dưỡng lâm sàng và ẩm thực Việt Nam.
${buildProfileSection(profile)}
${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
DỮ LIỆU ĂN UỐNG 7 NGÀY GẦN NHẤT (tổng hợp từ các bữa người dùng đã đánh dấu ĐÃ ĂN + món thêm ngoài thực đơn):
${dayLines || "(Chưa có dữ liệu)"}

Mục tiêu calo/ngày của người dùng: ${profile.target_calories || "1500-1800"} kcal.

NHIỆM VỤ:
1. Đánh giá hành vi ăn uống 7 ngày qua so với mục tiêu calo/macro và bệnh lý (nếu có): ăn vượt/thiếu, chất nào lệch, món nào không phù hợp bệnh lý (BẮT BUỘC đối chiếu TÀI LIỆU CHUYÊN MÔN ở trên nếu có).
2. Dự đoán XU HƯỚNG tình trạng sức khỏe/bệnh nếu tiếp tục ăn như 7 ngày qua:
   - "good"   = đang cải thiện tốt
   - "stable" = duy trì ổn, cần giữ nếp
   - "risk"   = có nguy cơ xấu đi / nặng hơn
3. Đưa 2-4 lời khuyên NGẮN GỌN, THỰC TẾ (món cụ thể nên thêm/bớt, thói quen cần chỉnh).

QUY TẮC:
- Nói tự nhiên, thân thiện, KHÔNG markdown.
- Không bịa số liệu y khoa; thiếu dữ liệu ngày nào thì đánh giá trên những ngày có dữ liệu và nhắc người dùng đánh dấu "Đã ăn" đều hơn.
- Đây là gợi ý dinh dưỡng, KHÔNG phải chẩn đoán y khoa — nếu status là "risk" hãy khuyên theo dõi thêm/hỏi bác sĩ khi cần.

CHỈ TRẢ JSON THUẦN (KHÔNG markdown):
{"status":"good|stable|risk","summary":"2-3 câu đánh giá tổng quan","advice":["lời khuyên 1","lời khuyên 2"]}
/no_think`;
};

const buildRebalancePrompt = (profile, anchors, foodsDB, knowledgeBlock = "") => `
Bạn là chuyên gia dinh dưỡng AI.

NGƯỜI DÙNG VỪA ĐỔI ${anchors.length} MÓN:
${anchors.map((a) => `- Ngày ${a.day}, Bữa "${a.meal}" → "${a.food}"`).join("\n")}

${buildProfileSection(profile)}
${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
NHIỆM VỤ:
1. GIỮ NGUYÊN tất cả các món đã đổi ở trên (đúng day + meal + food).
2. Cân đối lại các bữa khác để tổng calo TB/ngày ~ ${profile.target_calories} kcal.
3. Phù hợp mục tiêu "${profile.goal}" và bệnh lý "${profile.disease || "Không"}" (ưu tiên tuân theo TÀI LIỆU CHUYÊN MÔN ở trên nếu có).
4. Trả ĐẦY ĐỦ ${TOTAL_DAYS} ngày × 4 bữa.
${buildFoodsSection(foodsDB)}
${PLAN_FORMAT_SPEC}
`;

/* =========================================================
 * 4b. SINH PLAN THEO NGÀY — SONG SONG
 *
 * Vì sao đổi cách sinh (đo thật trên chính server vLLM đang dùng):
 *
 *   Hỏi cả 28 bữa trong MỘT lượt: 48,3s/lượt, tốc độ 47 token/s, và model
 *   thường dừng sớm — lượt đo được chỉ ra 2/7 ngày (6/28 bữa) với
 *   finish_reason "stop", tức nó tự kết thúc chứ không phải bị cắt. Coverage
 *   không đạt ⇒ bản cũ thử lượt 2 ⇒ fillMissingMeals chạy tiếp 3 vòng
 *   để bù 22 ô. Tổng cộng tới 15 lượt tuần tự ≈ 724s, vượt maxDuration 300s
 *   ⇒ 504, và vì hết ngân sách nên không kịp lưu gì ⇒ 503 plan_generate_retry.
 *
 *   Hỏi TỪNG NGÀY (4 bữa) rồi chạy 7 lượt SONG SONG: 9,4s tổng, phủ đủ 28/28.
 *   Server batch tốt — cộng dồn tuần tự là 54,2s nên song song nhanh gấp 5,8×.
 *
 * Mỗi lượt chỉ sinh ~350 token thay vì ~8000 nên model không "đuối" giữa chừng,
 * và một ngày hỏng chỉ mất đúng ngày đó thay vì kéo đổ cả tuần.
 * ========================================================= */

/** Prompt cho ĐÚNG một ngày. `avoid` là các món đã giao cho ngày khác. */
const buildOneDayPrompt = (profile, dayIndex, suggestions, avoid, knowledgeBlock, deviationNote) => `
Bạn là chuyên gia dinh dưỡng, am hiểu ẩm thực Việt Nam 3 miền và các món quốc tế phổ biến.

${buildProfileSection(profile)}
${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
NHIỆM VỤ: soạn thực đơn cho ĐÚNG MỘT NGÀY (ngày ${dayIndex}), gồm ĐỦ 4 bữa theo thứ tự: ${MEALS_PER_DAY.join(", ")}.
Bữa "Phụ" là bữa nhẹ (sữa chua, trái cây, các loại hạt, sinh tố, khoai lang...) — KHÔNG được bỏ.

YÊU CẦU:
- Dùng MÓN ĂN VIỆT NAM thực tế, đúng tên gọi quen thuộc (phở bò, bún chả, cơm tấm sườn bì chả, cháo gà, canh chua cá...).
- Tên món cụ thể, kèm thành phần chính; tránh tên chung chung như "cơm" hay "món mặn".
- Cân đối tinh bột – đạm – rau, bám mục tiêu ${profile.target_calories || "1500-1800"} kcal/ngày.
- Tránh món ảnh hưởng bệnh lý (nếu có), ưu tiên món hỗ trợ theo tài liệu chuyên môn ở trên (nếu có).
${suggestions ? `\nGỢI Ý ƯU TIÊN CHO NGÀY NÀY (chọn từ đây khi hợp lý, dùng ĐÚNG số liệu kèm theo):\n${suggestions}\n` : ""}${avoid ? `\n⚠️ CÁC MÓN ĐÃ DÙNG Ở NGÀY KHÁC — TUYỆT ĐỐI KHÔNG lặp lại:\n${avoid}\n` : ""}
⚠️ field "food" CHỈ chứa TÊN MÓN thuần (vd "Phở gà"), KHÔNG kèm số liệu calo/macro, KHÔNG dùng ký hiệu "|". Các con số nằm ĐÚNG field riêng.

Trả về DUY NHẤT JSON: {"day":${dayIndex},"meals":[{"meal":"<${MEALS_PER_DAY.join("|")}>","food":"<chỉ tên món>","amount":"1 phần","calories":<số>,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg"}]}
ĐỦ 4 bữa, mỗi bữa ĐỦ 10 trường. Không markdown, không giải thích.
${deviationNote || ""}`.trim() + "\n";

/**
 * Chia kho món thành 7 rổ RỜI NHAU, mỗi ngày một rổ.
 *
 * Bảy lượt chạy song song nên không lượt nào biết lượt kia chọn gì — để tự do
 * thì 2–3 ngày cùng ăn phở sáng. Thay vì thêm một vòng gọi nữa để khử trùng
 * (mất gấp đôi thời gian), chia sẵn danh sách gợi ý rời nhau và nói thẳng cho
 * mỗi ngày biết những món KHÔNG được đụng. Không tốn thêm lượt gọi nào.
 *
 * Chia xen kẽ (món 0→ngày 1, món 1→ngày 2, …) chứ không cắt khối liên tiếp:
 * bảng `foods` sắp theo tên nên cắt khối sẽ dồn hết món cùng vần vào một ngày.
 */
const splitFoodsAcrossDays = (foodsDB) => {
  const seen = new Set();
  const uniq = [];
  for (const f of foodsDB || []) {
    const name = cleanFoodName(f.description);
    if (!name) continue;
    const key = normalizeFoodName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ name, f });
    if (uniq.length >= MAX_FOODS_IN_PROMPT) break;
  }
  const buckets = Array.from({ length: TOTAL_DAYS }, () => []);
  uniq.forEach((item, i) => buckets[i % TOTAL_DAYS].push(item));
  return buckets;
};

const fmtSuggestion = ({ name, f }) =>
  `- ${name} | ${f.calories ?? "?"}kcal | P:${f.protein ?? "?"} | F:${f.fat ?? "?"} | C:${f.carbs ?? "?"} | Fi:${f.fiber ?? "?"} | Su:${f.sugar ?? "?"} | Na:${f.sodium ?? "?"}`;

/**
 * Sinh plan 7 ngày bằng 7 lượt gọi SONG SONG.
 *
 * `allSettled` chứ không `all`: một ngày hỏng thì 6 ngày kia vẫn dùng được, và
 * ô còn thiếu để fillMissingMeals bù — thay vì ném bỏ toàn bộ công đã làm.
 */
const generatePlanByDays = async ({ profile, foodsDB, knowledgeBlock = "", deviationNote = "", traceId = "", deadline = Infinity }) => {
  const t0 = Date.now();
  const buckets = splitFoodsAcrossDays(foodsDB);

  const oneDay = async (dayIndex) => {
    const mine = buckets[dayIndex - 1] || [];
    // "Tránh" = món của các ngày khác, cắt bớt cho prompt khỏi phình.
    const others = buckets
      .filter((_, i) => i !== dayIndex - 1)
      .flat()
      .slice(0, 40)
      .map((x) => x.name);

    const { parsed } = await completeJsonWithRetry({
      messages: [{
        role: "system",
        content: buildOneDayPrompt(
          profile, dayIndex,
          mine.map(fmtSuggestion).join("\n"),
          others.join(", "),
          knowledgeBlock, deviationNote
        ),
      }],
      temperature: 0.3,
      // ~350 token là đủ cho 4 bữa (đo thật); nới gấp ~3 để có biên an toàn.
      max_tokens: 1200,
      traceId,
      tag: `day#${dayIndex}`,
      deadline,
    });
    // Chấp nhận cả {day,meals} lẫn {plan:[{day,meals}]} — model trả cả hai kiểu.
    const arr = extractPlanArray(parsed);
    const flat = toFlatMeals(arr.length ? arr : [parsed]);
    // Ép đúng ngày: model đôi khi ghi "day" khác với ngày được yêu cầu.
    return flat.map((m) => ({ ...m, day: dayIndex }));
  };

  const results = await Promise.allSettled(
    Array.from({ length: TOTAL_DAYS }, (_, i) => oneDay(i + 1))
  );

  const out = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out.push(...r.value);
    else failed.push({ day: i + 1, err: r.reason?.message || String(r.reason) });
  });

  log.info(`${traceId} | plan song song`, {
    ms: Date.now() - t0,
    days: new Set(out.map((m) => m.day)).size,
    meals: out.length,
    failedDays: failed.length,
    ...(failed.length ? { failures: failed } : {}),
  });

  return out;
};

const slotKey = (m) => `${Number(m.day)}|${String(m.meal || "").trim().toLowerCase()}`;
// Bữa "thật": có TÊN MÓN cụ thể (không phải placeholder "Món ăn"/rỗng) VÀ có calo > 0.
// Placeholder (bữa rỗng lọt qua) sẽ bị coi là THIẾU để được bù lại bằng bữa thật.
const isRealMeal = (m) => {
  if (!m) return false;
  const food = String(m.food || "").trim().toLowerCase();
  if (!food || food === "món ăn" || food === "mon an") return false;
  return (Number(m.calories) || 0) > 0;
};

/** Liệt kê các ô (ngày × bữa) CÒN THIẾU (chưa có bữa THẬT) so với 7 ngày × 4 bữa. */
const findMissingSlots = (flat) => {
  const have = new Set((flat || []).filter(isRealMeal).map(slotKey));
  const missing = [];
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    for (const meal of MEALS_PER_DAY) {
      if (!have.has(`${d}|${meal.toLowerCase()}`)) missing.push({ day: d, meal });
    }
  }
  return missing;
};

/** "Tạo lại đến khi ĐẦY ĐỦ": sau khi có plan, TỰ BỔ SUNG các bữa còn thiếu bằng
 *  các lượt gọi NHỎ (chỉ hỏi đúng những bữa thiếu → nhanh & không bị cắt cụt),
 *  lặp tối đa 3 vòng. Giữ đúng mục tiêu/bệnh lý người dùng. */
async function fillMissingMeals(flatPlan, { profile, foodsDB, knowledgeBlock = "", traceId = "", deadline = Infinity }) {
  let out = Array.isArray(flatPlan) ? [...flatPlan] : [];
  for (let round = 1; round <= 3; round++) {
    const missing = findMissingSlots(out);
    if (!missing.length) break;
    if (outOfBudget(deadline)) {
      log.warn(`${traceId} | hết ngân sách thời gian, dừng bù bữa ở vòng ${round} (còn thiếu ${missing.length})`);
      break;
    }
    log.warn(`${traceId} | fill vòng ${round}: còn thiếu ${missing.length} bữa`);
    const list = missing.map((s) => `- Ngày ${s.day}, bữa "${s.meal}"`).join("\n");
    const sys = `${buildProfileSection(profile)}
Bạn là chuyên gia dinh dưỡng. BỔ SUNG CHÍNH XÁC các bữa còn thiếu dưới đây cho thực đơn tuần, PHÙ HỢP mục tiêu "${profile.goal || "của bạn"}"${profile.disease && profile.disease !== "không có" ? ` và tránh gây hại cho bệnh "${profile.disease}"` : ""}. CHỈ trả về ĐÚNG các bữa được liệt kê, KHÔNG thêm bữa/ngày khác. Bữa "Phụ" là bữa nhẹ (sữa chua, trái cây, các loại hạt, sinh tố...).
CÁC BỮA CẦN BỔ SUNG:
${list}
${knowledgeBlock ? "\n" + knowledgeBlock + "\n" : ""}
⚠️ QUAN TRỌNG: field "food" CHỈ chứa TÊN MÓN thuần (vd "Phở gà", "Sữa chua Hy Lạp"), TUYỆT ĐỐI KHÔNG kèm số liệu calo/macro và KHÔNG dùng ký hiệu "|". Các con số phải nằm ĐÚNG field riêng (calories, protein, fat...).
Trả về DUY NHẤT JSON: {"plan":[{"day":<số>,"meals":[{"meal":"<Sáng|Trưa|Tối|Phụ>","food":"<chỉ tên món>","amount":"1 phần","calories":<số>,"protein":"Xg","fat":"Xg","carbs":"Xg","fiber":"Xg","sugar":"Xg","sodium":"Xmg"}]}]}. Mỗi bữa ĐỦ 10 trường. Không markdown, không giải thích.`;
    let parsed;
    try {
      ({ parsed } = await completeJsonWithRetry({
        messages: [{ role: "system", content: sys }],
        temperature: 0.3,
        max_tokens: 3500,
        traceId,
        tag: `fill_meals#${round}`,
        deadline,
      }));
    } catch (e) {
      log.warn(`${traceId} | fill vòng ${round} lỗi: ${e.message}`);
      break;
    }
    const addFlat = toFlatMeals(extractPlanArray(parsed));
    const missSet = new Set(missing.map((s) => `${s.day}|${s.meal.toLowerCase()}`));
    let added = 0;
    for (const m of addFlat) {
      const key = slotKey(m);
      // chỉ nhận bữa THẬT, đúng ô đang thiếu, và ô đó chưa có bữa thật
      if (!missSet.has(key) || !isRealMeal(m)) continue;
      if (out.some((x) => slotKey(x) === key && isRealMeal(x))) continue;
      out = out.filter((x) => slotKey(x) !== key); // bỏ placeholder cũ cùng ô (nếu có)
      out.push(m);
      added++;
    }
    log.info(`${traceId} | fill vòng ${round}: bổ sung ${added} bữa`);
    if (added === 0) break; // model không bù được nữa → dừng, tránh lặp vô ích
  }
  // Bỏ mọi bữa placeholder còn sót (ô không bù được) → hiển thị "-" thay vì
  // "Món ăn — kcal"; lần load sau findMissingSlots sẽ tự thử bù lại ô đó.
  return out.filter(isRealMeal);
}

/* =========================================================
 * 5b. DINH DƯỠNG CHÍNH XÁC CHO TỪNG MÓN
 *     (FIX: khi đổi món -> tính lại dinh dưỡng món đó cho chính xác)
 * ========================================================= */
const fmtG = (v) => (v == null || !Number.isFinite(Number(v)) ? null : `${Math.round(Number(v))}g`);
const fmtMg = (v) => (v == null || !Number.isFinite(Number(v)) ? null : `${Math.round(Number(v))}mg`);

/** Tìm món trong FOODS DB theo tên đã chuẩn hóa -> dinh dưỡng chính xác từ DB.
 *  CHỈ khớp CHÍNH XÁC (sau khi chuẩn hóa) để tránh "đổi món" lại nhận nhầm
 *  dinh dưỡng/tên của một món KHÁC do khớp gần đúng (Yêu cầu #5, #6). */
const findFoodInDB = (food, foodsDB) => {
  const key = normalizeFoodName(food);
  if (!key) return null;
  const hit = (foodsDB || []).find((f) => normalizeFoodName(f.description) === key);
  if (!hit) return null;
  return {
    food: hit.description,
    amount: "1 phần",
    calories: hit.calories != null ? Math.round(Number(hit.calories)) : null,
    protein: fmtG(hit.protein),
    fat: fmtG(hit.fat),
    carbs: fmtG(hit.carbs),
    fiber: fmtG(hit.fiber),
    sugar: fmtG(hit.sugar),
    sodium: fmtMg(hit.sodium),
    source: "db",
  };
};

/** Hỏi AI ước tính dinh dưỡng cho ĐÚNG 1 món (không đụng tới các bữa khác). */
const estimateOneFoodAI = async ({ food, mealLabel, traceId }) => {
  const sys = `Bạn là chuyên gia dinh dưỡng quốc tế, am hiểu ẩm thực Việt Nam và thế giới.
PHẠM VI: Ước tính dinh dưỡng cho BẤT KỲ món ăn nào (Việt Nam, Hàn Quốc, Nhật Bản, Ý, Mỹ...).
KHÔNG giới hạn quốc gia — tên món gì cũng ước tính được.

Với MÓN VIỆT — hiểu đúng tên vùng miền:
• "bắp"="ngô" | "heo"="lợn" | "khoai mì"="sắn" | "trái"="quả" | "hủ tiếu"/"hủ tíu" | "bánh mỳ"="bánh mì"
• Phân biệt: phở bò ≠ bún bò Huế ≠ bún riêu | cơm tấm ≠ cơm gà | xôi mặn ≠ xôi xéo

Với MÓN QUỐC TẾ — dùng số liệu chuẩn quốc tế:
• Tteokbokki (bánh gạo cay Hàn) ~320kcal/phần | Ramen ~450-550kcal/tô | Sushi ~300-400kcal/phần
• Pasta carbonara ~550kcal | Pizza (2 lát) ~500kcal | Burger ~550kcal | Steak 200g ~350kcal

Ước tính theo khẩu phần 1 người thông thường (1 tô phở ~400-500g; 1 phần cơm tấm; 1 ổ bánh mì).
${mealLabel ? `Bữa: ${mealLabel}.` : ""}
Món cần ước tính: "${food}".

Trả về DUY NHẤT một JSON object:
{ "food": "<giữ NGUYÊN tên món người dùng nhập>", "amount": "<khẩu phần thực tế>",
  "calories": <number kcal>, "protein": "<g>", "fat": "<g>", "carbs": "<g>",
  "fiber": "<g>", "sugar": "<g>", "sodium": "<mg>" }
Chỉ trả JSON hợp lệ, không markdown, không giải thích.`;

  // Deterministic (seed 42, temp 0) + chống lặp + tự retry khi JSON hỏng. Phạt lặp
  // CỐ ĐỊNH nên cùng món vẫn ra cùng số (fix "10 cookies ra 480/600/470 kcal");
  // chỉ khi lần 1 hỏng mới retry với seed khác (hiếm, chấp nhận lệch nhỏ hơn crash).
  const { parsed: obj, raw } = await completeJsonWithRetry({
    messages: [{ role: "system", content: sys }],
    temperature: 0,
    seed: 42,
    max_tokens: 200,   // single-food nutrition JSON ≤ 150 token
    traceId,
    tag: "estimate_food",
  });
  log.info(`${traceId} | estimateOneFood`, { food, preview: raw.slice(0, 160) });
  const asStr = (v) => (v == null ? null : String(v));
  return {
    food: obj.food || food,
    amount: obj.amount || "1 phần",
    calories: parseNumber(obj.calories),
    protein: asStr(obj.protein),
    fat: asStr(obj.fat),
    carbs: asStr(obj.carbs),
    fiber: asStr(obj.fiber),
    sugar: asStr(obj.sugar),
    sodium: asStr(obj.sodium),
    source: "ai",
  };
};

/** Resolve dinh dưỡng chính xác cho 1 món.
 *  1) estimateFoodSmart (lib/nutrition.js): tách định lượng ("300ml sữa socola",
 *     "2 quả chuối"...), lấy mốc chuẩn /100g|ml hoặc /1 đơn vị từ
 *     USDA → OpenFoodFacts → FOODS DB → AI (temp 0, cache), scale tuyến tính
 *     TOÀN BỘ chất theo cùng tỷ lệ + validation Atwater → kết quả lặp lại
 *     y hệt giữa các lần gọi (200ml không bao giờ nhiều kcal hơn 300ml).
 *  2) Fallback giữ hành vi cũ: FOODS DB exact → AI ước tính trực tiếp (confidence low). */
const resolveMealNutrition = async ({ food, mealLabel, foodsDB, traceId }) => {
  try {
    const smart = await estimateFoodSmart({ food, mealLabel, foodsDB, traceId });
    if (smart && smart.calories != null) return smart;
  } catch (e) {
    log.warn(`${traceId} | estimateFoodSmart`, e.message);
  }
  const dbHit = findFoodInDB(food, foodsDB);
  if (dbHit) return { ...dbHit, confidence: "high" };
  try {
    return { ...(await estimateOneFoodAI({ food, mealLabel, traceId })), confidence: "low" };
  } catch (e) {
    log.warn(`${traceId} | resolveMealNutrition`, e.message);
    return {
      food,
      amount: "1 phần",
      calories: null,
      protein: null,
      fat: null,
      carbs: null,
      fiber: null,
      sugar: null,
      sodium: null,
      source: "fallback",
      confidence: "low",
    };
  }
};

/* =========================================================
 * 6. MAIN HANDLER
 * ========================================================= */
export async function POST(request) {
  const traceId = newTraceId();
  const startedAt = Date.now();
  const res = makeRes();
  const req = {
    method: "POST",
    headers: {
      authorization: request.headers.get("authorization"),
      "content-type": request.headers.get("content-type"),
    },
    body: await request.json().catch(() => null),
  };

  log.info(`${traceId} | INCOMING`, {
    method: req.method,
    hasAuth: !!req.headers.authorization,
    bodyKeys: req.body ? Object.keys(req.body) : [],
  });

  if (!req.body || typeof req.body !== "object") {
    return sendError(res, 400, "body_check", "Request body rỗng hoặc không phải JSON", {
      traceId,
      contentType: req.headers["content-type"],
    });
  }

  const auth = await getAuthUser(req);
  if (auth.error) {
    return sendError(res, auth.status, "auth", auth.error, {
      traceId,
      ...auth.detail,
    });
  }
  const { user } = auth;

  const { action, modifiedMeals, isQueryOnly } = req.body;

  try {
    /* =========================================================
     * FLOW A: UPDATE PLAN — chỉ cần gửi MẢNG MÓN ĐÃ ĐỔI
     * Body: { action: "update_plan", modifiedMeals: [{day, meal, food, ...}] }
     * ========================================================= */
    if (action === "update_plan") {
      log.step(`${traceId} | FLOW=update_plan`);

      if (!Array.isArray(modifiedMeals) || modifiedMeals.length === 0) {
        return sendError(
          res,
          400,
          "validate_modifiedMeals",
          "modifiedMeals phải là mảng không rỗng các món đã đổi",
          {
            traceId,
            received: typeof modifiedMeals,
            length: Array.isArray(modifiedMeals) ? modifiedMeals.length : null,
          }
        );
      }

      // Validate từng món
      const invalid = modifiedMeals.find(
        (m) => !m || !m.day || !m.meal || !m.food
      );
      if (invalid) {
        return sendError(
          res,
          400,
          "validate_modifiedMeals_fields",
          "Mỗi món trong modifiedMeals phải có day, meal, food",
          { traceId, sample: invalid }
        );
      }

      const [{ data: profile, error: profileErr }, foodsDB] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        fetchFoodsDB(),
      ]);

      if (profileErr || !profile) {
        return sendError(res, 404, "fetch_profile", "Không tìm thấy profile", {
          traceId,
          supabaseError: profileErr?.message,
        });
      }

      // Lấy plan gốc từ DB (không phụ thuộc client gửi đúng format)
      const currentGrouped = Array.isArray(profile.weekly_plan)
        ? profile.weekly_plan
        : [];
      if (currentGrouped.length === 0) {
        return sendError(
          res,
          400,
          "no_existing_plan",
          "Chưa có plan trong DB để cân đối lại",
          { traceId }
        );
      }

      // ✅ FIX: với MỖI món vừa đổi, tính lại dinh dưỡng CHÍNH XÁC cho riêng món đó
      //         (tra FOODS DB trước, không có thì để AI ước tính đúng 1 món).
      //         Không tái sinh cả tuần -> các bữa khác giữ nguyên, nhanh & chính xác.
      const resolvedMeals = [];
      for (const mod of modifiedMeals) {
        const nut = await resolveMealNutrition({
          food: mod.food,
          mealLabel: mod.meal,
          foodsDB,
          traceId,
        });
        // ✅ FIX #5: LUÔN giữ ĐÚNG tên món người dùng vừa nhập — không bao giờ
        //            đổi về tên món cũ/khác do DB hay AI trả tên hơi lệch.
        //            Dinh dưỡng thì lấy theo `nut` (đã tính lại chính xác).
        const userFood = String(mod.food == null ? "" : mod.food).trim();
        resolvedMeals.push({
          day: Number(mod.day),
          meal: mod.meal,
          food: userFood || nut.food,
          amount: nut.amount || mod.amount || "1 phần",
          calories: nut.calories,
          protein: nut.protein,
          fat: nut.fat,
          carbs: nut.carbs,
          fiber: nut.fiber,
          sugar: nut.sugar,
          sodium: nut.sodium,
        });
      }

      // Ghép dinh dưỡng đã tính vào plan gốc (chỉ thay đúng những bữa đã đổi)
      const grouped = applyModificationsToPlan(currentGrouped, resolvedMeals);
      const inserted = await syncMissingFoodsToDB(grouped, foodsDB);

      const { error: updateErr } = await supabase
        .from("profiles")
        .update({
          weekly_plan: grouped,
          plan_updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateErr) {
        return sendError(res, 500, "save_plan", "Lưu plan thất bại", {
          traceId,
          supabaseError: updateErr.message,
        });
      }

      log.info(`${traceId} | DONE update_plan`, {
        ms: Date.now() - startedAt,
        changed: resolvedMeals.length,
      });

      return res.status(200).json({
        success: true,
        newPlan: flattenPlan(grouped),
        updatedMeals: resolvedMeals,
        message: "Đã cập nhật & tính lại dinh dưỡng các món bạn đổi!",
        diagnostics: DEBUG
          ? { traceId, ms: Date.now() - startedAt, foodsInserted: inserted }
          : undefined,
      });
    }

    /* =========================================================
     * FLOW A2: ESTIMATE FOOD — ước tính dinh dưỡng 1 món lẻ
     * Dùng cho "Thêm món ăn ngoài thực đơn" (snack, trái cây...).
     * Body: { action: "estimate_food", food: "...", meal?: "..." }
     * ========================================================= */
    if (action === "estimate_food") {
      const food = (req.body.food || "").trim();
      if (!food) {
        return sendError(res, 400, "validate_food", "Thiếu tên món để ước tính", { traceId });
      }
      const foodsDB = await fetchFoodsDB();
      const nut = await resolveMealNutrition({
        food,
        mealLabel: req.body.meal || "",
        foodsDB,
        traceId,
      });
      logUsage({ userId: user.id, kind: "coach_estimate_food", durationMs: Date.now() - startedAt }); // E
      return res.status(200).json({ success: true, food: nut });
    }

    /* =========================================================
     * FLOW A3: HEALTH CHECK — cảnh báo tình trạng bệnh dựa theo
     * chế độ ăn uống 7 ngày gần nhất (dữ liệu client tổng hợp từ
     * các bữa đã đánh dấu "Đã ăn" + món thêm ngoài thực đơn).
     * Body: { action:"health_check", days:[{date, calories, protein,
     *         fat, carbs, dishes:[..]}], lang?: "vi"|"en" }
     * ========================================================= */
    if (action === "health_check") {
      log.step(`${traceId} | FLOW=health_check`);
      const days = Array.isArray(req.body.days)
        ? req.body.days.filter((d) => d && d.date).slice(-7)
        : [];
      if (days.length === 0) {
        return sendError(res, 400, "validate_days", "Thiếu dữ liệu ăn uống 7 ngày (days)", { traceId });
      }
      const lang = String(req.body.lang || "vi").toLowerCase() === "en" ? "en" : "vi";

      const { data: profile, error: profileErr } = await supabase
        .from("profiles").select("*").eq("id", user.id).single();
      if (profileErr || !profile) {
        return sendError(res, 404, "fetch_profile", "Không tìm thấy profile", {
          traceId, supabaseError: profileErr?.message,
        });
      }

      // RAG: nạp kiến thức theo bệnh lý để đối chiếu món đã ăn
      const knowledge = await retrieveKnowledge({
        disease: profile.disease,
        message: "chế độ ăn uống hằng ngày ảnh hưởng tới bệnh",
        topK: 6,
      });
      const knowledgeBlock = buildKnowledgeSection(knowledge);

      // Chống lặp + tự retry. Nếu SAU CẢ retry vẫn hỏng → KHÔNG bắn lỗi rác ra
      // người dùng: trả kết quả "stable" trung tính + lời khuyên chung, kèm cờ
      // degraded để client biết đây là bản dự phòng (trang vẫn dùng được bình thường).
      let parsed = null;
      try {
        ({ parsed } = await completeJsonWithRetry({
          messages: [{ role: "system", content: buildHealthCheckPrompt(profile, days, knowledgeBlock, lang) }],
          temperature: 0.2,
          max_tokens: 800,
          traceId,
          tag: "health_check",
        }));
      } catch (e) {
        log.warn(`${traceId} | health_check fallback (AI/parse hỏng): ${e.message}`);
      }

      logUsage({ userId: user.id, kind: "coach_health_check", durationMs: Date.now() - startedAt }); // E

      if (!parsed || typeof parsed !== "object") {
        const summary = lang === "en"
          ? "We couldn't complete the AI analysis right now. Based on your recent meals, keep your diet balanced and try again in a moment."
          : "Hiện chưa phân tích được bằng AI. Dựa trên các bữa gần đây, bạn hãy giữ chế độ ăn cân bằng và thử lại sau ít phút nhé.";
        const advice = lang === "en"
          ? ["Balance protein, carbs and fat across meals.", "Add more vegetables and drink enough water.", "Limit fried, sugary and very salty foods."]
          : ["Cân bằng đạm, tinh bột và chất béo giữa các bữa.", "Ăn thêm rau xanh và uống đủ nước.", "Hạn chế đồ chiên rán, nhiều đường và quá mặn."];
        return res.status(200).json({
          success: true,
          status: "stable",
          summary,
          advice,
          daysAnalyzed: days.length,
          degraded: true,
          diagnostics: DEBUG ? { traceId, ms: Date.now() - startedAt } : undefined,
        });
      }

      const status = ["good", "stable", "risk"].includes(String(parsed.status)) ? String(parsed.status) : "stable";
      const advice = Array.isArray(parsed.advice) ? parsed.advice.map(String).filter(Boolean) : [];

      log.info(`${traceId} | DONE health_check`, { ms: Date.now() - startedAt, status, days: days.length });
      return res.status(200).json({
        success: true,
        status,
        summary: String(parsed.summary || parsed.reply || ""),
        advice,
        daysAnalyzed: days.length,
        diagnostics: DEBUG ? { traceId, ms: Date.now() - startedAt } : undefined,
      });
    }

    /* =========================================================
     * FLOW B: GET / GENERATE WEEKLY PLAN
     * Body: { isQueryOnly: true } để chỉ lấy, không generate mới
     * ========================================================= */
    log.step(`${traceId} | FLOW=get_or_generate`, { isQueryOnly: !!isQueryOnly });

    const tFetch = Date.now();
    const [{ data: profile, error: profileErr }, foodsDB] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      fetchFoodsDB(),
    ]);
    const fetchMs = Date.now() - tFetch;
    let knowledgeMs = 0;

    if (profileErr || !profile) {
      return sendError(res, 404, "fetch_profile", "Không tìm thấy profile", {
        traceId,
        supabaseError: profileErr?.message,
      });
    }

    let currentPlan = profile.weekly_plan || [];
    const lastUpdated = profile.plan_updated_at
      ? new Date(profile.plan_updated_at)
      : null;
    const now = new Date();

    let isDeadlinePassed = false;
    if (profile.deadline) {
      const deadlineDate = new Date(profile.deadline);
      deadlineDate.setHours(23, 59, 59, 999);
      isDeadlinePassed = now > deadlineDate;
    }

    const diffDays = lastUpdated
      ? (now - lastUpdated) / (1000 * 60 * 60 * 24)
      : Infinity;
    const isMonday = now.getDay() === 1;

    // Logic tái sinh thực đơn:
    // 1) Chưa có plan → tạo mới
    // 2) Plan > 7 ngày tuổi → tạo mới (chu kỳ tuần)
    // 3) Đầu tuần mới (Thứ 2) và plan > 1 ngày tuổi → tạo mới
    // 4) User yêu cầu tường minh (force_regenerate)
    const forceRegenerate = req.body.force_regenerate === true;
    const planIsStale =
      currentPlan.length === 0 ||
      diffDays >= 7 ||
      (isMonday && diffDays >= 1);

    // isQueryOnly = "CHỈ ĐỌC, KHÔNG gọi AI" — trang /schedule dùng cờ này khi load
    // để hiện ngay thực đơn đã lưu. Trước đây cờ này được đọc ra rồi CHỈ đem đi log,
    // nên mỗi lần mở trang vẫn chạy full sinh plan (tới 6 lượt gọi LLM ~22s mỗi lượt)
    // → trang treo hàng phút. force_regenerate là yêu cầu tường minh nên luôn thắng.
    const readOnly = !!isQueryOnly && !forceRegenerate;
    const needsNewPlan = !isDeadlinePassed && !readOnly && (forceRegenerate || planIsStale);

    // Tính toán calo thực tế từ các bữa "isActuallyEaten" (user đã xác nhận ăn thực tế)
    // để so sánh với mục tiêu và điều chỉnh thực đơn những ngày còn lại
    const computeActualVsTarget = (plan, targetCalories) => {
      if (!Array.isArray(plan)) return null;
      const now = new Date();
      const todayDayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1-7

      let totalActual = 0;
      let totalTarget = 0;
      let actualDays = 0;

      for (const day of plan) {
        const dayNum = Number(day.day);
        if (dayNum > todayDayOfWeek) break; // Chưa đến ngày này
        const meals = Array.isArray(day.meals) ? day.meals : [];
        const dayActual = meals.filter((m) => m.isActuallyEaten).reduce((s, m) => s + (Number(m.calories) || 0), 0);
        const dayTarget = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
        if (dayActual > 0) {
          totalActual += dayActual;
          totalTarget += dayTarget;
          actualDays++;
        }
      }
      if (actualDays === 0) return null;
      return {
        avgActualPerDay: Math.round(totalActual / actualDays),
        avgTargetPerDay: Math.round(totalTarget / actualDays),
        targetCalories: Number(targetCalories) || 1600,
        deviation: Math.round(totalActual / actualDays) - (Number(targetCalories) || 1600),
        daysTracked: actualDays,
      };
    };

    log.info(`${traceId} | decision`, {
      hasPlan: currentPlan.length > 0,
      diffDays: Number(diffDays.toFixed(2)),
      isMonday,
      isDeadlinePassed,
      needsNewPlan,
    });

    let aiReply = "";
    let foodsInserted = 0;

    if (needsNewPlan) {
      // ── RAG: nạp kiến thức dinh dưỡng theo bệnh lý để xây thực đơn phù hợp ──
      const tKnow = Date.now();
      const knowledge = await retrieveKnowledge({
        disease: profile.disease,
        message: "",
        topK: 8,
      });
      knowledgeMs = Date.now() - tKnow;
      const knowledgeBlock = buildKnowledgeSection(knowledge);
      if (knowledge.chunks.length) {
        log.info(`${traceId} | knowledge`, {
          passages: knowledge.chunks.length,
          mode: knowledge.mode,
          diseases: knowledge.usedDiseaseKeys,
        });
      }

      // ── Tính toán deviation calo thực tế vs mục tiêu (nếu đã có plan cũ) ──
      let calorieDeviation = null;
      if (currentPlan.length > 0 && !forceRegenerate) {
        calorieDeviation = computeActualVsTarget(currentPlan, profile.target_calories);
        if (calorieDeviation) {
          log.info(`${traceId} | calorie_deviation`, calorieDeviation);
        }
      }

      // Một ngân sách CHUNG cho mọi lượt gọi LLM của request này (sinh + bù bữa),
      // để tổng thời gian không bao giờ chạm maxDuration.
      const aiDeadline = startedAt + AI_BUDGET_MS;

      let newFlatPlan;
      const tLlm = Date.now();
      try {
        const { promise, deduped } = dedupePlanRun(user.id, () => generatePlanByDays({
          profile,
          foodsDB,
          knowledgeBlock,
          deviationNote: buildDeviationNote(profile, calorieDeviation),
          traceId,
          deadline: aiDeadline,
        }));
        if (deduped) log.warn(`${traceId} | đã có lượt sinh đang chạy cho user này — dùng chung kết quả`);
        newFlatPlan = await promise;
        // Cả 7 ngày đều hỏng thì coi như sinh thất bại, đi tiếp cũng chỉ ra
        // bảng trống — rơi xuống nhánh catch để giữ plan cũ / báo tử tế.
        if (!newFlatPlan.length) throw new Error("cả 7 ngày đều không sinh được");
      } catch (planErr) {
        // AI dựng plan hỏng (kể cả sau retry). KHÔNG bắn JSON rác ra người dùng:
        // còn plan cũ thì giữ nguyên + báo nhẹ; chưa có plan thì báo lỗi thân thiện.
        log.warn(`${traceId} | plan gen fail: ${planErr.message}`);
        if (Array.isArray(currentPlan) && currentPlan.length > 0) {
          return res.status(200).json({
            success: true,
            reply: "HLV AI đang bận tạo thực đơn mới, tạm thời vẫn giữ lộ trình hiện tại của bạn. Bạn thử lại sau ít phút nhé!",
            newPlan: flattenPlan(currentPlan),
            isDeadlinePassed,
            degraded: true,
          });
        }
        return sendError(res, 503, "plan_generate_retry", "Chưa tạo được thực đơn lúc này, bạn vui lòng thử lại sau ít phút nhé!", { traceId });
      }
      // "Tạo lại đến khi ĐẦY ĐỦ": tự bổ sung các bữa còn thiếu (nhất là bữa Phụ)
      // bằng các lượt gọi nhỏ cho tới khi đủ 7 ngày × 4 bữa (hoặc model chịu thua).
      const llmMs = Date.now() - tLlm;

      /* Lưới an toàn: sinh song song thường đã phủ đủ 28/28 nên vòng bù hiếm
         khi chạy. Giữ lại cho trường hợp vài ngày lỗi mạng. */
      const tVal = Date.now();
      let filledFlat = toFlatMeals(newFlatPlan);
      filledFlat = await fillMissingMeals(filledFlat, { profile, foodsDB, knowledgeBlock, traceId, deadline: aiDeadline });
      currentPlan = groupPlanByDay(filledFlat);
      const stillMissing = findMissingSlots(filledFlat).length;
      const validationMs = Date.now() - tVal;

      const tSave = Date.now();
      foodsInserted = await syncMissingFoodsToDB(currentPlan, foodsDB);

      const { error: updateErr } = await supabase
        .from("profiles")
        .update({
          weekly_plan: currentPlan,
          plan_updated_at: now.toISOString(),
        })
        .eq("id", user.id);
      const saveMs = Date.now() - tSave;

      /* Log thời gian TỪNG BƯỚC, một dòng có cấu trúc.
         Không có nó thì lần sau chậm lại chỉ biết "tổng 300s" mà không biết
         khâu nào ăn thời gian — đúng tình cảnh vừa phải đo tay để tìm ra. */
      log.info(`${traceId} | timings_ms`, {
        fetch_data: fetchMs,
        knowledge: knowledgeMs,
        llm_generation: llmMs,
        validation: validationMs,
        supabase_save: saveMs,
        total: Date.now() - startedAt,
        meals: `${filledFlat.length}/${TOTAL_DAYS * MEALS_PER_DAY.length}`,
        still_missing: stillMissing,
      });

      if (updateErr) {
        return sendError(res, 500, "save_plan", "Lưu plan thất bại", {
          traceId,
          supabaseError: updateErr.message,
        });
      }

      // Thông báo thông minh dựa trên lý do tái sinh
      if (forceRegenerate) {
        aiReply = "HLV AI đã tạo lại thực đơn mới cho bạn theo yêu cầu!";
      } else if (calorieDeviation && Math.abs(calorieDeviation.deviation) > 150) {
        const overUnder = calorieDeviation.deviation > 0 ? "vượt" : "thiếu";
        aiReply = `Tuần mới bắt đầu! HLV AI nhận thấy tuần trước bạn ${overUnder} mục tiêu calo khoảng ${Math.abs(calorieDeviation.deviation)} kcal/ngày, nên đã điều chỉnh thực đơn tuần này cho phù hợp hơn.`;
      } else {
        aiReply = "Chào tuần mới! HLV AI đã thiết kế xong lộ trình 7 ngày cho bạn.";
      }
    } else if (isDeadlinePassed) {
      aiReply =
        "Chúc mừng bạn đã hoàn thành lộ trình! Hãy đặt một mục tiêu mới để tiếp tục nhé 🎉";
    } else {
      // TỰ BÙ KHI LOAD: plan đã lưu (kể cả plan CŨ tạo trước bản fix) nếu còn
      // THIẾU bữa (vd trống bữa Phụ) → tự bổ sung tới khi đủ 7×4 rồi lưu lại,
      // KHÔNG cần user bấm tạo lại. Chỉ chạy 1 lần cho mỗi plan thiếu (lần load
      // sau đã đủ nên không gọi lại). Đáp ứng: "load lại thì tạo lại đến khi đầy đủ".
      const flatNow = toFlatMeals(currentPlan);
      const missingNow = readOnly ? [] : findMissingSlots(flatNow);
      if (missingNow.length > 0) {
        log.warn(`${traceId} | plan đã lưu thiếu ${missingNow.length} bữa → tự bù khi load`);
        const filled = await fillMissingMeals(flatNow, { profile, foodsDB, traceId, deadline: startedAt + AI_BUDGET_MS });
        currentPlan = groupPlanByDay(filled);
        const { error: healErr } = await supabase
          .from("profiles")
          .update({ weekly_plan: currentPlan, plan_updated_at: now.toISOString() })
          .eq("id", user.id);
        if (healErr) log.warn(`${traceId} | lưu plan tự-bù lỗi: ${healErr.message}`);
        syncMissingFoodsToDB(currentPlan, foodsDB).catch(() => {});
        const left = findMissingSlots(toFlatMeals(currentPlan)).length;
        aiReply = left === 0
          ? "HLV AI đã bổ sung các bữa còn thiếu — thực đơn tuần của bạn giờ đã đầy đủ!"
          : "HLV AI đã bổ sung thêm các bữa còn thiếu cho thực đơn tuần của bạn.";
      } else if (readOnly && (planIsStale || findMissingSlots(flatNow).length > 0)) {
        // Chỉ-đọc: chưa gọi AI nên đừng báo "đang áp dụng tốt" khi thực đơn còn
        // trống/cũ — client sẽ tự chạy lượt sinh trong nền ngay sau đó.
        aiReply = currentPlan.length === 0
          ? "HLV AI đang soạn thực đơn tuần cho bạn..."
          : "HLV AI đang cập nhật lại thực đơn tuần cho bạn...";
      } else {
        aiReply = "Lộ trình tuần này của bạn vẫn đang được áp dụng rất tốt!";
      }
    }

    // Ở chế độ chỉ-đọc ta KHÔNG gọi AI, nên phải báo cho client biết còn nợ việc gì
    // để nó tự gọi lại 1 lượt sinh/bù trong nền (không chặn màn hình).
    const missingAfter = findMissingSlots(toFlatMeals(currentPlan)).length;
    const needsGeneration =
      readOnly && !isDeadlinePassed && (planIsStale || missingAfter > 0);

    return res.status(200).json({
      success: true,
      reply: aiReply,
      newPlan: flattenPlan(currentPlan),
      isDeadlinePassed,
      // client dùng 3 cờ này để quyết định có chạy nền hay không.
      // planStale = trống/quá hạn tuần (BẮT BUỘC dựng lại) vs chỉ thiếu vài bữa
      // (chỉ nên thử bù, vì model có thể không bao giờ bù đủ).
      needsGeneration,
      planStale: planIsStale,
      missingMeals: missingAfter,
      diagnostics: DEBUG
        ? {
            traceId,
            ms: Date.now() - startedAt,
            readOnly,
            planIsStale,
            needsNewPlan,
            needsGeneration,
            missingMeals: missingAfter,
            foodsInserted,
            foodsDBSize: foodsDB.length,
          }
        : undefined,
    });
  } catch (err) {
    return sendError(res, 500, "unhandled", err.message, {
      traceId,
      stack: err.stack?.split("\n").slice(0, 5),
      ms: Date.now() - startedAt,
    });
  }
}
