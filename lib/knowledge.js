/**
 * knowledge.js — Retrieval layer (RAG) for the AI coach.
 *
 * Two knowledge sources are combined automatically:
 *
 *   A. BUILT-IN, disease-routed base — knowledge/knowledge-base.json
 *      (the curated 6 docs: diabetes, gout, fatty liver, high cholesterol,
 *      kidney, gastrointestinal). Routed by the user's profile.disease string.
 *
 *   B. ADMIN-UPLOADED, semantic layer — Supabase admin_kb_chunks (see
 *      migrations/admin.sql), populated from /admin.html. General nutrition
 *      PDFs an admin adds; retrieved by semantic similarity to the live query
 *      (or lexical overlap when embeddings aren't available). This takes effect
 *      immediately, no redeploy.
 *
 * RANKING:
 *   • Disease routing always selects the right built-in document.
 *   • Semantic ranking (cosine over embeddings) is used when chunks have
 *     embeddings AND OPENAI_API_KEY is set; otherwise lexical overlap; otherwise
 *     plain document order.
 *
 * Every path is wrapped so a failure returns an empty result and never breaks
 * the chat flow.
 *
 * NOTE: this module avoids `import.meta` (it transpiles to CommonJS on Vercel,
 * where `import.meta` is a syntax error). File lookups use process.cwd() + fs.
 */

import fs from "fs";
import path from "path";
import { embedQuery } from "./rag/embeddings.js";
import {
  adminStoreReady,
  countAdminChunks,
  fetchAdminChunks,
} from "./rag/store.js";

const ADMIN_TITLE = "Tài liệu dinh dưỡng bổ sung (quản trị viên tải lên)";

