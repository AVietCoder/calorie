/**
 * /api/admin — admin knowledge-base management (uploads → Cloudinary + RAG).
 *
 * Pipeline (mirrors the reference RAG project, adapted to this stack):
 *   PDF → Cloudinary (raw file) → pdf-parse (text) → chunk → embed (OpenAI)
 *       → store chunks in Supabase admin_kb_chunks (+ metadata in admin_pdfs).
 *
 * Actions (?action=...):
 *   GET  whoami        -> { isAdmin, email, store, cloudinary, embeddings }
 *   GET  list          -> { pdfs:[...], store }
 *   POST upload        -> multipart (file=PDF): run the full pipeline
 *   POST delete&id=    -> delete a PDF (DB cascade + Cloudinary)
 *
 * Everything except `whoami` requires an admin. Reads/writes use the
 * service-role Supabase client (see store.js / migrations/admin.sql), so
 * SUPABASE_SERVICE_ROLE_KEY must be configured.
 */
import { IncomingForm } from "formidable";
import fs from "fs";

import { requireAdmin } from "../lib/admin-auth.js";
import { parsePdf } from "../lib/rag/parse-pdf.js";
import { chunkText } from "../lib/rag/chunker.js";
import { embedTexts, embeddingsAvailable } from "../lib/rag/embeddings.js";
import { cloudinaryConfigured, uploadPdf, destroyPdf, testCloudinaryConnection } from "../lib/cloudinary.js";
import {
  adminStoreReady,
  countAdminChunks,
  countAdminPdfs,
  createPdf,
  updatePdf,
  insertChunks,
  listPdfs,
  deletePdf,
} from "../lib/rag/store.js";

// Multipart upload => disable Vercel's default body parser (same as analyze-food).
export const config = { api: { bodyParser: false } };

