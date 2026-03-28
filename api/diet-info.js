import { supabase } from './lib/supabase.js';
import { authenticateToken } from './lib/auth-middleware.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

    try {
        const user = await authenticateToken(req);
        if (!user) return res.status(401).json({ message: 'Unauthorized' });

        const { data: p, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (error || !p) throw new Error("Chưa có thông tin profile");

        let bmr;
        const currentYear = new Date().getFullYear();
        const age = currentYear - (p.birth_year || 2000);
        
        if (p.gender === 'male') {
            bmr = 10 * p.weight + 6.25 * p.height - 5 * age + 5;
        } else {
            bmr = 10 * p.weight + 6.25 * p.height - 5 * age - 161;
        }

        const tdee = Math.round(bmr * (p.activity_level || 1.2));

        let targetCalories = tdee;
        const speedMap = { 'safe': 250, 'normal': 500, 'fast': 750 };
        const adjustment = speedMap[p.speed] || 500;

        if (p.goal === 'lose') targetCalories -= adjustment;
        else if (p.goal === 'gain' || p.goal === 'muscle') targetCalories += adjustment;

        const protein = Math.round((targetCalories * 0.3) / 4);
        const fat = Math.round((targetCalories * 0.25) / 9);
        const carbs = Math.round((targetCalories * 0.45) / 4);

        return res.status(200).json({
            success: true,
            data: {
                calories: targetCalories,
                bmr: Math.round(bmr),
                tdee: tdee,
                macros: { protein, fat, carbs },
                profile: p 
            }
        });

    } catch (error) {
        console.error("Diet Info Error:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
}