import { supabase } from "./supabase.js";

/**
 * Xác thực + kiểm tra quyền admin.
 * Trả về { user, profile } nếu OK, ngược lại trả về null và set status/error.
 */
export async function requireAdmin(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Thiếu token" });
    return null;
  }
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: "Token không hợp lệ" });
    return null;
  }
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id, username, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (pErr || !profile) {
    res.status(404).json({ error: "Không tìm thấy hồ sơ" });
    return null;
  }
  if (!profile.is_admin) {
    res.status(403).json({ error: "Bạn không có quyền admin" });
    return null;
  }
  return { user, profile };
}

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
