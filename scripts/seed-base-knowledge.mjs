#!/usr/bin/env node
/**
 * scripts/seed-base-knowledge.mjs
 *
 * Seeds the built-in disease-routed knowledge base
 * (knowledge/knowledge-base.json) into the Postgres table `kb_base_chunks`
 * so it can be searched with PostgreSQL Full Text Search (tsvector + GIN +
 * ts_rank) — the SAME engine used for admin-uploaded PDFs. No embeddings are
 * computed or stored; this is a plain, idempotent upsert of chunk text.
 *
 * Prerequisites:
 *   1. Run migrations/admin.sql (if not already applied).
 *   2. Run migrations/fulltext_search.sql on the Supabase SQL editor — this
 *      creates the `kb_base_chunks` table, its tsvector/GIN index, and the
 *      `search_base_kb_chunks` RPC this script's data will be queried through.
 *   3. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in your environment.
 *
 * Usage:
 *   node scripts/seed-base-knowledge.mjs
 *
 * Safe to re-run any time (e.g. after regenerating knowledge-base.json with
 * scripts/build-knowledge-base.py) — rows are upserted by their stable `id`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PATH = path.join(__dirname, "..", "knowledge", "knowledge-base.json");
const BATCH_SIZE = 200;

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    fail(
      "Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong môi trường.\n" +
        "   Ví dụ: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-base-knowledge.mjs"
    );
  }
  if (!fs.existsSync(KB_PATH)) {
    fail(`Không tìm thấy ${KB_PATH}. Chạy scripts/build-knowledge-base.py trước, hoặc kiểm tra đường dẫn.`);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const raw = JSON.parse(fs.readFileSync(KB_PATH, "utf-8"));
  const chunks = Array.isArray(raw.chunks) ? raw.chunks : [];
  if (!chunks.length) fail("knowledge-base.json không có chunk nào.");

  console.log(`📚 Nạp ${chunks.length} chunk từ ${path.relative(process.cwd(), KB_PATH)} vào bảng kb_base_chunks…`);

  // Confirm the table/migration exists before we start (clear error message
  // instead of N failed upserts).
  const probe = await supabase.from("kb_base_chunks").select("id", { count: "exact", head: true });
  if (probe.error) {
    fail(
      `Bảng kb_base_chunks chưa sẵn sàng (${probe.error.message}).\n` +
        "   → Hãy chạy migrations/fulltext_search.sql trên Supabase SQL Editor trước."
    );
  }

  const rows = chunks.map((c) => ({
    id: c.id,
    disease_key: c.disease_key || null,
    disease_title: c.disease_title || null,
    section: c.section || null,
    labels: Array.isArray(c.labels) ? c.labels : [],
    source_file: c.source || null,
    text: c.text,
    word_count: c.word_count ?? null,
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("kb_base_chunks").upsert(batch, { onConflict: "id" });
    if (error) fail(`Upsert thất bại ở batch ${i / BATCH_SIZE + 1}: ${error.message}`);
    upserted += batch.length;
    console.log(`   … ${upserted}/${rows.length}`);
  }

  const { count } = await supabase.from("kb_base_chunks").select("id", { count: "exact", head: true });
  console.log(`✅ Xong. kb_base_chunks hiện có ${count ?? "?"} dòng, sẵn sàng cho Full Text Search (tsvector + GIN + ts_rank).`);
}

main().catch((err) => fail(err?.message || String(err)));
