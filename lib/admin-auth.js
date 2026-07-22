/**
 * admin-auth.js — Authentication + admin-role check for the knowledge-base
 * management endpoints.
 *
 * A user is treated as an admin if EITHER:
 *   • their row in `profiles` has is_admin = true, OR
 *   • their email is listed in the ADMIN_EMAILS env var (comma-separated).
 *
 * The ADMIN_EMAILS fallback lets you bootstrap the very first admin without
 * touching the database. After that, set is_admin = true on profiles.
 */
import { supabase, supabaseAdmin } from "./supabase.js";

function bearer(req) {
  const h = req.headers.get('authorization') || "";
  if (!h) return null;
  return h.startsWith("Bearer ") ? h.slice(7) : h;
}

function adminEmailSet() {
  return new Set(
    String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Return the authenticated Supabase user, or null. */
export async function getAuthedUser(req) {
  const token = bearer(req);
  if (!token) return null;
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

/** Is this user an admin? */
export async function isAdminUser(user) {
  if (!user) return false;
  // 1) email allow-list
  if (user.email && adminEmailSet().has(String(user.email).toLowerCase())) return true;
  // 2) profiles.is_admin
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (error) return false;
    return !!data?.is_admin;
  } catch {
    return false;
  }
}

/**
 * Authenticate + authorize in one call.
 * @returns {Promise<{user:object|null, isAdmin:boolean}>}
 */
export async function requireAdmin(req) {
  const user = await getAuthedUser(req);
  if (!user) return { user: null, isAdmin: false };
  const isAdmin = await isAdminUser(user);
  return { user, isAdmin };
}

export default { getAuthedUser, isAdminUser, requireAdmin };
