import { supabase } from './lib/supabase.js';
import { authenticateToken } from './lib/auth-middleware.js';

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    try {
        const user = await authenticateToken(req);
        if (!user) return res.status(401).json({ message: 'Unauthorized' });

        const userId = user.id;
        const formData = req.body;

        // Kiểm tra deadline mới có hợp lệ (phải là tương lai)
        const newDeadline = formData.deadline ? new Date(formData.deadline) : null;
        const now = new Date();
        if (newDeadline) {
            newDeadline.setHours(23, 59, 59, 999);
            if (newDeadline <= now) {
                return res.status(400).json({
                    success: false,
                    message: 'Deadline phải là ngày trong tương lai.'
                });
            }
        }

        const updateData = {
            gender: formData.gender,
            birth_year: parseInt(formData.birth_year),
            height: parseFloat(formData.height),
            weight: parseFloat(formData.weight),
            target_weight: parseFloat(formData.target_weight),
            goal: formData.goal,
            disease: formData.disease || '',
            activity_level: parseFloat(formData.activity_level),
            speed: formData.speed,
            high_cal_days: formData.high_cal_days,
            deadline: formData.deadline,
            allergies: formData.allergies,
            focus_macro: formData.focus_macro,
            snacking: formData.snacking,
            reason: formData.reason,
            is_setup_completed: true,
            updated_at: now.toISOString(),
            weekly_plan: [],
            plan_updated_at: now.toISOString()
        };

        const { error } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', userId);

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Cập nhật lộ trình thành công!',
            isDeadlinePassed: false 
        });

    } catch (error) {
        console.error('Error in setup route:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Không thể lưu dữ liệu. Vui lòng thử lại.',
            details: error.message
        });
    }
}