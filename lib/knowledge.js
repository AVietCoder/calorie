/**
 * knowledge.js — Retrieval layer for the AI nutrition coach.
 *
 * NO EMBEDDINGS ANYWHERE. Two knowledge sources are combined into ONE
 * unified pool, both searched with native PostgreSQL Full Text Search
 * (tsvector + GIN index + ts_rank — see migrations/fulltext_search.sql):
 *
 *   A. BUILT-IN, disease-routed base — table `kb_base_chunks` (seeded from
 *      knowledge/knowledge-base.json via scripts/seed-base-knowledge.mjs).
 *      Curated docs: diabetes, gout, fatty liver, high cholesterol, kidney,
 *      gastrointestinal. The user's profile.disease gives a routing boost
 *      (additive on the ts_rank score) but never hard-filters the pool.
 *
 *   B. ADMIN-UPLOADED Knowledge Base — Supabase `admin_kb_chunks` (general
 *      PDFs an admin adds via /admin.html). Searched fresh on every request
 *      (no bulk in-memory cache needed — Postgres does the ranking).
 *
 * RETRIEVAL: for each question we call `search_base_kb_chunks` and
 * `search_admin_kb_chunks` (Postgres RPCs, see lib/rag/kb-base-store.js and
 * lib/rag/store.js), merge the results, apply the disease/source routing
 * bonus, sort by score, then trim to `topK` chunks within a character
 * budget. Every path is wrapped so a failure returns an empty result and
 * never breaks the chat flow.
 */

import fs from "fs";
import path from "path";
import { searchAdminChunks } from "./rag/store.js";
import { searchBaseChunks } from "./rag/kb-base-store.js";

const ADMIN_TITLE = "Tài liệu dinh dưỡng bổ sung (quản trị viên tải lên)";

/* Tunables (overridable via env) ----------------------------------------- */
const ROUTE_BONUS = Number(process.env.RAG_ROUTE_BONUS || 0.05); // additive on ts_rank for a matched disease doc
const ADMIN_BONUS = Number(process.env.RAG_ADMIN_BONUS || 0.01);

/* Confidence gate for the STRICT Knowledge-Base mode (see lib/rag/kb-answer.js).
 * Because Postgres only returns a row when `tsv @@ websearch_to_tsquery(...)`
 * actually matched, ANY result is already a genuine full-text hit. The rank
 * floor below is a small extra safety valve against a single, very weak
 * keyword match; tune via env per corpus. */
const KB_MIN_RANK = Number(process.env.RAG_KB_MIN_RANK || 0.01);
const RAG_DEBUG = process.env.RAG_DEBUG === "1";

function rlog(...args) {
  if (RAG_DEBUG) console.log("🔎 [rag]", ...args);
}

export const KB_NOT_FOUND = "Không tìm thấy trong Knowledge Base.";

/* ----------------------------------------------------------------------- */
/* Disease label metadata — used ONLY to route/boost the built-in base     */
/* layer by the user's profile.disease string. Loaded from the same JSON   */
/* file the base layer was seeded from (knowledge/knowledge-base.json).    */
/* This is plain string matching — no embeddings, no network call.         */
/* ----------------------------------------------------------------------- */
let _labelsByKey = null;

const BUNDLE_PATHS = [
  path.join(process.cwd(), "knowledge", "knowledge-base.json"),
  path.join(process.cwd(), "knowledge-base.json"),
];

function loadDiseaseLabels() {
  if (_labelsByKey) return _labelsByKey;
  _labelsByKey = new Map();
  for (const p of BUNDLE_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
        const chunks = Array.isArray(parsed?.chunks) ? parsed.chunks : [];
        for (const c of chunks) {
          if (c.disease_key && !_labelsByKey.has(c.disease_key)) {
            _labelsByKey.set(c.disease_key, (c.labels || []).map(deaccent));
          }
        }
        break;
      }
    } catch (err) {
      console.warn(`⚠️ [knowledge] failed to read ${p}: ${err.message}`);
    }
  }
  return _labelsByKey;
}

