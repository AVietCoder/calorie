-- ============================================================
-- Admin Panel & Cloudinary Migration
-- Chạy file này trên Supabase SQL Editor một lần duy nhất.
-- An toàn: KHÔNG đụng tới các bảng hiện có (profiles, foods).
-- ============================================================

-- 1) Cờ admin trong profiles (chỉ thêm cột nếu chưa có)
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- 2) Bảng metadata PDF đã upload qua admin panel
create table if not exists public.admin_pdfs (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_size bigint,
  cloudinary_public_id text,
  cloudinary_url text,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_by_email text,
  status text not null default 'uploaded',
  -- uploaded | extracting | chunking | embedding | saving | ready | error
  error_message text,
  chunk_count integer not null default 0,
  embedding_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2b) Lưu file PDF gốc trong Supabase Storage (nơi lưu CHÍNH, không phụ thuộc Cloudinary).
--     storage_path = đường dẫn object trong bucket; storage_bucket = tên bucket.
alter table public.admin_pdfs
  add column if not exists storage_path text;
alter table public.admin_pdfs
  add column if not exists storage_bucket text;

create index if not exists admin_pdfs_created_at_idx
  on public.admin_pdfs (created_at desc);

-- 3) Bảng chunks RAG admin (riêng, không đụng knowledge-base.json hiện tại)
create table if not exists public.admin_kb_chunks (
  id uuid primary key default gen_random_uuid(),
  pdf_id uuid references public.admin_pdfs(id) on delete cascade,
  chunk_index integer not null,
  text text not null,
  embedding jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_kb_chunks_pdf_idx
  on public.admin_kb_chunks (pdf_id);

-- 4) Bảng lưu metadata ảnh chat upload qua Cloudinary
create table if not exists public.chat_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  cloudinary_public_id text,
  cloudinary_url text not null,
  width integer,
  height integer,
  bytes integer,
  format text,
  conversation_ref text,
  created_at timestamptz not null default now()
);

create index if not exists chat_images_user_idx
  on public.chat_images (user_id, created_at desc);

-- 5) Bảng log usage AI (chỉ ghi thêm, không sửa luồng cũ)
create table if not exists public.ai_usage_logs (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null, -- chat | image_analysis | rag
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_created_at_idx
  on public.ai_usage_logs (created_at desc);

-- 6) RLS: chỉ admin được đọc các bảng admin (qua service role thì luôn ok)
alter table public.admin_pdfs enable row level security;
alter table public.admin_kb_chunks enable row level security;
alter table public.chat_images enable row level security;
alter table public.ai_usage_logs enable row level security;

-- Policy: admin đọc tất cả
drop policy if exists "admin read admin_pdfs" on public.admin_pdfs;
create policy "admin read admin_pdfs" on public.admin_pdfs
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists "admin read admin_kb_chunks" on public.admin_kb_chunks;
create policy "admin read admin_kb_chunks" on public.admin_kb_chunks
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists "user read own chat_images" on public.chat_images;
create policy "user read own chat_images" on public.chat_images
  for select using (auth.uid() = user_id);

drop policy if exists "admin read all chat_images" on public.chat_images;
create policy "admin read all chat_images" on public.chat_images
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- ============================================================
-- Cách gán quyền admin cho 1 user:
--   update public.profiles set is_admin = true where id = '<user-uuid>';
-- ============================================================

-- ============================================================
-- LƯU FILE PDF GỐC (Supabase Storage)
-- App sẽ tự tạo bucket riêng tư tên 'admin-pdfs' khi upload lần đầu
-- (cần SUPABASE_SERVICE_ROLE_KEY). Nếu muốn tạo trước bằng SQL, chạy:
--
--   insert into storage.buckets (id, name, public)
--   values ('admin-pdfs', 'admin-pdfs', false)
--   on conflict (id) do nothing;
--
-- Bucket để PRIVATE; tải về dùng signed URL ngắn hạn do server cấp.
-- ============================================================
