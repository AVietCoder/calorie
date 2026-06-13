/**
 * knowledge.js — Retrieval layer that lets the AI coach "học" (learn from) the
 * clinical diet documents in scripts/sources (diabetes, gout, fatty liver,
 * high cholesterol, kidney disease, gastrointestinal).
 *
 * This is Retrieval-Augmented Generation (RAG): instead of fine-tuning the
 * model, we retrieve the most relevant passages from the documents at request
 * time and inject them into the prompt as grounded reference material.
 *
 * Two retrieval modes, picked automatically:
 *   1. Disease routing (always on, zero setup, language-independent):
 *      the user's `profile.disease` string is matched against each document's
 *      label list, so a Vietnamese disease name reliably selects the right
 *      English document.
 *   2. Semantic ranking (optional upgrade): if you run
 *      `node scripts/ingest-knowledge.mjs` once, every chunk gets an embedding
 *      vector, and the user's actual message is matched by cosine similarity —
 *      this handles free-form questions and cross-document queries, including
 *      Vietnamese-question vs English-document matching.
 *   When embeddings are absent we fall back to lexical overlap, and when even
 *   that is uninformative (e.g. a Vietnamese question with no embeddings) we
 *   simply inject the routed disease document in reading order.
 *
 * The module is defensive: any failure returns an empty result so the chat
 * flow is never broken by the knowledge layer.
 */

const fs = require("fs");
const path = require("path");

/* ----------------------------------------------------------------------- */
/* Load knowledge base (cached at module level)                            */
/* ----------------------------------------------------------------------- */
let _kb = null;

const CANDIDATE_PATHS = [
  path.join(__dirname, "..", "knowledge", "knowledge-base.json"),
  path.join(process.cwd(), "api", "knowledge", "knowledge-base.json"),
  path.join(process.cwd(), "knowledge", "knowledge-base.json"),
  path.join(process.cwd(), "knowledge-base.json"),
];

function loadKB() {
  if (_kb) return _kb;
  for (const p of CANDIDATE_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        _kb = parsed && Array.isArray(parsed.chunks) ? parsed : { chunks: [] };
        const withEmb = _kb.chunks.filter((c) => Array.isArray(c.embedding)).length;
        console.log(
          `📚 [knowledge] loaded ${_kb.chunks.length} chunks from ${p}` +
            (withEmb ? ` (${withEmb} with embeddings)` : " (keyword mode)")
        );
        return _kb;
      }
    } catch (err) {
      console.warn(`⚠️ [knowledge] failed to read ${p}: ${err.message}`);
    }
  }
  console.warn("⚠️ [knowledge] knowledge-base.json not found; knowledge disabled.");
  _kb = { chunks: [] };
  return _kb;
}

/* ----------------------------------------------------------------------- */
/* Text utilities                                                          */
/* ----------------------------------------------------------------------- */

/** Lowercase + strip Vietnamese diacritics so matching is accent-insensitive. */
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
  return deaccent(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* ----------------------------------------------------------------------- */
/* Disease routing                                                         */
/* ----------------------------------------------------------------------- */

/**
 * Match the free-text `disease` field against each document's label list.
 * Returns the set of disease_keys that apply (may be empty).
 */
function matchDiseaseKeys(diseaseStr, kb) {
  const hay = deaccent(diseaseStr);
  if (!hay) return new Set();

  // Collect the label list per disease_key from the chunks themselves.
  const labelsByKey = new Map();
  for (const c of kb.chunks) {
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
/* Optional embedding of the live query (semantic mode)                    */
/* ----------------------------------------------------------------------- */
let _openai = null;
async function getOpenAI() {
  if (_openai) return _openai;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { default: OpenAI } = await import("openai");
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openai;
  } catch {
    return null;
  }
}

async function embedQuery(text, model) {
  const client = await getOpenAI();
  if (!client) return null;
  try {
    const resp = await client.embeddings.create({
      model: model || "text-embedding-3-small",
      input: String(text).slice(0, 8000),
    });
    return resp.data?.[0]?.embedding || null;
  } catch (err) {
    console.warn(`⚠️ [knowledge] query embedding failed: ${err.message}`);
    return null;
  }
}

/* ----------------------------------------------------------------------- */
/* Main retrieval                                                          */
/* ----------------------------------------------------------------------- */

/**
 * Retrieve the most relevant document passages for this request.
 *
 * @param {Object}  opts
 * @param {string}  opts.message   The user's message / query (Vietnamese is fine).
 * @param {string}  opts.disease   The user's profile.disease string.
 * @param {number}  [opts.topK=6]  Max passages to return.
 * @param {number}  [opts.maxChars=4500] Soft cap on total injected characters.
 * @returns {Promise<{chunks:Array, usedDiseaseKeys:string[], mode:string}>}
 */
async function retrieveKnowledge({
  message = "",
  disease = "",
  topK = 6,
  maxChars = 4500,
} = {}) {
  try {
    const kb = loadKB();
    if (!kb.chunks.length) return { chunks: [], usedDiseaseKeys: [], mode: "empty" };

    const diseaseKeys = matchDiseaseKeys(disease, kb);
    const hasEmbeddings =
      !!kb.embedding_model && kb.chunks.some((c) => Array.isArray(c.embedding));

    // If the user has >1 condition, allow a few more passages.
    const k = Math.min(Math.max(topK, diseaseKeys.size * 4), 12);

    // Candidate pool: routed disease docs if matched, else the whole base.
    const pool = diseaseKeys.size
      ? kb.chunks.filter((c) => diseaseKeys.has(c.disease_key))
      : kb.chunks;

    let ranked = [];
    let mode = "routing_order";

    if (hasEmbeddings) {
      const qText = `${disease ? disease + ". " : ""}${message}`.trim() || disease;
      const qvec = await embedQuery(qText, kb.embedding_model);
      if (qvec) {
        ranked = pool
          .map((c) => ({ c, score: cosine(qvec, c.embedding) }))
          .sort((a, b) => b.score - a.score);
        mode = "semantic";
      }
    }

    if (!ranked.length) {
      // Lexical overlap fallback (works when query shares words with the docs).
      const qTokens = tokenize(`${disease} ${message}`);
      if (qTokens.length) {
        const qset = new Set(qTokens);
        ranked = pool
          .map((c) => {
            const ctoks = tokenize(c.text);
            let hits = 0;
            for (const t of ctoks) if (qset.has(t)) hits++;
            return { c, score: hits / Math.max(8, ctoks.length) };
          })
          .sort((a, b) => b.score - a.score);
        mode = "lexical";
      }
    }

    let picked;
    if (diseaseKeys.size) {
      // We have a disease match: ALWAYS inject that document's guidance.
      // If ranking produced useful scores, lead with the best; otherwise use
      // document order so the section reads coherently.
      const useScores = ranked.length && ranked[0].score > 0;
      const ordered = useScores ? ranked.map((r) => r.c) : pool;
      picked = ordered.slice(0, k);
    } else {
      // No disease match: only inject if we found a genuinely relevant passage
      // (avoid polluting a healthy user's prompt with random disease info).
      const strong = ranked.filter((r) =>
        mode === "semantic" ? r.score >= 0.3 : r.score >= 0.12
      );
      picked = strong.slice(0, k).map((r) => r.c);
      mode = picked.length ? mode : "none";
    }

    // Enforce character budget.
    const out = [];
    let total = 0;
    for (const c of picked) {
      const len = (c.text || "").length;
      if (out.length && total + len > maxChars) break;
      out.push(c);
      total += len;
    }

    return {
      chunks: out,
      usedDiseaseKeys: [...diseaseKeys],
      mode,
    };
  } catch (err) {
    console.warn(`⚠️ [knowledge] retrieveKnowledge error: ${err.message}`);
    return { chunks: [], usedDiseaseKeys: [], mode: "error" };
  }
}

/**
 * Format retrieved chunks into a Vietnamese prompt block telling the model to
 * treat them as authoritative clinical guidance for the user's condition.
 * Returns "" when there is nothing to inject.
 */
function buildKnowledgeSection(result) {
  const chunks = result?.chunks || [];
  if (!chunks.length) return "";

  // Group by document title for readable, source-attributed output.
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

module.exports = {
  retrieveKnowledge,
  buildKnowledgeSection,
};