-- =============================================================================
-- menu_meal_notes — ghi chú từng bữa + nguồn tra cứu của thực đơn.
--
-- Bộ thực đơn chuẩn ("Thực đơn mẫu/") có 5 sheet mỗi file, trước đây hệ thống
-- chỉ đọc sheet "DỮ LIỆU". Hai sheet còn lại chứa thông tin không có ở đâu khác.
--
-- 1) menu_template_meals.note / needs_review — từ sheet "THỰC ĐƠN"
--
--    Mỗi bữa có một dòng ghi chú, gộp nhiều mệnh đề bằng dấu ";". Hai loại
--    đáng chú ý:
--      "CẦN KIỂM TRA: tổng dinh dưỡng chưa đầy đủ"
--      "Đã chuẩn hóa từ “Trái cây tráng miệng” thành “Táo tươi: 150 g”…"
--
--    `needs_review` tách riêng thành boolean thay vì để giao diện tự dò chuỗi:
--    đây là ứng dụng sức khoẻ, việc "số liệu này chưa kiểm chứng" phải là một
--    trường dữ liệu truy vấn được, không phải kết quả của một phép so khớp
--    chuỗi rải rác trong component.
--
-- 2) menu_templates.source_meta — từ sheet "THÔNG TIN XỬ LÝ"
--
--    jsonb chứa: sourceFile, processedAt, nutritionSource, methodDoc,
--    priceSource… Dùng jsonb chứ không tách từng cột vì đây là siêu dữ liệu
--    xuất xứ, chỉ để hiển thị/đối chiếu, không lọc hay join theo nó — thêm
--    trường mới sau này không phải chạy migration lần nữa.
--
-- Safe & additive. Idempotent. Chạy trong Supabase SQL Editor.
-- =============================================================================

alter table public.menu_template_meals
  add column if not exists note text not null default '';

alter table public.menu_template_meals
  add column if not exists needs_review boolean not null default false;

alter table public.menu_templates
  add column if not exists source_meta jsonb;

-- Thư viện cần đếm nhanh "thực đơn nào có bữa cần rà soát" để gắn nhãn.
create index if not exists idx_menu_template_meals_review
  on public.menu_template_meals (template_day_id)
  where needs_review;
