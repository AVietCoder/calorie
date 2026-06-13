/**
 * embeddings.js — Turn text into vectors with OpenAI embeddings.
 *
 * Mirrors the reference project's embed-texts.js, but uses the `openai` SDK
 * the app already depends on (instead of adding @langchain/openai). Model is
 * text-embedding-3-small (1536 dims): cheap, fast, and plenty accurate for
 * short clinical passages. Override with EMBEDDING_MODEL if you ever want
 * text-embedding-3-large.
 */
import OpenAI from "openai";

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "text-embedding-3-small";

let _client = null;
function client() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export function embeddingsAvailable() {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Embed an array of texts. Returns an array of vectors aligned to the input
 * order. Throws if no API key (callers should guard with embeddingsAvailable()).
 * @param {string[]} texts
 * @param {object} [opts]
 * @param {number} [opts.batchSize=64]
 * @returns {Promise<number[][]>}
 */
export async function embedTexts(texts, opts = {}) {
  const c = client();
  if (!c) throw new Error("OPENAI_API_KEY not set");
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
