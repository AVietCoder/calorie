import { supabase } from "../lib/supabase.js";
import { requireAdmin, setCors } from "../lib/admin-auth.js";

/**
 * GET /api/admin/stats
 * Tổng hợp số liệu cho dashboard.
 */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const count = async (table, filter = null) => {
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: c } = await q;
    return c || 0;
  };

  const [
    totalUsers,
    totalPdfs,
    totalChunks,
    totalImages,
    totalAiLogs,
  ] = await Promise.all([
    count("profiles"),
    count("admin_pdfs"),
    count("admin_kb_chunks"),
    count("chat_images"),
    count("ai_usage_logs"),
  ]);

  // Active users last 7 days (from ai_usage_logs)
  const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: active7data } = await supabase
    .from("ai_usage_logs")
    .select("user_id")
    .gte("created_at", since7);
  const activeUsers7d = new Set((active7data || []).map((r) => r.user_id).filter(Boolean)).size;

  // Health stats from profiles.disease
  const { data: profiles } = await supabase
    .from("profiles")
    .select("disease, chat_history, created_at");

  const healthBuckets = {
    kidney: 0, diabetes: 0, hypertension: 0, obesity: 0,
    cholesterol: 0, gout: 0, liver: 0, gastro: 0, other: 0, none: 0,
  };
  let totalConversations = 0;
  let totalPrompts = 0;
  const newUsersByDay = {};

  for (const p of profiles || []) {
    const d = String(p.disease || "").toLowerCase();
    if (!d || d === "không" || d === "không có" || d === "none") healthBuckets.none++;
    else if (/thận|kidney/.test(d)) healthBuckets.kidney++;
    else if (/tiểu đường|diabet/.test(d)) healthBuckets.diabetes++;
    else if (/huyết áp|hypertens/.test(d)) healthBuckets.hypertension++;
    else if (/béo|obes/.test(d)) healthBuckets.obesity++;
    else if (/cholesterol|mỡ máu/.test(d)) healthBuckets.cholesterol++;
    else if (/gout|gút/.test(d)) healthBuckets.gout++;
    else if (/gan|liver/.test(d)) healthBuckets.liver++;
    else if (/dạ dày|tiêu hóa|gastro/.test(d)) healthBuckets.gastro++;
    else healthBuckets.other++;

    const hist = Array.isArray(p.chat_history) ? p.chat_history : [];
    if (hist.length) totalConversations++;
    totalPrompts += hist.filter((m) => m?.role === "user").length;

    if (p.created_at) {
      const day = String(p.created_at).slice(0, 10);
      newUsersByDay[day] = (newUsersByDay[day] || 0) + 1;
    }
  }

  // Last training time = newest ready PDF
  const { data: lastReady } = await supabase
    .from("admin_pdfs")
    .select("updated_at")
    .eq("status", "ready")
    .order("updated_at", { ascending: false })
    .limit(1);

  return res.status(200).json({
    overview: {
      totalUsers,
      activeUsers7d,
      totalConversations,
      totalPrompts,
      totalImages,
      totalPdfs,
      totalChunks,
      totalAiLogs,
    },
    rag: {
      status: totalChunks > 0 ? "online" : "empty",
      lastSync: lastReady?.[0]?.updated_at || null,
    },
    health: healthBuckets,
    newUsersByDay,
  });
}
