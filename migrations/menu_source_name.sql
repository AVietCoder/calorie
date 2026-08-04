-- =============================================================================
-- menu_source_name — tên ĐƠN VỊ phát hành thực đơn, để tra logo nguồn.
--
-- Cột `source` sẵn có KHÔNG dùng được cho việc này: nó là khoá idempotency của
-- scripts/seed-reference-menus.mjs ("reference:<slug>"), không phải tên đơn vị.
--
-- `source_name` giữ đúng tên như trên tài liệu gốc ("Medlatec", "Trạm y tế
-- phường Sơn Kỳ") — lib/family-menu/source-logos.js tra logo từ chuỗi này.
-- Suy ngược từ tiêu đề ("Thực đơn tiểu đường — Medlatec") thì hỏng ngay khi ai
-- đó sửa tiêu đề, nên phải lưu tách.
--
-- Safe & additive. Idempotent. Chạy trong Supabase SQL Editor.
-- =============================================================================

alter table public.menu_templates
  add column if not exists source_name text;
