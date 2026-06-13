/**
 * retrieval.js — Hybrid retrieval core for the RAG layer.
 *
 * The previous pipeline used EITHER dense (cosine over embeddings) OR lexical
 * (token-overlap) ranking, picked one, and cut by a hard threshold. That throws
 * away signal: a question may match a passage lexically (same Vietnamese terms)
 * even when the embedding similarity is mediocre, and vice-versa.
 *
 * This module implements a small but real hybrid pipeline — entirely in JS, so
 * it stays compatible with the app's "embeddings stored as JSON in Supabase /
 * cosine in JS" design (no pgvector needed):
 *
 *   1. DENSE   — cosine similarity over OpenAI embeddings (when available).
 *   2. LEXICAL — BM25 over the candidate pool (tf saturation + idf, the same
 *                ranking function search engines use; far better than raw
 *                token-overlap).
 *   3. FUSION  — Reciprocal Rank Fusion (RRF) merges the two rankings into one
 *                robust ordering. RRF is rank-based, so it doesn't need the two
 *                score scales to be comparable.
 *   4. MMR     — Maximal Marginal Relevance re-selects the top-k to maximise
 *                relevance while minimising redundancy (so we don't feed the
 *                LLM three near-duplicate paragraphs).
 *
 * Every function is pure and defensive. Callers can mix chunks that have
 * embeddings with chunks that don't — dense scoring simply skips the latter.
 */

/* --------------------------------------------------------------------- */
/* Text utilities (shared)                                               */
/* --------------------------------------------------------------------- */
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

const STOPWORDS = new Set(
  ("the a an and or of to in on for with without is are be can may should would " +
    "what which how when where why who whom my your our their i you it that this " +
    "these those at as by from do does did eat eaten eating food foods diet meal " +
    "co khong ko nen la cua va hay cho toi minh ban an gi mon nao the nhu duoc " +
    "voi tu khi nhung cac mot hai ba con thi se da dang ve ra vao len xuong").split(" ")
);