/** Lowercase + strip diacritics (Vietnamese-aware) — plain string utility, no embeddings. */
export function deaccent(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Which disease_key(s) does the user's free-text `disease` profile field match? */
function matchDiseaseKeys(diseaseStr) {
  const hay = deaccent(diseaseStr);
  if (!hay) return new Set();
  const labelsByKey = loadDiseaseLabels();
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
  kbOnly = false, // true → search ONLY the admin-uploaded PDFs (Knowledge Base)
} = {}) {
  try {
    const qStr = `${disease ? disease + ". " : ""}${message}`.trim() || disease;
    rlog(`retrieve start: kbOnly=${kbOnly} q="${qStr.slice(0, 80)}"`);

    if (!qStr) {
      return { chunks: [], usedDiseaseKeys: [], mode: "none", source: "none", bestRank: 0 };
    }

    const diseaseKeys = matchDiseaseKeys(disease);
    const wantK = Math.min(Math.max(topK + 4, 8), 20);

    // Pull ranked candidates from Postgres Full Text Search (tsvector+GIN+ts_rank).
    const [adminRows, baseRows] = await Promise.all([
      searchAdminChunks(qStr, wantK),
      kbOnly ? Promise.resolve([]) : searchBaseChunks(qStr, wantK),
    ]);
    rlog(`fts hits: base=${baseRows.length} admin=${adminRows.length}`);

    const adminPool = adminRows.map((r) => ({
      text: r.text,
      source: "admin",
      disease_key: null,
      disease_title: ADMIN_TITLE,
      section: `đoạn ${(r.chunk_index ?? 0) + 1}`,
      rank: (r.rank || 0) + ADMIN_BONUS,
    }));

    const basePool = baseRows.map((r) => ({
      text: r.text,
      source: "base",
      disease_key: r.disease_key,
      disease_title: r.disease_title || "Tài liệu dinh dưỡng theo bệnh lý",
      section: r.section || "",
      rank: (r.rank || 0) + (diseaseKeys.size && diseaseKeys.has(r.disease_key) ? ROUTE_BONUS : 0),
    }));

    const pool = kbOnly ? adminPool : [...basePool, ...adminPool];
    pool.sort((a, b) => b.rank - a.rank);

    if (!pool.length) {
      return {
        chunks: [], usedDiseaseKeys: [...diseaseKeys], mode: "fulltext", source: "none", bestRank: 0,
      };
    }

    /* ---------- Character budget + final selection ---------- */
    const out = [];
    let total = 0;
    let baseTaken = 0;
    let adminTaken = 0;
    let bestRank = 0;
    for (const c of pool) {
      if (out.length >= topK) break;
      const len = (c.text || "").length;
      if (out.length && total + len > maxChars) continue; // skip oversize, keep scanning
      bestRank = Math.max(bestRank, c.rank);
      out.push({ ...c, _rank: c.rank });
      total += len;
      if (c.source === "base") baseTaken++;
      else adminTaken++;
    }

    if (!out.length) {
      return {
        chunks: [], usedDiseaseKeys: [...diseaseKeys], mode: "fulltext", source: "none", bestRank: 0,
      };
    }

    const source = baseTaken && adminTaken ? "base+admin" : adminTaken ? "admin" : "base";
    rlog(`retrieve done: ${out.length} chunks, source=${source}, bestRank=${bestRank.toFixed(4)}`);

    return {
      chunks: out,
      usedDiseaseKeys: [...diseaseKeys],
      mode: "fulltext",
      source,
      bestRank,
    };
  } catch (err) {
    console.warn(`⚠️ [knowledge] retrieveKnowledge error: ${err.message}`);
    return { chunks: [], usedDiseaseKeys: [], mode: "error", source: "error", bestRank: 0 };
  }
}

