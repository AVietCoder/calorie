import { supabase } from './supabase.js';


export async function authenticateToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;

    const token = authHeader.split(' ')[1];
    if (!token) return null;

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            console.error("Xác thực thất bại:", error?.message);
            return null;
        }

        return user;
    } catch (err) {
        console.error("Lỗi Middleware:", err);
        return null;
    }
}