export function tokenize(s = "") {
  return deaccent(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export function cosine(a, b) {
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

/* --------------------------------------------------------------------- */
/* BM25 — lexical relevance over the candidate pool                       */
/* --------------------------------------------------------------------- */
/**
 * Build a tiny BM25 index over `docs` and score each against `queryTokens`.
 * Returns an array of scores aligned to `docs` (0 when no lexical signal).
 *
 * @param {Array<{text:string}>} docs
 * @param {string[]} queryTokens  Already tokenized + deaccented query terms.
 * @param {object} [opts]
 * @param {number} [opts.k1=1.5]
 * @param {number} [opts.b=0.75]
 */
export function bm25Scores(docs, queryTokens, opts = {}) {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;
  const N = docs.length;
  if (!N || !queryTokens.length) return new Array(N).fill(0);

  // Per-doc term frequencies + lengths.
  const docTokens = docs.map((d) => tokenize(d.text || ""));
  const docLen = docTokens.map((t) => t.length);
  const avgdl = docLen.reduce((a, c) => a + c, 0) / N || 1;

  const tf = docTokens.map((toks) => {
    const m = new Map();
    for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
    return m;
  });

  // Document frequency for each unique query term.
  const qset = [...new Set(queryTokens)];
  const df = new Map();
  for (const term of qset) {
    let c = 0;
    for (const m of tf) if (m.has(term)) c++;
    df.set(term, c);
  }

  // idf with the BM25+ smoothing variant (always >= 0).
  const idf = new Map();
  for (const term of qset) {
    const n = df.get(term) || 0;
    idf.set(term, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  const scores = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const m = tf[i];
    if (!m.size) continue;
    let s = 0;
    const norm = k1 * (1 - b + (b * docLen[i]) / avgdl);
    for (const term of qset) {
      const f = m.get(term);
      if (!f) continue;
      s += (idf.get(term) || 0) * ((f * (k1 + 1)) / (f + norm));
    }
    scores[i] = s;
  }
  return scores;
}

/* --------------------------------------------------------------------- */
/* Reciprocal Rank Fusion                                                 */
/* --------------------------------------------------------------------- */
/**
 * Merge several ranked index-lists into one fused score per item.
 *
 * @param {number[][]} rankings  Each entry is a list of item-indices, best first.
 * @param {object} [opts]
 * @param {number} [opts.k=60]   RRF dampening constant.
 * @param {number} [opts.size]   Total number of items (to size the output).
 * @param {number[]} [opts.weights]  Optional per-ranking weight.
 * @returns {number[]}  fused score per item index.
 */
export function reciprocalRankFusion(rankings, opts = {}) {
  const k = opts.k ?? 60;
  const size = opts.size ?? Math.max(0, ...rankings.flat().map((i) => i + 1));
  const weights = opts.weights || rankings.map(() => 1);
  const fused = new Array(size).fill(0);
  rankings.forEach((order, r) => {
    const w = weights[r] ?? 1;
    order.forEach((idx, rank) => {
      fused[idx] += w * (1 / (k + rank + 1));
    });
  });
  return fused;
}

/** Indices of `scores` sorted descending, skipping zeros if `dropZero`. */
function rankIndices(scores, dropZero = true) {
  const idx = scores.map((s, i) => i);
  idx.sort((a, b) => scores[b] - scores[a]);
  return dropZero ? idx.filter((i) => scores[i] > 0) : idx;
}

/* --------------------------------------------------------------------- */
/* Maximal Marginal Relevance (diversity-aware re-ranking)                */
/* --------------------------------------------------------------------- */
/**
 * Select up to `k` items balancing relevance and novelty.
 *
 * @param {Array<{embedding?:number[]}>} items  Candidate items (already sorted
 *        best-first is fine but not required).
 * @param {number[]} relevance  Relevance score per item (e.g. fused score).
 * @param {object} [opts]
 * @param {number} [opts.k=6]
 * @param {number} [opts.lambda=0.7]  1 = pure relevance, 0 = pure diversity.
 * @returns {number[]}  selected item indices, in selection order.
 */
export function mmrSelect(items, relevance, opts = {}) {
  const k = Math.min(opts.k ?? 6, items.length);
  const lambda = opts.lambda ?? 0.7;
  if (k <= 0) return [];

  // Normalise relevance to [0,1] so it's comparable to cosine diversity.
  const maxRel = Math.max(1e-9, ...relevance);
  const rel = relevance.map((r) => Math.max(0, r) / maxRel);

  const canDiversify = items.some((it) => Array.isArray(it.embedding) && it.embedding.length);
  if (!canDiversify) {
    // No embeddings → fall back to plain relevance order.
    return rankIndices(rel, false).slice(0, k);
  }

  const selected = [];
  const remaining = new Set(items.map((_, i) => i));

  while (selected.length < k && remaining.size) {
    let best = -1;
    let bestScore = -Infinity;
    for (const i of remaining) {
      let maxSim = 0;
      const ei = items[i].embedding;
      if (Array.isArray(ei)) {
        for (const j of selected) {
          const ej = items[j].embedding;
          if (Array.isArray(ej)) maxSim = Math.max(maxSim, cosine(ei, ej));
        }
      }
      const score = lambda * rel[i] - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best === -1) break;
    selected.push(best);
    remaining.delete(best);
  }
  return selected;
}

/* --------------------------------------------------------------------- */
/* Orchestrator: hybrid rank a pool                                       */
/* --------------------------------------------------------------------- */
/**
 * Rank a candidate pool with dense + lexical + RRF, then MMR-select.
 *
 * @param {object} args
 * @param {Array<{text:string, embedding?:number[]}>} args.pool
 * @param {number[]|null} args.qvec        Query embedding (null → lexical only).
 * @param {string[]} args.qTokens          Tokenized query (for BM25).
 * @param {number} [args.topK=6]
 * @param {number} [args.mmrLambda=0.7]
 * @param {(idx:number)=>number} [args.bonus]  Optional additive fused-score
 *        bonus per pool index (e.g. disease-routing boost).
 * @returns {{ order:number[], fused:number[], dense:number[], lexical:number[], mode:string }}
 */
export function hybridRank(args) {
  const {
    pool,
    qvec = null,
    qTokens = [],
    topK = 6,
    mmrLambda = 0.7,
    bonus = null,
  } = args;

  const N = pool.length;
  if (!N) return { order: [], fused: [], dense: [], lexical: [], mode: "none" };

  // 1) Dense scores (cosine), 0 for chunks without embeddings.
  const hasAnyEmbedding = pool.some((c) => Array.isArray(c.embedding) && c.embedding.length);
  const dense = new Array(N).fill(0);
  if (qvec && hasAnyEmbedding) {
    for (let i = 0; i < N; i++) {
      if (Array.isArray(pool[i].embedding)) dense[i] = cosine(qvec, pool[i].embedding);
    }
  }

  // 2) Lexical (BM25) scores.
  const lexical = bm25Scores(pool, qTokens);

  // 3) Build rank lists + fuse with RRF.
  const rankings = [];
  const weights = [];
  const denseActive = qvec && hasAnyEmbedding;
  const lexActive = qTokens.length > 0;
  if (denseActive) {
    rankings.push(rankIndices(dense));
    weights.push(1.0);
  }
  if (lexActive) {
    rankings.push(rankIndices(lexical));
    weights.push(denseActive ? 0.8 : 1.0); // slightly favour dense when both exist
  }

  let fused;
  let mode;
  if (rankings.length) {
    fused = reciprocalRankFusion(rankings, { k: 60, size: N, weights });
    mode = denseActive && lexActive ? "hybrid" : denseActive ? "semantic" : "lexical";
  } else {
    // No query signal at all → keep pool order.
    fused = pool.map((_, i) => 1 / (i + 1));
    mode = "order";
  }

  // 4) Routing / source bonus (additive on fused score).
  if (typeof bonus === "function") {
    for (let i = 0; i < N; i++) fused[i] += bonus(i) || 0;
  }

  // 5) MMR re-selection for diversity.
  const order = mmrSelect(pool, fused, { k: topK, lambda: mmrLambda });

  return { order, fused, dense, lexical, mode };
}

export default {
  deaccent,
  tokenize,
  cosine,
  bm25Scores,
  reciprocalRankFusion,
  mmrSelect,
  hybridRank,
};
