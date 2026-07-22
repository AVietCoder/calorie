-- ============================================================
--  RAG / Embedding observability — OPTIONAL but recommended.
--  Run once on the Supabase SQL Editor. Safe & idempotent:
--  only ADDS nullable columns to admin_pdfs, touches nothing else.
--
--  These columns let /admin and the upload logs show, per PDF:
--    embedding_model  — which model produced the vectors (e.g. 'bge-m3')
--    embedding_dim    — vector dimension actually stored (e.g. 1024)
--    embedding_error  — the exact error if embedding failed (NULL if ok)
--
--  The app writes them "best-effort": if you skip this migration the
--  upload pipeline still works — it just can't display these diagnostics.
-- ============================================================

alter table public.admin_pdfs
  add column if not exists embedding_model text;

alter table public.admin_pdfs
  add column if not exists embedding_dim integer;

alter table public.admin_pdfs
  add column if not exists embedding_error text;

-- Handy index to quickly find PDFs whose embeddings failed.
create index if not exists admin_pdfs_embedding_error_idx
  on public.admin_pdfs (embedding_error)
  where embedding_error is not null;
