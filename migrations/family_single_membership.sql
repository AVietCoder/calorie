-- =============================================================================
-- family_single_membership — mỗi tài khoản chỉ thuộc ĐÚNG MỘT gia đình.
--
-- Bối cảnh (Ảnh 3): luật cũ cho phép một người VỪA sở hữu household riêng VỪA
-- là thành viên (kind='linked') trong household của người khác. Hệ quả:
--   * getHouseholdForUser() ưu tiên household mình sở hữu -> Kitchen vẫn hiện
--     gia đình rỗng của chính họ dù đã được duyệt vào gia đình khác;
--   * họ vẫn thấy và bấm được "Tạo mã mới" cho household riêng của mình.
--
-- Code đã chặn trạng thái này từ nay về sau (join_by_code / create_household /
-- regenerate_join_code). File này dọn nốt DỮ LIỆU ĐANG CÓ theo hướng
-- "ƯU TIÊN GIA ĐÌNH ĐÃ THAM GIA":
--   giữ lại tư cách thành viên ở gia đình người khác, XOÁ household riêng
--   của họ — nhưng CHỈ KHI household đó không còn tài khoản thật nào khác.
--
-- ⚠️ CÓ XOÁ DỮ LIỆU. Household bị xoá sẽ cascade sang household_members,
--    weekly_menu_plans, plan_*, shopping_lists... theo FK có sẵn.
--    HÃY CHẠY PHẦN KIỂM TRA (BƯỚC 1) TRƯỚC, xem kỹ rồi mới chạy BƯỚC 2.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- BƯỚC 1 — CHỈ ĐỌC: liệt kê các household sắp bị xoá. Chạy riêng, đọc kỹ.
-- ─────────────────────────────────────────────────────────────────────────
select
  h.id                as household_se_bi_xoa,
  h.owner_id,
  h.join_code,
  h.mode,
  joined.household_id as gia_dinh_se_giu_lai,
  (select count(*) from public.household_members m
    where m.household_id = h.id and m.kind = 'linked' and m.user_id <> h.owner_id) as thanh_vien_that_khac,
  (select count(*) from public.household_members m
    where m.household_id = h.id and m.kind = 'dependent') as thanh_vien_phu_thuoc,
  (select count(*) from public.weekly_menu_plans p where p.household_id = h.id) as so_thuc_don
from public.households h
join public.household_members joined
  on joined.user_id = h.owner_id
 and joined.kind = 'linked'
 and joined.household_id <> h.id
order by h.created_at;

-- ─────────────────────────────────────────────────────────────────────────
-- BƯỚC 2 — GHI: xoá household riêng của những người đã tham gia gia đình khác.
--
-- Điều kiện an toàn: chỉ xoá household mà chủ hộ là tài khoản thật DUY NHẤT
-- (không có linked member nào khác). Nếu household đó còn thành viên thật khác
-- thì BỎ QUA — sẽ được liệt kê ở BƯỚC 3 để bạn xử lý thủ công, vì xoá tự động
-- sẽ cắt quyền truy cập của người khác mà họ không hề đồng ý.
-- ─────────────────────────────────────────────────────────────────────────
with ung_vien as (
  select h.id
  from public.households h
  join public.household_members joined
    on joined.user_id = h.owner_id
   and joined.kind = 'linked'
   and joined.household_id <> h.id
  where not exists (
    select 1 from public.household_members m
    where m.household_id = h.id
      and m.kind = 'linked'
      and m.user_id is not null
      and m.user_id <> h.owner_id
  )
)
delete from public.households h
using ung_vien u
where h.id = u.id;

-- ─────────────────────────────────────────────────────────────────────────
-- BƯỚC 3 — CHỈ ĐỌC: các ca CÒN LẠI cần xử lý tay (household riêng vẫn còn
-- thành viên thật khác). Bình thường sẽ trả 0 dòng.
-- ─────────────────────────────────────────────────────────────────────────
select
  h.id as household_con_lai,
  h.owner_id,
  joined.household_id as chu_ho_dang_la_thanh_vien_cua
from public.households h
join public.household_members joined
  on joined.user_id = h.owner_id
 and joined.kind = 'linked'
 and joined.household_id <> h.id
order by h.created_at;

-- ─────────────────────────────────────────────────────────────────────────
-- BƯỚC 4 — CHỈ ĐỌC: xác nhận không ai còn nằm trong nhiều hơn 1 gia đình.
-- Kỳ vọng: 0 dòng.
-- ─────────────────────────────────────────────────────────────────────────
select user_id, count(*) as so_gia_dinh
from public.household_members
where kind = 'linked' and user_id is not null
group by user_id
having count(*) > 1;
