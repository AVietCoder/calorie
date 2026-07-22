-- =============================================================================
-- nutrition_provenance — A+B: gắn "nguồn gốc + độ tin cậy" cho dữ liệu dinh dưỡng
--
-- Trước đây `foods` và `nutrition_anchors` KHÔNG phân biệt được một dòng USDA
-- chuẩn với một dòng AI đoán bừa → không thể ưu tiên dữ liệu tốt, không thể
-- duyệt/sửa, không chống được "nhiễm DB". Migration này thêm provenance để:
--   • lookup XẾP HẠNG theo nguồn (usda/off/manual > vn_ref > foods > ai)
--   • nguồn tốt được phép thay nguồn kém; dòng `verified` (admin duyệt) BẤT KHẢ ĐÈ
--   • đo mức dùng (hit_count/last_used_at) cho self-healing & LRU sau này
--
-- An toàn: chỉ THÊM cột, đều có DEFAULT → engine hiện tại chạy y nguyên.
-- Chạy trong Supabase SQL Editor. Idempotent (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

-- ── foods: bảng món ăn per-suất (tích luỹ từ vision/plan) ────────────────────
alter table public.foods
  add column if not exists source       text        not null default 'ai',
  add column if not exists confidence   text        not null default 'low',
  add column if not exists verified     boolean     not null default false,
  add column if not exists hit_count    integer     not null default 0,
  add column if not exists last_used_at timestamptz;

-- Dữ liệu foods cũ (trước khi có provenance) là do plan/vision AI sinh ra:
-- để nguyên source='ai', verified=false. Admin có thể verify dần (bundle F).
--
-- (Đã bỏ cột `embedding` từng dùng cho khớp ngữ nghĩa C-semantic — dự án
-- KHÔNG dùng embedding ở bất kỳ đâu nữa. Khớp món ăn chỉ dùng exact/alias
-- match; xem migrations/fulltext_search.sql — cũng DROP COLUMN IF EXISTS
-- foods.embedding để dọn sạch cho các cài đặt đã chạy migration cũ.)

-- ── nutrition_anchors: mốc /100g|ml hoặc /1 đơn vị (đã có cột source) ─────────
alter table public.nutrition_anchors
  add column if not exists confidence   text        not null default 'medium',
  add column if not exists verified     boolean     not null default false,
  add column if not exists hit_count    integer     not null default 0,
  add column if not exists last_used_at timestamptz;

-- Chỉ mục phục vụ lookup xếp hạng + dọn dẹp theo mức dùng
create index if not exists idx_foods_verified   on public.foods (verified);
create index if not exists idx_foods_source      on public.foods (source);
create index if not exists idx_anchors_verified  on public.nutrition_anchors (verified);
create index if not exists idx_anchors_source    on public.nutrition_anchors (source);

-- RPC tăng hit_count + last_used_at cho anchor (engine gọi fire-and-forget).
-- SECURITY DEFINER để chạy dưới quyền owner (bypass RLS an toàn cho 1 thao tác đếm).
create or replace function public.increment_anchor_hit(anchor_key text)
returns void
language sql
security definer
as $$
  update public.nutrition_anchors
     set hit_count = hit_count + 1, last_used_at = now()
   where key = anchor_key;
$$;

-- Gợi ý (KHÔNG bắt buộc): nếu muốn đánh dấu các mốc tham chiếu VN đã seed từ code
-- là "đáng tin" ngay, chạy sau khi seed:
--   update public.nutrition_anchors set verified = true, confidence = 'high'
--   where source = 'vn_ref';
