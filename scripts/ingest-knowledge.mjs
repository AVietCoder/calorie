#!/usr/bin/env node
/**
 * ingest-knowledge.mjs — OPTIONAL one-time upgrade.
 *
 * Adds OpenAI embedding vectors to every chunk in
 * knowledge/knowledge-base.json. After running this, the app's retrieval
 * automatically switches from keyword/disease-routing to full semantic search,
 * which handles free-form questions (e.g. "cá hồi có tốt cho người gút không?")
 * and matches Vietnamese questions against the English source documents.
 *
 * The app works WITHOUT running this (disease routing already injects the right
 * document). Run it only when you want smarter, question-level retrieval.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/ingest-knowledge.mjs
 *
 * Re-run it any time you regenerate the knowledge base
 * (python scripts/build-knowledge-base.py) or add new documents.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PATH = path.join(__dirname, "..", "knowledge", "knowledge-base.json");
const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const BATCH = 64;

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Missing OPENAI_API_KEY environment variable.");
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

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
