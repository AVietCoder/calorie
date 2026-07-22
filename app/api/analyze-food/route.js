import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase.js";
import { analyzeFoodImage } from "../../../lib/vision.js";
// Validation cuối trước khi trả kết quả: chặn số âm + đối chiếu công thức
// Atwater (kcal ~ 4P + 4C + 9F, sai số 15%) -> tự hiệu chỉnh kcal nếu lệch.
import { validateAndFixNutrition } from "../../../lib/nutrition.js";
// RAG: đối chiếu dinh dưỡng với Knowledge Base (PDF calo chuẩn admin upload) để
// ưu tiên số liệu chính xác, chống hallucination của vision (graceful, không chặn).
import { nutritionFromKnowledgeBase } from "../../../lib/rag/kb-answer.js";
// D: lưu ảnh đã phân tích vào "Nhật ký ảnh món ăn" (fire-and-forget).
import { saveFoodPhoto } from "../../../lib/food-diary.js";
// E: ghi nhật ký sử dụng AI (fire-and-forget).
import { logUsage } from "../../../lib/usage-log.js";
import { CORS_HEADERS, corsJson, corsOptions } from "../../../lib/cors.js";

export const maxDuration = 120;

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

// Bóc số gram từ chuỗi "3g" / "11 g" -> 3 / 11 (null nếu không có số).
const parseGrams = (val) => {
  if (val == null || String(val).trim() === "") return null;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
};

// Back-fill 1 macro bị thiếu từ calories theo Atwater (kcal = 4P + 4C + 9F).
// Chặn lỗi "protein trống -> Atwater hạ kcal sai" (nguyên nhân hình 2).
// Chỉ suy ra khi CHỈ thiếu đúng 1 macro và có calories tin cậy.
const fillMissingMacros = (f) => {
  const kcal = Number(f.calories) || 0;
  let P = parseGrams(f.protein);
  let C = parseGrams(f.carbs);
  let F = parseGrams(f.fat);
  const missingCount = [P, C, F].filter((x) => x == null).length;

  if (kcal > 0 && missingCount === 1) {
    const r1 = (x) => Math.max(0, Math.round(x * 10) / 10);
    if (P == null) P = r1((kcal - 4 * (C || 0) - 9 * (F || 0)) / 4);
    else if (C == null) C = r1((kcal - 4 * (P || 0) - 9 * (F || 0)) / 4);
    else if (F == null) F = r1((kcal - 4 * (P || 0) - 4 * (C || 0)) / 9);
  }

  return {
    ...f,
    protein: P != null ? `${P}g` : f.protein,
    carbs: C != null ? `${C}g` : f.carbs,
    fat: F != null ? `${F}g` : f.fat,
  };
};

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

// Khau phan 'chuan 1 suat' (1 phan/to/bat/dia/o/ly...) - chi khi do moi dung so lieu
// foods DB (override) hoac luu nguoc vao DB. Khau phan le ('1 mieng', 'nua bat'...)
// phai GIU NGUYEN so lieu vision tinh theo anh, tranh DB ghi de sai va tranh lam
// nhiem foods DB bang so lieu theo khau phan le (loi 'AI bi loan').
const isStandardPortion = (amount = '') => {
  const a = String(amount || '').toLowerCase().trim();
  if (!a) return true; // khong ro khau phan -> giu hanh vi cu
  return /^(1|m\u1ED9t|mot)\s*(ph\u1EA7n|phan|t\u00F4|to|b\u00E1t|bat|ch\u00E9n|chen|\u0111\u0129a|d\u0129a|dia|\u1ED5|o|ly|c\u1ED1c|coc|h\u1ED9p|hop|su\u1EA5t|suat)(?!\p{L})/u.test(a)
    && !/(?<!\p{L})(nh\u1ECF|nho|mini|b\u00E9|be)(?!\p{L})/u.test(a);
};

