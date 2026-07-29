-- =============================================================================
-- account_deletion — xoá tài khoản vĩnh viễn (yêu cầu bắt buộc của Google Play).
--
-- Vì sao là HÀM SQL chứ không phải một chuỗi lệnh từ Node:
--   supabase-js gửi mỗi lệnh là một request PostgREST riêng, KHÔNG có transaction
--   bao ngoài. Hỏng ở giữa sẽ để lại tài khoản nửa xoá — hồ sơ mất nhưng lịch sử
--   chat còn, hoặc ngược lại. Gói tất cả vào một hàm plpgsql thì toàn bộ nằm gọn
--   trong MỘT transaction: hoặc sạch hết, hoặc không đụng gì.
--
-- Safe & additive: không sửa bảng nào đang có. Idempotent — chạy lại được, và
-- gọi hàm với user không tồn tại cũng không lỗi.
-- Chạy trong Supabase SQL Editor.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Nhật ký xoá tài khoản
--
-- KHÔNG có khoá ngoại tới auth.users: bản ghi phải SỐNG LÂU HƠN người dùng,
-- cascade sẽ xoá mất đúng thứ cần giữ. user_id lưu trần như một giá trị lịch sử.
--
-- Không lưu email/tên: mục đích là chứng minh "đã xử lý yêu cầu xoá lúc nào",
-- không phải giữ lại dữ liệu cá nhân — giữ lại là đi ngược chính chính sách này.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.account_deletion_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  deleted_at    timestamptz not null default now(),
  -- 'self' = người dùng tự xoá trong app. Để dành cho các nguồn khác về sau.
  requested_by  text not null default 'self',
  -- Số bản ghi đã xoá theo từng bảng — phục vụ đối chiếu khi có khiếu nại.
  stats         jsonb not null default '{}'::jsonb
);

create index if not exists idx_account_deletion_log_user
  on public.account_deletion_log (user_id, deleted_at desc);

alter table public.account_deletion_log enable row level security;

-- Chỉ service role đọc/ghi được. Không có policy nào cho client — nhật ký này
-- không phải thứ người dùng cuối cần thấy.
drop policy if exists account_deletion_log_no_client on public.account_deletion_log;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) delete_user_account(uuid) — xoá sạch dữ liệu ứng dụng của một người dùng.
--
-- KHÔNG xoá dòng trong auth.users: việc đó do máy chủ gọi Admin API làm ở bước
-- cuối, sau khi transaction này đã commit. Làm ngược lại thì cascade của
-- auth.users sẽ chạy trước và ta mất khả năng đếm/kiểm soát thứ tự.
--
-- Xoá TƯỜNG MINH từng bảng thay vì trông chờ `on delete cascade` của auth.users:
-- không phải bảng nào cũng khai cascade (nhiều bảng là `set null`), và dựa vào
-- cấu hình khoá ngoại nghĩa là một lần đổi schema có thể âm thầm để sót dữ liệu
-- cá nhân mà không ai biết.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.delete_user_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_handle text;
  v_email text;
  v_household_ids uuid[];
  v_stats jsonb := '{}'::jsonb;
  v_n bigint;
