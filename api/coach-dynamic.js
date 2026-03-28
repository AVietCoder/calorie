import OpenAI from "openai";
import { supabase } from './lib/supabase.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

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
        const { message, isQueryOnly } = req.body; // Thêm nhận message từ body

        // --- GIỮ NGUYÊN LOGIC CŨ: Kiểm tra tạo mới ---
        const diffDays = lastUpdated ? (now - lastUpdated) / (1000 * 60 * 60 * 24) : 999;
        const isMonday = now.getDay() === 1; 
        const needsNewPlan = !currentPlan || diffDays >= 7 || (isMonday && diffDays >= 1);

        let aiReply = "";

        // --- LOGIC MỚI: Xử lý khi có tin nhắn chat ---
       if (message && !isQueryOnly) {
    console.log("--- Noah đang tương tác với HLV AI ---");
    
    const chatPrompt = `
        Bạn là HLV Dinh dưỡng AI thông minh và tâm lý. Noah vừa nhắn: "${message}"
        Thông tin Noah: ${profile.weight}kg, Mục tiêu: ${profile.goal}, Calo mục tiêu/ngày: ${profile.target_calories || '1500-1800'} kcal.
        Đây là thực đơn 7 ngày hiện tại: ${JSON.stringify(currentPlan)}
        
        NHIỆM VỤ CỦA BẠN (Xử lý theo 3 kịch bản):
        
        1. XÃ GIAO/HỎI ĐÁP: Nếu Noah chỉ chào hỏi hoặc hỏi kiến thức (ví dụ: "Ăn táo có tốt không?"), hãy trả lời thân thiện. "newPlan" giữ nguyên thực đơn cũ.
        
        2. BÁO CÁO ĂN UỐNG (BÙ TRỪ CALO): Nếu Noah báo vừa ăn gì đó ngoài kế hoạch (ví dụ: "Trưa nay lỡ ăn 1 cái pizza 1000kcal"):
           - Hãy tính toán lượng calo dư thừa.
           - Điều chỉnh các bữa tiếp theo (Tối hôm nay hoặc cả ngày mai) giảm calo lại, tăng rau xanh/protein để bù đắp nhưng vẫn đủ chất.
        
        3. THAY ĐỔI MÓN/LỐI SỐNG: Nếu Noah muốn đổi món (ví dụ: "Đổi trưa T3 thành bún chả"):
           - Cập nhật món đó vào đúng ngày.
           - QUAN TRỌNG: Tự động rà soát và điều chỉnh các món còn lại trong ngày hoặc các ngày sau đó để đảm bảo tổng Macro (Protein/Carb/Fat) cả tuần vẫn bám sát mục tiêu ${profile.focus_macro}.

        YÊU CẦU ĐỊNH DẠNG:
        - Phản hồi "reply": Thân thiện, giải thích ngắn gọn lý do bạn điều chỉnh (ví dụ: "Vì trưa nay bạn ăn hơi nhiều tinh bột nên tối mình nhẹ nhàng lại với salad nhé").
        - "newPlan": Luôn trả về ĐỦ 7 ngày (day 1-7) sau khi đã chỉnh sửa.

        BẮT BUỘC trả về JSON: { "reply": "...", "newPlan": [...] }
    `;

    const chatCompletion = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [{ role: "system", content: chatPrompt }],
        response_format: { type: "json_object" }
    });

    const result = JSON.parse(chatCompletion.choices[0].message.content);
    aiReply = result.reply;
    
    // Phòng thủ: Nếu AI trả về newPlan rỗng hoặc lỗi, giữ nguyên plan cũ
    currentPlan = (result.newPlan && result.newPlan.length > 0) ? result.newPlan : currentPlan;

    // Cập nhật lại vào Database
    await supabase.from('profiles').update({ 
        weekly_plan: currentPlan,
        plan_updated_at: now 
    }).eq('id', user.id);
}
        else if (needsNewPlan) {
            console.log("--- Đang khởi tạo lộ trình 7 ngày mới ---");
            const aiPrompt = `Bạn là chuyên gia dinh dưỡng. Tạo thực đơn 7 ngày (Thứ 2 đến Chủ Nhật) cho Noah:
            - Cân nặng: ${profile.weight}kg, Mục tiêu: ${profile.goal}
            - Macro ưu tiên: ${profile.focus_macro}, Vận động: ${profile.activity_level}
            
            YÊU CẦU: Trả về JSON mảng 7 ngày. Mỗi ngày có 4 bữa: Sáng, Trưa, Tối, Phụ.
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
                model: "gpt-4.1-nano",
                messages: [{ role: "system", content: aiPrompt }]
            });

            currentPlan = JSON.parse(completion.choices[0].message.content.replace(/```json|```/g, "").trim());
            aiReply = "Chào tuần mới! HLV AI đã thiết kế xong lộ trình 7 ngày cho bạn.";

            await supabase.from('profiles').update({ weekly_plan: currentPlan, plan_updated_at: now }).eq('id', user.id);
        } else {
            aiReply = "Lộ trình tuần này của Noah vẫn đang được áp dụng rất tốt!";
        }

        // BIẾN ĐỔI: Phẳng hóa để Frontend render (Giữ nguyên như cũ)
        const formattedPlan = currentPlan.flatMap(dEntry => 
            dEntry.meals.map(m => ({ ...m, day: dEntry.day }))
        );

        return res.status(200).json({
            success: true,
            reply: aiReply,
            newPlan: formattedPlan
        });

    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
}