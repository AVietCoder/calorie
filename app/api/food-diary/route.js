// app/api/food-diary/route.js — replaces api/food-diary.js.
// GET /api/food-diary?limit=60 -> { success, items: [{id, url, w, h, analysis, created_at}] }
import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { getFoodPhotos } from '../../../lib/food-diary.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 10;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) return corsJson(NextResponse, { success: false, error: 'Thiếu token' }, { status: 401 });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return corsJson(NextResponse, { success: false, error: 'Token không hợp lệ' }, { status: 401 });

  const limit = parseInt(new URL(request.url).searchParams.get('limit'), 10) || 60;
  const rows = await getFoodPhotos(user.id, limit);
  const items = rows.map((r) => ({
    id: r.id,
    url: r.cloudinary_url,
    w: r.width || null,
    h: r.height || null,
    analysis: r.analysis || null,
    created_at: r.created_at,
  }));
  return corsJson(NextResponse, { success: true, items });
}
