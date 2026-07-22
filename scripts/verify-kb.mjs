#!/usr/bin/env node
/**
 * scripts/verify-kb.mjs
 *
 * End-to-end smoke test for the Knowledge Base pipeline — NO EMBEDDINGS
 * ANYWHERE. Verifies:
 *
 *   Stage 1 (offline, always runs): chunker.js produces sane chunks from
 *            sample text — no network/DB needed.
 *   Stage 2 (online, needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY): inserts
 *            a throwaway PDF + chunks, confirms PostgreSQL Full Text Search
 *            (tsvector + GIN + ts_rank, via the search_admin_kb_chunks RPC)
 *            actually finds it back by a real keyword — proof the migration
 *            in migrations/fulltext_search.sql is applied and working — then
 *            deletes the test row.
 *
 * Usage:
 *   node scripts/verify-kb.mjs   # offline-only (chunker check)
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-kb.mjs
 */
import { chunkText } from "../lib/rag/chunker.js";

const SAMPLE_TEXT = `
Che do an cho nguoi tieu duong tuyp 2 can uu tien thuc pham co chi so duong
huyet thap, giau chat xo, han che duong tinh luyen va tinh bot trang.

Nen an: rau xanh, ca, uc ga, gao lut, yen mach, cac loai dau.
Nen tranh: nuoc ngot co gas, banh keo, com trang an qua nhieu, do chien ran.

Nguoi benh gout can han che thuc pham giau purin nhu noi tang dong vat, hai
san co vo, thit do, va tuyet doi tranh ruou bia. Nen uong nhieu nuoc loc va
an nhieu rau xanh, trai cay it duong.
`.repeat(8); // long enough to force multiple chunks

let failed = 0;
function ok(label, cond, extra) {
  const extraText = extra ? " - " + extra : "";
  console.log((cond ? "OK  " : "FAIL") + " " + label + extraText);
  if (!cond) failed++;
}

async function stage1_chunker() {
  console.log("\n-- Stage 1: chunker.js (offline) --");
  const chunks = chunkText(SAMPLE_TEXT, { chunkChars: 400, overlap: 60 });
  ok("chunkText() returns an array", Array.isArray(chunks));
  ok("chunkText() produced multiple chunks", chunks.length > 1, chunks.length + " chunk(s)");
  const maxLen = chunks.length ? Math.max(...chunks.map((c) => c.length)) : 0;
  ok("every chunk is within a reasonable size", chunks.every((c) => c.length > 0 && c.length <= 500), "max len = " + maxLen);
  return chunks;
}

async function stage2_postgresFts(chunks) {
  console.log("\n-- Stage 2: PostgreSQL Full Text Search (online) --");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("SKIP: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
    console.log("This is NOT a failure -- it just means the Postgres stage was not checked.");
    return;
  }

  const { createPdf, insertChunks, deletePdf, searchAdminChunks } = await import("../lib/rag/store.js");

  let pdf;
  try {
    pdf = await createPdf({
      file_name: "__verify-kb-test__.pdf",
      file_size: 0,
      uploaded_by: null,
      uploaded_by_email: "verify-kb-script",
      status: "ready",
    });
    ok("createPdf() inserted a test row", !!pdf?.id);

    const { inserted } = await insertChunks(pdf.id, chunks);
    ok("insertChunks() stored the test chunks", inserted === chunks.length, inserted + "/" + chunks.length);

    // A phrase that genuinely appears in SAMPLE_TEXT (unaccented, matches the
    // 'simple' tsvector config) -- proves real matching, not a coincidence.
    const results = await searchAdminChunks("tieu duong purin", 10);
    const hitOurPdf = results.some((r) => r.pdf_id === pdf.id);
    ok(
      "search_admin_kb_chunks RPC (tsvector+GIN+ts_rank) found the test chunk",
      hitOurPdf,
      results.length + " result(s) total"
    );
    if (results.length) {
      const top = results[0];
      ok("results are ranked (ts_rank present)", typeof top.rank === "number", "rank=" + top.rank);
    }
  } finally {
    if (pdf?.id) {
      await deletePdf(pdf.id); // cascades to admin_kb_chunks
      console.log("Cleaned up test data.");
    }
  }
}

(async () => {
  console.log("Checking Knowledge Base pipeline (no embeddings anywhere)...");
  const chunks = await stage1_chunker();
  await stage2_postgresFts(chunks);

  console.log(
    failed
      ? "\n" + failed + " check(s) FAILED."
      : "\nAll available checks PASSED. No embeddings were used."
  );
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error("Error while running verify-kb:", err);
  process.exit(1);
});
