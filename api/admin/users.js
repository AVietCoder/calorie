import { supabase } from "../lib/supabase.js";
import { requireAdmin, setCors } from "../lib/admin-auth.js";

/**
 * GET /api/admin/users         - list users (no chat_history blob for perf)
 * GET /api/admin/users?id=...  - get full profile + chat_history + images
 */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = req.query?.id;
  if (id) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    const { data: images } = await supabase
      .from("chat_images")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(200);
    return res.status(200).json({ profile, images: images || [] });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, birth_year, weight, height, disease, goal, is_admin, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ users: data || [] });
}
