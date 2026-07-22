-- =============================================================================
-- chat_images_diary — D: kích hoạt bảng chat_images (đang không dùng) thành
-- "Nhật ký ảnh món ăn". Thêm cột analysis (jsonb) để mỗi ảnh đã phân tích tự
-- chứa kết quả dinh dưỡng → nhật ký truy vấn được mà không cần join.
--
-- analysis = {"food","calories","protein","fat","carbs","confidence","source"}
--
-- An toàn: chỉ thêm cột nullable. Chạy trong Supabase SQL Editor. Idempotent.
-- =============================================================================

alter table public.chat_images
  add column if not exists analysis jsonb;

-- Truy vấn nhật ký theo user + thời gian (mới nhất trước)
create index if not exists idx_chat_images_user_created
  on public.chat_images (user_id, created_at desc);

-- ── RLS: cho phép GHI nhật ký ─────────────────────────────────────────────────
-- QUAN TRỌNG: chat_images & ai_usage_logs bật RLS trong admin.sql nhưng chỉ có
-- policy SELECT → mọi INSERT/SELECT từ server đang bị chặn. Server ghi/đọc bằng
-- SERVICE ROLE (SUPABASE_SERVICE_ROLE_KEY) nên BYPASS RLS — đó là đường chính.
-- Các policy dưới là dự phòng: nếu sau này ghi bằng client mang JWT người dùng
-- thì vẫn hợp lệ. KHÔNG có service role thì service-role client tự fallback về
-- anon (auth.uid()=NULL) và các tính năng D/E sẽ không ghi được — hãy cấu hình key.
drop policy if exists "user insert own chat_images" on public.chat_images;
create policy "user insert own chat_images" on public.chat_images
  for insert with check (auth.uid() = user_id);

drop policy if exists "user insert own ai_usage_logs" on public.ai_usage_logs;
create policy "user insert own ai_usage_logs" on public.ai_usage_logs
  for insert with check (auth.uid() = user_id or user_id is null);

drop policy if exists "admin read ai_usage_logs" on public.ai_usage_logs;
create policy "admin read ai_usage_logs" on public.ai_usage_logs
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );
