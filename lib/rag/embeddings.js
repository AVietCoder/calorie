/**
 * embeddings.js — Turn text into vectors for semantic RAG.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ROOT-CAUSE FIX (bug: "resp.data is not iterable")
 * ─────────────────────────────────────────────────────────────────────────
 *  The `openai` SDK v6 changed `embeddings.create()` so that, WHEN THE CALLER
 *  DOES NOT PASS `encoding_format`, it silently sends `encoding_format:"base64"`
 *  to the server and then base64-decodes the reply on the client
 *  (see https://github.com/openai/openai-node/pull/1312).
 *
 *  That assumes the server obeys OpenAI-cloud's exact base64 contract. Our
 *  self-hosted embedding backends (vLLM `--task embed`, the bundled
 *  vllm-server/embed_server.py, HF TEI, or any reverse proxy) return PLAIN
 *  FLOAT ARRAYS. The mismatch produced BOTH failure modes we saw:
 *
 *    (a) `TypeError: resp.data is not iterable` — when the returned body shape
 *        isn't the exact {data:[{embedding:<base64 str>}]} the SDK's decoder
 *        expects, `resp.data` ends up undefined and the `for..of` throws; and
 *    (b) SILENT CORRUPTION — when the backend returns float arrays, the SDK
 *        base64-decodes those floats-as-bytes and hands back garbage vectors,
 *        so semantic search "works" but returns nonsense (no error at all).
 *
 *  THE FIX: always pass `encoding_format:"float"` so the SDK returns the raw
 *  float arrays untouched (no base64 round-trip). This is universally supported
 *  by OpenAI cloud AND every OpenAI-compatible self-hosted server. On top of
 *  that we parse the response DEFENSIVELY (accept float[]/base64-string and a
 *  couple of alternate body shapes) and validate vector dimensions, so a
 *  quirky backend can never again corrupt vectors or crash the upload.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  How to provide embeddings (checked in this order):
 *
 *   1) SELF-HOSTED (recommended, fully local): a vLLM/embed server, e.g.
 *        EMBEDDING_BASE_URL=http://103.73.232.112:3333/v1
 *        EMBEDDING_API_KEY=EMPTY            (or your --api-key token)
 *        EMBEDDING_MODEL=bge-m3
 *   2) OPENAI CLOUD (fallback): set OPENAI_API_KEY (+ optional EMBEDDING_MODEL).
 *   3) NOTHING SET -> embeddingsAvailable() === false -> RAG uses keyword search.
 *
 *  Debugging: set RAG_DEBUG=1 (or EMBEDDING_DEBUG=1) for per-batch stage logs.
 *  Failures are ALWAYS logged regardless of the flag.
 */
import OpenAI from "openai";

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "text-embedding-3-small";

const DEBUG = process.env.RAG_DEBUG === "1" || process.env.EMBEDDING_DEBUG === "1";
const DEFAULT_BATCH = Number(process.env.EMBEDDING_BATCH_SIZE || 64);
const MAX_INPUT_CHARS = Number(process.env.EMBEDDING_MAX_INPUT_CHARS || 8000);

function dbg(...args) {
  if (DEBUG) console.log("🔎 [embeddings]", ...args);
}

let _client = null;
let _backendKind = "none";

function client() {
  if (_client) return _client;

  // 1) Self-hosted embedding server (a dedicated vLLM / embed_server.py).
  if (process.env.EMBEDDING_BASE_URL) {
    _backendKind = "self-hosted";
    _client = new OpenAI({
      baseURL: process.env.EMBEDDING_BASE_URL,
      apiKey:
        process.env.EMBEDDING_API_KEY ||
        process.env.LLM_API_KEY ||
        "EMPTY",
    });
    dbg(`backend=self-hosted url=${process.env.EMBEDDING_BASE_URL} model=${EMBEDDING_MODEL}`);
    return _client;
  }

  // 2) Fall back to OpenAI cloud if a key is present.
  if (process.env.OPENAI_API_KEY) {
    _backendKind = "openai-cloud";
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    dbg(`backend=openai-cloud model=${EMBEDDING_MODEL}`);
    return _client;
  }

  // 3) Nothing configured.
  _backendKind = "none";
  return null;
}

