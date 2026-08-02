-- =============================================================================
-- menu_dish_price — thêm trường "Giá tiền" cho món ăn trong thực đơn.
--
-- Giá được nhập dưới dạng KHOẢNG GIÁ do người dùng gõ, ví dụ:
--   "15.000đ -> 18.000đ"   "25k -> 30k"   "40.000đ"
--
-- Vì sao là `text` chứ không phải numeric/range:
--   • Đây là khoảng giá, không phải một con số — không ép về numeric được.
--   • Yêu cầu là GIỮ NGUYÊN VĂN chuỗi người nhập, và xuất Excel ra đúng như vậy.
--     Parse thành số rồi format lại chắc chắn làm sai lệch định dạng gốc.
--   • Không dùng cho phép tính nào cả. Chi phí đi chợ vẫn tính từ bảng giá
--     nguyên liệu (lib/family-menu/shopping.js) — trường này KHÔNG đụng vào đó.
--
-- default '' (chứ không phải null) để mọi tầng đọc ra cùng một kiểu chuỗi,
-- không phải rải `?? ''` khắp nơi.
--
-- Safe & additive. Idempotent. Chạy trong Supabase SQL Editor.
-- =============================================================================

-- Món trong thư viện thực đơn (đích đến của import Excel).
alter table public.menu_template_dishes
  add column if not exists price text not null default '';

-- Món trong kế hoạch đã sinh (nguồn của export Excel). Giá được sao chép từ
-- món gốc trong thư viện lúc sinh kế hoạch / đổi món.
alter table public.plan_dishes
  add column if not exists price text not null default '';
