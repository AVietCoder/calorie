// lib/usage-log.js — E: ghi nhật ký sử dụng AI vào bảng ai_usage_logs (đang trống).
// Mỗi lần gọi model (chat/analyze/coach/health_check) ghi 1 dòng: kind + duration.
// FIRE-AND-FORGET: không await ở caller, lỗi bỏ qua — không bao giờ chặn request.
// ai_usage_logs bật RLS và KHÔNG có policy insert/select cho client anon
// (auth.uid()=NULL từ server) → ghi/đọc đều bị chặn. Dùng service-role bypass RLS.
import { supabaseAdmin as supabase } from "./supabase.js";

/** @param {{ userId?, kind: string, durationMs?: number }} p */
export function logUsage({ userId = null, kind, durationMs = null }) {
  try {
    if (!kind) return;
    supabase.from("ai_usage_logs").insert({
      user_id: userId,
      kind: String(kind).slice(0, 40),
      duration_ms: durationMs != null && Number.isFinite(Number(durationMs)) ? Math.round(Number(durationMs)) : null,
    }).then(() => {}, () => {});
  } catch { /* bảng chưa tạo / lỗi → bỏ qua */ }
}

/** Tổng hợp cho dashboard admin (bundle E). Trả cấu trúc rỗng nếu bảng trống/lỗi. */
export async function getUsageStats(days = 7) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString();
  try {
    const { data, error } = await supabase
      .from("ai_usage_logs")
      .select("kind, duration_ms, created_at")
      .gte("created_at", since)
      .limit(5000);
    if (error || !Array.isArray(data)) return { total: 0, byKind: {}, avgDurationMs: null, days };
    const byKind = {};
    let sumDur = 0, nDur = 0;
    for (const r of data) {
      const k = r.kind || "unknown";
      byKind[k] = (byKind[k] || 0) + 1;
      if (r.duration_ms != null) { sumDur += Number(r.duration_ms) || 0; nDur++; }
    }
    return {
      total: data.length,
      byKind,
      avgDurationMs: nDur ? Math.round(sumDur / nDur) : null,
      days,
    };
  } catch {
    return { total: 0, byKind: {}, avgDurationMs: null, days };
  }
}
