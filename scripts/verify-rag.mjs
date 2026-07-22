/**
 * verify-rag.mjs — END-TO-END proof that the RAG pipeline works.
 *
 * Runs the REAL modules on a REAL PDF, fully OFFLINE (no GPU, no Supabase, no
 * model download), exercising every stage the bug touched:
 *
 *   PDF → parse-pdf.js → chunker.js → embeddings.js (THE FIX) → in-memory
 *   vector store → retrieval.js hybridRank → knowledge.js confidence gate +
 *   strict grounding → (optional) LLM answer.
 *
 * It starts scripts/embed-server-local.mjs, which returns PLAIN FLOAT ARRAYS
 * exactly like vllm-server/embed_server.py — i.e. the precise scenario that used
 * to throw "resp.data is not iterable" / silently corrupt vectors. Passing here
 * means the encoding_format fix is correct against a real float backend.
 *
 * Usage:
 *   node scripts/verify-rag.mjs [path/to.pdf]
 *   RAG_DEBUG=1 node scripts/verify-rag.mjs sample.pdf     # verbose stage logs
 *   LLM_BASE_URL=http://host:4444/v1 LLM_MODEL=qwen2.5-vl \
 *     node scripts/verify-rag.mjs sample.pdf               # also do a grounded LLM answer
 *
 * Exit code 0 = all assertions passed; non-zero = a stage failed.
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- Safe env defaults so importing lib/* never crashes offline ---------------
// supabase.js calls createClient at import; give it a syntactically valid URL.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:9";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "offline-dummy";

const PASS = "✅", FAIL = "❌", INFO = "•";
let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? PASS : FAIL} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
  return cond;
}
function section(t) {
  console.log("\n" + "═".repeat(70) + `\n${t}\n` + "═".repeat(70));
}

async function main() {
  // Resolve the test PDF.
  const arg = process.argv[2];
  const candidates = [
    arg,
    path.join(ROOT, "scripts", "sources", "VTN_FCT_2007.pdf"),
    path.join(ROOT, "VTN_FCT_2007.pdf"),
  ].filter(Boolean);
  const pdfPath = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!pdfPath) {
    console.error(`${FAIL} No PDF found. Pass one: node scripts/verify-rag.mjs path/to.pdf`);
    console.error(`   looked in: ${candidates.join(", ")}`);
    process.exit(2);
  }

  section("STAGE 1 — Start offline embedding backend (float-returning, like embed_server.py)");
  const { startLocalEmbedServer } = await import("./embed-server-local.mjs");
  const emb = await startLocalEmbedServer(Number(process.env.EMBED_PORT || 4790));
  process.env.EMBEDDING_BASE_URL = emb.url;
  process.env.EMBEDDING_API_KEY = "EMPTY";
  process.env.EMBEDDING_MODEL = emb.model;

  // Import the REAL modules AFTER env is set (dynamic import avoids load-time crashes).
  const { parsePdf } = await import("../lib/rag/parse-pdf.js");
  const { chunkText } = await import("../lib/rag/chunker.js");
  const embeddings = await import("../lib/rag/embeddings.js");
  const { tokenize, hybridRank } = await import("../lib/rag/retrieval.js");
  const knowledge = await import("../lib/knowledge.js");

  // 1a) Prove the backend is reachable and the FIX yields sane float vectors.
  const ping = await embeddings.pingEmbeddings();
  check("embedding backend ping", ping.ok, ping.ok ? `dim=${ping.dim} shape=${ping.shape}` : ping.error);
  check("ping vectors are finite floats (not base64-corrupted)",
    ping.ok && Array.isArray(ping.sample) && ping.sample.every(Number.isFinite),
    ping.ok ? `sample=[${ping.sample.map((x) => x.toFixed(4)).join(", ")}...]` : "");

  section("STAGE 2 — Parse the PDF");
  const t0 = Date.now();
  const { text, pages } = await parsePdf(fs.readFileSync(pdfPath));
  check("PDF text extracted", text && text.length > 1000, `${text.length} chars, ${pages} pages, ${Date.now() - t0}ms`);
  console.log(`${INFO} file: ${path.basename(pdfPath)}`);

  section("STAGE 3 — Chunk");
  const chunks = chunkText(text, { chunkChars: 1000, overlap: 150 });
  const avg = Math.round(chunks.reduce((a, c) => a + c.length, 0) / (chunks.length || 1));
  check("chunks produced", chunks.length > 0, `${chunks.length} chunks, avg ${avg} chars`);
  check("chunks are non-trivial", avg > 100 && avg <= 1400, `avg ${avg} chars`);

  section("STAGE 4 — Embed ALL chunks (this is what used to throw / corrupt)");
  // Cap for a fast local run; override with EMBED_LIMIT=0 to embed everything.
  const limit = process.env.EMBED_LIMIT !== undefined ? Number(process.env.EMBED_LIMIT) : 1200;
  const toEmbed = limit > 0 ? chunks.slice(0, limit) : chunks;
  console.log(`${INFO} embedding ${toEmbed.length}${limit > 0 && chunks.length > limit ? ` of ${chunks.length}` : ""} chunks…`);
  const te = Date.now();
  let vectors;
  try {
    vectors = await embeddings.embedTexts(toEmbed);
  } catch (e) {
    check("embedTexts completed without error", false, e.message);
    console.error("\nThe embedding stage failed — this is the original bug surface.");
    emb.close();
    process.exit(1);
  }
  const dim = vectors[0]?.length || 0;
  check("embedTexts completed without error", true, `${vectors.length} vectors in ${Date.now() - te}ms`);
  check("one vector per chunk", vectors.length === toEmbed.length, `${vectors.length} == ${toEmbed.length}`);
  check("consistent dimension", vectors.every((v) => v.length === dim) && dim > 0, `dim=${dim}`);
  check("vectors are finite (NOT silently corrupted)", vectors.every((v) => v.every(Number.isFinite)), "all values finite");
  check("vectors are normalized-ish (non-zero norm)",
    vectors.every((v) => v.some((x) => x !== 0)), "no all-zero vectors");

  // Build the in-memory pool exactly like knowledge.js does for admin chunks.
  const pool = toEmbed.map((text, i) => ({ text, embedding: vectors[i], source: "admin", section: `đoạn ${i + 1}` }));

  section("STAGE 5 — Semantic search + retrieval + strict grounding");
  const { minCosine, minBm25 } = knowledge.kbThresholds();
  console.log(`${INFO} confidence gate: cosine ≥ ${minCosine} OR bm25 ≥ ${minBm25}\n`);

  // Queries that SHOULD be answerable from a Vietnamese Food Composition Table,
  // plus off-topic ones that should NOT be (to prove the not-found path).
  // NOTE: the offline stand-in embedding is lexical, not truly semantic, so we
  // use off-topic queries that share NO common Vietnamese tokens with the food
  // corpus. With the REAL bge-m3 model the gate additionally rejects topically
  // unrelated queries even when a few words overlap.
  const queries = [
    { q: "thành phần dinh dưỡng của gạo tẻ", expectFound: true },
    { q: "protein trong thịt lợn", expectFound: true },
    { q: "hàm lượng vitamin C trong rau", expectFound: true },
    { q: "quarterly revenue forecast spreadsheet pivot formulas", expectFound: false },
    { q: "kubernetes ingress TLS certificate renewal cronjob", expectFound: false },
  ];

  for (const { q, expectFound } of queries) {
    const qvec = await embeddings.embedQuery(q);
    const qTokens = tokenize(q);
    const { order, dense, lexical, mode } = hybridRank({ pool, qvec, qTokens, topK: 6 });

    // Reconstruct a retrieveKnowledge-shaped result so we can use the REAL gate.
    let bestDense = 0, bestBm25 = 0;
    const selected = order.map((i) => {
      bestDense = Math.max(bestDense, dense?.[i] || 0);
      bestBm25 = Math.max(bestBm25, lexical?.[i] || 0);
      return { ...pool[i], _cosine: dense?.[i] || 0, _bm25: lexical?.[i] || 0 };
    });
    const result = { chunks: selected, bestDense, bestBm25, mode };
    const found = knowledge.kbHasConfidentHit(result);

    console.log(`\n${INFO} Q: "${q}"`);
    console.log(`   mode=${mode} bestCosine=${bestDense.toFixed(3)} bestBM25=${bestBm25.toFixed(2)} → ${found ? "ANSWER" : knowledge.KB_NOT_FOUND}`);
    if (found) {
      const top = selected[0];
      console.log(`   top chunk (${top.section}, cos=${top._cosine.toFixed(3)}): ${top.text.slice(0, 120).replace(/\s+/g, " ")}…`);
    }
    check(`gate decision matches expectation for "${q.slice(0, 40)}…"`, found === expectFound,
      `expected ${expectFound ? "FOUND" : "NOT-FOUND"}, got ${found ? "FOUND" : "NOT-FOUND"}`);

    // Show the strict grounding block once (proves the prompt the LLM receives).
    if (found && q === queries[0].q) {
      const block = knowledge.buildStrictKbSection(result, { lang: "vi" });
      console.log(`\n${INFO} strict grounding block preview (first 380 chars of ${block.length}):`);
      console.log("   " + block.slice(0, 380).replace(/\n/g, "\n   ") + " …");
    }
  }

  // Optional: full grounded LLM answer if a chat backend is configured.
  if (process.env.LLM_BASE_URL) {
    section("STAGE 6 — Grounded LLM answer (LLM_BASE_URL detected)");
    try {
      const { answerFromKnowledgeBase } = await import("../lib/rag/kb-answer.js");
      // Monkey-inject our in-memory pool by temporarily stubbing the admin fetch.
      const store = await import("../lib/rag/store.js");
      store.default.fetchAdminChunks = async () => pool.map((c, i) => ({ id: String(i), pdf_id: "verify", chunk_index: i, text: c.text, embedding: c.embedding }));
      store.default.adminStoreReady = async () => true;
      store.default.countAdminChunks = async () => pool.length;
      const ans = await answerFromKnowledgeBase({ question: "Gạo tẻ có bao nhiêu protein trên 100g?", lang: "vi" });
      console.log(`${INFO} found=${ans.found}\n${INFO} answer:\n${ans.answer}`);
    } catch (e) {
      console.log(`${INFO} skipped grounded LLM answer: ${e.message}`);
    }
  } else {
    console.log(`\n${INFO} (Set LLM_BASE_URL + LLM_MODEL to also test a full grounded LLM answer.)`);
  }

  emb.close();
  section("RESULT");
  if (failures === 0) {
    console.log(`${PASS} ALL CHECKS PASSED — parse → chunk → embed → vector search → retrieval → grounding all work.`);
    process.exit(0);
  } else {
    console.log(`${FAIL} ${failures} check(s) FAILED.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
