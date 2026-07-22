import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { authenticateToken } from '../../../lib/auth-middleware.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 10;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function GET(request) {
  try {
    const user = await authenticateToken(request);
    if (!user) {
      return corsJson(NextResponse, { success: false, message: 'Phiên đăng nhập hết hạn hoặc không hợp lệ.' }, { status: 401 });
    }

    const { data, error } = await supabase.from('profiles').select('is_setup_completed').eq('id', user.id).single();
    if (error) throw error;

    return corsJson(NextResponse, { success: true, is_setup_completed: data ? data.is_setup_completed : false });
  } catch (error) {
    console.error('Error in status route:', error.message);
    return corsJson(NextResponse, { success: false, message: 'Lỗi hệ thống khi kiểm tra trạng thái.', details: error.message }, { status: 500 });
  }
}
