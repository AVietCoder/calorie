import { supabase } from "../lib/supabase.js";
import { retrieveKnowledge, buildKnowledgeSection } from "../lib/knowledge.js";
// Local LLM (vLLM) via OpenAI-compatible client. See lib/llm.js.
import { llm as openai, LLM_MODEL } from "../lib/llm.js";

const MODEL = LLM_MODEL;
const DEBUG =
  process.env.DEBUG_COACH === "1" || process.env.NODE_ENV !== "production";

const MEALS_PER_DAY = ["Sáng", "Trưa", "Tối", "Phụ"];
const TOTAL_DAYS = 7;

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

const safeParseAIJson = (raw) => {
  if (!raw) throw new Error("AI trả về rỗng");
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        try {
          return JSON.parse(m[0].replace(/,\s*([}\]])/g, "$1"));
        } catch {
          /* rơi xuống throw */
        }
      }
    }
    throw new Error("AI JSON không hợp lệ. Preview: " + cleaned.slice(0, 300));
  }
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
      .select("description, calories, protein, fat, carbs, fiber, sugar, sodium")
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

const formatFoodsForPrompt = (foods) => {
  if (!Array.isArray(foods) || foods.length === 0) return "(Chưa có dữ liệu)";
  return foods
    .map(
      (f) =>
        `- ${f.description} | ${f.calories ?? "?"}kcal | P:${f.protein ?? "?"} | F:${f.fat ?? "?"} | C:${f.carbs ?? "?"} | Fi:${f.fiber ?? "?"} | Su:${f.sugar ?? "?"} | Na:${f.sodium ?? "?"}`
    )
    .join("\n");
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
3. Nếu món KHÔNG có → tự ước tính theo khẩu phần Việt Nam.
4. Không lặp lại cùng 1 món quá 2 lần trong 7 ngày.
`;
};

const syncMissingFoodsToDB = async (plan, foodsDB) => {
  if (!Array.isArray(plan) || plan.length === 0) return 0;
  const existing = new Set(
    (foodsDB || []).map((f) => normalizeFoodName(f.description))
  );
  const seen = new Set();
  const missing = [];
  for (const dayEntry of plan) {
    for (const meal of dayEntry.meals || []) {
      const foodName = meal.food?.trim();
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
    out.push({ ...rest, day: Number(day) });
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
JSON object có key "plan" là MẢNG ${TOTAL_DAYS} NGÀY. Mỗi ngày 4 bữa: ${MEALS_PER_DAY.join(", ")}.
Mỗi bữa BẮT BUỘC có đủ 10 trường: meal, food, amount, calories, protein, fat, carbs, fiber, sugar, sodium.

Ví dụ:
{
  "plan": [
    {
      "day": 1,
      "meals": [
        { "meal": "Sáng", "food": "Phở gà", "amount": "1 bát (400ml)",
          "calories": 450, "protein": "28g", "fat": "12g", "carbs": "58g",
          "fiber": "2g", "sugar": "4g", "sodium": "920mg" }
      ]
    }
  ]
}
Chỉ trả về JSON hợp lệ, không markdown, không giải thích.
`;

const buildCreatePlanPrompt = (profile, foodsDB, knowledgeBlock = "") => `
Bạn là chuyên gia dinh dưỡng và am hiểu sâu ẩm thực Việt Nam 3 miền Bắc - Trung - Nam.

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
`;

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
 * 5. AI CALL WRAPPER
 * ========================================================= */
const callAIForPlan = async ({ systemPrompt, userPayload, traceId }) => {
  const t0 = Date.now();
  const messages = [{ role: "system", content: systemPrompt }];
  if (userPayload) {
    messages.push({
      role: "user",
      content:
        typeof userPayload === "string" ? userPayload : JSON.stringify(userPayload),
    });
  }
  log.info(`${traceId} | AI request`, {
    model: MODEL,
    promptChars: systemPrompt.length,
    payloadChars: userPayload ? JSON.stringify(userPayload).length : 0,
  });

  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 6000,  // 7-day plan đầy đủ, tránh JSON bị cụt (gây lỗi parse)
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    });
  } catch (err) {
    log.error(`${traceId} | OpenAI`, err);
    throw new Error(`OpenAI lỗi: ${err.message}`);
  }

  const raw = completion.choices?.[0]?.message?.content ?? "";
  log.info(`${traceId} | AI response`, {
    ms: Date.now() - t0,
    chars: raw.length,
    preview: raw.slice(0, 200),
  });

  const parsed = safeParseAIJson(raw);
  const planArr = extractPlanArray(parsed);
  if (!Array.isArray(planArr) || planArr.length === 0) {
    throw new Error(
      "AI không trả về plan hợp lệ. Keys: " + Object.keys(parsed || {}).join(", ")
    );
  }
  return planArr;
};

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
  const sys = `Bạn là chuyên gia dinh dưỡng ẩm thực Việt Nam, hiểu rõ món ăn 3 miền Bắc - Trung - Nam.
MẶC ĐỊNH coi đây là MÓN ĂN VIỆT NAM trừ khi tên ghi rõ là món nước ngoài.
Hiểu các tên gọi vùng miền và cách viết khác nhau (vd: "bắp" = "ngô", "heo" = "lợn",
"khoai mì" = "sắn", "trái" = "quả", "hủ tiếu" / "hủ tíu", "bánh mỳ" = "bánh mì").
Phân biệt đúng các món dễ nhầm (vd: phở bò ≠ bún bò Huế ≠ bún riêu; cơm tấm ≠ cơm gà;
xôi mặn ≠ xôi xéo). KHÔNG được đoán nhầm sang một món khác chỉ vì tên gần giống.

Ước tính dinh dưỡng cho ĐÚNG MỘT món ăn theo khẩu phần 1 người Việt thông thường
(vd: 1 tô/bát phở ~ 400-500g; 1 đĩa cơm tấm sườn ~ 1 phần; 1 ổ bánh mì ~ 1 ổ).
${mealLabel ? `Bữa: ${mealLabel}.` : ""}
Món: "${food}".

Trả về DUY NHẤT một JSON object đúng các trường sau:
{ "food": "<giữ NGUYÊN tên món người dùng nhập>", "amount": "<khẩu phần, vd: 1 tô (450g)>",
  "calories": <number kcal>, "protein": "<g>", "fat": "<g>", "carbs": "<g>",
  "fiber": "<g>", "sugar": "<g>", "sodium": "<mg>" }
Chỉ trả JSON hợp lệ, không markdown, không giải thích.`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: "system", content: sys }],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 200,   // single-food nutrition JSON ≤ 150 token
    extra_body: { chat_template_kwargs: { enable_thinking: false } },
  });
  const raw = completion.choices?.[0]?.message?.content ?? "";
  log.info(`${traceId} | estimateOneFood`, { food, preview: raw.slice(0, 160) });
  const obj = safeParseAIJson(raw);
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

