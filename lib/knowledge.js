/**
 * knowledge.js — Retrieval layer (RAG) for the AI nutrition coach.
 *
 * Two knowledge sources are combined into ONE unified, hybrid-ranked pool:
 *
 *   A. BUILT-IN, disease-routed base — knowledge/knowledge-base.json
 *      (curated docs: diabetes, gout, fatty liver, high cholesterol, kidney,
 *      gastrointestinal). The user's profile.disease gives a strong routing
 *      boost, but routing is no longer a hard pre-filter — a well-matched
 *      passage from another doc can still surface when it's clearly relevant.
 *
 *   B. ADMIN-UPLOADED, semantic layer — Supabase admin_kb_chunks (general
 *      nutrition PDFs an admin adds via /admin.html). Takes effect immediately
 *      (the in-memory cache is invalidated on upload/delete).
 *
 * RANKING (see lib/rag/retrieval.js):
 *   dense (cosine) + lexical (BM25) → Reciprocal Rank Fusion → MMR diversity.
 *   Works with mixed pools (some chunks embedded, some not) and degrades to
 *   pure lexical when no OpenAI key is configured.
 *
 * UPGRADE: the bundled base chunks historically shipped WITHOUT embeddings, so
 * the base layer ran keyword-only. When an OpenAI key is present we now embed
 * the base chunks once and cache them in memory, so the base layer also gets
 * semantic search with no rebuild required. (For zero cold-start cost, bake the
 * vectors into the JSON ahead of time with scripts/ingest-knowledge.mjs.)
 *
 * Every path is wrapped so a failure returns an empty result and never breaks
 * the chat flow. Avoids `import.meta` (transpiles to CommonJS on Vercel).
 */

import fs from "fs";
import path from "path";
import { embedQuery, embedTexts, embeddingsAvailable } from "./rag/embeddings.js";
import { adminStoreReady, countAdminChunks, fetchAdminChunks } from "./rag/store.js";
import { deaccent, tokenize, hybridRank } from "./rag/retrieval.js";

const ADMIN_TITLE = "Tài liệu dinh dưỡng bổ sung (quản trị viên tải lên)";

/* Tunables (overridable via env) ----------------------------------------- */
const LAZY_EMBED_BASE = process.env.RAG_LAZY_EMBED_BASE !== "0"; // embed base layer at runtime
const ADMIN_CACHE_TTL_MS = Number(process.env.RAG_ADMIN_CACHE_TTL_MS || 60_000);
const ROUTE_BONUS = Number(process.env.RAG_ROUTE_BONUS || 0.015); // additive on fused (RRF) score
const ADMIN_BONUS = Number(process.env.RAG_ADMIN_BONUS || 0.004);
const MMR_LAMBDA = Number(process.env.RAG_MMR_LAMBDA || 0.7);

/* ----------------------------------------------------------------------- */
/* Bundled knowledge base (built-in base) — cached, read via cwd()+fs.     */
/* ----------------------------------------------------------------------- */
let _bundle = null;
let _baseEmbedded = false;      // have we lazily embedded the base chunks?
let _baseEmbedPromise = null;   // in-flight embedding (avoid duplicate work)
let _baseEmbedCooldownUntil = 0; // back off after a failure (transient key/rate issues)

const BUNDLE_PATHS = [
  path.join(process.cwd(), "knowledge", "knowledge-base.json"),
  path.join(process.cwd(), "knowledge-base.json"),
];

function loadBundle() {
  if (_bundle) return _bundle;
  for (const p of BUNDLE_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
        _bundle = parsed && Array.isArray(parsed.chunks) ? parsed : { chunks: [] };
        return _bundle;
      }
    } catch (err) {
      console.warn(`⚠️ [knowledge] failed to read ${p}: ${err.message}`);
    }
  }
  _bundle = { chunks: [] };
  return _bundle;
}

/**
 * Lazily attach embeddings to the bundled base chunks (once per warm instance).
 * No-op if the chunks already have embeddings, lazy-embed is disabled, or no
 * OpenAI key. Best-effort: on failure the base layer just stays lexical.
 */
