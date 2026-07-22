import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { authenticateToken } from '../../../lib/auth-middleware.js';
import { computeTargets } from '../../../lib/bmr.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 10;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function GET(request) {
  try {
    const user = await authenticateToken(request);
    if (!user) return corsJson(NextResponse, { message: 'Unauthorized' }, { status: 401 });

    const { data: p, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error || !p) throw new Error('Chưa có thông tin profile');

    const { bmr, tdee, calories, macros } = computeTargets(p);

    return corsJson(NextResponse, {
      success: true,
      data: { calories, bmr, tdee, macros, profile: p },
    });
  } catch (error) {
    console.error('Diet Info Error:', error.message);
    return corsJson(NextResponse, { success: false, message: error.message }, { status: 500 });
  }
}