/** Resolve dinh dưỡng chính xác cho 1 món: ưu tiên DB, không có thì để AI ước tính. */
const resolveMealNutrition = async ({ food, mealLabel, foodsDB, traceId }) => {
  const dbHit = findFoodInDB(food, foodsDB);
  if (dbHit) return dbHit;
  try {
    return await estimateOneFoodAI({ food, mealLabel, traceId });
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
    };
  }
};

/* =========================================================
 * 6. MAIN HANDLER
 * ========================================================= */
export default async function handler(req, res) {
  const traceId = newTraceId();
  const startedAt = Date.now();

  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  log.info(`${traceId} | INCOMING`, {
    method: req.method,
    hasAuth: !!req.headers.authorization,
    bodyKeys: req.body ? Object.keys(req.body) : [],
  });

  if (req.method !== "POST") {
    return sendError(res, 405, "method_check", `Method ${req.method} không hỗ trợ`, {
      traceId,
    });
  }

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
      return res.status(200).json({ success: true, food: nut });
    }

    /* =========================================================
     * FLOW B: GET / GENERATE WEEKLY PLAN
     * Body: { isQueryOnly: true } để chỉ lấy, không generate mới
     * ========================================================= */
    log.step(`${traceId} | FLOW=get_or_generate`, { isQueryOnly: !!isQueryOnly });

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
    const needsNewPlan =
      !isDeadlinePassed &&
      (currentPlan.length === 0 || diffDays >= 7 || (isMonday && diffDays >= 1));

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
      const knowledge = await retrieveKnowledge({
        disease: profile.disease,
        message: "",
        topK: 8,
      });
      const knowledgeBlock = buildKnowledgeSection(knowledge);
      if (knowledge.chunks.length) {
        log.info(`${traceId} | knowledge`, {
          passages: knowledge.chunks.length,
          mode: knowledge.mode,
          diseases: knowledge.usedDiseaseKeys,
        });
      }

      const newFlatPlan = await callAIForPlan({
        systemPrompt: buildCreatePlanPrompt(profile, foodsDB, knowledgeBlock),
        traceId,
      });
      currentPlan = groupPlanByDay(newFlatPlan);
      foodsInserted = await syncMissingFoodsToDB(currentPlan, foodsDB);

      const { error: updateErr } = await supabase
        .from("profiles")
        .update({
          weekly_plan: currentPlan,
          plan_updated_at: now.toISOString(),
        })
        .eq("id", user.id);

      if (updateErr) {
        return sendError(res, 500, "save_plan", "Lưu plan thất bại", {
          traceId,
          supabaseError: updateErr.message,
        });
      }
      aiReply = "Chào tuần mới! HLV AI đã thiết kế xong lộ trình 7 ngày cho bạn.";
    } else if (isDeadlinePassed) {
      aiReply =
        "Chúc mừng bạn đã hoàn thành lộ trình! Hãy đặt một mục tiêu mới để tiếp tục nhé 🎉";
    } else {
      aiReply = "Lộ trình tuần này của bạn vẫn đang được áp dụng rất tốt!";
    }

    return res.status(200).json({
      success: true,
      reply: aiReply,
      newPlan: flattenPlan(currentPlan),
      isDeadlinePassed,
      diagnostics: DEBUG
        ? {
            traceId,
            ms: Date.now() - startedAt,
            needsNewPlan,
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
