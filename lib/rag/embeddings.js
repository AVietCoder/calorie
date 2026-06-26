/**
 * embeddings.js — Turn text into vectors for semantic RAG.
 *
 * Embeddings are OPTIONAL. The bundled knowledge base ships without vectors and
 * the retrieval layer falls back to keyword/lexical search when no embedding
 * backend is configured — so the app works fine even with embeddings off.
 *
 * Three ways to provide embeddings (checked in this order):
 *
 *   1) SELF-HOSTED (recommended, fully local): run a SECOND vLLM instance that
 *      serves an embedding model, then set:
 *        EMBEDDING_BASE_URL=http://103.73.232.112:4445/v1
 *        EMBEDDING_API_KEY=EMPTY            (or your --api-key token)
 *        EMBEDDING_MODEL=bge-m3             (the --served-model-name you used)
 *
 *   2) OPENAI CLOUD (opt-in only): set BOTH EMBEDDING_PROVIDER=openai AND
 *      OPENAI_API_KEY. Without EMBEDDING_PROVIDER=openai, OpenAI is NEVER called
 *      (a leftover OPENAI_API_KEY cannot consume tokens).
 *
 *   3) NOTHING SET -> embeddingsAvailable() === false -> RAG uses keyword search.
 *
 * NOTE: a chat/vision vLLM instance does NOT serve /v1/embeddings. If you want
 * semantic RAG you must run a separate embedding model (see option 1). We
 * deliberately do NOT reuse LLM_BASE_URL here for that reason.
 */
import OpenAI from "openai";

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "text-embedding-3-small";

let _client = null;

// OpenAI cloud embeddings are now STRICTLY OPT-IN. They are used only if you
// explicitly set EMBEDDING_PROVIDER=openai. This guarantees that a leftover
// OPENAI_API_KEY in the environment can NEVER silently consume OpenAI tokens.
const openaiOptIn = () =>
  (process.env.EMBEDDING_PROVIDER || "").toLowerCase() === "openai" &&
  !!process.env.OPENAI_API_KEY;

function client() {
  if (_client) return _client;

  // 1) Self-hosted embedding server (a dedicated vLLM instance) — preferred.
  if (process.env.EMBEDDING_BASE_URL) {
    _client = new OpenAI({
      baseURL: process.env.EMBEDDING_BASE_URL,
      apiKey:
        process.env.EMBEDDING_API_KEY ||
        process.env.LLM_API_KEY ||
        "EMPTY",
    });
    return _client;
  }

  // 2) OpenAI cloud — ONLY when explicitly opted in.
  if (openaiOptIn()) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _client;
  }

  // 3) Nothing configured -> RAG falls back to keyword search (0 OpenAI tokens).
  return null;
}

export function embeddingsAvailable() {
  return !!(process.env.EMBEDDING_BASE_URL || openaiOptIn());
}

/**
 * Embed an array of texts. Returns an array of vectors aligned to the input
 * order. Throws if no backend is configured (callers should guard with
 * embeddingsAvailable()).
 * @param {string[]} texts
 * @param {object} [opts]
 * @param {number} [opts.batchSize=64]
 * @returns {Promise<number[][]>}
 */
export async function embedTexts(texts, opts = {}) {
  const c = client();
  if (!c) throw new Error("No embedding backend configured (set EMBEDDING_BASE_URL or OPENAI_API_KEY)");
  const batchSize = opts.batchSize ?? 64;
  const inputs = texts.map((t) => String(t || "").slice(0, 8000));
  const out = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const resp = await c.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    for (const row of resp.data) out.push(row.embedding);
  }
  return out;
}

/**
 * Embed a single query string. Returns the vector, or null on any failure
 * (so retrieval can gracefully fall back to keyword routing).
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
export async function embedQuery(text) {
  const c = client();
  if (!c) return null;
  try {
    const resp = await c.embeddings.create({
      model: EMBEDDING_MODEL,
      input: String(text || "").slice(0, 8000),
    });
    return resp.data?.[0]?.embedding || null;
  } catch (err) {
    console.warn(`⚠️ [embeddings] query embed failed: ${err.message}`);
    return null;
  }
}

export default { embedTexts, embedQuery, embeddingsAvailable, EMBEDDING_MODEL };