/* ----------------------------------------------------------------------- */
/* Bundled knowledge base (built-in base) — cached, read via cwd()+fs.     */
/* ----------------------------------------------------------------------- */
let _bundle = null;
const BUNDLE_PATHS = [
  path.join(process.cwd(), "knowledge", "knowledge-base.json"),
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

/* ----------------------------------------------------------------------- */
/* Text utilities                                                          */
/* ----------------------------------------------------------------------- */
function deaccent(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(
  ("the a an and or of to in on for with without is are be can may should would " +
    "what which how my i you it that this these those at as by from do does eat " +
    "food foods diet co khong nen la cua va hay cho toi an gi mon").split(" ")
);

function tokenize(s = "") {
  return deaccent(s).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
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

/* Rank a pool of chunks by semantic (if qvec) else lexical overlap. */
function rankPool(pool, qvec, qTokens) {
  if (qvec) {
    return pool
      .map((c) => ({ c, score: Array.isArray(c.embedding) ? cosine(qvec, c.embedding) : 0 }))
      .sort((a, b) => b.score - a.score);
  }
  if (qTokens && qTokens.length) {
    const qset = new Set(qTokens);
    return pool
      .map((c) => {
        const ctoks = tokenize(c.text);
        let hits = 0;
        for (const t of ctoks) if (qset.has(t)) hits++;
        return { c, score: hits / Math.max(8, ctoks.length) };
      })
      .sort((a, b) => b.score - a.score);
  }
  return [];
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

    // Embed the query once (reused for base + admin). Null if no OpenAI key.
    let qvec = null;
    if (process.env.OPENAI_API_KEY && qStr) {
      qvec = await embedQuery(qStr);
    }

    /* ---------- A. Built-in disease-routed base ---------- */
    const baseChunks = [];
    const bundle = loadBundle();
    const diseaseKeys = matchDiseaseKeys(disease, bundle.chunks);
    let baseMode = "none";
    if (bundle.chunks.length) {
      const pool = diseaseKeys.size
        ? bundle.chunks.filter((c) => diseaseKeys.has(c.disease_key))
        : bundle.chunks;
      const baseHasEmb = pool.some((c) => Array.isArray(c.embedding) && c.embedding.length);
      const ranked = rankPool(pool, baseHasEmb ? qvec : null, qTokens);
      const k = Math.min(Math.max(topK, diseaseKeys.size * 4), 12);

      if (diseaseKeys.size) {
        const useScores = ranked.length && ranked[0].score > 0;
        const ordered = useScores ? ranked.map((r) => r.c) : pool;
        baseChunks.push(...ordered.slice(0, k));
        baseMode = useScores ? (baseHasEmb && qvec ? "semantic" : "lexical") : "routing_order";
      } else {
        const strong = ranked.filter((r) => (baseHasEmb && qvec ? r.score >= 0.3 : r.score >= 0.12));
        baseChunks.push(...strong.slice(0, k).map((r) => r.c));
        baseMode = baseChunks.length ? (baseHasEmb && qvec ? "semantic" : "lexical") : "none";
      }
    }

    /* ---------- B. Admin-uploaded semantic layer ---------- */
    const adminChunks = [];
    let adminMode = "none";
    try {
      if ((await adminStoreReady()) && (await countAdminChunks()) > 0) {
        const pool = await fetchAdminChunks(1000);
        if (pool.length) {
          const adminHasEmb = pool.some((c) => Array.isArray(c.embedding) && c.embedding.length);
          const ranked = rankPool(pool, adminHasEmb ? qvec : null, qTokens);
          const threshold = adminHasEmb && qvec ? 0.3 : 0.12;
          const adminTopK = Math.min(topK, 4);
          const strong = ranked.filter((r) => r.score >= threshold).slice(0, adminTopK);
          for (const r of strong) {
            adminChunks.push({
              text: r.c.text,
              disease_title: ADMIN_TITLE,
              section: `đoạn ${(r.c.chunk_index ?? 0) + 1}`,
              source: "admin",
            });
          }
          adminMode = adminChunks.length ? (adminHasEmb && qvec ? "semantic" : "lexical") : "none";
        }
      }
    } catch (err) {
      console.warn(`⚠️ [knowledge] admin retrieval skipped: ${err.message}`);
    }

    /* ---------- Merge + character budget ---------- */
    const merged = [...baseChunks, ...adminChunks];
    if (!merged.length) {
      return { chunks: [], usedDiseaseKeys: [...diseaseKeys], mode: "none", source: "none" };
    }
    const out = [];
    let total = 0;
    for (const c of merged) {
      const len = (c.text || "").length;
      if (out.length && total + len > maxChars) break;
      out.push(c);
      total += len;
    }

    const source =
      baseChunks.length && adminChunks.length
        ? "base+admin"
        : adminChunks.length
        ? "admin"
        : "base";
    const mode = baseChunks.length ? baseMode : adminMode;

    return { chunks: out, usedDiseaseKeys: [...diseaseKeys], mode, source };
  } catch (err) {
    console.warn(`⚠️ [knowledge] retrieveKnowledge error: ${err.message}`);
    return { chunks: [], usedDiseaseKeys: [], mode: "error", source: "error" };
  }
}

/**
 * Format retrieved chunks into a Vietnamese prompt block. Returns "" when empty.
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
      body += `- (${c.section}) ${c.text}\n`;
    }
  }

  return `
================================================================
TÀI LIỆU CHUYÊN MÔN VỀ DINH DƯỠNG THEO BỆNH LÝ (RẤT QUAN TRỌNG)
================================================================
Dưới đây là các trích đoạn từ tài liệu y khoa/dinh dưỡng đã được tổng hợp, liên quan trực tiếp đến tình trạng sức khỏe của người dùng. Đây là NGUỒN ĐÁNG TIN CẬY.

QUY TẮC SỬ DỤNG TÀI LIỆU NÀY:
1. Khi tư vấn, gợi ý hoặc xây dựng/điều chỉnh thực đơn cho người dùng có bệnh lý, BẮT BUỘC ưu tiên tuân theo các khuyến nghị trong tài liệu này (món nên ăn, món nên hạn chế/tránh, nguyên tắc dinh dưỡng).
2. Nếu một món ăn người dùng nhắc tới thuộc nhóm "nên tránh/hạn chế" theo tài liệu → cảnh báo nhẹ nhàng và đề xuất món thay thế phù hợp.
3. Khi đưa ra lời khuyên dựa trên tài liệu, hãy diễn đạt tự nhiên bằng tiếng Việt, áp dụng vào món ăn Việt Nam cụ thể (không chép nguyên văn tiếng Anh).
4. Tài liệu là kiến thức nền về bệnh lý; vẫn phải kết hợp với mục tiêu calo và macro của người dùng.
5. Nếu tài liệu không đề cập đến điều người dùng hỏi, hãy dùng kiến thức chuyên môn chung như bình thường.
${body}
================================================================
`.trim();
}

export default { retrieveKnowledge, buildKnowledgeSection };