async function ensureBaseEmbeddings() {
  if (_baseEmbedded || !LAZY_EMBED_BASE || !embeddingsAvailable()) return;
  if (Date.now() < _baseEmbedCooldownUntil) return; // backing off after a failure
  const bundle = loadBundle();
  const chunks = bundle.chunks || [];
  const missing = chunks.filter((c) => !(Array.isArray(c.embedding) && c.embedding.length));
  if (!missing.length) {
    _baseEmbedded = true;
    return;
  }
  if (_baseEmbedPromise) return _baseEmbedPromise; // someone else is doing it

  _baseEmbedPromise = (async () => {
    try {
      const inputs = missing.map((c) => `[${c.disease_title || ""}] (${c.section || ""}) ${c.text || ""}`);
      const vectors = await embedTexts(inputs);
      missing.forEach((c, i) => {
        if (Array.isArray(vectors[i])) c.embedding = vectors[i];
      });
      _baseEmbedded = true;
      console.log(`📚 [knowledge] lazily embedded ${missing.length} base chunks (semantic base layer active).`);
    } catch (err) {
      _baseEmbedCooldownUntil = Date.now() + 5 * 60_000; // retry no sooner than 5 min
      console.warn(`⚠️ [knowledge] base lazy-embed failed (staying lexical, backing off 5m): ${err.message}`);
    } finally {
      _baseEmbedPromise = null;
    }
  })();
  return _baseEmbedPromise;
}

/* ----------------------------------------------------------------------- */
/* Admin chunk cache (short TTL; invalidated on upload/delete).            */
/* ----------------------------------------------------------------------- */
let _adminCache = { at: 0, chunks: null };

async function getAdminChunksCached() {
  const now = Date.now();
  if (_adminCache.chunks && now - _adminCache.at < ADMIN_CACHE_TTL_MS) {
    return _adminCache.chunks;
  }
  try {
    if (!(await adminStoreReady()) || (await countAdminChunks()) === 0) {
      _adminCache = { at: now, chunks: [] };
      return [];
    }
    const pool = await fetchAdminChunks(2000);
    _adminCache = { at: now, chunks: pool || [] };
    return _adminCache.chunks;
  } catch (err) {
    console.warn(`⚠️ [knowledge] admin fetch failed: ${err.message}`);
    return _adminCache.chunks || [];
  }
}

/** Clear caches so freshly uploaded/deleted admin docs take effect at once. */
export function resetKnowledgeCache() {
  _adminCache = { at: 0, chunks: null };
}

/* ----------------------------------------------------------------------- */
/* Disease routing (built-in base only)                                    */
/* ----------------------------------------------------------------------- */
function matchDiseaseKeys(diseaseStr, chunks) {
  const hay = deaccent(diseaseStr);
  if (!hay) return new Set();
  const labelsByKey = new Map();
  for (const c of chunks) {
    if (!labelsByKey.has(c.disease_key)) {
      labelsByKey.set(c.disease_key, new Set((c.labels || []).map(deaccent)));
    }
  }
  const keys = new Set();
  for (const [key, labels] of labelsByKey) {
    for (const label of labels) {
      if (label && hay.includes(label)) {
        keys.add(key);
        break;
      }
    }
  }
  return keys;
}

/* ----------------------------------------------------------------------- */
/* Main retrieval                                                          */
/* ----------------------------------------------------------------------- */
export async function retrieveKnowledge({
  message = "",
  disease = "",
  topK = 6,
  maxChars = 4500,
} = {}) {
  try {
    const qStr = `${disease ? disease + ". " : ""}${message}`.trim() || disease;
    const qTokens = tokenize(`${disease} ${message}`);

    // Embed query + base layer in parallel (both reused below). qvec is null
    // when no OpenAI key, in which case everything falls back to lexical.
    let qvec = null;
    if (embeddingsAvailable() && qStr) {
      const [vec] = await Promise.all([embedQuery(qStr), ensureBaseEmbeddings()]);
      qvec = vec;
    }

    /* ---------- Build the unified candidate pool ---------- */
    const bundle = loadBundle();
    const diseaseKeys = matchDiseaseKeys(disease, bundle.chunks);

    // No signal at all (no query terms, no embedding, no disease match) → there
    // is nothing to retrieve on. Returning arbitrary chunks here would inject
    // irrelevant disease info (e.g. for a healthy user with no question).
    if (!qTokens.length && !qvec && !diseaseKeys.size) {
      return { chunks: [], usedDiseaseKeys: [], mode: "none", source: "none" };
    }

    // Base chunks: when a disease is matched, prefer that doc but still keep a
    // few others as long-tail candidates (so cross-cutting questions work).
    const baseChunks = (bundle.chunks || []).map((c) => ({
      text: c.text,
      embedding: Array.isArray(c.embedding) ? c.embedding : null,
      disease_key: c.disease_key,
      disease_title: c.disease_title || "Tài liệu dinh dưỡng theo bệnh lý",
      section: c.section || "",
      source: "base",
    }));

    const adminRaw = await getAdminChunksCached();
    const adminChunks = (adminRaw || []).map((c) => ({
      text: c.text,
      embedding: Array.isArray(c.embedding) ? c.embedding : null,
      disease_key: null,
      disease_title: ADMIN_TITLE,
      section: `đoạn ${(c.chunk_index ?? 0) + 1}`,
      source: "admin",
    }));

    const pool = [...baseChunks, ...adminChunks];
    if (!pool.length) {
      return { chunks: [], usedDiseaseKeys: [...diseaseKeys], mode: "none", source: "none" };
    }

    /* ---------- Hybrid rank (dense + BM25 + RRF + MMR) ---------- */
    // Routing/source bonus pushes the matched disease doc and admin docs up
    // without hard-excluding anything else.
    const bonus = (i) => {
      const c = pool[i];
      let b = 0;
      if (c.source === "base" && diseaseKeys.size && diseaseKeys.has(c.disease_key)) b += ROUTE_BONUS;
      if (c.source === "admin") b += ADMIN_BONUS;
      return b;
    };

    // Pull a few extra before the char-budget trim so MMR has room to diversify.
    const wantK = Math.min(Math.max(topK + 4, 8), 16);
    const { order, mode } = hybridRank({
      pool,
      qvec,
      qTokens,
      topK: wantK,
      mmrLambda: MMR_LAMBDA,
      bonus,
    });

    /* ---------- Character budget + final selection ---------- */
    const out = [];
    let total = 0;
    let baseTaken = 0;
    let adminTaken = 0;
    for (const i of order) {
      const c = pool[i];
      const len = (c.text || "").length;
      if (out.length >= topK) break;
      if (out.length && total + len > maxChars) continue; // skip oversize, keep scanning
      out.push(c);
      total += len;
      if (c.source === "base") baseTaken++;
      else adminTaken++;
    }

    if (!out.length) {
      return { chunks: [], usedDiseaseKeys: [...diseaseKeys], mode, source: "none" };
    }

    const source =
      baseTaken && adminTaken ? "base+admin" : adminTaken ? "admin" : "base";

    return { chunks: out, usedDiseaseKeys: [...diseaseKeys], mode, source };
  } catch (err) {
    console.warn(`⚠️ [knowledge] retrieveKnowledge error: ${err.message}`);
    return { chunks: [], usedDiseaseKeys: [], mode: "error", source: "error" };
  }
}

