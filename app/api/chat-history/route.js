import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { corsJson, corsOptions } from '../../../lib/cors.js';

export const maxDuration = 10;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) return corsJson(NextResponse, { error: 'Thiếu token' }, { status: 401 });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return corsJson(NextResponse, { error: 'Token không hợp lệ' }, { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('chat_history')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) return corsJson(NextResponse, { error: profileError.message }, { status: 400 });

  return corsJson(NextResponse, { history: profile?.chat_history || [] });
}
