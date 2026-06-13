/**
 * storage.js — store raw PDF files in Supabase Storage (primary file store).
 *
 * Why this exists
 * ---------------
 * The original pipeline only persisted the raw PDF when Cloudinary was
 * configured. If it wasn't, the file was lost (only the extracted text chunks
 * survived in Supabase), so "upload → download the original" silently broke.
 *
 * Supabase is already a hard dependency of this app (auth + DB), so its built-in
 * object storage is the most reliable place to keep the files: it works out of
 * the box with the SERVICE-ROLE key the admin pipeline already needs — no extra
 * service, no extra credentials. Cloudinary is kept as an optional mirror.
 *
 * Download links are issued as short-lived SIGNED URLs (the bucket is private),
 * so a plain <a download> works without leaking the file publicly and without
 * needing an Authorization header on the link.
 *
 * Every function is defensive: on failure it logs and returns a safe value so
 * the upload pipeline degrades gracefully instead of throwing.
 */
import { supabaseAdmin, hasServiceRole } from "../supabase.js";

export const PDF_BUCKET = process.env.SUPABASE_PDF_BUCKET || "admin-pdfs";
const SIGNED_URL_TTL = Number(process.env.SUPABASE_SIGNED_URL_TTL || 60 * 60); // 1h

/** Storage works whenever we have a Supabase URL (service role strongly advised). */
export function storageConfigured() {
  return !!process.env.SUPABASE_URL;
}

let _bucketReady = null;

/**
 * Make sure the private PDF bucket exists. Idempotent; cached after first OK.
 * Safe to call on every upload.
 */
export async function ensureBucket() {
  if (_bucketReady) return true;
  if (!storageConfigured()) return false;
  try {
    const { data: existing } = await supabaseAdmin.storage.getBucket(PDF_BUCKET);
    if (existing) {
      _bucketReady = true;
      return true;
    }
  } catch {
    /* fall through to create */
  }
  try {
    const { error } = await supabaseAdmin.storage.createBucket(PDF_BUCKET, {
      public: false,
      fileSizeLimit: "25MB",
      allowedMimeTypes: ["application/pdf"],
    });
    // "already exists" is fine (race / created in dashboard).
    if (error && !/exist/i.test(error.message || "")) {
      console.warn(`⚠️ [storage] createBucket: ${error.message}`);
      return false;
    }
    _bucketReady = true;
    return true;
  } catch (err) {
    console.warn(`⚠️ [storage] ensureBucket error: ${err.message}`);
    return false;
  }
}

function safeName(filename) {
  return String(filename || "document.pdf")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "document.pdf";
}

/**
 * Upload a PDF buffer. Returns { path, bucket } or null on failure.
 * The object key is namespaced by the admin_pdfs row id to avoid collisions.
 */
export async function uploadPdfToStorage(buffer, filename, pdfId) {
  if (!storageConfigured()) return null;
  if (!hasServiceRole) {
    console.warn("⚠️ [storage] SUPABASE_SERVICE_ROLE_KEY not set — storage upload may fail under RLS.");
  }
  const ok = await ensureBucket();
  if (!ok) return null;

  const base = safeName(filename);
  const withExt = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  const path = `${pdfId || "misc"}/${withExt}`;

  try {
    const { error } = await supabaseAdmin.storage
      .from(PDF_BUCKET)
      .upload(path, buffer, {
        contentType: "application/pdf",
        upsert: true,
        cacheControl: "3600",
      });
    if (error) {
      console.warn(`⚠️ [storage] upload failed: ${error.message}`);
      return null;
    }
    return { path, bucket: PDF_BUCKET };
  } catch (err) {
    console.warn(`⚠️ [storage] upload error: ${err.message}`);
    return null;
  }
}

/**
 * Create a short-lived signed download URL for a stored object.
 * `downloadName` makes the browser save it with the original filename.
 * Returns the URL string or null.
 */
export async function getSignedUrl(path, downloadName) {
  if (!path || !storageConfigured()) return null;
  try {
    const opts = downloadName ? { download: downloadName } : undefined;
    const { data, error } = await supabaseAdmin.storage
      .from(PDF_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL, opts);
    if (error) {
      console.warn(`⚠️ [storage] signed url failed: ${error.message}`);
      return null;
    }
    return data?.signedUrl || null;
  } catch (err) {
    console.warn(`⚠️ [storage] signed url error: ${err.message}`);
    return null;
  }
}

/** Download the raw bytes of a stored object (for server-side streaming). */
export async function downloadPdfFromStorage(path) {
  if (!path || !storageConfigured()) return null;
  try {
    const { data, error } = await supabaseAdmin.storage.from(PDF_BUCKET).download(path);
    if (error || !data) {
      console.warn(`⚠️ [storage] download failed: ${error?.message || "no data"}`);
      return null;
    }
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.warn(`⚠️ [storage] download error: ${err.message}`);
    return null;
  }
}

/** Best-effort delete of a stored object. Returns true on success. */
export async function deletePdfFromStorage(path) {
  if (!path || !storageConfigured()) return false;
  try {
    const { error } = await supabaseAdmin.storage.from(PDF_BUCKET).remove([path]);
    if (error) {
      console.warn(`⚠️ [storage] remove failed: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`⚠️ [storage] remove error: ${err.message}`);
    return false;
  }
}

export default {
  PDF_BUCKET,
  storageConfigured,
  ensureBucket,
  uploadPdfToStorage,
  getSignedUrl,
  downloadPdfFromStorage,
  deletePdfFromStorage,
};
