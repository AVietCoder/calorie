import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, email, password, username, birthYear, weight, height } = req.body;

    
    if (action === 'register') {
        
        const { data, error } = await supabase.auth.signUp({ 
            email, 
            password,
            options: {
                data: { display_name: username }
            }
        });
        
        if (error) return res.status(400).json({ error: error.message });

        
        if (data.user) {
            const { error: profileError } = await supabase
                .from('profiles')
                .insert([{ 
                    id: data.user.id, 
                    username, 
                    birth_year: birthYear, 
                    weight: parseFloat(weight), 
                    height: parseFloat(height), 
                    chat_history: [] 
                }]);

            if (profileError) {
                
                return res.status(400).json({ error: "Lỗi tạo hồ sơ: " + profileError.message });
            }
        }

        return res.status(200).json({ message: "Đăng ký thành công!" });
    }
if (action === 'login') {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
    
    
    if (!data.session) {
        return res.status(400).json({ error: "Không thể tạo phiên làm việc. Hãy kiểm tra lại email." });
    }
    
    return res.status(200).json({ 
        token: data.session.access_token, 
        user: data.user 
    });
}
if (action === 'logout') {
    const { error } = await supabase.auth.signOut();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ message: "Đăng xuất thành công!" });
}

return res.status(400).json({ error: 'Action không hợp lệ' });
}