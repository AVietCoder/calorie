// app/api/auth/route.js — replaces api/auth.js. Same actions/response shapes
// (register/login/refresh/logout) so calorie-ai-mobile keeps working unchanged.
import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { CORS_HEADERS, corsJson, corsOptions } from '../../../lib/cors.js';
import { isValidBirthYear, isValidHeight, isValidWeight } from '../../../lib/body-metrics.js';

export const maxDuration = 10;

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { action, email, password, username, birthYear, weight, height } = body;

  if (action === 'register') {
    // Chặn TRƯỚC KHI tạo tài khoản Supabase Auth — sai thì báo lỗi ngay, tránh
    // tạo user "mồ côi" (có auth nhưng insert profile phía dưới không chạy tới).
    if (!isValidBirthYear(birthYear)) {
      return corsJson(NextResponse, { error: 'Năm sinh không hợp lệ.' }, { status: 400 });
    }
    if (!isValidHeight(height)) {
      return corsJson(NextResponse, { error: 'Chiều cao phải nằm trong khoảng 80 - 250 cm.' }, { status: 400 });
    }
    if (!isValidWeight(weight)) {
      return corsJson(NextResponse, { error: 'Cân nặng phải nằm trong khoảng 20 - 300 kg.' }, { status: 400 });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: username } },
    });
    if (error) return corsJson(NextResponse, { error: error.message }, { status: 400 });

    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert([
        { id: data.user.id, username, birth_year: birthYear, weight: parseFloat(weight), height: parseFloat(height), chat_history: [] },
      ]);
      if (profileError) {
        return corsJson(NextResponse, { error: 'Lỗi tạo hồ sơ: ' + profileError.message }, { status: 400 });
      }
    }
    return corsJson(NextResponse, { message: 'Đăng ký thành công!' });
  }

  if (action === 'login') {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return corsJson(NextResponse, { error: 'Sai tài khoản hoặc mật khẩu' }, { status: 401 });
    if (!data.session) {
      return corsJson(NextResponse, { error: 'Không thể tạo phiên làm việc. Hãy kiểm tra lại email.' }, { status: 400 });
    }
    return corsJson(NextResponse, {
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: data.user,
    });
  }

  if (action === 'refresh') {
    const refreshToken = body.refresh_token;
    if (!refreshToken) return corsJson(NextResponse, { error: 'Thiếu refresh_token' }, { status: 400 });
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) {
      return corsJson(NextResponse, { error: 'Không thể làm mới phiên đăng nhập' }, { status: 401 });
    }
    return corsJson(NextResponse, {
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: data.user,
    });
  }

  if (action === 'logout') {
    const { error } = await supabase.auth.signOut();
    if (error) return corsJson(NextResponse, { error: error.message }, { status: 400 });
    return corsJson(NextResponse, { message: 'Đăng xuất thành công!' });
  }

  return corsJson(NextResponse, { error: 'Action không hợp lệ' }, { status: 400 });
}
