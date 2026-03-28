import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Thiếu token" });


    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: "Token không hợp lệ" });


    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('chat_history')
        .eq('id', user.id)
        .maybeSingle();

    if (profileError) return res.status(400).json({ error: profileError.message });

    return res.status(200).json({ history: profile?.chat_history || [] });
}