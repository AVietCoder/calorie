import OpenAI from "openai";
import { supabase } from './lib/supabase.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) throw new Error("Invalid token");

        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        let currentPlan = profile.weekly_plan;
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
        const needsNewPlan = !isDeadlinePassed && (currentPlan.length == 0 || diffDays >= 7 || (isMonday && diffDays >= 1));

        let aiReply = "";
        if (needsNewPlan) {
            const aiPrompt = `
Bạn là chuyên gia dinh dưỡng và am hiểu ẩm thực Việt Nam. 
Người dùng thường ăn các món Việt như: cơm, phở, bún, hủ tiếu, cháo, cá, thịt gà, thịt heo, rau luộc, canh, trái cây, sữa chua... 
Hãy tạo thực đơn 7 ngày (Thứ 2 đến Chủ Nhật) cho người dùng:
- Cân nặng: ${profile.weight}kg, Mục tiêu: ${profile.goal}
- Macro ưu tiên: ${profile.focus_macro}, Vận động: ${profile.activity_level}

YÊU CẦU:
- Ưu tiên các món ăn phổ biến của người Việt Nam.
- Thực đơn đa dạng giữa các ngày (không lặp lại món quá nhiều).
- Có sự cân bằng dinh dưỡng phù hợp với mục tiêu (giảm cân / tăng cơ / duy trì).
- Bao gồm món ăn quen thuộc như: cơm, bún, phở, hủ tiếu, canh, cá, thịt, trứng, đậu, rau xanh, trái cây,...
- Có thể kết hợp món hiện đại lành mạnh (salad, yến mạch, sữa chua, sinh tố).

Trả về JSON mảng 7 ngày. Mỗi ngày có 4 bữa: Sáng, Trưa, Tối, Phụ.
Định dạng:
[
  {
    "day": 1,
    "meals": [
      {"meal": "Sáng", "food": "Phở gà", "amount": "1 bát", "calories": 450},
      {"meal": "Trưa", "food": "Cơm ức gà", "amount": "150g", "calories": 600},
      {"meal": "Phụ", "food": "Táo", "amount": "1 quả", "calories": 100},
      {"meal": "Tối", "food": "Salad cá ngừ", "amount": "200g", "calories": 400}
    ]
  },
  ... (tiếp tục đến day: 7)
]
Chỉ trả về JSON, không giải thích.`;

            const completion = await openai.chat.completions.create({
                model: "gpt-4.1",
                messages: [{ role: "system", content: aiPrompt }]
            });

            currentPlan = JSON.parse(completion.choices[0].message.content.replace(/```json|```/g, "").trim());
            aiReply = "Chào tuần mới! HLV AI đã thiết kế xong lộ trình 7 ngày cho bạn.";

            await supabase.from('profiles').update({ weekly_plan: currentPlan, plan_updated_at: now }).eq('id', user.id);
        } else if (isDeadlinePassed) {
            aiReply = "Chúc mừng bạn đã hoàn thành lộ trình! Hãy đặt một mục tiêu mới để tiếp tục nhé 🎉";
        } else {
            aiReply = "Lộ trình tuần này của bạn vẫn đang được áp dụng rất tốt!";
        }

        const formattedPlan = Array.isArray(currentPlan) ? currentPlan.flatMap(dEntry =>
            dEntry.meals.map(m => ({ ...m, day: dEntry.day }))
        ) : [];

        return res.status(200).json({
            success: true,
            reply: aiReply,
            newPlan: formattedPlan,
            isDeadlinePassed
        });

    } catch (err) {
        console.error("Lỗi API Schedule:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
}