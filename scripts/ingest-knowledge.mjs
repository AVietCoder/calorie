import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PATH = path.join(__dirname, "..", "knowledge", "knowledge-base.json");
const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const BATCH = 64;

// Build an OpenAI-compatible client. Prefer a self-hosted embedding server
// (a dedicated vLLM instance) via EMBEDDING_BASE_URL; otherwise use OpenAI cloud.
function makeClient() {
  if (process.env.EMBEDDING_BASE_URL) {
    return new OpenAI({
      baseURL: process.env.EMBEDDING_BASE_URL,
      apiKey: process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || "EMPTY",
    });
  }
  if (process.env.OPENAI_API_KEY) {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return null;
}

async function main() {
  const openai = makeClient();
  if (!openai) {
    console.error("❌ No embedding backend configured.");
    console.error("   Set EMBEDDING_BASE_URL (self-hosted vLLM) or OPENAI_API_KEY.");
    process.exit(1);
  }
  if (!fs.existsSync(KB_PATH)) {
    console.error(`❌ Knowledge base not found at ${KB_PATH}`);
    console.error("   Run: python scripts/build-knowledge-base.py");
    process.exit(1);
  }

  const kb = JSON.parse(fs.readFileSync(KB_PATH, "utf-8"));
  const chunks = kb.chunks || [];
  console.log(`📚 Loaded ${chunks.length} chunks. Embedding with ${MODEL}...`);

  let done = 0;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const inputs = slice.map(
      (c) => `[${c.disease_title}] (${c.section}) ${c.text}`
    );
    const resp = await openai.embeddings.create({ model: MODEL, input: inputs });
    resp.data.forEach((d, idx) => {
      slice[idx].embedding = d.embedding;
    });
    done += slice.length;
    console.log(`   embedded ${done}/${chunks.length}`);
  }

  kb.embedding_model = MODEL;
  fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2), "utf-8");
  console.log(`✅ Wrote embeddings to ${KB_PATH}`);
  console.log("   Semantic retrieval is now active in the app.");
}

main().catch((err) => {
  console.error("❌ Ingest failed:", err.message);
  process.exit(1);
});
