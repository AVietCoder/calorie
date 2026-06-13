import { supabase } from "../lib/supabase.js";
import { requireAdmin, setCors } from "../lib/admin-auth.js";

/**
 * GET    /api/admin/pdfs            - list PDFs
 * GET    /api/admin/pdfs?id=<uuid>  - get one + chunks count
 * DELETE /api/admin/pdfs?id=<uuid>  - delete (and its chunks via cascade)
 */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  if (req.method === "GET") {
    const id = req.query?.id;
    if (id) {
      const { data, error } = await supabase
        .from("admin_pdfs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ pdf: data });
    }
    const { data, error } = await supabase
      .from("admin_pdfs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ pdfs: data || [] });
  }

  if (req.method === "DELETE") {
    const id = req.query?.id;
    if (!id) return res.status(400).json({ error: "Thiếu id" });
    const { error } = await supabase.from("admin_pdfs").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