/**
 * Does a retrieval result contain a chunk we're confident actually answers
 * the question? Because Postgres only returns rows whose tsvector actually
 * matched the query (`tsv @@ websearch_to_tsquery(...)`), any non-empty
 * result is already a genuine full-text hit; the rank floor is a small
 * extra safety net. Used by the strict KB flow to decide between a grounded
 * answer and the "Không tìm thấy trong Knowledge Base." refusal.
 * @param {object} result  A retrieveKnowledge() result.
 * @returns {boolean}
 */
export function kbHasConfidentHit(result) {
  if (!result || !Array.isArray(result.chunks) || !result.chunks.length) return false;
  return (result.bestRank || 0) >= KB_MIN_RANK;
}

/** Expose the active KB confidence threshold (for diagnostics/logging). */
export function kbThresholds() {
  return { minRank: KB_MIN_RANK };
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
Dưới đây là các trích đoạn từ tài liệu y khoa/dinh dưỡng đã được truy hồi (Full Text Search), liên quan trực tiếp đến tình trạng sức khỏe và câu hỏi của người dùng. Đây là NGUỒN ĐÁNG TIN CẬY và được ưu tiên hơn kiến thức chung.

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

/**
 * Build a STRICT, grounded prompt block for Knowledge-Base-only answers.
 * Unlike buildKnowledgeSection (which blends KB context into general coaching),
 * this forbids background knowledge entirely and mandates the not-found reply.
 * @param {object} result   A retrieveKnowledge({ kbOnly:true }) result.
 * @param {object} [opts]
 * @param {"vi"|"en"} [opts.lang="vi"]
 * @returns {string}
 */
export function buildStrictKbSection(result, opts = {}) {
  const lang = opts.lang || "vi";
  const chunks = result?.chunks || [];
  let body = "";
  chunks.forEach((c, i) => {
    const tag = c.section ? `${c.section}` : `đoạn ${i + 1}`;
    body += `\n[${i + 1}] (${tag}) ${c.text}`;
  });

  if (lang === "en") {
    return `
================================================================
KNOWLEDGE BASE PASSAGES (the ONLY allowed source)
================================================================
Answer the user's question using ONLY the passages below, retrieved from the
uploaded documents via full text search. Absolute rules:
1. Use ONLY facts/numbers that appear in these passages. Do NOT use outside or
   background knowledge, and NEVER invent or estimate numbers.
2. If the passages do not contain the specific information asked for, reply with
   EXACTLY this sentence and nothing else: "${KB_NOT_FOUND}".
3. When you give a nutrition value, name the food/section it came from.
4. Be concise and answer in English.
${body}
================================================================`.trim();
  }

  return `
================================================================
TRÍCH ĐOẠN TỪ KNOWLEDGE BASE (NGUỒN DUY NHẤT ĐƯỢC PHÉP DÙNG)
================================================================
Hãy trả lời câu hỏi của người dùng CHỈ dựa trên các trích đoạn dưới đây, được
truy hồi bằng Full Text Search từ tài liệu đã tải lên. Quy tắc bắt buộc:
1. CHỈ dùng dữ kiện/con số xuất hiện trong các trích đoạn này. TUYỆT ĐỐI KHÔNG
   dùng kiến thức nền bên ngoài và KHÔNG được tự bịa hay ước lượng số liệu.
2. Nếu các trích đoạn KHÔNG chứa thông tin cụ thể được hỏi, hãy trả lời DUY NHẤT
   đúng câu sau, không thêm gì khác: "${KB_NOT_FOUND}".
3. Khi đưa ra một giá trị dinh dưỡng, nêu rõ tên thực phẩm/mục mà nó lấy từ đó.
4. Trả lời ngắn gọn bằng tiếng Việt.
${body}
================================================================`.trim();
}

export default {
  retrieveKnowledge,
  buildKnowledgeSection,
  buildStrictKbSection,
  kbHasConfidentHit,
  kbThresholds,
  deaccent,
  KB_NOT_FOUND,
};
