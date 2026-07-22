/**
 * embed-server-local.mjs — a tiny, DEPENDENCY-FREE, OpenAI-compatible embedding
 * server for OFFLINE testing (no GPU, no model download).
 *
 * It deliberately mimics the bundled vllm-server/embed_server.py: it returns
 * embeddings as PLAIN FLOAT ARRAYS and honors `encoding_format` ("float" →
 * arrays, "base64" → base64). That makes it perfect for reproducing the exact
 * production scenario that used to break (SDK sending encoding_format:base64
 * against a float-returning server) and for proving the fix end-to-end.
 *
 * The embedding itself is a DETERMINISTIC character-trigram hashing vector,
 * L2-normalized. It is NOT bge-m3 quality — it exists to validate the PIPELINE
 * (parse→chunk→embed→store→cosine search) and the encoding_format fix offline.
 * For real semantic quality, point EMBEDDING_BASE_URL at bge-m3 (vLLM) in prod.
 *
 * Endpoints:
 *   GET  /v1/models
 *   GET  /health
 *   POST /v1/embeddings   body: {"input": str|str[], "model": str, "encoding_format"?: "float"|"base64"}
 *
 * Env: EMBED_PORT (default 4790), EMBED_DIM (default 256), EMBED_SERVED_NAME (default bge-m3-local)
 */
import http from "http";

const PORT = Number(process.env.EMBED_PORT || 4790);
const DIM = Number(process.env.EMBED_DIM || 1024); // matches bge-m3's real dim
const SERVED = process.env.EMBED_SERVED_NAME || "bge-m3-local";

/** Deterministic FNV-1a hash → uint32. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Normalize text like the app's retrieval layer (deaccent + lowercase). */
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Character-trigram hashing embedding, L2-normalized → number[DIM]. */
function embed(text) {
  const v = new Float64Array(DIM);
  const t = ` ${norm(text)} `;
  // word unigrams + character trigrams give a decent lexical-semantic signal
  for (const w of t.split(" ").filter(Boolean)) {
    const idx = fnv1a("w:" + w) % DIM;
    v[idx] += 2.0; // whole-word match weighs more
  }
  for (let i = 0; i < t.length - 2; i++) {
    const g = t.slice(i, i + 3);
    if (g.trim().length < 2) continue;
    const idx = fnv1a("g:" + g) % DIM;
    v[idx] += 1.0;
  }
  let n = 0;
  for (let i = 0; i < DIM; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

function floatsToBase64(floats) {
  return Buffer.from(new Float32Array(floats).buffer).toString("base64");
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "GET" && req.url.startsWith("/health")) return send(200, { status: "ok", model: SERVED, dim: DIM });
  if (req.method === "GET" && req.url.startsWith("/v1/models"))
    return send(200, { object: "list", data: [{ id: SERVED, object: "model", owned_by: "local" }] });

  if (req.method === "POST" && req.url.startsWith("/v1/embeddings")) {
    let body;
    try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return send(400, { error: "bad json" }); }
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    const useB64 = body.encoding_format === "base64";
    const data = inputs.map((text, i) => {
      const vec = embed(text);
      return { object: "embedding", index: i, embedding: useB64 ? floatsToBase64(vec) : vec };
    });
    return send(200, { object: "list", data, model: body.model || SERVED, usage: { prompt_tokens: 0, total_tokens: 0 } });
  }

  send(404, { error: "not found" });
});

export function startLocalEmbedServer(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`🧪 [embed-server-local] up on http://localhost:${port}/v1 (model=${SERVED}, dim=${DIM})`);
      resolve({ port, url: `http://localhost:${port}/v1`, model: SERVED, close: () => server.close() });
    });
  });
}

// Run standalone: `node scripts/embed-server-local.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  startLocalEmbedServer();
}

export default { startLocalEmbedServer };