export function embeddingsAvailable() {
  return !!(process.env.EMBEDDING_BASE_URL || process.env.OPENAI_API_KEY);
}

/** A short human-readable description of the active backend (for logs/whoami). */
export function embeddingBackendInfo() {
  const on = embeddingsAvailable();
  return {
    available: on,
    kind: on ? (process.env.EMBEDDING_BASE_URL ? "self-hosted" : "openai-cloud") : "none",
    base_url: process.env.EMBEDDING_BASE_URL || (process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : null),
    model: EMBEDDING_MODEL,
  };
}

/* ------------------------------------------------------------------ */
/* Defensive response parsing                                          */
/* ------------------------------------------------------------------ */

/** Decode a base64-encoded little-endian float32 buffer into a number[]. */
function base64ToFloats(b64) {
  const buf = Buffer.from(b64, "base64");
  // Guard: length must be a multiple of 4 for float32.
  const usable = buf.byteLength - (buf.byteLength % 4);
  return Array.from(
    new Float32Array(buf.buffer, buf.byteOffset, usable / Float32Array.BYTES_PER_ELEMENT)
  );
}

/**
 * Coerce a single "embedding" field into a number[]. Accepts:
 *   - number[]                         (self-hosted float servers, our default)
 *   - base64 string                    (OpenAI base64 encoding)
 *   - { data: number[] } / { embedding: number[] }  (rare wrappers)
 * Returns null if it can't be interpreted as a numeric vector.
 */
function coerceEmbedding(emb) {
  if (Array.isArray(emb)) {
    // Could be number[] or (very rare) [[...]] — flatten one level if needed.
    if (emb.length && Array.isArray(emb[0])) emb = emb[0];
    const v = emb.map(Number);
    return v.every(Number.isFinite) ? v : null;
  }
  if (typeof emb === "string") {
    try {
      const v = base64ToFloats(emb);
      return v.length ? v : null;
    } catch {
      return null;
    }
  }
  if (emb && typeof emb === "object") {
    if (Array.isArray(emb.embedding)) return coerceEmbedding(emb.embedding);
    if (Array.isArray(emb.data)) return coerceEmbedding(emb.data);
  }
  return null;
}

/**
 * Extract an aligned array of vectors from any reasonable embeddings response.
 * Supported shapes:
 *   { data: [ { embedding }, ... ] }     ← OpenAI / vLLM / embed_server.py
 *   { data: [ [..floats..], ... ] }      ← some servers put raw arrays in data
 *   { embeddings: [ [..], ... ] }        ← HF TEI-style
 *   [ [..], ... ]                        ← bare array
 * Returns { vectors, shape } or throws a *descriptive* error.
 */
function extractVectors(resp, expected) {
  let rows = null;
  let shape = "unknown";

  if (resp && Array.isArray(resp.data)) {
    shape = "data[]";
    rows = resp.data.map((r) => coerceEmbedding(r && r.embedding !== undefined ? r.embedding : r));
  } else if (resp && Array.isArray(resp.embeddings)) {
    shape = "embeddings[]";
    rows = resp.embeddings.map(coerceEmbedding);
  } else if (Array.isArray(resp)) {
    shape = "bare[]";
    rows = resp.map(coerceEmbedding);
  }

  if (!rows) {
    const keys = resp && typeof resp === "object" ? Object.keys(resp).join(",") : typeof resp;
    throw new Error(
      `unrecognized embeddings response shape (keys=[${keys}]); ` +
        `expected {data:[{embedding}]}. Backend=${_backendKind}, model=${EMBEDDING_MODEL}.`
    );
  }

  const badIdx = rows.findIndex((v) => !Array.isArray(v) || v.length === 0);
  if (badIdx !== -1) {
    throw new Error(
      `embedding #${badIdx} could not be parsed into a numeric vector ` +
        `(got ${JSON.stringify(rows[badIdx])?.slice(0, 60)}). Backend=${_backendKind}.`
    );
  }

  if (typeof expected === "number" && expected > 0) {
    const mismatch = rows.findIndex((v) => v.length !== expected);
    if (mismatch !== -1) {
      throw new Error(
        `inconsistent embedding dimension: #${mismatch} has ${rows[mismatch].length} dims, expected ${expected}.`
      );
    }
  }
  return { vectors: rows, shape };
}

