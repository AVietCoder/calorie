-- ============================================================
-- KHẢO SÁT TRẢI NGHIỆM NGƯỜI DÙNG
-- File cần chạy: migrations/survey_analytics.sql
--
-- Dùng cho Supabase/PostgreSQL hiện tại của dự án.
-- Người dùng KHÔNG cần đăng nhập để gửi khảo sát.
-- Nếu đã đăng nhập, phản hồi sẽ tự liên kết với auth.uid().
-- ============================================================

-- 1. Danh mục câu hỏi
create table if not exists public.survey_questions (
  id text primary key,
  section_id text not null,
  section_title text not null,
  question_text_vi text not null,
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists survey_questions_section_order_idx
  on public.survey_questions (section_id, sort_order);

-- 2. Mỗi lần người dùng hoàn thành form là một response
create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  -- NULL khi người tham gia chưa đăng nhập.
  user_id uuid references auth.users(id) on delete set null,
  survey_version integer not null default 1,
  age_group text not null check (
    age_group in ('under_18', '18_24', '25_34', '35_44', '45_54', '55_plus', 'prefer_not')
  ),
  gender text not null check (
    gender in ('male', 'female', 'other', 'prefer_not')
  ),
  occupation text not null check (
    occupation in ('student', 'office', 'manual', 'freelance', 'homemaker', 'retired', 'other')
  ),
  usage_duration text not null check (
    usage_duration in ('under_week', '1_4_weeks', '1_3_months', 'over_3_months')
  ),
  usage_frequency text not null check (
    usage_frequency in ('daily', 'few_week', 'weekly', 'rarely')
  ),
  primary_goal text not null check (
    primary_goal in ('lose', 'maintain', 'gain', 'muscle', 'health', 'disease', 'other')
  ),
  comment text check (char_length(comment) <= 1000),
  average_score numeric(3, 2) not null check (average_score between 1 and 5),
  submitted_at timestamptz not null default now()
);

create index if not exists survey_responses_user_idx
  on public.survey_responses (user_id, submitted_at desc)
  where user_id is not null;

create index if not exists survey_responses_submitted_at_idx
  on public.survey_responses (submitted_at desc);

-- 3. Điểm của từng câu hỏi thuộc một response
create table if not exists public.survey_answers (
  response_id uuid not null references public.survey_responses(id) on delete cascade,
  question_id text not null references public.survey_questions(id),
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (response_id, question_id)
);

create index if not exists survey_answers_question_score_idx
  on public.survey_answers (question_id, score);

-- 4. Danh sách 22 câu hỏi hiện có trên trang Review
insert into public.survey_questions
  (id, section_id, section_title, question_text_vi, sort_order)
values
  ('plan_1', 'plan', 'Thực đơn, kế hoạch', 'Thực đơn 7 ngày phù hợp với khẩu vị của tôi', 1),
  ('plan_2', 'plan', 'Thực đơn, kế hoạch', 'Các bữa ăn trong kế hoạch là thực tế (có thể thực hiện)', 2),
  ('plan_3', 'plan', 'Thực đơn, kế hoạch', 'Tôi có thể dễ dàng thay đổi / tạo lại kế hoạch', 3),
  ('plan_4', 'plan', 'Thực đơn, kế hoạch', 'Kế hoạch phù hợp với lịch làm việc/sinh hoạt của tôi', 4),
  ('plan_5', 'plan', 'Thực đơn, kế hoạch', 'Áp dụng thực đơn từ ứng dụng giúp tôi tiến gần hơn tới mục tiêu', 5),
  ('track_1', 'tracking', 'Ghi nhận & Theo dõi', 'Ghi nhận bữa ăn vào ứng dụng dễ dàng', 1),
  ('track_2', 'tracking', 'Ghi nhận & Theo dõi', 'Tôi dễ tìm thấy món ăn mình muốn ghi nhận', 2),
  ('track_3', 'tracking', 'Ghi nhận & Theo dõi', 'Giá trị dinh dưỡng hiển thị chính xác', 3),
  ('track_4', 'tracking', 'Ghi nhận & Theo dõi', 'Vòng tiến độ “Hôm nay đã nạp” giúp tôi kiểm soát lượng nạp', 4),
  ('track_5', 'tracking', 'Ghi nhận & Theo dõi', 'Các biểu đồ (calo, macro, cân nặng) dễ hiểu', 5),
  ('ai_1', 'ai', 'Trợ lý AI', 'Tính năng chat AI hữu ích cho tôi', 1),
  ('ai_2', 'ai', 'Trợ lý AI', 'Câu trả lời từ AI hỗ trợ tôi đưa ra quyết định', 2),
  ('ai_3', 'ai', 'Trợ lý AI', 'Ghi bữa ăn trực tiếp từ chat (nói “Tôi ăn...”) tiện lợi', 3),
  ('remind_1', 'reminders', 'Nhắc nhở & Thông báo', 'Tính năng nhắc nhở bữa ăn/uống thuốc hữu ích', 1),
  ('remind_2', 'reminders', 'Nhắc nhở & Thông báo', 'Nhắc nhở giúp tôi tuân thủ kế hoạch', 2),
  ('ux_1', 'ux', 'Trải nghiệm sử dụng', 'Ứng dụng dễ sử dụng, dễ tìm các tính năng', 1),
  ('ux_2', 'ux', 'Trải nghiệm sử dụng', 'Giao diện rõ ràng và không rối', 2),
  ('ux_3', 'ux', 'Trải nghiệm sử dụng', 'Ứng dụng tải nhanh, không lag', 3),
  ('ux_4', 'ux', 'Trải nghiệm sử dụng', 'Tương tác với ứng dụng không gặp lỗi', 4),
  ('ui_1', 'ui', 'Đánh giá giao diện', 'Giao diện có dễ sử dụng không?', 1),
  ('all_1', 'overall', 'Tổng thể', 'Tôi sẽ tiếp tục sử dụng ứng dụng', 1),
  ('all_2', 'overall', 'Tổng thể', 'Tôi sẽ giới thiệu ứng dụng cho bạn bè', 2)
