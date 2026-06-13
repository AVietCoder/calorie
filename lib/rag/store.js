/**
 * store.js — Supabase-backed admin knowledge store.
 *
 * Uses the schema defined in migrations/admin.sql:
 *   admin_pdfs       one row per uploaded PDF (Cloudinary URL + status + counts)
 *   admin_kb_chunks  many rows per PDF (chunk_index, text, embedding jsonb)
 *
 * These tables are SEPARATE from the bundled disease-routed knowledge base
 * (knowledge/knowledge-base.json) — admin uploads are a general, semantic
 * RAG layer that complements it.
 *
 * All access uses the SERVICE-ROLE client (supabaseAdmin) because the RLS
 * policies in admin.sql only allow admins / the service role to read these
 * tables. SUPABASE_SERVICE_ROLE_KEY must therefore be set for this feature.
 *
 * Embeddings are stored as JSON arrays; cosine similarity is computed in JS
 * (no pgvector needed). Every function is defensive: on error it returns a safe
 * value and logs, so the chat flow is never broken.
 */
import { supabaseAdmin } from "../supabase.js";

const PDFS = "admin_pdfs";
const CHUNKS = "admin_kb_chunks";

let _readyCache = null;

/** Are the admin tables present + reachable (via service role)? (cached) */
export async function adminStoreReady() {
  if (_readyCache !== null) return _readyCache;
  try {
    if (!process.env.SUPABASE_URL) {
      _readyCache = false;
      return false;
    }
    const { error } = await supabaseAdmin
      .from(CHUNKS)
      .select("id", { count: "exact", head: true })
      .limit(1);
    _readyCache = !error;
    if (error) console.warn(`⚠️ [store] admin tables not ready: ${error.message}`);
    return _readyCache;
  } catch (err) {
    console.warn(`⚠️ [store] adminStoreReady error: ${err.message}`);
    _readyCache = false;
    return false;
  }
}

export function resetAdminStoreCache() {
  _readyCache = null;
}

/** Count rows. */
async function countRows(table) {
  try {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true });
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}
export const countAdminChunks = () => countRows(CHUNKS);
export const countAdminPdfs = () => countRows(PDFS);

/** Insert a new admin_pdfs row (status defaults to 'uploaded'). Returns the row. */
export async function createPdf(meta) {
  const {
    file_name,
    file_size = null,
    cloudinary_public_id = null,
    cloudinary_url = null,
    uploaded_by = null,
    uploaded_by_email = null,
    status = "uploaded",
  } = meta;
  const { data, error } = await supabaseAdmin
    .from(PDFS)
    .insert([{ file_name, file_size, cloudinary_public_id, cloudinary_url, uploaded_by, uploaded_by_email, status }])
    .select()
    .single();
  if (error) throw new Error(`createPdf failed: ${error.message}`);
  return data;
}

/** Patch an admin_pdfs row. */
export async function updatePdf(id, fields) {
  const { error } = await supabaseAdmin
    .from(PDFS)
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn(`⚠️ [store] updatePdf ${id}: ${error.message}`);
}

/** Insert chunk rows for a pdf. embeddings may be null (then stored as null). */
function sanitizeText(value) {
  let s = String(value ?? "");
  if (typeof s.toWellFormed === "function") s = s.toWellFormed();
  return s
    .replace(/\\u[0-9a-fA-F]{0,3}(?![0-9a-fA-F])/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function insertChunks(pdfId, chunks, embeddings = null) {
  const safeChunks = Array.isArray(chunks) ? chunks.map((c) => sanitizeText(c)).filter(Boolean) : [];
  const hasEmb = Array.isArray(embeddings) && embeddings.length === safeChunks.length;
  const rows = safeChunks.map((text, i) => ({
    pdf_id: pdfId,
    chunk_index: i,
    text,
    embedding: hasEmb ? embeddings[i] : null,
  }));
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabaseAdmin.from(CHUNKS).insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`insertChunks failed: ${error.message}`);
  }
  resetAdminStoreCache();
  return { inserted: rows.length, embedded: hasEmb ? rows.length : 0 };
}

/** List uploaded PDFs (newest first) for the admin panel. */
export async function listPdfs() {
  try {
    const { data, error } = await supabaseAdmin
      .from(PDFS)
      .select("id, file_name, file_size, cloudinary_url, cloudinary_public_id, status, error_message, chunk_count, embedding_count, uploaded_by_email, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn(`⚠️ [store] listPdfs: ${error.message}`);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn(`⚠️ [store] listPdfs error: ${err.message}`);
    return [];
  }
}

/** Fetch one PDF row (to read its cloudinary_public_id before delete). */
export async function getPdf(id) {
  try {
    const { data, error } = await supabaseAdmin.from(PDFS).select("*").eq("id", id).single();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

/** Delete a PDF row (chunks cascade via FK). Returns the deleted row. */
export async function deletePdf(id) {
  const row = await getPdf(id);
  const { error } = await supabaseAdmin.from(PDFS).delete().eq("id", id);
  if (error) throw new Error(`deletePdf failed: ${error.message}`);
  resetAdminStoreCache();
  return row;
}

/**
 * Fetch admin chunks for retrieval. Returns up to `limit` rows with parsed
 * embeddings. Used by knowledge.js to inject admin-uploaded knowledge into chat.
 */
export async function fetchAdminChunks(limit = 1000) {
  try {
    const { data, error } = await supabaseAdmin
      .from(CHUNKS)
      .select("id, pdf_id, chunk_index, text, embedding")
      .limit(limit);
    if (error || !Array.isArray(data)) return [];
    return data.map((c) => ({
      ...c,
      embedding: Array.isArray(c.embedding) ? c.embedding : null,
    }));
  } catch (err) {
    console.warn(`⚠️ [store] fetchAdminChunks error: ${err.message}`);
    return [];
  }
}

export default {
  adminStoreReady,
  resetAdminStoreCache,
  countAdminChunks,
  countAdminPdfs,
  createPdf,
  updatePdf,
  insertChunks,
  listPdfs,
  getPdf,
  deletePdf,
  fetchAdminChunks,
};
