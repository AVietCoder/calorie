-- =============================================================================
-- nutrition_anchors — cache MỐC DINH DƯỠNG CHUẨN cho pipeline lib/nutrition.js
--
-- Mỗi row là giá trị dinh dưỡng trên "1 đơn vị mốc" của một thực phẩm:
--   kind = 'volume' | 'mass'  → per_unit là giá trị trên ĐÚNG 100ml / 100g
--   kind = 'unit'             → per_unit là giá trị trên ĐÚNG 1 đơn vị đếm
--                               (key dạng "unit:<đơn vị>:<tên món>")
--
-- Nhờ cache này, "100ml / 200ml / 300ml / 500ml sữa socola" luôn scale từ
-- CÙNG MỘT mốc → kết quả tuyến tính và lặp lại y hệt giữa các lần gọi.
--
-- Chạy trong Supabase SQL Editor. Code tự fallback về memory-cache nếu bảng
-- chưa tồn tại, nhưng nên tạo để mốc bền vững qua các lần cold-start.
-- =============================================================================

create table if not exists public.nutrition_anchors (
  key        text primary key,          -- vd: "volume:sua socola" | "unit:mieng:sushi"
  kind       text not null,             -- 'volume' | 'mass' | 'unit'
  per_unit   jsonb not null,            -- {calories, protein, fat, carbs, fiber, sugar, sodium}
  source     text not null default 'ai',-- 'usda' | 'off' | 'ai'
  updated_at timestamptz not null default now()
);

-- Server dùng service-role key (bypass RLS). Bật RLS để client anon không đọc/ghi.
alter table public.nutrition_anchors enable row level security;
