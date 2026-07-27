-- =============================================================================
-- family_join_code — replaces the email-invite flow with a 6-digit numeric
-- join code (Kahoot/Quizizz style) + an owner-approved join request queue.
--
-- Before: owner created a `household_invites` row (email + alphanumeric code);
--         whoever typed the code became a linked member INSTANTLY, no approval.
-- After:  every household carries exactly ONE active numeric code
--         (`households.join_code`); typing it creates a PENDING request that
--         the owner must accept before the user becomes a linked member.
--
-- Safe & additive: `household_invites` is intentionally left in place (unused
-- by the app now) so historical rows aren't destroyed — drop it manually later
-- if you want. Nothing else in the family_menu_planner schema is touched.
-- Idempotent. Run once in the Supabase SQL Editor, AFTER family_menu_planner.sql.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) households.join_code — one active 6-digit numeric code per household
-- ─────────────────────────────────────────────────────────────────────────
alter table public.households add column if not exists join_code            text;
alter table public.households add column if not exists join_code_updated_at timestamptz;

-- Digits only, exactly 6. Nullable so the column can be added to a populated
-- table before the backfill below runs.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_households_join_code_format'
  ) then
    alter table public.households
      add constraint chk_households_join_code_format
      check (join_code is null or join_code ~ '^[0-9]{6}$');
  end if;
end $$;

-- Backfill a unique code for every pre-existing household.
do $$
declare
  h        record;
  new_code text;
  tries    integer;
begin
  for h in select id from public.households where join_code is null loop
    tries := 0;
    loop
      new_code := lpad((floor(random() * 1000000))::integer::text, 6, '0');
      exit when not exists (select 1 from public.households where join_code = new_code);
      tries := tries + 1;
      if tries > 100 then
        raise exception 'family_join_code: no unique join_code after 100 attempts';
      end if;
    end loop;
    update public.households
       set join_code = new_code, join_code_updated_at = now()
     where id = h.id;
  end loop;
end $$;

-- Uniqueness is what makes a code resolvable to exactly one household.
-- (Postgres unique indexes allow multiple NULLs, so this is safe if a row
-- somehow ends up without a code.)
create unique index if not exists idx_households_join_code
  on public.households (join_code);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) household_join_requests — pending queue awaiting owner approval
--
-- display_name/email are snapshotted at request time purely so the owner's
-- "Pending Join Requests" list can identify the person without the server
-- having to read auth.users on every render.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.household_join_requests (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  display_name text,
  email        text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users(id) on delete set null
);

create index if not exists idx_household_join_requests_household
  on public.household_join_requests (household_id, status, created_at desc);

create index if not exists idx_household_join_requests_user
  on public.household_join_requests (user_id, status);

-- At most ONE outstanding request per (household, user) — this is the DB-level
-- backstop for the "no duplicate requests" rule checked in the API layer.
create unique index if not exists idx_household_join_requests_pending_unique
  on public.household_join_requests (household_id, user_id)
  where status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────
-- 3) RLS — server writes go through supabaseAdmin (service role, bypasses
--    RLS) like the rest of this project; policies are the client-facing
--    backstop, mirroring family_menu_planner.sql.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.household_join_requests enable row level security;

-- The household owner can read and decide every request aimed at their household.
drop policy if exists "join_requests owner all" on public.household_join_requests;
create policy "join_requests owner all" on public.household_join_requests
  for all using (
    exists (select 1 from public.households h where h.id = household_join_requests.household_id and h.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.households h where h.id = household_join_requests.household_id and h.owner_id = auth.uid())
  );

-- A requester can read their own request (to poll "waiting for approval").
drop policy if exists "join_requests own read" on public.household_join_requests;
create policy "join_requests own read" on public.household_join_requests
  for select using (user_id = auth.uid());

-- A user may only ever file a request on their own behalf.
drop policy if exists "join_requests own insert" on public.household_join_requests;
create policy "join_requests own insert" on public.household_join_requests
  for insert with check (user_id = auth.uid());