// Bảng foods tự phình theo mỗi lần phân tích → cap lại, ưu tiên verify + dùng nhiều.
const FOODS_DB_CAP = 2000;
const fetchFoodsDB = async () => {
  try {
    const { data, error } = await supabase
      .from("foods")
      .select("description, calories, protein, fat, carbs, fiber, sugar, sodium, source, confidence, verified")
      .order("verified", { ascending: false })
      .order("hit_count", { ascending: false })
      .limit(FOODS_DB_CAP);
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

export async function POST(request) {
  const _t0 = Date.now();
  const res = makeRes();

  // ── Xác thực ─────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
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
    const formData = await request.formData();
    const fields = {};
    for (const [k, v] of formData.entries()) if (typeof v === "string") fields[k] = v;
    const imageFile = formData.get("image") ?? formData.get("photo") ?? formData.get("file");

    const note = normalizeText(getFirst(fields.note) ?? getFirst(fields.message));
    const lang = normalizeText(getFirst(fields.lang)) || "vi";

    if (!imageFile) {
      return res.status(400).json({ success: false, error: "Thiếu ảnh để phân tích." });
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const base64Image = imageBuffer.toString("base64");
    const mimetype = imageFile.type || "image/jpeg";

    // ── Nhận diện ảnh qua vision.js (Gemini → Qwen JSON → Qwen <data> fallback) ──
    let obj;
    try {
      obj = await analyzeFoodImage({ base64: base64Image, mimeType: mimetype, note, lang });
    } catch (e) {
      console.error("[analyze-food] vision lỗi:", e.message);
      // Fallback: Qwen hội thoại với <data> tag (cách chat.js xử lý thành công)
      try {
        console.log("[analyze-food] Thử fallback Qwen <data> path...");
        const { llm, LLM_VISION_MODEL } = await import("../../../lib/llm.js");
        // max_pixels ~3.2MP (448×448×16) — đồng bộ lib/vision.js để đếm tốt vật thể nhỏ
        const QWEN_MIN_PIXELS = parseInt(process.env.QWEN_MIN_PIXELS || "200704", 10);
        const QWEN_MAX_PIXELS = parseInt(process.env.QWEN_MAX_PIXELS || "3211264", 10);
        const FALLBACK_PROMPT = `Bạn là chuyên gia dinh dưỡng. Nhìn ảnh, nhận diện món ăn và ước tính dinh dưỡng THEO ĐÚNG KHẨU PHẦN nhìn thấy (vd: 100ml, 1 ly, 1 phần...).
QUY TẮC BẮT BUỘC:
- Điền ĐẦY ĐỦ cả 4 chỉ số: calories, protein, fat, carbs. KHÔNG được để trống. Nếu món thực sự có protein/fat/carbs thì KHÔNG được ghi 0.
- Các chỉ số phải NHẤT QUÁN theo công thức Atwater: calories ≈ 4×protein(g) + 4×carbs(g) + 9×fat(g), sai số <15%.
- Ví dụ chuẩn: 100ml sữa socola ≈ 80 kcal, protein 3g, fat 3g, carbs 11g.
Trả lời ngắn gọn rồi KẾT THÚC bằng dòng JSON duy nhất theo format:
<data>{"calories":NNN,"protein":"NNg","fat":"NNg","carbs":"NNg","fiber":"NNg","sugar":"NNg","sodium":"NNmg","description":"Tên món"}</data>
Nếu KHÔNG phải món ăn: <data>{"calories":0,"protein":"0g","fat":"0g","carbs":"0g","fiber":"0g","sugar":"0g","sodium":"0mg","description":"NOT_FOOD"}</data>`;
        const userContent = [];
        if (note) userContent.push({ type: "text", text: `Món: ${note}` });
        userContent.push({ type: "image_url", image_url: { url: `data:${mimetype};base64,${base64Image}` } });
        // Junk-guard + retry đổi seed: Qwen đôi khi "degenerate" (rỗng/!!!!!) ở lần
        // đầu; thử vài seed trước khi bỏ cuộc (giống cách chat.js xử lý ổn định).
        const looksJunk = (t = "") => {
          const c = String(t).replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/\s+/g, "").trim();
          if (!c) return true;
          if (/(.)\1{15,}/.test(c)) return true;       // 1 ký tự lặp ≥16 lần
          if (/(.{2,5})\1{8,}/.test(c)) return true;   // cụm ngắn lặp ≥9 lần
          return false;
        };
        const runVision = async (seed, temperature) => {
          const completion = await llm.chat.completions.create({
            model: LLM_VISION_MODEL,
            max_tokens: 600,
            temperature,
            top_p: 1,
            seed,
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
          if (looksJunk(raw)) throw new Error("phản hồi rỗng/degenerate");
          const dataM = raw.match(/<data>([\s\S]*?)<\/data>/i) || raw.match(/<data>\s*(\{[\s\S]*)$/i);
          if (!dataM) throw new Error("Fallback không bóc được <data>");
          // Parse CHỊU LỖI: JSON thẳng → bỏ dấu phẩy thừa → chộp cụm {} lớn nhất.
          const tryParse = (t) => { try { return JSON.parse(String(t).trim().replace(/,\s*([}\]])/g, "$1")); } catch { return null; } };
          const parsed = tryParse(dataM[1]) || tryParse((dataM[1].match(/\{[\s\S]*\}/) || [])[0] || "");
          if (!parsed) throw new Error("Fallback <data> không parse được JSON");
          return parsed;
        };

        // temp 0 seed 42 trước (ổn định, cùng ảnh ra cùng số); hỏng mới đổi seed + nhiệt độ.
        const visionAttempts = [[42, 0], [123, 0.2], [777, 0.4]];
        let parsed = null, lastVisionErr;
        for (let k = 0; k < visionAttempts.length; k++) {
          try { parsed = await runVision(...visionAttempts[k]); break; }
          catch (e) { lastVisionErr = e; console.warn(`[analyze-food] fallback lần ${k + 1} hỏng: ${e.message}`); }
        }
        if (!parsed) throw lastVisionErr || new Error("Fallback thất bại");

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
      // items[]: danh sách phần tử + số lượng model đếm được (tổng đã được
      // vision.js tự nhân bằng code — quantity × calories_per_unit).
      items: Array.isArray(obj.items) ? obj.items : undefined,
      source: "ai",
    };

    // Back-fill macro thiếu NGAY sau vision: nếu để trống thì các bước sau
    // (DB lookup / Atwater) coi = 0 và hạ nhầm calories (80 -> 44 như hình 2).
    food = fillMissingMacros(food);

    // ── DB lookup: ưu tiên số liệu đã xác minh nếu món đã có trong DB ───
    // CHỈ áp dụng khi vision xác nhận đây là MỘT SUẤT CHUẨN. Khẩu phần lẻ
    // ("1 miếng", "nửa bát"...) giữ nguyên số vision tính theo ảnh — không
    // override từ DB (1 miếng sushi không thể lấy 350kcal của cả phần) và
    // không lưu ngược vào DB (tránh làm nhiễm foods DB -> "AI bị loạn").
    try {
      const standardPortion = isStandardPortion(food.amount);
      const foodsDB = standardPortion ? await fetchFoodsDB() : [];
      const key = normalizeFoodName(foodName);
      // CHỈ khớp CHÍNH XÁC sau chuẩn hóa — khớp mờ includes() hai chiều khiến
      // "Sushi cá hồi" lấy nhầm số của "Sushi" (và ngược lại) → sai số (Bug #1/#3).
      const hit = standardPortion && key
        ? foodsDB.find((f) => normalizeFoodName(f.description) === key) || null
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
          // Provenance (A+B): dòng foods đã verify → tin cao; chưa verify → medium.
          source: hit.verified ? "foods_verified" : "foods",
          _dbConfidence: hit.verified ? "high" : "medium",
        };
        console.log(`[analyze-food] DB hit: "${dbName}" (${food.calories} kcal)`);
      } else if (standardPortion) {
        // Lưu món mới vào DB để lần sau có sẵn (chỉ với suất chuẩn — khẩu phần lẻ
        // KHÔNG lưu để không làm nhiễm số liệu chung của món)
        const newRecord = {
          description: foodName,
          calories: food.calories,
          protein: food.protein,
          fat: food.fat,
          carbs: food.carbs,
          fiber: food.fiber,
          sugar: food.sugar,
          sodium: food.sodium,
          // Provenance (A+B): món do vision AI sinh, chưa admin verify.
          source: "ai",
          confidence: "medium",
          verified: false,
        };
        supabase.from("foods").insert(newRecord).then(({ error }) => {
          if (error) console.warn("[analyze-food] Lưu foods DB:", error.message);
        });
      }
    } catch (dbErr) {
      console.warn("[analyze-food] DB lookup lỗi (không chặn):", dbErr.message);
    }

    // ── RAG: đối chiếu với KNOWLEDGE BASE (PDF calo chuẩn admin đã upload) ──
    // Ưu tiên số liệu "chuẩn" từ tài liệu người dùng cung cấp hơn ước lượng của
    // vision (chống hallucination). KHÔNG đè lên món đã admin VERIFY trong foods
    // DB, và CHỈ áp cho SUẤT CHUẨN (tránh quy đổi khẩu phần lẻ sai). Helper có
    // cổng tin cậy + prompt nghiêm ngặt; không tìm thấy/lỗi → giữ nguyên số vision.
    try {
      if (food.source !== "foods_verified" && isStandardPortion(food.amount)) {
        const kb = await nutritionFromKnowledgeBase({ food: foodName, amount: food.amount || "1 phần", lang });
        if (kb.found && kb.calories > 0) {
          food = {
            ...food,
            calories: kb.calories,
            protein: kb.protein ?? food.protein,
            fat: kb.fat ?? food.fat,
            carbs: kb.carbs ?? food.carbs,
            fiber: kb.fiber ?? food.fiber,
            sugar: kb.sugar ?? food.sugar,
            sodium: kb.sodium ?? food.sodium,
            source: "kb",
            _dbConfidence: "high",
          };
          console.log(`[analyze-food] KB override (RAG): "${foodName}" → ${kb.calories} kcal`);
        }
      }
    } catch (kbErr) {
      console.warn("[analyze-food] KB grounding lỗi (không chặn):", kbErr.message);
    }

    // Back-fill lần nữa PHÒNG trường hợp DB hit trả về macro null/trống,
    // trước khi Atwater check chạy (chặn kcal bị hạ sai vì macro rỗng).
    food = fillMissingMacros(food);

    // ── Validation cuối (Yêu cầu #8): số âm + Atwater check ──────────────
    const fixed = validateAndFixNutrition(food);
    food = {
      ...food,
      calories: fixed.calories,
      protein: fixed.protein,
      fat: fixed.fat,
      carbs: fixed.carbs,
      fiber: fixed.fiber,
      sugar: fixed.sugar,
      sodium: fixed.sodium,
      // Provenance (A+B): foods verify hoặc KB (PDF chuẩn) = high; foods chưa verify
      // hoặc vision ước theo ảnh = medium. estimated=false khi lấy từ nguồn xác minh
      // (foods_verified) hoặc Knowledge Base (kb).
      confidence: food._dbConfidence || (["foods_verified", "kb"].includes(food.source) ? "high" : "medium"),
      estimated: !["foods_verified", "kb"].includes(food.source),
    };
    delete food._dbConfidence;
    if (fixed.corrected) {
      console.log(`[analyze-food] Atwater hiệu chỉnh kcal -> ${food.calories}`);
    }

    // D: lưu ảnh vào nhật ký (fire-and-forget — không chặn/không làm chậm response)
    saveFoodPhoto({ userId: user.id, buffer: imageBuffer, analysis: food, conversationRef: "extra-food" });
    logUsage({ userId: user.id, kind: "analyze_food", durationMs: Date.now() - _t0 }); // E

    console.log(`[analyze-food] ✅ "${food.food}" | ${food.calories} kcal | source=${food.source}`);
    return res.status(200).json({ success: true, food });

  } catch (err) {
    console.error("analyze-food error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Lỗi phân tích ảnh: " + (err?.message || "unknown") });
  }
}
