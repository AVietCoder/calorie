-- =============================================================================
-- excel_export_and_pricing — hỗ trợ xuất Excel + bảng giá nguyên liệu do Admin
-- cấu hình + trạng thái "đã mua" của danh sách đi chợ.
--
-- An toàn & bổ sung: KHÔNG sửa/xoá cột nào đang có. Idempotent (IF NOT EXISTS
-- ở mọi nơi). Chạy một lần trong Supabase SQL Editor.
--
-- Nếu KHÔNG chạy migration này, hệ thống vẫn hoạt động:
--   • lib/family-menu/pricing.js tự lùi về knowledge/ingredient-prices.json
--   • checkbox "đã mua" chỉ tồn tại trong file Excel in ra
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) BẢNG GIÁ NGUYÊN LIỆU DO ADMIN CẤU HÌNH
--
--    Thứ tự ưu tiên khi tra giá (xem lib/family-menu/pricing.js):
--      household_id khớp  →  region khớp  →  dòng global  →  bảng tham khảo
--    Nhờ vậy có thể đặt giá riêng cho từng khu vực hoặc từng khách hàng mà
--    không phải sửa code hay file JSON.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ingredient_prices (
  id            uuid primary key default gen_random_uuid(),
  -- Khớp với `id` trong knowledge/ingredient-catalog.json, ví dụ 'thit_ba_chi'.
  ingredient_id text not null,
  unit          text not null,
  price         numeric not null check (price >= 0),
  currency      text not null default 'VND',
  -- Phạm vi áp dụng: cả hai NULL = giá toàn hệ thống.
  region        text,
  household_id  uuid references public.households(id) on delete cascade,
  active        boolean not null default true,
  note          text,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_ingredient_prices_lookup
  on public.ingredient_prices (ingredient_id, active);
create index if not exists idx_ingredient_prices_household
  on public.ingredient_prices (household_id) where household_id is not null;
create index if not exists idx_ingredient_prices_region
  on public.ingredient_prices (region) where region is not null;

-- Mỗi phạm vi chỉ có tối đa một giá đang hoạt động cho một nguyên liệu.
-- Ba unique index riêng vì Postgres coi NULL là khác nhau trong unique thường.
create unique index if not exists idx_ingredient_prices_global_unique
  on public.ingredient_prices (ingredient_id)
  where household_id is null and region is null and active;

create unique index if not exists idx_ingredient_prices_region_unique
  on public.ingredient_prices (ingredient_id, region)
  where household_id is null and region is not null and active;

create unique index if not exists idx_ingredient_prices_household_unique
  on public.ingredient_prices (ingredient_id, household_id)
  where household_id is not null and active;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) BỔ SUNG CỘT CHO SHOPPING LIST
--    `category` và `est_cost` đã có sẵn trong family_menu_planner.sql nhưng
--    chưa được ghi. Từ bản này chúng được điền tự động.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.shopping_list_items
  add column if not exists ingredient_id text,
  add column if not exists display_qty    numeric,
  add column if not exists display_unit   text,
  add column if not exists unit_price     numeric,
  add column if not exists purchased      boolean not null default false,
  add column if not exists purchased_at   timestamptz,
  add column if not exists substitutes    text[] not null default '{}';

create index if not exists idx_shopping_list_items_ingredient
  on public.shopping_list_items (ingredient_id);

-- Số suất người dùng chọn khi xuất file (mặc định = số thành viên).
alter table public.shopping_lists
  add column if not exists servings integer;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) NHẬT KÝ NHẬP FILE — để rà soát khi AI nhận diện sai
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.menu_import_logs (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid references public.menu_templates(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  filename      text,
  sheet_name    text,
  strategy      text,        -- 'legacy-flat' | 'heuristic' | 'ai' | …
  layout        text,        -- 'pivot' | 'record' | 'meal-rows' | …
  confidence    numeric,
  day_count     integer,
  dish_count    integer,
  warnings      jsonb not null default '[]'::jsonb,
  report        jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_menu_import_logs_template
  on public.menu_import_logs (template_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) RLS — server ghi bằng service role (bypass RLS) như phần còn lại của dự án.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.ingredient_prices enable row level security;
alter table public.menu_import_logs  enable row level security;

-- Giá toàn hệ thống / theo khu vực: ai đăng nhập cũng đọc được (để hiển thị
-- ước tính chi phí). Giá riêng của một hộ: chỉ hộ đó đọc.
drop policy if exists "ingredient_prices read shared" on public.ingredient_prices;
create policy "ingredient_prices read shared" on public.ingredient_prices
  for select using (household_id is null and active);

drop policy if exists "ingredient_prices read own household" on public.ingredient_prices;
create policy "ingredient_prices read own household" on public.ingredient_prices
  for select using (
    household_id is not null and (
      exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid())
      or exists (
        select 1 from public.household_members m
        where m.household_id = ingredient_prices.household_id
          and m.kind = 'linked' and m.user_id = auth.uid()
      )
    )
  );

drop policy if exists "menu_import_logs read own" on public.menu_import_logs;
create policy "menu_import_logs read own" on public.menu_import_logs
  for select using (user_id = auth.uid());