/* ------------------------------------------------------------------ */
/* Low-level call (with the encoding_format:"float" fix)               */
/* ------------------------------------------------------------------ */
async function rawEmbed(c, input) {
  // *** THE FIX ***: force float encoding so the SDK does NOT base64-round-trip.
  return c.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
    encoding_format: "float",
  });
}

/**
 * Embed an array of texts. Returns an array of vectors aligned to the input
 * order. Throws (with a descriptive message) if no backend is configured or a
 * batch fails — callers should guard with embeddingsAvailable().
 * @param {string[]} texts
 * @param {object} [opts]
 * @param {number} [opts.batchSize]
 * @returns {Promise<number[][]>}
 */
export async function embedTexts(texts, opts = {}) {
  const c = client();
  if (!c) throw new Error("No embedding backend configured (set EMBEDDING_BASE_URL or OPENAI_API_KEY)");

  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const inputs = (texts || []).map((t) => String(t || "").slice(0, MAX_INPUT_CHARS));
  const out = [];
  let dim = 0;
  const t0 = Date.now();

  dbg(`embedTexts: ${inputs.length} texts, batchSize=${batchSize}, model=${EMBEDDING_MODEL}`);

  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const bt = Date.now();
    const resp = await rawEmbed(c, batch);
    const { vectors, shape } = extractVectors(resp, dim || undefined);
    if (!dim && vectors[0]) dim = vectors[0].length;
    for (const v of vectors) out.push(v);
    dbg(
      `  batch ${i / batchSize + 1}: ${batch.length} in → ${vectors.length} vecs, ` +
        `dim=${dim}, shape=${shape}, ${Date.now() - bt}ms`
    );
  }

  if (out.length !== inputs.length) {
    throw new Error(`embedTexts: expected ${inputs.length} vectors, got ${out.length}`);
  }
  dbg(`embedTexts done: ${out.length} vectors, dim=${dim}, total ${Date.now() - t0}ms`);
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
    const resp = await rawEmbed(c, String(text || "").slice(0, MAX_INPUT_CHARS));
    const { vectors } = extractVectors(resp);
    return vectors[0] || null;
  } catch (err) {
    console.warn(`⚠️ [embeddings] query embed failed: ${err.message}`);
    return null;
  }
}

/**
 * Self-diagnostic: embed a tiny probe and report what came back. Use this to
 * verify a backend is wired correctly BEFORE running a big upload. Never throws
 * — returns a structured result you can log or surface in /admin whoami.
 * @returns {Promise<{ok:boolean, dim?:number, shape?:string, sample?:number[], backend:object, error?:string}>}
 */
export async function pingEmbeddings() {
  const backend = embeddingBackendInfo();
  const c = client();
  if (!c) return { ok: false, backend, error: "no backend configured" };
  try {
    const resp = await rawEmbed(c, ["ping: thành phần dinh dưỡng"]);
    const { vectors, shape } = extractVectors(resp);
    const v = vectors[0] || [];
    const result = {
      ok: true,
      dim: v.length,
      shape,
      sample: v.slice(0, 4),
      backend,
    };
    console.log(
      `✅ [embeddings] ping OK — backend=${backend.kind} model=${backend.model} ` +
        `dim=${result.dim} shape=${shape} sample=[${result.sample.map((x) => x.toFixed(4)).join(", ")}...]`
    );
    return result;
  } catch (err) {
    console.error(`❌ [embeddings] ping FAILED — backend=${backend.kind} model=${backend.model}: ${err.message}`);
    return { ok: false, backend, error: err.message };
  }
}

export default {
  embedTexts,
  embedQuery,
  pingEmbeddings,
  embeddingsAvailable,
  embeddingBackendInfo,
  EMBEDDING_MODEL,
};
