import OpenAI from "openai";
import { supabase } from './lib/supabase.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Fetch toàn bộ kho món ăn từ bảng foods ──────────────────────────────────
const fetchFoodsDB = async () => {
  try {
    const { data, error } = await supabase
      .from("foods")
      .select("description, calories, protein, fat, carbs, fiber, sugar, sodium")
      .order("description", { ascending: true });
    if (error || !data) return [];
    return data;
  } catch (err) {
    console.error("❌ Lỗi fetch foods:", err.message);
    return [];
  }
};

// ─── Format foods thành chuỗi compact để inject vào prompt ───────────────────
const formatFoodsForPrompt = (foods) => {
  if (!Array.isArray(foods) || foods.length === 0) return "(Chưa có dữ liệu)";
  return foods
    .map(
      (f) =>
        `- ${f.description} | ${f.calories ?? "?"}kcal | P:${f.protein ?? "?"} | F:${f.fat ?? "?"} | C:${f.carbs ?? "?"} | Fi:${f.fiber ?? "?"} | Su:${f.sugar ?? "?"} | Na:${f.sodium ?? "?"}`
    )
    .join("\n");
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Invalid token");

    // Fetch profile và foodsDB song song
    const [{ data: profile }, foodsDB] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      fetchFoodsDB(),
    ]);

    let currentPlan = profile.weekly_plan || [];
    const lastUpdated = profile.plan_updated_at ? new Date(profile.plan_updated_at) : null;
    const now = new Date();

    let isDeadlinePassed = false;
    if (profile.deadline) {
      const deadlineDate = new Date(profile.deadline);
      deadlineDate.setHours(23, 59, 59, 999);
      isDeadlinePassed = now > deadlineDate;
    }

    const diffDays = lastUpdated ? (now - lastUpdated) / (1000 * 60 * 60 * 24) : 999;
    const isMonday = now.getDay() === 1;
    const needsNewPlan = !isDeadlinePassed && (
      currentPlan.length === 0 ||
      diffDays >= 7 ||
      (isMonday && diffDays >= 1)
    );

    let aiReply = "";

    if (needsNewPlan) {
      const foodsSection = foodsDB.length > 0
        ? `
KHO MÓN ĂN CÓ SẴN (FOODS DATABASE)
Đây là danh sách các món ăn đã được lưu trong hệ thống với thông tin dinh dưỡng đã xác minh.
Format: Tên món | kcal | Protein | Fat | Carbs | Fiber | Sugar | Sodium

${formatFoodsForPrompt(foodsDB)}

QUY TẮC SỬ DỤNG FOODS DATABASE:
1. BẮT BUỘC ưu tiên chọn món từ danh sách trên khi lên thực đơn.
2. Nếu món CÓ trong danh sách → dùng CHÍNH XÁC thông tin dinh dưỡng từ đó, không tự ước tính lại.
3. Nếu món KHÔNG có trong danh sách → tự ước tính như bình thường.
4. Không lặp lại cùng 1 món quá 2 lần trong 7 ngày.
`
        : "";

      const aiPrompt = `
Bạn là chuyên gia dinh dưỡng và am hiểu ẩm thực Việt Nam.
Người dùng thường ăn các món Việt như: cơm, phở, bún, hủ tiếu, cháo, cá, thịt gà, thịt heo, rau luộc, canh, trái cây, sữa chua...
Hãy tạo thực đơn 7 ngày (Thứ 2 đến Chủ Nhật) cho người dùng:
- Giới tính: ${profile.gender ?? "N/A"}
- Năm sinh: ${profile.birth_year ?? "N/A"}
- Chiều cao: ${profile.height ?? "N/A"} cm
- Bệnh lý (nếu có): ${profile.disease || "Không có"}
- Calo mục tiêu/ngày: ${profile.target_calories || "1500-1800"} kcal
- Lý do thực hiện: ${profile.reason || "N/A"}
- Cân nặng: ${profile.weight}kg, Mục tiêu: ${profile.goal}
- Macro ưu tiên: ${profile.focus_macro}, Vận động: ${profile.activity_level}

YÊU CẦU:
- Ưu tiên các món ăn phổ biến của người Việt Nam.
- Thực đơn đa dạng giữa các ngày (không lặp lại món quá nhiều).
- Có sự cân bằng dinh dưỡng phù hợp với mục tiêu (giảm cân / tăng cơ / duy trì).
- Mỗi ngày gồm 4 bữa: Sáng, Trưa, Tối, Phụ.
- Cung cấp đầy đủ thông tin dinh dưỡng cho mỗi bữa.
- Tránh các món ảnh hưởng đến bệnh lý (nếu có).
${foodsSection}

Trả về JSON mảng 7 ngày. Mỗi ngày có 4 bữa. ĐỊNH DẠNG BẮT BUỘC - mỗi bữa phải có ĐẦY ĐỦ 10 trường:
[
  {
    "day": 1,
    "meals": [
      {
        "meal": "Sáng",
        "food": "Phở gà",
        "amount": "1 bát (400ml)",
        "calories": 450,
        "protein": "28g",
        "fat": "12g",
        "carbs": "58g",
        "fiber": "2g",
        "sugar": "4g",
        "sodium": "920mg"
      }
    ]
  }
]
Chỉ trả về JSON hợp lệ, không giải thích, không markdown.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "system", content: aiPrompt }],
        response_format: { type: "json_object" },
      });

      let raw = completion.choices[0].message.content.trim();
      // response_format json_object có thể bọc trong key bất kỳ
      const parsed = JSON.parse(raw);
      // Tìm mảng 7 ngày trong parsed (có thể là parsed trực tiếp hoặc parsed.plan / parsed.days)
      currentPlan = Array.isArray(parsed)
        ? parsed
        : (parsed.plan || parsed.days || parsed.menu || Object.values(parsed).find(Array.isArray) || []);

      aiReply = "Chào tuần mới! HLV AI đã thiết kế xong lộ trình 7 ngày cho bạn.";

      await supabase.from('profiles')
        .update({ weekly_plan: currentPlan, plan_updated_at: now })
        .eq('id', user.id);

    } else if (isDeadlinePassed) {
      aiReply = "Chúc mừng bạn đã hoàn thành lộ trình! Hãy đặt một mục tiêu mới để tiếp tục nhé 🎉";
    } else {
      aiReply = "Lộ trình tuần này của bạn vẫn đang được áp dụng rất tốt!";
    }

    // Flatten plan để trả về frontend — giữ đủ tất cả trường macro
    const formattedPlan = Array.isArray(currentPlan)
      ? currentPlan.flatMap(dEntry =>
          (dEntry.meals || []).map(m => ({ ...m, day: dEntry.day }))
        )
      : [];

    return res.status(200).json({
      success: true,
      reply: aiReply,
      newPlan: formattedPlan,
      isDeadlinePassed,
    });

  } catch (err) {
    console.error("Lỗi API Schedule:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