/**
 * Format retrieved chunks into a Vietnamese prompt block. Returns "" when empty.
 * Tuned for the nutrition-coach goal: the model must ground disease advice in
 * these passages, adapt them to concrete Vietnamese dishes, and still respect
 * the user's calorie/macro targets.
 */
export function buildKnowledgeSection(result) {
  const chunks = result?.chunks || [];
  if (!chunks.length) return "";

  const byTitle = new Map();
  for (const c of chunks) {
    const title = c.disease_title || c.source || "Tài liệu dinh dưỡng";
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(c);
  }

  let body = "";
  for (const [title, list] of byTitle) {
    body += `\n### ${title}\n`;
    for (const c of list) {
      const tag = c.section ? `(${c.section}) ` : "";
      body += `- ${tag}${c.text}\n`;
    }
  }

  return `
================================================================
TÀI LIỆU CHUYÊN MÔN VỀ DINH DƯỠNG THEO BỆNH LÝ (RẤT QUAN TRỌNG)
================================================================
Dưới đây là các trích đoạn từ tài liệu y khoa/dinh dưỡng đã được truy hồi (RAG), liên quan trực tiếp đến tình trạng sức khỏe và câu hỏi của người dùng. Đây là NGUỒN ĐÁNG TIN CẬY và được ưu tiên hơn kiến thức chung.

QUY TẮC SỬ DỤNG TÀI LIỆU NÀY:
1. Khi tư vấn, gợi ý hoặc xây dựng/điều chỉnh thực đơn cho người dùng có bệnh lý, BẮT BUỘC ưu tiên tuân theo các khuyến nghị trong tài liệu này (món nên ăn, món nên hạn chế/tránh, nguyên tắc dinh dưỡng).
2. Nếu một món ăn người dùng nhắc tới thuộc nhóm "nên tránh/hạn chế" theo tài liệu → cảnh báo nhẹ nhàng và đề xuất món thay thế phù hợp.
3. Diễn đạt tự nhiên bằng tiếng Việt và áp dụng vào món ăn Việt Nam cụ thể; KHÔNG chép nguyên văn tiếng Anh, KHÔNG trích dẫn dài.
4. Tài liệu là kiến thức nền về bệnh lý; vẫn phải kết hợp với mục tiêu calo và macro của người dùng.
5. Chỉ dùng thông tin có trong tài liệu hoặc kiến thức dinh dưỡng phổ quát đáng tin cậy. Nếu tài liệu KHÔNG đề cập điều người dùng hỏi, hãy nói rõ là khuyến nghị chung và tránh bịa số liệu y khoa cụ thể.
${body}
================================================================
`.trim();
}

export default { retrieveKnowledge, buildKnowledgeSection, resetKnowledgeCache };
