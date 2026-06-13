import { supabase } from "../lib/supabase.js";
import { requireAdmin, setCors } from "../lib/admin-auth.js";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/admin/upload-pdf
 * Body JSON:
 *   {
 *     file_name, file_size,
 *     cloudinary_public_id, cloudinary_url
 *   }
 * Flow:
 *   1) Insert metadata vào admin_pdfs (status=uploaded)
 *   2) Fetch PDF từ Cloudinary, parse text -> chunks -> embeddings
 *   3) Insert chunks vào admin_kb_chunks, update status=ready
 * Trả về pdf_id ngay sau bước 1 để client poll status.
 *
 * Vì serverless có timeout, processing chạy fire-and-forget (best effort).
 * Client có thể gọi POST lại /api/admin/process-pdf?id=... để retry.
 */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const {
    file_name,
    file_size,
    cloudinary_public_id,
    cloudinary_url,
  } = req.body || {};

  if (!cloudinary_url || !file_name) {
    return res.status(400).json({ error: "Thiếu file_name hoặc cloudinary_url" });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("admin_pdfs")
    .insert({
      file_name,
      file_size: file_size || null,
      cloudinary_public_id,
      cloudinary_url,
      uploaded_by: ctx.user.id,
      uploaded_by_email: ctx.user.email,
      status: "uploaded",
    })
    .select()
    .single();

  if (insErr) return res.status(500).json({ error: insErr.message });

  // Kick off processing (await for ~25s budget; nếu hết thì client poll tiếp)
  try {
    await processPdf(inserted.id, cloudinary_url);
  } catch (err) {
    console.error("processPdf error:", err);
    await supabase
      .from("admin_pdfs")
      .update({ status: "error", error_message: String(err.message || err) })
      .eq("id", inserted.id);
  }

  return res.status(200).json({ pdf_id: inserted.id });
}

async function processPdf(pdfId, url) {
  const setStatus = async (status, extra = {}) =>
    supabase
      .from("admin_pdfs")
      .update({ status, updated_at: new Date().toISOString(), ...extra })
      .eq("id", pdfId);

  await setStatus("extracting");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Tải PDF lỗi: ${resp.status}`);
  const arrayBuf = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  // Dynamic import pdf-parse (CJS)
  const pdfParse = (await import("pdf-parse")).default;
  const parsed = await pdfParse(buffer);
  const fullText = (parsed.text || "").replace(/\s+\n/g, "\n").trim();

  await setStatus("chunking");
  const chunks = chunkText(fullText, 1000, 150);
  if (!chunks.length) {
    await setStatus("ready", { chunk_count: 0, embedding_count: 0 });
    return;
  }

  await setStatus("embedding", { chunk_count: chunks.length });

  // Embed batch
  const BATCH = 32;
  const allEmbeddings = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const r = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: slice,
    });
    r.data.forEach((d) => allEmbeddings.push(d.embedding));
  }

  await setStatus("saving");
  // Insert in batches
  const rows = chunks.map((text, idx) => ({
    pdf_id: pdfId,
    chunk_index: idx,
    text,
    embedding: allEmbeddings[idx],
  }));
  const INS_BATCH = 100;
  for (let i = 0; i < rows.length; i += INS_BATCH) {
    const slice = rows.slice(i, i + INS_BATCH);
    const { error } = await supabase.from("admin_kb_chunks").insert(slice);
    if (error) throw error;
  }

  await setStatus("ready", {
    chunk_count: chunks.length,
    embedding_count: allEmbeddings.length,
  });
}

function chunkText(text, size = 1000, overlap = 150) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) return [];
  const out = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + size, clean.length);
    let slice = clean.slice(i, end);
    // try break at paragraph
    if (end < clean.length) {
      const lastBreak = slice.lastIndexOf("\n\n");
      if (lastBreak > size * 0.5) slice = slice.slice(0, lastBreak);
    }
    out.push(slice.trim());
    i += Math.max(1, slice.length - overlap);
  }
  return out.filter(Boolean);
}
