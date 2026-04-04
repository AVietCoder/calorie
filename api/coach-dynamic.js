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
        const { message, isQueryOnly } = req.body; 
        const diffDays = lastUpdated ? (now - lastUpdated) / (1000 * 60 * 60 * 24) : 999;
        const isMonday = now.getDay() === 1; 
        const needsNewPlan = !currentPlan || diffDays >= 7 || (isMonday && diffDays >= 1);

        let aiReply = "";

       if (message && !isQueryOnly) {
    console.log("--- Người dùng đang tương tác với HLV AI ---");
const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); 
const dayNames = ["", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"];
const currentDayName = dayNames[dayOfWeek];
const chatPrompt = `
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

    LUÔN sử dụng mapping này khi cập nhật newPlan
    Nếu người dùng nói "Thứ X", bạn PHẢI chuyển sang đúng "day" theo bảng ánh xạ ở trên trước khi cập nhật newPlan.
    Không được dùng số thứ tự tự nhiên của ngày trong tuần..
    Người dùng vừa nhắn: "${message}"

    THÔNG TIN NGƯỜI DÙNG
    - Cân nặng: ${profile.weight}kg
    - Mục tiêu: ${profile.goal}
    - Macro ưu tiên: ${profile.focus_macro}
    - Calo mục tiêu/ngày: ${profile.target_calories || '1500-1800'} kcal

    THỰC ĐƠN 7 NGÀY HIỆN TẠI
    ${JSON.stringify(currentPlan)}

    Người dùng thường ăn các món Việt như: cơm, phở, bún, hủ tiếu, cháo, cá, thịt gà, thịt heo, rau luộc, canh, trái cây, sữa chua... 
    Khi thay đổi món hãy ưu tiên món phổ biến, dễ mua ở Việt Nam.

    --------------------------------

    NHIỆM VỤ CỦA BẠN

    Xử lý theo 3 kịch bản:

    XÃ GIAO / HỎI KIẾN THỨC  
    Nếu người dùng chỉ chào hỏi hoặc hỏi kiến thức (ví dụ: "Ăn táo có tốt không?"):
    - Trả lời thân thiện và dễ hiểu.
    - Không thay đổi thực đơn.
    - "newPlan" giữ nguyên thực đơn cũ.

    BÁO CÁO ĂN UỐNG (BÙ TRỪ CALO & TÁI CẤU TRÚC)

    Nếu người dùng báo vừa ăn gì ngoài kế hoạch 
    (ví dụ: "Trưa nay lỡ ăn pizza 1000kcal"):

    1. ƯỚC LƯỢNG CALO
    - Ước tính lượng calo của món người dùng vừa ăn.
    - So sánh với calo mục tiêu trong ngày (${profile.target_calories || '1500-1800'} kcal).

    2. CẬP NHẬT BỮA ĂN THỰC TẾ
    - Xác định đúng ngày hiện tại trong thực đơn: day = ${dayOfWeek}.
    - Cập nhật món ăn thực tế vào đúng bữa (Sáng / Trưa / Tối / Phụ) của day này trong "newPlan".

    3. BÙ TRỪ CALO TRONG NGÀY
    Nếu tổng calo của ngày ${dayOfWeek} vượt mục tiêu:
    - Giảm calo của các bữa còn lại trong cùng ngày.
    - Ưu tiên giảm tinh bột hoặc chất béo trước, vẫn đảm bảo đủ protein.

    4. TÁI CẤU TRÚC CÁC NGÀY SAU
    Nếu vẫn dư calo sau khi điều chỉnh trong ngày:
    - Điều chỉnh nhẹ các ngày tiếp theo (day ${dayOfWeek}+1 → day 7).
    - Không điều chỉnh các ngày trước đó.
    - Không để lượng calo mỗi ngày giảm quá mức gây thiếu dinh dưỡng.

    5. GIỮ CÂN BẰNG DINH DƯỠNG
    - Vẫn đảm bảo macro mục tiêu (${profile.focus_macro}).
    - Không giảm calo quá mạnh trong một ngày.
    - Giữ thực đơn hợp lý và dễ thực hiện.

    Cuối cùng:
    - Giải thích ngắn gọn cho người dùng trong "reply".
    - Trả về "newPlan" là thực đơn 7 ngày đã được cập nhật và tái cấu trúc.
    
    THIẾU THÔNG TIN (BẮT BUỘC HỎI LẠI)

    Nếu người dùng chỉ nói món ăn và ngày nhưng KHÔNG nói rõ bữa nào 
    (ví dụ: "Thứ 6 ăn súp", "Đổi thứ 4 sang bún bò"):

    - KHÔNG được tự ý chọn bữa.
    - Hãy hỏi lại người dùng để xác nhận bữa ăn.

    Ví dụ phản hồi:
    "Bạn muốn ăn món đó vào bữa nào của Thứ X? (Sáng / Trưa / Tối / Phụ)"

    Trong trường hợp này:
    - Không thay đổi thực đơn.
    - "newPlan" phải giữ nguyên thực đơn hiện tại.

    THAY ĐỔI MÓN / LỐI SỐNG (TÍNH TOÁN LẠI TOÀN BỘ)  
    Nếu người dùng muốn đổi món (ví dụ: "Đổi trưa thứ 3 thành bún chả"):
    - Cập nhật món đó vào đúng ngày và đúng bữa.
    - Ước tính lại calories của món mới.
    - **TÁI CẤU TRÚC TOÀN DIỆN:** Vì món mới có thông số dinh dưỡng khác, bạn PHẢI tính toán lại các bữa ăn từ thời điểm đó trở đi cho đến hết Day 7.
    - Đảm bảo Macro (Protein / Carb / Fat) của CẢ TUẦN vẫn bám sát mục tiêu ${profile.focus_macro} sau khi đã thay đổi món.
    - Ưu tiên món ăn Việt Nam đa dạng giữa các ngày.
    - Nếu người dùng muốn đổi món: Cập nhật vào đúng ngày họ yêu cầu (hoặc mặc định là hôm nay - Day ${dayOfWeek}).
    - Tính toán lại toàn bộ lộ trình từ thời điểm đó đến Day 7.
    
    --------------------------------

    QUY TẮC ĐIỀU CHỈNH THỰC ĐƠN

    - Mỗi ngày có 4 bữa: Sáng, Trưa, Tối, Phụ.
    - Thực đơn phải đủ 7 ngày (day 1 → day 7), không làm mất ngày nào, không để thiếu bữa.
    - **TÍNH LIÊN KẾT:** Các ngày trong "newPlan" phải có sự liên kết về mặt calo. Nếu ngày trước ăn dư, ngày sau phải thanh đạm hơn.
    - Hạn chế lặp lại món quá nhiều.

    --------------------------------

    ĐỊNH DẠNG MỖI BỮA
    {
    "meal": "Sáng | Trưa | Tối | Phụ",
    "food": "Tên món",
    "amount": "khẩu phần",
    "calories": số_calories
    }

    --------------------------------

    PHẢN HỒI
    - "reply": giải thích thân thiện, ngắn gọn tại sao bạn điều chỉnh các bữa ăn tiếp theo để bù đắp cho lượng calo đã nạp.
    - "newPlan": luôn trả về đầy đủ thực đơn 7 ngày sau khi đã tái cấu trúc và bù trừ.

    --------------------------------

    BẮT BUỘC TRẢ VỀ JSON HỢP LỆ
    {
    "reply": "...",
    "newPlan": [...]
    }
    Không viết thêm bất kỳ văn bản nào ngoài JSON.
`;

    const chatCompletion = await openai.chat.completions.create({
        model: "gpt-4.1", 
        messages: [{ role: "system", content: chatPrompt }],
        response_format: { type: "json_object" }
    });

    const result = JSON.parse(chatCompletion.choices[0].message.content);
    aiReply = result.reply;
    console.log(result.newPlan);
    
    currentPlan = (result.newPlan && result.newPlan.length > 0) ? result.newPlan : currentPlan;

    await supabase.from('profiles').update({ 
        weekly_plan: currentPlan,
        plan_updated_at: now 
    }).eq('id', user.id);
}
        else if (needsNewPlan) {
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
        } else {
            aiReply = "Lộ trình tuần này của người dùng vẫn đang được áp dụng rất tốt!";
        }

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