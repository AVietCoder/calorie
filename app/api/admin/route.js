/**
 * /api/admin — admin knowledge-base management (uploads → Storage + Knowledge Base).
 *
 * Pipeline (NO EMBEDDINGS ANYWHERE):
 *   PDF → Supabase Storage (raw file, PRIMARY) [+ Cloudinary mirror, OPTIONAL]
 *       → pdf-parse (text) → chunk → store chunks in Supabase admin_kb_chunks
 *       → Postgres builds the searchable index automatically (a GENERATED
 *         `tsv tsvector` column + GIN index — see migrations/fulltext_search.sql).
 *   Questions are answered by PostgreSQL Full Text Search (ts_rank), not by
 *   any embedding/vector similarity. No BGE-M3, no OpenAI/Lovable embeddings,
 *   no /v1/embeddings call, no pgvector, anywhere in this pipeline.
 *
 * Actions (?action=...):
 *   GET  whoami        -> { isAdmin, email, store, cloudinary, storage, search }
 *   GET  list          -> { pdfs:[{ ..., download_url, download_kind }], store }
 *   GET  ftscheck      -> Full Text Search smoke test (admin only)
 *   GET  download&id=  -> 302 redirect to a fresh signed download URL
 *   POST upload        -> multipart (file=PDF): run the full pipeline
 *   POST delete&id=    -> delete a PDF (DB cascade + Storage + Cloudinary)
 *
 * Everything except `whoami` requires an admin. Reads/writes use the
 * service-role Supabase client (see store.js / migrations/admin.sql), so
 * SUPABASE_SERVICE_ROLE_KEY must be configured (also required for Storage).
 */
import { NextResponse } from "next/server";

import { requireAdmin } from "../../../lib/admin-auth.js";
// Curation/analytics (bundle F) ghi `foods` và đọc `ai_usage_logs` (RLS bật) từ
// server → phải dùng service-role để bypass RLS. Alias thành `supabase` cho gọn.
import { supabaseAdmin as supabase } from "../../../lib/supabase.js";
import { getUsageStats } from "../../../lib/usage-log.js";
import { parsePdf } from "../../../lib/rag/parse-pdf.js";
import { chunkText } from "../../../lib/rag/chunker.js";
import { cloudinaryConfigured, uploadPdf, destroyPdf } from "../../../lib/cloudinary.js";
import {
  storageConfigured,
  uploadPdfToStorage,
  getSignedUrl,
  deletePdfFromStorage,
} from "../../../lib/rag/storage.js";
import {
  adminStoreReady,
  countAdminChunks,
  countAdminPdfs,
  createPdf,
  updatePdf,
  insertChunks,
  listPdfs,
  getPdf,
  deletePdf,
  searchAdminChunks,
} from "../../../lib/rag/store.js";
import { CORS_HEADERS, corsJson, corsOptions } from "../../../lib/cors.js";

export const maxDuration = 60;

// Express-shaped `res` shim — see app/api/chat/route.js for the rationale.
function makeRes() {
  const self = {
    _status: 200,
    status(n) { self._status = n; return self; },
    json(body) { return corsJson(NextResponse, body, { status: self._status }); },
    end() { return new NextResponse(null, { status: self._status, headers: { ...CORS_HEADERS, ...self._headers } }); },
    setHeader(k, v) { self._headers = { ...self._headers, [k]: v }; return self; },
  };
  return self;
}

export async function OPTIONS() {
  return corsOptions(NextResponse);
}

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

/** Full Text Search engine info shown in the admin panel (replaces the old embedding pill). */
function searchEngineInfo() {
  return {
    engine: "postgres-fulltext-search",
    index: "tsvector + GIN + ts_rank",
    description: "Không dùng embedding — tìm kiếm bằng PostgreSQL Full Text Search.",
  };
}

