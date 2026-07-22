import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { authenticateToken } from '../../../lib/auth-middleware.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 10;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function POST(request) {
  try {
    const user = await authenticateToken(request);
    if (!user) return corsJson(NextResponse, { message: 'Unauthorized' }, { status: 401 });

    const userId = user.id;
    const formData = await request.json().catch(() => ({}));

    const newDeadline = formData.deadline ? new Date(formData.deadline) : null;
    const now = new Date();
    if (newDeadline) {
      newDeadline.setHours(23, 59, 59, 999);
      if (newDeadline <= now) {
        return corsJson(NextResponse, { success: false, message: 'Deadline phải là ngày trong tương lai.' }, { status: 400 });
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
      plan_updated_at: now.toISOString(),
    };

    const { error } = await supabase.from('profiles').update(updateData).eq('id', userId);
    if (error) throw error;

    return corsJson(NextResponse, { success: true, message: 'Cập nhật lộ trình thành công!', isDeadlinePassed: false });
  } catch (error) {
    console.error('Error in setup route:', error.message);
    return corsJson(NextResponse, { success: false, message: 'Không thể lưu dữ liệu. Vui lòng thử lại.', details: error.message }, { status: 500 });
  }
}
