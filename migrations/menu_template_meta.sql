-- =============================================================================
-- menu_template_meta — thư viện thực đơn: mô tả, danh mục, ảnh, cờ hệ thống.
--
-- Trước đây menu_templates chỉ có title + tags, nên thư viện chỉ hiện được một
-- dòng chữ trơ. Bốn cột dưới đây phục vụ: thẻ có ảnh + mô tả ngắn + lọc theo
-- danh mục, và phân biệt thực đơn CỦA HỆ THỐNG (seed sẵn, chỉ admin sửa) với
-- thực đơn do người dùng tự tải lên.
--
-- Safe & additive. Idempotent. Chạy trong Supabase SQL Editor.
-- =============================================================================

alter table public.menu_templates add column if not exists description text;
alter table public.menu_templates add column if not exists category    text;
alter table public.menu_templates add column if not exists image_url   text;

-- true = thực đơn mẫu do hệ thống seed (scripts/seed-reference-menus.mjs).
-- Người dùng thường chỉ được XEM và áp dụng; chỉ admin được sửa/xoá.
alter table public.menu_templates add column if not exists is_system boolean not null default false;

create index if not exists idx_menu_templates_category
  on public.menu_templates (category)
  where category is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- SỬA LỖI DỮ LIỆU: template "mồ côi" — vô hình với MỌI người.
--
-- recommend.js lọc bằng `visibility = 'public' OR owner_household_id = <hộ tôi>`.
-- Một dòng vừa `visibility = 'private'` vừa `owner_household_id IS NULL` thì
-- không vế nào khớp được ⇒ nằm trong DB nhưng không ai thấy, kể cả người tạo.
-- Chuyển chúng về public để dùng lại được (không xoá dữ liệu).
-- ─────────────────────────────────────────────────────────────────────────
update public.menu_templates
   set visibility = 'public',
       updated_at = now()
 where visibility = 'private'
   and owner_household_id is null;
