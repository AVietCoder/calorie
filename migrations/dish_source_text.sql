-- =============================================================================
-- dish_source_text — giữ chuỗi gốc của tên món + chống trùng danh sách đi chợ.
--
-- Bối cảnh: thực đơn nguồn viết nguyên liệu ngay trong tên món
--   "Phở bò: 180 g bánh phở, 50 g thịt bò, 30 g bò viên"
-- Importer nay tách chuỗi đó ra bảng nguyên liệu và RÚT GỌN tên còn "Phở bò".
--
-- `source_text` giữ nguyên chuỗi ban đầu, phục vụ 2 việc:
--   1. Đối chiếu / kiểm tra lại khi parser sai.
--   2. Khoá idempotency cho scripts/backfill-dish-ingredients.mjs — chạy lại với
--      --force sẽ parse từ ĐÂY, chứ parse lại từ `name` đã rút gọn thì mất dữ liệu.
--
-- Safe & additive. Idempotent. Chạy trong Supabase SQL Editor.
-- =============================================================================

alter table public.menu_template_dishes
  add column if not exists source_text text;

-- buildShoppingList() xoá-rồi-chèn shopping_lists theo plan_id. Không có ràng buộc
-- duy nhất thì hai request đồng thời có thể tạo 2 dòng cho cùng một plan, và
-- `.maybeSingle()` phía đọc sẽ nổ. Ràng buộc này khiến đua nhau fail rõ ràng
-- thay vì âm thầm nhân đôi.
create unique index if not exists idx_shopping_lists_plan_unique
  on public.shopping_lists (plan_id);
