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


console.log("User đang chat là:", user.id);
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

        if (!message && !imageFile) {
            return res.status(400).json({ error: "Thiếu dữ liệu: Gửi tin nhắn hoặc ảnh." });
        }

const { data: { user }, error: authError } = await supabase.auth.getUser(token);
if (authError || !user) return res.status(401).json({ error: "Token không hợp lệ" });

console.log("--- DEBUG MODE ---");
console.log("ID người dùng từ Token:", user.id);


const { data: allProfiles, error: allProfilesError } = await supabase
    .from('profiles')
    .select('*');

if (allProfilesError) {
    console.error("Lỗi khi lấy toàn bộ profiles:", allProfilesError.message);
} else {
    console.log("Danh sách tất cả Profile đang có trong DB:", allProfiles);
    
    
    const findMe = allProfiles.find(p => p.id === user.id);
    if (findMe) {
        console.log("✅ ĐÃ TÌM THẤY profile khớp với User!");
    } else {
        console.log("❌ KHÔNG tìm thấy profile nào có ID trùng với User.");
    }
}
        
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
        console.log(profile)
        if (profileError || !profile) return res.status(404).json({ error: "Người dùng không tồn tại" });

        let history = profile.chat_history || [];

        
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
            model: "gpt-4.1-nano", 
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