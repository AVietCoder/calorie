-- ============================================================
--  fulltext_search.sql
--  Refactor: remove ALL embedding/vector dependencies and replace
--  the Knowledge Base retrieval engine with native PostgreSQL
--  Full Text Search (tsvector + GIN index + ts_rank).
--
--  Run this ONCE on the Supabase SQL Editor, AFTER migrations/admin.sql
--  (and, if you ever ran it, after migrations/rag_embedding_observability.sql).
--  Safe & idempotent — every statement uses IF EXISTS / IF NOT EXISTS.
--
--  What this does:
--   1) Drops every embedding/vector column and the pgvector extension
--      (BGE-M3 / OpenAI / Lovable embeddings are no longer stored anywhere).
--   2) Adds a generated `tsv` tsvector column + GIN index to
--      `admin_kb_chunks` (the admin-uploaded PDF Knowledge Base).
--   3) Creates `kb_base_chunks` — the built-in disease-routed knowledge
--      (diabetes/gout/fatty-liver/etc.) now lives in Postgres too, so the
--      WHOLE knowledge system (uploaded PDFs + built-in docs) is searched
--      the same way: tsvector + GIN + ts_rank. No JS-side vector math.
--   4) Creates two RPC functions the app calls via supabase.rpc(...):
--        search_admin_kb_chunks(query_text, match_count)
--        search_base_kb_chunks(query_text, match_count)
--      Both use `websearch_to_tsquery('simple', query_text)` (robust to
--      free-form user questions) and rank matches with ts_rank().
--
--  Text-search config: we use 'simple' (lowercasing + tokenizing, NO
--  stemming) rather than 'english'/'vietnamese' — Postgres ships no
--  Vietnamese dictionary out of the box, and running English stemming
--  over Vietnamese text corrupts matches. 'simple' works correctly for
--  Vietnamese AND English content with zero extra extensions.
-- ============================================================

-- ------------------------------------------------------------------
-- 0) Remove pgvector entirely (defensive — safe even if never installed).
-- ------------------------------------------------------------------
drop extension if exists vector cascade;

-- ------------------------------------------------------------------
-- 1) admin_kb_chunks — drop embedding column, add tsvector + GIN index.
-- ------------------------------------------------------------------
alter table public.admin_kb_chunks
  drop column if exists embedding;

alter table public.admin_kb_chunks
  add column if not exists tsv tsvector
  generated always as (to_tsvector('simple', coalesce(text, ''))) stored;

create index if not exists admin_kb_chunks_tsv_idx
  on public.admin_kb_chunks using gin (tsv);

-- ------------------------------------------------------------------
-- 2) admin_pdfs — drop embedding diagnostic columns (no longer produced).
-- ------------------------------------------------------------------
alter table public.admin_pdfs drop column if exists embedding_count;
alter table public.admin_pdfs drop column if exists embedding_model;
alter table public.admin_pdfs drop column if exists embedding_dim;
alter table public.admin_pdfs drop column if exists embedding_error;

-- ------------------------------------------------------------------
-- 3) foods — drop the old "C-semantic" embedding column
--    (semantic food-name matching used embeddings; now exact-match only).
-- ------------------------------------------------------------------
alter table public.foods drop column if exists embedding;

-- ------------------------------------------------------------------
-- 4) kb_base_chunks — the built-in disease-routed knowledge base
--    (previously shipped only as knowledge/knowledge-base.json + in-memory
--    JS ranking). Seed it with `node scripts/seed-base-knowledge.mjs`.
--    id is TEXT (not uuid) so it can reuse the stable ids already present
--    in knowledge-base.json (e.g. "diabetes-000"), making re-seeding an
--    idempotent upsert.
-- ------------------------------------------------------------------
create table if not exists public.kb_base_chunks (
  id            text primary key,
  disease_key   text,
  disease_title text,
  section       text,
  labels        text[] not null default '{}',
  source_file   text,
  text          text not null,
  word_count    integer,
  created_at    timestamptz not null default now()
);

alter table public.kb_base_chunks
  add column if not exists tsv tsvector
  generated always as (to_tsvector('simple', coalesce(text, ''))) stored;

create index if not exists kb_base_chunks_tsv_idx
  on public.kb_base_chunks using gin (tsv);

create index if not exists kb_base_chunks_disease_idx
  on public.kb_base_chunks (disease_key);

-- Read-only reference data (curated diet documents) — safe to expose to any
-- authenticated caller; only the service role (server) ever writes to it.
alter table public.kb_base_chunks enable row level security;

drop policy if exists "read kb_base_chunks" on public.kb_base_chunks;
create policy "read kb_base_chunks" on public.kb_base_chunks
  for select using (true);

-- ------------------------------------------------------------------
-- 5) RPC — Full Text Search over the admin-uploaded PDF Knowledge Base.
--    This is what api/kb-query.js and the chat coach call for every
--    question: GIN-indexed tsvector match, ranked by ts_rank.
-- ------------------------------------------------------------------
drop function if exists public.search_admin_kb_chunks(text, integer);

create or replace function public.search_admin_kb_chunks(
  query_text text,
  match_count integer default 10
)
returns table (
  id uuid,
  pdf_id uuid,
  chunk_index integer,
  text text,
  rank real
)
language sql
stable
as $$
  select c.id, c.pdf_id, c.chunk_index, c.text,
         ts_rank(c.tsv, websearch_to_tsquery('simple', query_text))::real as rank
  from public.admin_kb_chunks c
  where coalesce(trim(query_text), '') <> ''
    and c.tsv @@ websearch_to_tsquery('simple', query_text)
  order by rank desc
  limit greatest(coalesce(match_count, 10), 1);
$$;

-- ------------------------------------------------------------------
-- 6) RPC — Full Text Search over the built-in disease-routed base layer.
--    kb_base_chunks.id is TEXT (e.g. "diabetes-004"), not a uuid, so this
--    function returns `id text` — drop first in case an older, differently
--    typed version of this function already exists (CREATE OR REPLACE
--    cannot change a function's return type).
-- ------------------------------------------------------------------
drop function if exists public.search_base_kb_chunks(text, integer);

create or replace function public.search_base_kb_chunks(
  query_text text,
  match_count integer default 12
)
returns table (
  id text,
  disease_key text,
  disease_title text,
  section text,
  text text,
  rank real
)
language sql
stable
as $$
  select b.id, b.disease_key, b.disease_title, b.section, b.text,
         ts_rank(b.tsv, websearch_to_tsquery('simple', query_text))::real as rank
  from public.kb_base_chunks b
  where coalesce(trim(query_text), '') <> ''
    and b.tsv @@ websearch_to_tsquery('simple', query_text)
  order by rank desc
  limit greatest(coalesce(match_count, 12), 1);
$$;

-- ============================================================
-- Done. After running this:
--   1. Re-upload any existing PDFs is NOT required — old chunks keep their
--      `text` and immediately become searchable (the tsv column backfills
--      automatically for existing rows since it's a generated column).
--   2. Seed the built-in disease knowledge base into Postgres:
--        node scripts/seed-base-knowledge.mjs
--   3. No embedding server, API key, or vector extension is needed anywhere.
-- ============================================================
