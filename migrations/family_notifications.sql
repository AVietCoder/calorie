-- =============================================================================
-- family_notifications — thông báo "để dành" cho thành viên gia đình.
--
-- Vì sao cần bảng riêng thay vì suy ra từ dữ liệu có sẵn:
--   * "Bạn đã bị xoá khỏi gia đình" — khi chủ hộ xoá thành viên, dòng trong
--     household_members BỊ XOÁ HẲN, không còn dấu vết nào để suy ra. Nếu chủ hộ
--     xoá luôn cả gia đình thì household cũng biến mất.
--   * "Bạn đã được duyệt vào gia đình" — có thể suy từ household_join_requests
--     (status='accepted') nhưng không có chỗ đánh dấu "người dùng đã xem chưa",
--     nên sẽ hiện lại mãi mỗi lần đăng nhập.
-- Người nhận thường KHÔNG online lúc sự kiện xảy ra, nên phải ghi lại để lần
-- đăng nhập kế tiếp mới hiện được.
--
-- Safe & additive: không đụng bảng nào đang có. Idempotent.
-- Chạy trong Supabase SQL Editor, SAU family_join_code.sql.
-- =============================================================================

create table if not exists public.household_notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null check (type in ('join_approved', 'removed_from_family')),

  -- Ảnh chụp handle chủ hộ tại thời điểm tạo thông báo. BẮT BUỘC phải snapshot:
  -- gia đình có thể bị giải tán ngay sau đó, lúc ấy không còn tra ngược ra được
  -- "@ai" đã xoá mình.
  owner_handle text,

  -- on delete SET NULL (KHÔNG cascade): chủ hộ xoá cả gia đình thì thông báo
  -- "bạn đã bị xoá khỏi gia đình" VẪN PHẢI CÒN — cascade sẽ xoá mất đúng cái
  -- thông báo cần hiện.
  household_id uuid references public.households(id) on delete set null,

  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

-- Truy vấn nóng duy nhất: "lấy thông báo CHƯA ĐỌC của tôi, mới nhất trước".
create index if not exists idx_household_notifications_unread
  on public.household_notifications (user_id, created_at desc)
  where read_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — server ghi bằng supabaseAdmin (service role, bỏ qua RLS) như phần còn
-- lại của dự án; policy dưới đây là lớp chặn phía client.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.household_notifications enable row level security;

-- Chỉ đọc được thông báo của chính mình.
drop policy if exists "household_notifications own read" on public.household_notifications;
create policy "household_notifications own read" on public.household_notifications
  for select using (user_id = auth.uid());

-- Chỉ được cập nhật thông báo của chính mình (dùng để đánh dấu đã đọc).
drop policy if exists "household_notifications own update" on public.household_notifications;
create policy "household_notifications own update" on public.household_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
