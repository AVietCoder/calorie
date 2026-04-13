import { IncomingForm } from 'formidable';
import OpenAI from "openai";
import fs from "fs";
import { supabase } from './lib/supabase.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Không tìm thấy mã xác thực" });

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });
    }

    const form = new IncomingForm();

    try {
        const [fields, files] = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                resolve([fields, files]);
            });
        });

        const message = fields.message ? fields.message[0] : "";
        const imageFile = files.image ? files.image[0] : null;
        const isQueryOnly = fields.isQueryOnly ? fields.isQueryOnly[0] === "true" : false;

        if (!message && !imageFile) {
            return res.status(400).json({ error: "Thiếu dữ liệu: Gửi tin nhắn hoặc ảnh." });
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return res.status(404).json({ error: "Người dùng không tồn tại" });
        }

        let history = profile.chat_history || [];
        let currentPlan = profile.weekly_plan || [];
        const now = new Date();

        // ===== NHÁNH 1: TEXT-ONLY -> cập nhật thực đơn kiểu coach =====
        if (message && !imageFile && !isQueryOnly) {
            console.log("--- Người dùng đang tương tác với HLV AI ---");

            const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
            const dayNames = ["", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"];
            const currentDayName = dayNames[dayOfWeek];

            // Copy nguyên prompt từ coach-dynamic.js vào đây
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
            const aiReply = result.reply || "";

            if (Array.isArray(result.newPlan) && result.newPlan.length > 0) {
                currentPlan = result.newPlan;
                await supabase
                    .from('profiles')
                    .update({
                        weekly_plan: currentPlan,
                        plan_updated_at: now
                    })
                    .eq('id', user.id);
            }

            const userEntry = { role: "user", content: message };
            const assistantEntry = { role: "assistant", content: aiReply };
            let newHistory = [...history, userEntry, assistantEntry];

            if (newHistory.length > 20) newHistory = newHistory.slice(-20);

            await supabase
                .from('profiles')
                .update({ chat_history: newHistory })
                .eq('id', user.id);

            return res.status(200).json({
                success: true,
                reply: aiReply,
                newPlan: currentPlan,
                username: profile.username
            });
        }

        // ===== NHÁNH 2: GIỮ NGUYÊN PHÂN TÍCH DINH DƯỠNG ẢNH/TIN NHẮN NHƯ CŨ =====
        let userContent = [];
        if (message) userContent.push({ type: "text", text: message });

        if (imageFile) {
            const imageBuffer = fs.readFileSync(imageFile.filepath);
            const base64Image = imageBuffer.toString("base64");
            userContent.push({
                type: "image_url",
                image_url: { url: `data:${imageFile.mimetype};base64,${base64Image}` }
            });
        }

        const messages = [
            {
                role: "system",
                content: `Bạn là chuyên gia dinh dưỡng AI. 
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
                Ví dụ khi không phải thức ăn (chỉ khi người dùng gửi ảnh không liên quan): "Xin lỗi, tôi thấy đây là một chiếc xe hơi. Tôi chỉ có thể phân tích dinh dưỡng từ thực phẩm. <error>Không phải thức ăn</error>"
                Ví dụ khi là thức ăn: <data>{"calories": 250, "protein": "15g", "fat": "10g", "carbs": "30g", "fiber": "2g", "sugar": "5g", "sodium": "400mg", "description": "Phở bò Việt Nam"}</data>`
            },
            ...history,
            { role: "user", content: userContent }
        ];

        const completion = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: messages,
            max_tokens: 1000,
        });

        const aiReply = completion.choices[0]?.message?.content;

        const userEntry = { role: "user", content: message || "[Người dùng đã gửi một hình ảnh]" };
        const assistantEntry = { role: "assistant", content: aiReply };

        let newHistory = [...history, userEntry, assistantEntry];
        if (newHistory.length > 20) newHistory = newHistory.slice(-20);

        await supabase
            .from('profiles')
            .update({ chat_history: newHistory })
            .eq('id', user.id);

        return res.status(200).json({
            reply: aiReply,
            username: profile.username
        });

    } catch (err) {
        console.error("❌ Lỗi API:", err);
        return res.status(500).json({ error: "Lỗi Server", details: err.message });
    }
}