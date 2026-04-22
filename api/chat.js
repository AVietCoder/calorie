import { IncomingForm } from "formidable";
import OpenAI from "openai";
import fs from "fs";
import { supabase } from "./lib/supabase.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = {
  api: {
    bodyParser: false,
  },
};

const getFirst = (value) => {
  if (Array.isArray(value)) return value[0];
  return value ?? null;
};

const normalizeText = (value) => {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
};

const normalizeHistory = (history) => {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && typeof item === "object" && item.role && item.content != null)
    .map((item) => ({
      role: item.role,
      content: Array.isArray(item.content) ? JSON.stringify(item.content) : String(item.content),
    }));
};

const truncateHistory = (history, max = 20) => {
  if (!Array.isArray(history)) return [];
  if (history.length <= max) return history;
  return history.slice(-max);
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const extractDataBlock = (text = "") => {
  const match = String(text).match(/<data>([\s\S]*?)<\/data>/i);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
};

const MEAL_TIME_REGEX = /\b(sáng|trưa|chiều|tối|bữa phụ|bua phu|ăn lúc|lúc nào|mấy giờ)\b/i;

const FOLLOW_UP_MEAL_TIME_QUESTION =
  "Bạn có thể cho tôi biết bạn ăn vào sáng, trưa, tối hay bữa phụ không?";

const shouldAskMealTime = (message = "") => {
  return !MEAL_TIME_REGEX.test(String(message || ""));
};

const appendMealTimeFollowUp = (reply, message) => {
  const text = String(reply || "").trim();
  if (!text) return FOLLOW_UP_MEAL_TIME_QUESTION;

  if (!shouldAskMealTime(message)) return text;

  const lower = text.toLowerCase();
  const alreadyAsked =
    lower.includes("sáng, trưa, tối hay bữa phụ") ||
    lower.includes("bạn có thể cho tôi biết bạn ăn vào") ||
    lower.includes("bữa phụ không") ||
    lower.includes("ăn vào lúc nào");

  if (alreadyAsked) return text;

  return `${text}\n\n${FOLLOW_UP_MEAL_TIME_QUESTION}`;
};

const buildCoachPrompt = ({
  profile,
  currentPlan,
  currentDayName,
  dayOfWeek,
  message,
  isQueryOnly,
  isDeadlinePassed,
}) => {
  let prompt = `
Bạn là HLV Dinh dưỡng AI thông minh, thân thiện và am hiểu ẩm thực Việt Nam.

HÔM NAY LÀ: ${currentDayName} (Tương ứng "day": ${dayOfWeek} trong thực đơn).

QUY TẮC ÁNH XẠ NGÀY TRONG THỰC ĐƠN:
day 1 = Thứ 2
day 2 = Thứ 3
day 3 = Thứ 4
day 4 = Thứ 5
day 5 = Thứ 6
day 6 = Thứ 7
day 7 = Chủ Nhật

Khi người dùng nói:
- "Thứ 2" → day = 1
- "Thứ 3" → day = 2
- "Thứ 4" → day = 3
- "Thứ 5" → day = 4
- "Thứ 6" → day = 5
- "Thứ 7" → day = 6
- "Chủ Nhật" → day = 7

LUÔN sử dụng mapping này khi cập nhật newPlan.
Không được dùng số thứ tự tự nhiên của ngày trong tuần.
Người dùng vừa nhắn: "${message}"

THÔNG TIN NGƯỜI DÙNG
- Giới tính: ${profile.gender ?? "N/A"}
- Năm sinh: ${profile.birth_year ?? "N/A"}
- Chiều cao: ${profile.height ?? "N/A"} cm
- Cân nặng: ${profile.weight ?? "N/A"}kg
- Mục tiêu: ${profile.goal ?? "N/A"}
- Bệnh lý (nếu có): ${profile.disease || "Không có"}
- Macro ưu tiên: ${profile.focus_macro ?? "N/A"}
- Calo mục tiêu/ngày: ${profile.target_calories || "1500-1800"} kcal
- Lý do thực hiện: ${profile.reason || "N/A"}

YÊU CẦU:
- Ưu tiên các món ăn phổ biến của người Việt Nam.
- Thực đơn đa dạng giữa các ngày (không lặp lại món quá nhiều).
- Có sự cân bằng dinh dưỡng phù hợp với mục tiêu (giảm cân / tăng cơ / duy trì).
- Bao gồm món ăn quen thuộc như: cơm, bún, phở, hủ tiếu, canh, cá, thịt, trứng, đậu, rau xanh, trái cây,...
- Có thể kết hợp món hiện đại lành mạnh (salad, yến mạch, sữa chua, sinh tố).
- Tránh các món quá cầu kỳ, khó tìm nguyên liệu hoặc chế biến phức tạp.
- Mỗi ngày gồm 4 bữa: Sáng, Trưa, Tối, Phụ (bữa phụ có thể là trái cây, sữa chua, hạt,...).
- Cung cấp lượng calo ước tính cho mỗi bữa và tổng calo/ngày.
- Tránh các món ảnh hưởng đến bệnh lý (nếu có) và ưu tiên thực phẩm hỗ trợ sức khỏe.

THỰC ĐƠN 7 NGÀY HIỆN TẠI
${JSON.stringify(currentPlan)}

--------------------------------

MỤC TIÊU XỬ LÝ

1) update_plan
- Người dùng đã nói đủ thông tin để cập nhật thực đơn.
- Ví dụ:
  - "Đổi trưa thứ 3 thành bún chả"
  - "Tối nay ăn phở bò"
  - "Trưa thứ 6 lỡ ăn pizza 1000 kcal"
- Nếu đủ thông tin thì PHẢI cập nhật newPlan.

2) analyze_only
- Người dùng chỉ hỏi kiến thức, chỉ nói món ăn, hoặc chỉ muốn ước tính calo mà không đủ thông tin để sửa plan.
- Ví dụ:
  - "Ăn táo có tốt không?"
  - "Một tô bún bò bao nhiêu calo?"
  - "Tôi vừa ăn 2 cái bánh mì"
- Chỉ phân tích, không đổi plan.

3) ask_clarify
- Người dùng muốn đổi thực đơn nhưng thiếu ngày hoặc thiếu bữa.
- Ví dụ:
  - "Đổi thứ 4 sang bún bò"
  - "Thứ 6 ăn súp"
  - "Sửa bữa ăn này"
- Phải hỏi lại rõ ràng.

QUY TẮC RẤT QUAN TRỌNG
- Nếu người dùng chỉ nói tên món ăn mà không có ngày/bữa → chỉ phân tích calo, không đổi plan.
- Nếu người dùng muốn đổi plan nhưng thiếu ngày hoặc thiếu bữa → phải hỏi lại.
- Chỉ khi đủ thông tin mới được cập nhật newPlan.
- Nếu isQueryOnly = true thì tuyệt đối không đổi thực đơn, chỉ trả lời tư vấn / phân tích.

RÀNG BUỘC ĐIỀU CHỈNH THỰC ĐƠN
- Mỗi ngày có 4 bữa: Sáng, Trưa, Tối, Phụ.
- Thực đơn phải đủ 7 ngày (day 1 → day 7), không được làm mất ngày nào.
- Nếu ngày trước ăn dư, các bữa/ngày sau nên thanh đạm hơn một chút.
- Không giảm calo quá mạnh gây thiếu dinh dưỡng.
- Ưu tiên món Việt Nam dễ làm, dễ mua.
- Hạn chế lặp lại món quá nhiều.
- Giữ macro phù hợp mục tiêu ${profile.focus_macro || "cân bằng"}.

ĐỊNH DẠNG MỖI BỮA (BẮT BUỘC ĐẦY ĐỦ TẤT CẢ CÁC TRƯỜNG)
{
  "meal": "Sáng | Trưa | Tối | Phụ",
  "food": "Tên món",
  "amount": "khẩu phần",
  "calories": số_calories,
  "protein": "số + g",
  "fat": "số + g",
  "carbs": "số + g",
  "fiber": "số + g",
  "sugar": "số + g",
  "sodium": "số + mg"
}
Mọi bữa ăn trong newPlan đều PHẢI có đủ 10 trường trên. Không được bỏ sót bất kỳ trường nào.

PHẢN HỒI BẮT BUỘC
Trả về JSON hợp lệ với các trường sau:
{
  "reply": "...",
  "action": "update_plan" | "analyze_only" | "ask_clarify",
  "needsClarification": true/false,
  "clarifyQuestion": "...",
  "newPlan": [...]
}

QUY TẮC CHO TỪNG TRƯỜNG:
- reply: giải thích ngắn gọn, tự nhiên, thân thiện. Khi update_plan, nêu rõ: món đã ghi nhận, tổng calo ngày hôm đó, và cách điều chỉnh các bữa/ngày còn lại.
- action:
  - "update_plan" khi đủ thông tin để cập nhật thực đơn
  - "analyze_only" khi chỉ phân tích calo / kiến thức
  - "ask_clarify" khi cần hỏi thêm ngày/bữa
- needsClarification:
  - true nếu phải hỏi lại
  - false nếu không cần
- clarifyQuestion:
  - chỉ điền khi cần hỏi lại
  - ví dụ: "Bạn muốn đổi vào ngày nào và bữa nào? (Sáng / Trưa / Tối / Phụ)"
- newPlan:
  - nếu action = update_plan thì trả về thực đơn 7 ngày đã cập nhật ĐẦY ĐỦ
  - nếu action = analyze_only hoặc ask_clarify thì phải giữ nguyên thực đơn cũ

NHIỆM VỤ CỤ THỂ

A. Nếu người dùng báo đã ăn gì ngoài kế hoạch và đủ thông tin ngày/bữa:
- Ước lượng CHÍNH XÁC calo + đầy đủ macro (protein, fat, carbs, fiber, sugar, sodium) của món đã ăn thực tế.
- Cập nhật đúng vào ngày và bữa tương ứng.
- Tính tổng calo ngày đó sau khi cập nhật bữa này.
- TÁI CÂN BẰNG CÁC BỮA CÒN LẠI TRONG NGÀY ĐÓ:
  + Nếu bữa vừa ăn VƯỢT calo kế hoạch → giảm bớt các bữa còn lại trong ngày, ưu tiên món nhẹ dễ tiêu, ít dầu mỡ (cháo trắng, rau luộc, canh rau, trái cây, sữa chua không đường).
  + Nếu bữa vừa ăn ÍT hơn kế hoạch → tăng nhẹ bữa phụ hoặc bữa tiếp theo bằng món giàu protein (trứng luộc, ức gà, đậu hũ, cá hấp).
  + Đảm bảo TỔNG CALO CẢ NGÀY vẫn gần mục tiêu ${profile.target_calories || "1500-1800"} kcal (dao động ±150 kcal là chấp nhận được).
- TÁI CẤU TRÚC CÁC NGÀY SAU (từ ngày tiếp theo đến hết day 7):
  + Nếu ngày hiện tại DƯ calo (>150 kcal so với mục tiêu) → điều chỉnh 1-2 ngày sau thanh đạm hơn: ưu tiên rau xanh, protein nạc (ức gà luộc, cá hấp, tôm, đậu hũ), giảm tinh bột, tránh chiên xào.
  + Nếu ngày hiện tại THIẾU calo (<150 kcal so với mục tiêu) → giữ nguyên hoặc tăng nhẹ bữa phụ các ngày sau bằng món bổ dưỡng.
  + Thay đổi phải TỰ NHIÊN, KHÔNG CẮT GIẢM ĐỘT NGỘT, đảm bảo đủ dinh dưỡng cho mục tiêu ${profile.goal || "sức khỏe"}.
  + Ưu tiên đa dạng món Việt: phở, bún, cơm, cháo, bánh mì, gỏi, canh... tránh lặp lại quá 2 lần/tuần với cùng 1 món.
- Mỗi bữa trong newPlan PHẢI có đủ 10 trường: meal, food, amount, calories, protein, fat, carbs, fiber, sugar, sodium.

B. Nếu người dùng chỉ nói món ăn mà không có ngày/bữa:
- Phân tích đầy đủ: calo, protein, fat, carbs, fiber, sugar, sodium và nhận xét tác động đến mục tiêu ${profile.goal || "sức khỏe"}.
- Gợi ý điều chỉnh nếu cần (ví dụ: ăn kèm rau, giảm dầu...).
- Không thay đổi thực đơn.

C. Nếu người dùng muốn đổi thực đơn nhưng thiếu ngày hoặc thiếu bữa:
- Hỏi lại rõ ràng ngày và bữa cụ thể.
- Không thay đổi thực đơn.

D. Nếu người dùng muốn đổi món cụ thể và đã nói rõ ngày/bữa:
- Cập nhật món đó với đầy đủ 10 trường dinh dưỡng.
- TÁI CÂN BẰNG các bữa còn lại trong ngày đó để tổng calo ngày gần mục tiêu ${profile.target_calories || "1500-1800"} kcal.
- Tái cấu trúc từ ngày tiếp theo đến hết day 7 nếu tổng ngày lệch nhiều, ưu tiên món Việt đa dạng, không lặp lại.

CHỈ TRẢ VỀ JSON, KHÔNG THÊM BẤT KỲ VĂN BẢN NÀO KHÁC.
isQueryOnly = ${isQueryOnly ? "true" : "false"}
`;

  if (isDeadlinePassed) {
    prompt += `
\n[LƯU Ý QUAN TRỌNG]: Người dùng đã VƯỢT QUÁ THỜI HẠN (deadline) của lộ trình hiện tại. 
Bạn tuyệt đối KHÔNG ĐƯỢC cập nhật thực đơn (action luôn là "analyze_only").
Hãy gửi lời chúc mừng chân thành vì họ đã hoàn thành chặng đường, tư vấn lượng calo bình thường, và khuyên họ vào mục LỘ TRÌNH (Plan) để cập nhật lại chỉ số cơ thể nhằm bắt đầu chu kỳ mới.`;
  }

  return prompt;
};

const buildNutritionPrompt = () => {
  return `
Bạn là chuyên gia dinh dưỡng AI.
Nhiệm vụ: Phân tích thực phẩm từ hình ảnh hoặc văn bản.

QUY TẮC KIỂM TRA ẢNH:
- CHỈ KHI người dùng gửi hình ảnh: Nếu hình ảnh KHÔNG liên quan đến thực phẩm/đồ uống, bạn BẮT BUỘC phải trả về nội dung lỗi nằm trong thẻ <error>...</error>.
- Ví dụ: <error>Xin lỗi, tôi thấy đây là một chiếc xe hơi. Tôi chỉ có thể phân tích thực phẩm.</error>

- NẾU người dùng chỉ nhắn tin văn bản (không có ảnh): Hãy trả lời bình thường như một chuyên gia (tư vấn, giải đáp thắc mắc) mà không cần bắt lỗi "Không phải thức ăn".

QUY TẮC TRẢ VỀ (Khi là thực phẩm):
1. Viết một đoạn nhận xét ngắn gọn, thân thiện về món ăn cho người dùng.
2. BẮT BUỘC chèn dữ liệu JSON vào cuối câu trả lời bên trong thẻ <data>...</data>.
3. JSON phải có đầy đủ các trường sau (nếu không biết rõ hãy ước lượng số chính xác nhất):
{
  "calories": số (kcal),
  "protein": "số + g",
  "fat": "số + g",
  "carbs": "số + g",
  "fiber": "số + g",
  "sugar": "số + g",
  "sodium": "số + mg",
  "description": "tên món ăn hoặc tóm tắt ngắn"
}

Nếu người dùng chỉ gửi ảnh mà không nói rõ bữa ăn, sau khi phân tích xong hãy hỏi thêm:
"Bạn có thể cho tôi biết bạn ăn vào sáng, trưa, tối hay bữa phụ không?"

Ví dụ khi không phải thức ăn (chỉ khi người dùng gửi ảnh không liên quan):
"Xin lỗi, tôi thấy đây là một chiếc xe hơi. Tôi chỉ có thể phân tích dinh dưỡng từ thực phẩm. <error>Không phải thức ăn</error>"

Ví dụ khi là thức ăn:
<data>{"calories": 250, "protein": "15g", "fat": "10g", "carbs": "30g", "fiber": "2g", "sugar": "5g", "sodium": "400mg", "description": "Phở bò Việt Nam"}</data>
`;
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Không tìm thấy mã xác thực" });
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });
  }

  const form = new IncomingForm();

  try {
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, parsedFields, parsedFiles) => {
        if (err) return reject(err);
        resolve([parsedFields, parsedFiles]);
      });
    });

    const message = normalizeText(getFirst(fields.message));
    const imageFile = getFirst(files.image);
    const isQueryOnly = String(getFirst(fields.isQueryOnly) ?? "false") === "true";

    const followupType = normalizeText(getFirst(fields.followupType));
    const mealDataRaw = normalizeText(getFirst(fields.mealData));
    const mealTime = normalizeText(getFirst(fields.mealTime));
    const mealDayMode = normalizeText(getFirst(fields.mealDayMode));

    const mealDayText =
      normalizeText(getFirst(fields.mealDayText)) ||
      normalizeText(getFirst(fields.mealDayValue));
    const pendingMealData = safeJsonParse(mealDataRaw);
    console.log("0: " + mealTime);
    console.log("2: " + mealDayText);

    if (!message && !imageFile) {
      return res.status(400).json({ error: "Thiếu dữ liệu: Gửi tin nhắn hoặc ảnh." });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: "Người dùng không tồn tại" });
    }

    let history = normalizeHistory(profile.chat_history || []);
    let currentPlan = Array.isArray(profile.weekly_plan) ? profile.weekly_plan : [];
    const now = new Date();
    let isDeadlinePassed = false;
    if (profile.deadline) {
      const deadlineDate = new Date(profile.deadline);
      deadlineDate.setHours(23, 59, 59, 999);
      isDeadlinePassed = now > deadlineDate;
    }

    const effectiveIsQueryOnly = isQueryOnly || isDeadlinePassed;
    const formatDate = (dateInput) => {
      const date = new Date(dateInput);
      const d = String(date.getDate()).padStart(2, "0");
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const y = date.getFullYear();
      return `${d}/${m}/${y}`;
    };

    const todayText = formatDate(mealDayText == "hôm nay" ? now : mealDayText);
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const dayNames = ["", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"];
    const currentDayName = dayNames[dayOfWeek];
    const resolvedDayText = todayText;

    // Có ảnh: phân tích ảnh + text
    if (imageFile) {
      let userContent = [];

      if (message) {
        userContent.push({ type: "text", text: message });
      }

      const imageBuffer = fs.readFileSync(imageFile.filepath);
      const base64Image = imageBuffer.toString("base64");

      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${imageFile.mimetype};base64,${base64Image}`,
        },
      });

      const messages = [
        {
          role: "system",
          content: buildNutritionPrompt(),
        },
        ...history.slice(-10),
        {
          role: "user",
          content: userContent,
        },
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages,
        max_tokens: 1000,
      });

      let aiReply = completion.choices[0]?.message?.content || "";
      aiReply = appendMealTimeFollowUp(aiReply, message);

      const nutritionData = extractDataBlock(aiReply);

      const userEntry = {
        role: "user",
        content: message || "[Người dùng đã gửi một hình ảnh]",
      };
      const assistantEntry = { role: "assistant", content: aiReply };

      const newHistory = truncateHistory([...history, userEntry, assistantEntry], 20);

      const updatePayload = {
        chat_history: newHistory,
      };

      if (nutritionData) {
        updatePayload.last_detected_meal = nutritionData;
      }

      await supabase.from("profiles").update(updatePayload).eq("id", user.id);

      return res.status(200).json({
        reply: aiReply,
        username: profile.username,
      });
    }

    // Follow-up từ popup: người dùng đã chọn buổi/ngày sau khi phân tích ảnh
    let finalMessage = message;

    const isMealFollowup =
      followupType === "meal_time_update" && pendingMealData && mealTime;

    if (isMealFollowup) {
      console.log(resolvedDayText);
      finalMessage = `Bạn đã ăn ${pendingMealData.description || "món ăn"} vào buổi ${mealTime}, ngày ${resolvedDayText}.

Thông tin dinh dưỡng ước tính:
- Calories: ${pendingMealData.calories || "N/A"} kcal
- Protein: ${pendingMealData.protein || "N/A"}
- Fat: ${pendingMealData.fat || "N/A"}
- Carbs: ${pendingMealData.carbs || "N/A"}
- Fiber: ${pendingMealData.fiber || "N/A"}
- Sugar: ${pendingMealData.sugar || "N/A"}
- Sodium: ${pendingMealData.sodium || "N/A"}

Hãy cập nhật thực đơn 7 ngày tương ứng và điều chỉnh hợp lý nếu cần.
<deleted> Trả về JSON đúng format coach prompt. <deleted>`;
    }

    const coachPrompt = buildCoachPrompt({
      profile,
      currentPlan,
      currentDayName,
      dayOfWeek,
      message: finalMessage,
      isQueryOnly: effectiveIsQueryOnly,
      isDeadlinePassed,
    });

    const coachMessages = [
      {
        role: "system",
        content: coachPrompt,
      },
      ...history.slice(-10),
      {
        role: "user",
        content: finalMessage,
      },
    ];

    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: coachMessages,
      response_format: { type: "json_object" },
    });

    const raw = chatCompletion.choices[0]?.message?.content || "{}";
    const result = safeJsonParse(raw) || {};

    let aiReply = String(result.reply || "");
    const action = String(result.action || "analyze_only");
    const needsClarification = Boolean(result.needsClarification);
    const clarifyQuestion = String(result.clarifyQuestion || "");

    if (action === "analyze_only") {
      aiReply = appendMealTimeFollowUp(aiReply, finalMessage);
    } else if (action === "ask_clarify" && !clarifyQuestion) {
      aiReply = appendMealTimeFollowUp(aiReply, finalMessage);
    }

    if (
      action === "update_plan" &&
      Array.isArray(result.newPlan) &&
      result.newPlan.length > 0
    ) {
      currentPlan = result.newPlan;
      await supabase
        .from("profiles")
        .update({
          weekly_plan: currentPlan,
          plan_updated_at: now,
        })
        .eq("id", user.id);
    }

    const userEntry = { role: "user", content: finalMessage };
    const assistantEntry = { role: "assistant", content: aiReply };

    const newHistory = truncateHistory([...history, userEntry, assistantEntry], 20);

    await supabase
      .from("profiles")
      .update({ chat_history: newHistory })
      .eq("id", user.id);

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
    return res.status(500).json({
      error: "Lỗi Server",
      details: err.message,
    });
  }
}