begin
  if p_user_id is null then
    raise exception 'delete_user_account: thiếu p_user_id';
  end if;

  -- Handle của chính người này, để báo cho thành viên biết AI đã giải tán gia đình.
  select username into v_owner_handle from profiles where id = p_user_id;

  -- Email dùng để dọn những bảng lưu người dùng theo EMAIL chứ không theo id.
  select email into v_email from auth.users where id = p_user_id;

  select array_agg(id) into v_household_ids from households where owner_id = p_user_id;

  -- ── Gia đình do người này làm chủ ──────────────────────────────────────
  -- Xoá tài khoản chủ hộ sẽ cuốn theo cả gia đình. Thành viên khác thường
  -- KHÔNG online lúc này, nên phải để lại thông báo — giống hệt luồng "bị xoá
  -- khỏi gia đình" đang có. Bảng thông báo khai household_id là `set null` nên
  -- thông báo vẫn sống sót sau khi gia đình biến mất.
  if v_household_ids is not null then
    insert into household_notifications (user_id, type, owner_handle, household_id)
    select m.user_id, 'removed_from_family', v_owner_handle, m.household_id
      from household_members m
     where m.household_id = any(v_household_ids)
       and m.user_id is not null
       and m.user_id <> p_user_id;
    get diagnostics v_n = row_count;
    v_stats := v_stats || jsonb_build_object('members_notified', v_n);

    -- Thực đơn RIÊNG TƯ của hộ sắp bị xoá phải xoá theo. Khoá ngoại
    -- owner_household_id khai `on delete set null`, nên nếu để cascade tự chạy
    -- chúng sẽ thành dòng vừa private vừa không thuộc hộ nào — vô hình với mọi
    -- người mãi mãi (xem ghi chú ở migrations/menu_template_meta.sql).
    delete from menu_templates
     where owner_household_id = any(v_household_ids)
       and visibility = 'private';
    get diagnostics v_n = row_count;
    v_stats := v_stats || jsonb_build_object('private_templates', v_n);

    -- households cascade sang household_members, weekly_menu_plans → plan_days
    -- → plan_meals → plan_dishes → plan_dish_ingredients, shopping_lists →
    -- shopping_list_items, household_join_requests, menu_adjustment_audit.
    delete from households where id = any(v_household_ids);
    get diagnostics v_n = row_count;
    v_stats := v_stats || jsonb_build_object('households_owned', v_n);
  else
    v_stats := v_stats || jsonb_build_object('members_notified', 0, 'private_templates', 0, 'households_owned', 0);
  end if;

  -- ── Là THÀNH VIÊN trong gia đình người khác ────────────────────────────
  delete from household_members where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_stats := v_stats || jsonb_build_object('memberships', v_n);

  delete from household_join_requests where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_stats := v_stats || jsonb_build_object('join_requests', v_n);

  -- Đơn của NGƯỜI KHÁC mà người này từng duyệt: giữ đơn, gỡ danh tính người duyệt.
  update household_join_requests set decided_by = null where decided_by = p_user_id;

  -- Thông báo GỬI CHO người này (thông báo gửi cho người khác ở trên phải giữ).
  delete from household_notifications where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_stats := v_stats || jsonb_build_object('notifications', v_n);

  -- Lời mời gia đình theo EMAIL (bảng của cơ chế mời cũ, trước khi có mã 6 số).
  -- Không có cột user_id nên không dọn theo id được: lời mời do NGƯỜI KHÁC tạo
  -- vẫn giữ nguyên email của người này nếu bỏ qua. Bảng hiện không còn được mã
  -- nguồn dùng tới, nhưng dữ liệu cũ thì vẫn phải xoá.
  if v_email is not null then
    delete from household_invites where lower(email) = lower(v_email);
    get diagnostics v_n = row_count;
    v_stats := v_stats || jsonb_build_object('invites', v_n);
  end if;

  -- Đơn xin vào gia đình cũng snapshot email lúc gửi.
  if v_email is not null then
    delete from household_join_requests where lower(email) = lower(v_email);
  end if;

  -- ── Ảnh món ăn ─────────────────────────────────────────────────────────
  -- Chỉ xoá dòng DB ở đây. File trên Cloudinary do máy chủ xoá sau khi
  -- transaction commit: gọi HTTP ra ngoài từ trong transaction là sai nguyên
  -- tắc, và rollback cũng không lấy lại được file đã xoá.
  delete from chat_images where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_stats := v_stats || jsonb_build_object('chat_images', v_n);

  -- ── Khảo sát ───────────────────────────────────────────────────────────
  -- Chứa tuổi/giới tính/nghề nghiệp gắn với user_id ⇒ là dữ liệu cá nhân, xoá
  -- hẳn chứ không chỉ gỡ liên kết. survey_answers cascade theo survey_responses.
  delete from survey_responses where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_stats := v_stats || jsonb_build_object('survey_responses', v_n);

  -- ── Nhật ký dùng AI ────────────────────────────────────────────────────
  delete from ai_usage_logs where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_stats := v_stats || jsonb_build_object('ai_usage_logs', v_n);

  delete from menu_import_logs where user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_stats := v_stats || jsonb_build_object('import_logs', v_n);

  -- ── Nội dung DÙNG CHUNG: gỡ danh tính, không xoá ───────────────────────
  -- Thực đơn công khai và tài liệu quản trị có thể đang được người khác dùng.
  -- Xoá chúng là lấy đi dữ liệu của người khác; ẩn danh là đủ để không còn
  -- dấu vết cá nhân. (Thực đơn riêng tư đã bị xoá hẳn ở trên.)
  update menu_templates set created_by = null where created_by = p_user_id;
  get diagnostics v_n = row_count;
  v_stats := v_stats || jsonb_build_object('templates_anonymised', v_n);

  update admin_pdfs set uploaded_by = null, uploaded_by_email = null where uploaded_by = p_user_id;
  update ingredient_prices set updated_by = null where updated_by = p_user_id;

  -- ── Hồ sơ (kèm chat_history, kế hoạch tuần, chỉ số cơ thể) ─────────────
  delete from profiles where id = p_user_id;
  get diagnostics v_n = row_count;
  v_stats := v_stats || jsonb_build_object('profile', v_n);

  insert into account_deletion_log (user_id, requested_by, stats)
  values (p_user_id, 'self', v_stats);

  return v_stats;
end;
$$;

comment on function public.delete_user_account(uuid) is
  'Xoá toàn bộ dữ liệu ứng dụng của một người dùng trong MỘT transaction. Không đụng auth.users — máy chủ gọi Admin API sau khi hàm này commit.';

-- Chỉ service role được gọi. Người dùng cuối đi qua DELETE /api/account, nơi có
-- xác thực và kiểm tra quyền sở hữu; mở hàm này cho authenticated sẽ cho phép
-- bất kỳ ai truyền uuid của người khác vào.
revoke all on function public.delete_user_account(uuid) from public, anon, authenticated;
