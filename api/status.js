import { supabase } from './lib/supabase.js';
import { authenticateToken } from './lib/auth-middleware.js'; // Thêm .js nếu cần

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        const user = await authenticateToken(req);

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Phiên đăng nhập hết hạn hoặc không hợp lệ.' 
            });
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('is_setup_completed')
            .eq('id', user.id)
            .single();

        if (error) throw error;

        return res.status(200).json({
            success: true,
            is_setup_completed: data ? data.is_setup_completed : false
        });

    } catch (error) {
        console.error('Error in status route:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Lỗi hệ thống khi kiểm tra trạng thái.',
            details: error.message
        });
    }
}