/** Confirms the tsvector/GIN/RPC migration has actually been applied. */
async function ftsReady() {
  try {
    await searchAdminChunks("test", 1);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request) {
  return coreHandler(request, "GET");
}

export async function POST(request) {
  return coreHandler(request, "POST");
}

async function coreHandler(request, method) {
  const res = makeRes();
  const req = {
    method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    headers: request.headers, // Web Headers (requireAdmin needs .get())
  };
  setCors(res);

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
      storage: storageConfigured(),
      search: searchEngineInfo(), // Full Text Search info (frontend pill) — replaces `embeddings`
    });
  }

  if (!isAdmin) {
    return res.status(403).json({ success: false, error: "Bạn không có quyền quản trị (admin)." });
  }

  try {
    // ── List uploaded PDFs ────────────────────────────────────────────
    if (req.method === "GET" && action === "list") {
      const pdfs = await listPdfs();

      // Attach a ready-to-use download URL for each row. Prefer Supabase
      // Storage (private bucket → short-lived signed URL, works out of the
      // box); fall back to the Cloudinary delivery URL for older uploads.
      const withLinks = await Promise.all(
        (pdfs || []).map(async (p) => {
          let download_url = null;
          let download_kind = null;
          if (p.storage_path) {
            const name = (p.file_name || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
            download_url = await getSignedUrl(p.storage_path, name);
            if (download_url) download_kind = "storage";
          }
          if (!download_url && p.cloudinary_url) {
            download_url = p.cloudinary_url;
            download_kind = "cloudinary";
          }
          return { ...p, download_url, download_kind };
        })
      );

      return res.status(200).json({
        success: true,
        pdfs: withLinks,
        store: await storeSummary(),
        cloudinary: cloudinaryConfigured(),
        storage: storageConfigured(),
        search: searchEngineInfo(),
      });
    }

    // ── Full Text Search self-diagnostic (admin only) ─────────────────
    //   GET /api/admin?action=ftscheck → confirms migrations/fulltext_search.sql
    //   has been applied (tsvector column + GIN index + RPC function all
    //   reachable) BEFORE relying on it for uploads/questions.
    if (req.method === "GET" && action === "ftscheck") {
      const ok = await ftsReady();
      return res.status(ok ? 200 : 502).json({
        success: ok,
        search: searchEngineInfo(),
        ready: ok,
        hint: ok ? null : "Chạy migrations/fulltext_search.sql trên Supabase SQL Editor.",
      });
    }

    // ── Download a PDF (redirect to a fresh signed URL) ───────────────
    // Robust fallback path: /api/admin?action=download&id=<uuid>
    if (req.method === "GET" && action === "download") {
      const id = asText(req.query?.id) || asText(req.query?.docId);
      if (!id) return res.status(400).json({ success: false, error: "Thiếu id." });
      const row = await getPdf(id);
      if (!row) return res.status(404).json({ success: false, error: "Không tìm thấy tài liệu." });

      const name = (row.file_name || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      let url = null;
      if (row.storage_path) url = await getSignedUrl(row.storage_path, name);
      if (!url && row.cloudinary_url) url = row.cloudinary_url;
      if (!url) {
        return res.status(404).json({
          success: false,
          error: "Tài liệu này chưa có file gốc để tải (chỉ có phần văn bản đã trích).",
        });
      }
      res.setHeader("Location", url);
      return res.status(302).end();
    }

    // ── Delete a PDF (DB cascade + Storage + Cloudinary) ──────────────
    if (req.method === "POST" && action === "delete") {
      const id = asText(req.query?.id) || asText(req.query?.docId);
      if (!id) return res.status(400).json({ success: false, error: "Thiếu id." });
      const row = await deletePdf(id);
      if (row?.storage_path) await deletePdfFromStorage(row.storage_path);
      if (row?.cloudinary_public_id) await destroyPdf(row.cloudinary_public_id);
      // No cache to invalidate — every question hits Postgres Full Text
      // Search directly, so the removed doc disappears from retrieval at once.
      return res.status(200).json({ success: true, store: await storeSummary() });
    }

    // ── Upload a PDF and run the Knowledge Base pipeline ──────────────
    if (req.method === "POST" && action === "upload") {
      if (!(await adminStoreReady())) {
        return res.status(400).json({
          success: false,
          error: "Chưa tạo bảng Supabase. Hãy chạy migrations/admin.sql và migrations/fulltext_search.sql, và đặt SUPABASE_SERVICE_ROLE_KEY.",
        });
      }

      const formData = await request.formData();
      const fileObj = formData.get("file") ?? formData.get("pdf") ?? formData.get("document");
      if (!fileObj) return res.status(400).json({ success: false, error: "Thiếu tệp PDF (field 'file')." });

      const filename = fileObj.name || "document.pdf";
      const isPdf =
        (fileObj.type && fileObj.type.includes("pdf")) || filename.toLowerCase().endsWith(".pdf");
      if (!isPdf) return res.status(400).json({ success: false, error: "Chỉ chấp nhận tệp PDF." });

      const buffer = Buffer.from(await fileObj.arrayBuffer());
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
      let storage = null;
      try {
        // 2) Persist the raw PDF.
        //    PRIMARY: Supabase Storage (always available with this stack).
        //    OPTIONAL MIRROR: Cloudinary (kept for backward compatibility).
        const cloudinaryOn = cloudinaryConfigured();

        storage = await uploadPdfToStorage(buffer, filename, pdf.id);
        if (cloudinaryOn) {
          try {
            cloud = await uploadPdf(buffer, filename);
          } catch (e) {
            console.warn(`⚠️ [admin] Cloudinary mirror failed (ignored): ${e.message}`);
            cloud = null;
          }
        }

        await updatePdf(pdf.id, {
          status: "extracting",
          storage_path: storage?.path || null,
          storage_bucket: storage?.bucket || null,
          cloudinary_public_id: cloud?.public_id || null,
          cloudinary_url: cloud?.url || null,
        });

        // 3) Extract text.
        console.log(`📄 [admin][upload] pdf=${pdf.id} file="${filename}" size=${size}B → extracting…`);
        const { text, pages } = await parsePdf(buffer);
        if (!text || text.trim().length < 40) {
          console.warn(`⚠️ [admin][upload] pdf=${pdf.id} no extractable text (likely a scanned image PDF).`);
          await updatePdf(pdf.id, { status: "error", error_message: "PDF không có văn bản (có thể là scan ảnh)." });
          return res.status(422).json({
            success: false,
            error: "Không trích được văn bản từ PDF (có thể là PDF scan ảnh, không có text).",
          });
        }
        console.log(`📄 [admin][upload] pdf=${pdf.id} extracted ${text.length} chars from ${pages} page(s).`);

        // 4) Chunk (tuned: smaller chunks retrieve more precisely for Q&A).
        await updatePdf(pdf.id, { status: "chunking" });
        const chunks = chunkText(text, { chunkChars: 1000, overlap: 150 });
        if (!chunks.length) {
          await updatePdf(pdf.id, { status: "error", error_message: "Không tạo được đoạn văn bản." });
          return res.status(422).json({ success: false, error: "Không tạo được đoạn văn bản nào." });
        }
        const avgLen = Math.round(chunks.reduce((a, c) => a + c.length, 0) / chunks.length);
        console.log(`✂️ [admin][upload] pdf=${pdf.id} chunked into ${chunks.length} chunks (avg ${avgLen} chars).`);

        // 5) Save chunks (text only). Postgres builds the search index itself:
        //    `tsv` is a GENERATED tsvector column with a GIN index (see
        //    migrations/fulltext_search.sql) — nothing to compute here, no
        //    embedding call, no vector to store.
        await updatePdf(pdf.id, { status: "saving" });
        const { inserted } = await insertChunks(pdf.id, chunks);
        console.log(`💾 [admin][upload] pdf=${pdf.id} saved ${inserted} chunks (full-text indexed).`);

        // 6) Mark ready — usable immediately (no cache to warm/invalidate;
        //    every question queries Postgres Full Text Search directly).
        await updatePdf(pdf.id, {
          status: "ready",
          chunk_count: inserted,
        });
        console.log(`🎉 [admin][upload] pdf=${pdf.id} READY — ${inserted} chunks, full-text searchable.`);

        // Build a download URL for the response (signed Storage URL preferred).
        let download_url = null;
        if (storage?.path) {
          download_url = await getSignedUrl(
            storage.path,
            filename.replace(/[^a-zA-Z0-9._-]/g, "_")
          );
        }
        if (!download_url && cloud?.url) download_url = cloud.url;

        const storageWarning = !storage && !cloud
          ? "Không lưu được file gốc (kiểm tra SUPABASE_SERVICE_ROLE_KEY / Storage). Phần văn bản vẫn được lưu vào Supabase."
          : !storage && cloud
          ? "Chưa lưu được vào Supabase Storage — đang dùng Cloudinary để lưu file gốc."
          : null;

        return res.status(200).json({
          success: true,
          document: {
            id: pdf.id,
            file_name: filename,
            pages,
            chunk_count: inserted,
            download_url,
            stored: !!(storage || cloud),
            storage: !!storage,
            cloudinary: !!cloud,
          },
          store: await storeSummary(),
          warning: storageWarning,
        });
      } catch (err) {
        await updatePdf(pdf.id, { status: "error", error_message: String(err?.message || "unknown").slice(0, 500) });
        if (storage?.path) await deletePdfFromStorage(storage.path); // avoid orphans
        if (cloud?.public_id) await destroyPdf(cloud.public_id);
        console.error("admin upload error:", err);
        return res.status(500).json({ success: false, error: "Lỗi xử lý tài liệu: " + (err?.message || "unknown") });
      }
    }

    // ── E+F: Analytics + Nutrition curation ───────────────────────────
    // Thống kê sử dụng AI 7 ngày + tổng quan chất lượng dữ liệu dinh dưỡng.
    if (req.method === "GET" && action === "nutrition_stats") {
      const days = parseInt(req.query?.days, 10) || 7;
      const [usage, foodsAgg, anchorsAgg] = await Promise.all([
        getUsageStats(days),
        (async () => {
          const { data } = await supabase.from("foods").select("verified, source");
          const rows = Array.isArray(data) ? data : [];
          const bySource = {};
          let verified = 0;
          for (const r of rows) { bySource[r.source || "?"] = (bySource[r.source || "?"] || 0) + 1; if (r.verified) verified++; }
          return { total: rows.length, verified, bySource };
        })(),
        (async () => {
          const { data } = await supabase.from("nutrition_anchors").select("verified, source");
          const rows = Array.isArray(data) ? data : [];
          const bySource = {};
          let verified = 0;
          for (const r of rows) { bySource[r.source || "?"] = (bySource[r.source || "?"] || 0) + 1; if (r.verified) verified++; }
          return { total: rows.length, verified, bySource };
        })(),
      ]);
      return res.status(200).json({ success: true, usage, foods: foodsAgg, anchors: anchorsAgg });
    }

    // Danh sách món foods (ưu tiên chưa verify để admin duyệt trước).
    if (req.method === "GET" && action === "list_foods") {
      const onlyUnverified = String(req.query?.unverified || "") === "1";
      let q = supabase.from("foods")
        .select("id, description, calories, protein, fat, carbs, fiber, sugar, sodium, source, confidence, verified, hit_count")
        .order("verified", { ascending: true })
        .order("hit_count", { ascending: false })
        .limit(Math.min(parseInt(req.query?.limit, 10) || 200, 500));
      if (onlyUnverified) q = q.eq("verified", false);
      const { data, error } = await q;
      if (error) return res.status(400).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, foods: data || [] });
    }

    // Duyệt 1 món (đánh dấu verified — bất khả đè bởi AI về sau).
    if (req.method === "POST" && action === "verify_food") {
      const id = asText(req.query?.id);
      if (!id) return res.status(400).json({ success: false, error: "Thiếu id." });
      const { error } = await supabase.from("foods")
        .update({ verified: true, confidence: "high", source: "manual", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return res.status(400).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    // Sửa dinh dưỡng 1 món (admin chỉnh tay → coi như manual verified).
    if (req.method === "POST" && action === "update_food") {
      const id = asText(req.query?.id);
      const body = await request.json().catch(() => ({}));
      if (!id) return res.status(400).json({ success: false, error: "Thiếu id." });
      const patch = {};
      for (const k of ["description", "calories", "protein", "fat", "carbs", "fiber", "sugar", "sodium"]) {
        if (body[k] != null) patch[k] = body[k];
      }
      if (!Object.keys(patch).length) return res.status(400).json({ success: false, error: "Không có trường để cập nhật." });
      patch.verified = true; patch.confidence = "high"; patch.source = "manual";
      patch.updated_at = new Date().toISOString();
      const { error } = await supabase.from("foods").update(patch).eq("id", id);
      if (error) return res.status(400).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    // Xoá 1 món foods sai/nhiễm.
    if (req.method === "POST" && action === "delete_food") {
      const id = asText(req.query?.id);
      if (!id) return res.status(400).json({ success: false, error: "Thiếu id." });
      const { error } = await supabase.from("foods").delete().eq("id", id);
      if (error) return res.status(400).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: "Action không hợp lệ." });
  } catch (err) {
    console.error("admin error:", err);
    return res.status(500).json({ success: false, error: "Lỗi máy chủ: " + (err?.message || "unknown") });
  }
}
