/**
 * ingest-knowledge.mjs — pre-bake embeddings into knowledge/knowledge-base.json
 * so the built-in disease-routed base layer gets semantic search with ZERO
 * cold-start cost at runtime.
 *
 * It now reuses the app's single embedding implementation (lib/rag/embeddings.js)
 * so it always carries the SAME fix as production — in particular the
 * `encoding_format:"float"` pin that avoids the SDK's base64 round-trip (the
 * root cause of the "resp.data is not iterable" bug and of silent vector
 * corruption against self-hosted float-returning backends).
 *
 * Configure a backend via EMBEDDING_BASE_URL (self-hosted vLLM/embed_server) or
 * OPENAI_API_KEY, then run:  node scripts/ingest-knowledge.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { embedTexts, embeddingsAvailable, embeddingBackendInfo } from "../lib/rag/embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PATH = path.join(__dirname, "..", "knowledge", "knowledge-base.json");

async function main() {
  if (!embeddingsAvailable()) {
    console.error("❌ No embedding backend configured.");
    console.error("   Set EMBEDDING_BASE_URL (self-hosted vLLM/embed_server) or OPENAI_API_KEY.");
    process.exit(1);
  }
  if (!fs.existsSync(KB_PATH)) {
    console.error(`❌ Knowledge base not found at ${KB_PATH}`);
    console.error("   Run: python scripts/build-knowledge-base.py");
    process.exit(1);
  }

  const backend = embeddingBackendInfo();
  const kb = JSON.parse(fs.readFileSync(KB_PATH, "utf-8"));
  const chunks = kb.chunks || [];
  console.log(`📚 Loaded ${chunks.length} chunks. Embedding via ${backend.kind} (${backend.model})...`);

  const inputs = chunks.map((c) => `[${c.disease_title || ""}] (${c.section || ""}) ${c.text || ""}`);
  const t0 = Date.now();
  const vectors = await embedTexts(inputs); // batches + validates + logs internally
  vectors.forEach((v, i) => { chunks[i].embedding = v; });

  kb.embedding_model = backend.model;
  kb.embedding_dim = vectors[0]?.length || null;
  fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2), "utf-8");
  console.log(
    `✅ Wrote ${vectors.length} embeddings (dim=${kb.embedding_dim}) to ${KB_PATH} in ${Date.now() - t0}ms`
  );
  console.log("   Semantic retrieval over the built-in base layer is now pre-baked.");
}

main().catch((err) => {
  console.error("❌ Ingest failed:", err.message);
  process.exit(1);
});