on conflict (id) do update set
  section_id = excluded.section_id,
  section_title = excluded.section_title,
  question_text_vi = excluded.question_text_vi,
  sort_order = excluded.sort_order,
  is_active = true;

-- 5. Hàm gửi khảo sát công khai.
-- Hàm thực hiện response + toàn bộ answers trong cùng một transaction.
-- Không nhận user_id từ client; auth.uid() được lấy trực tiếp từ Supabase.
create or replace function public.submit_survey_response(
  p_age_group text,
  p_gender text,
  p_occupation text,
  p_usage_duration text,
  p_usage_frequency text,
  p_primary_goal text,
  p_answers jsonb,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_response_id uuid;
  v_question_count integer;
  v_average numeric;
begin
  if p_age_group not in ('under_18', '18_24', '25_34', '35_44', '45_54', '55_plus', 'prefer_not')
    or p_gender not in ('male', 'female', 'other', 'prefer_not')
    or p_occupation not in ('student', 'office', 'manual', 'freelance', 'homemaker', 'retired', 'other')
    or p_usage_duration not in ('under_week', '1_4_weeks', '1_3_months', 'over_3_months')
    or p_usage_frequency not in ('daily', 'few_week', 'weekly', 'rarely')
    or p_primary_goal not in ('lose', 'maintain', 'gain', 'muscle', 'health', 'disease', 'other')
  then
    raise exception 'Thông tin chung của khảo sát không hợp lệ.';
  end if;

  if p_comment is not null and char_length(trim(p_comment)) > 1000 then
    raise exception 'Góp ý không được vượt quá 1.000 ký tự.';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Danh sách câu trả lời không hợp lệ.';
  end if;

  select count(*)
    into v_question_count
  from public.survey_questions
  where is_active = true;

  if jsonb_object_length(p_answers) <> v_question_count then
    raise exception 'Cần trả lời đầy đủ % câu hỏi.', v_question_count;
  end if;

  if exists (
    select 1
    from jsonb_each_text(p_answers) as answer(question_id, score_text)
    where score_text !~ '^[1-5]$'
  ) then
    raise exception 'Điểm đánh giá phải là số nguyên từ 1 đến 5.';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_answers) as answer(question_id)
    where not exists (
      select 1
      from public.survey_questions question
      where question.id = answer.question_id
        and question.is_active = true
    )
  ) then
    raise exception 'Có câu hỏi không tồn tại hoặc đã ngừng sử dụng.';
  end if;

  select avg(score_text::numeric)
    into v_average
  from jsonb_each_text(p_answers) as answer(question_id, score_text);

  insert into public.survey_responses (
    user_id,
    survey_version,
    age_group,
    gender,
    occupation,
    usage_duration,
    usage_frequency,
    primary_goal,
    comment,
    average_score
  )
  values (
    auth.uid(),
    1,
    p_age_group,
    p_gender,
    p_occupation,
    p_usage_duration,
    p_usage_frequency,
    p_primary_goal,
    nullif(trim(p_comment), ''),
    round(v_average, 2)
  )
  returning id into v_response_id;

  insert into public.survey_answers (response_id, question_id, score)
  select
    v_response_id,
    question_id,
    score_text::smallint
  from jsonb_each_text(p_answers) as answer(question_id, score_text);

  return v_response_id;
end;
$$;

-- Chỉ cho phép gửi thông qua hàm đã kiểm tra dữ liệu ở trên.
revoke all on function public.submit_survey_response(
  text, text, text, text, text, text, jsonb, text
) from public;

grant execute on function public.submit_survey_response(
  text, text, text, text, text, text, jsonb, text
) to anon, authenticated;

-- 6. Row Level Security
alter table public.survey_questions enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_answers enable row level security;

-- Không cho anon/authenticated ghi trực tiếp vào bảng.
-- Việc ghi chỉ đi qua submit_survey_response().
revoke all on table public.survey_questions from anon, authenticated;
revoke all on table public.survey_responses from anon, authenticated;
revoke all on table public.survey_answers from anon, authenticated;

grant select on table public.survey_questions to anon, authenticated;
grant select on table public.survey_responses to authenticated;
grant select on table public.survey_answers to authenticated;

drop policy if exists "public read active survey questions" on public.survey_questions;
create policy "public read active survey questions"
  on public.survey_questions for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "user read own survey responses" on public.survey_responses;
create policy "user read own survey responses"
  on public.survey_responses for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "admin read all survey responses" on public.survey_responses;
create policy "admin read all survey responses"
  on public.survey_responses for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.is_admin = true
    )
  );

drop policy if exists "user read own survey answers" on public.survey_answers;
create policy "user read own survey answers"
  on public.survey_answers for select
  to authenticated
  using (
    exists (
      select 1
      from public.survey_responses response
      where response.id = response_id
        and response.user_id = auth.uid()
    )
  );

drop policy if exists "admin read all survey answers" on public.survey_answers;
create policy "admin read all survey answers"
  on public.survey_answers for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.is_admin = true
    )
  );

-- Các policy insert/delete cũ (nếu file từng được chạy thử) sẽ được dọn sạch.
drop policy if exists "user create own survey responses" on public.survey_responses;
drop policy if exists "user delete own incomplete survey responses" on public.survey_responses;
drop policy if exists "user create own survey answers" on public.survey_answers;
