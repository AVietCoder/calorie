-- =============================================================================
-- user_intake_sync — đồng bộ "đã ăn / bỏ bữa / món thêm" giữa web và app.
--
-- Trước đây dữ liệu này CHỈ nằm trong máy: web ghi vào localStorage, app ghi
-- vào AsyncStorage, hai bên không hề biết nhau. Tick "đã ăn" trên điện thoại
-- rồi mở web ra thì trắng trơn, và ngược lại. Đổi máy hay xoá cache là mất hết.
--
-- Lưu dạng jsonb trên chính bảng profiles, giống cách weekly_plan đang làm:
-- không thêm bảng mới, không đổi hình dạng dữ liệu mà client vốn đã dùng.
--
--   {
--     "2026-08-24": {
--       "eaten":     { "5-Sáng": true },
--       "skipped":   { "5-Trưa": true },
--       "eatenInfo": { "5-Sáng": { food, calories, protein, fat, carbs } },
--       "extras":    [ { id, name, calories, protein, fat, carbs } ],
--       "_ts":       1756000000000
--     }
--   }
--
-- `_ts` là mốc thời gian sửa lần cuối của TỪNG NGÀY. Hai máy cùng sửa một ngày
-- thì bản có _ts lớn hơn thắng. Chốt theo từng ngày chứ không theo cả object:
-- sửa hôm nay trên điện thoại không được phép xoá mất bản ghi hôm qua trên web.
--
-- Safe & additive. Idempotent. Chạy trong Supabase SQL Editor.
-- =============================================================================

alter table public.profiles
  add column if not exists intake jsonb not null default '{}'::jsonb;