const getFirst = (v) => (Array.isArray(v) ? v[0] : v ?? null);
const asText = (v) => String((Array.isArray(v) ? v[0] : v) ?? "").trim();

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function storeSummary() {
  const ready = await adminStoreReady();
  return {
    ready,
    pdfs: ready ? await countAdminPdfs() : 0,
    chunks: ready ? await countAdminChunks() : 0,
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query?.action || "").toLowerCase();

  const { user, isAdmin } = await requireAdmin(req);
  if (!user) {
    return res.status(401).json({ success: false, error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." });
  }

  // whoami: any logged-in user may check their status.
  if (req.method === "GET" && action === "whoami") {
    return res.status(200).json({
      success: true,
      isAdmin,
      email: user.email,
      store: await storeSummary(),
      cloudinary: cloudinaryConfigured(),
      embeddings: embeddingsAvailable(),
    });
  }

  if (!isAdmin) {
    return res.status(403).json({ success: false, error: "Bạn không có quyền quản trị (admin)." });
  }

  try {
    // ── List uploaded PDFs ────────────────────────────────────────────
    if (req.method === "GET" && action === "list") {
      const result = await testCloudinaryConnection();

      const pdfs = await listPdfs();
      return res.status(200).json({
        success: true,
        pdfs,
        store: await storeSummary(),
        cloudinary: cloudinaryConfigured(),
        embeddings: embeddingsAvailable(),
      });
    }

    // ── Delete a PDF (DB cascade + Cloudinary) ────────────────────────
    if (req.method === "POST" && action === "delete") {
      const id = asText(req.query?.id) || asText(req.query?.docId);
      if (!id) return res.status(400).json({ success: false, error: "Thiếu id." });
      const row = await deletePdf(id);
      if (row?.cloudinary_public_id) await destroyPdf(row.cloudinary_public_id);
      return res.status(200).json({ success: true, store: await storeSummary() });
    }

    // ── Upload a PDF and run the RAG pipeline ─────────────────────────
    if (req.method === "POST" && action === "upload") {
      if (!(await adminStoreReady())) {
        return res.status(400).json({
          success: false,
          error: "Chưa tạo bảng Supabase. Hãy chạy migrations/admin.sql và đặt SUPABASE_SERVICE_ROLE_KEY.",
        });
      }

      const form = new IncomingForm({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true });
      const [, files] = await new Promise((resolve, reject) => {
        form.parse(req, (err, f, fl) => (err ? reject(err) : resolve([f, fl])));
      });

      const fileObj = getFirst(files.file) ?? getFirst(files.pdf) ?? getFirst(files.document);
      if (!fileObj) return res.status(400).json({ success: false, error: "Thiếu tệp PDF (field 'file')." });

      const filename = fileObj.originalFilename || fileObj.newFilename || "document.pdf";
      const isPdf =
        (fileObj.mimetype && fileObj.mimetype.includes("pdf")) || filename.toLowerCase().endsWith(".pdf");
      if (!isPdf) return res.status(400).json({ success: false, error: "Chỉ chấp nhận tệp PDF." });

      const buffer = fs.readFileSync(fileObj.filepath);
      const size = fileObj.size ?? buffer.length;

      // 1) Create the admin_pdfs record up front (so failures leave a trace).
      const pdf = await createPdf({
        file_name: filename,
        file_size: size,
        uploaded_by: user.id,
        uploaded_by_email: user.email,
        status: "uploaded",
      });

      let cloud = null;
      try {
        // 2) Store the raw PDF in Cloudinary (if configured).
        const cloudinaryOn = cloudinaryConfigured();
        if (cloudinaryOn) {
          cloud = await uploadPdf(buffer, filename);
        }
        await updatePdf(pdf.id, {
          status: "extracting",
          cloudinary_public_id: cloud?.public_id || null,
          cloudinary_url: cloud?.url || null,
        });

        // 3) Extract text.
        const { text, pages } = await parsePdf(buffer);
        if (!text || text.trim().length < 40) {
          await updatePdf(pdf.id, { status: "error", error_message: "PDF không có văn bản (có thể là scan ảnh)." });
          return res.status(422).json({
            success: false,
            error: "Không trích được văn bản từ PDF (có thể là PDF scan ảnh, không có text).",
          });
        }

        // 4) Chunk.
        await updatePdf(pdf.id, { status: "chunking" });
        const chunks = chunkText(text, { chunkChars: 1200, overlap: 200 });
        if (!chunks.length) {
          await updatePdf(pdf.id, { status: "error", error_message: "Không tạo được đoạn văn bản." });
          return res.status(422).json({ success: false, error: "Không tạo được đoạn văn bản nào." });
        }

        // 5) Embed (optional).
        let embeddings = null;
        if (embeddingsAvailable()) {
          await updatePdf(pdf.id, { status: "embedding" });
          try {
            embeddings = await embedTexts(chunks);
          } catch (e) {
            console.warn(`⚠️ [admin] embedding failed, storing text only: ${e.message}`);
            embeddings = null;
          }
        }

        // 6) Save chunks.
        await updatePdf(pdf.id, { status: "saving" });
        const { inserted, embedded } = await insertChunks(pdf.id, chunks, embeddings);

        // 7) Mark ready.
        await updatePdf(pdf.id, {
          status: "ready",
          chunk_count: inserted,
          embedding_count: embedded,
        });

        return res.status(200).json({
          success: true,
          document: {
            id: pdf.id,
            file_name: filename,
            pages,
            chunk_count: inserted,
            embedding_count: embedded,
            cloudinary_url: cloud?.url || null,
            cloudinary: cloudinaryOn,
          },
          store: await storeSummary(),
          warning: cloudinaryOn ? null : "Cloudinary chưa được cấu hình — tệp PDF KHÔNG được lưu trên cloud (các đoạn văn bản vẫn lưu vào Supabase).",
        });
      } catch (err) {
        await updatePdf(pdf.id, { status: "error", error_message: String(err?.message || "unknown").slice(0, 500) });
        if (cloud?.public_id) await destroyPdf(cloud.public_id); // avoid orphaned cloud file
        console.error("admin upload error:", err);
        return res.status(500).json({ success: false, error: "Lỗi xử lý tài liệu: " + (err?.message || "unknown") });
      }
    }

    return res.status(400).json({ success: false, error: "Action không hợp lệ." });
  } catch (err) {
    console.error("admin error:", err);
    return res.status(500).json({ success: false, error: "Lỗi máy chủ: " + (err?.message || "unknown") });
  }
}
