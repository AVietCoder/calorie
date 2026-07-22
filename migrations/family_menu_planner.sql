-- =============================================================================
-- family_menu_planner — AI Personalized Weekly Menu Planner (MVP)
--
-- Adds: households (family|chef mode, switchable) + members, a curated menu
-- template library (Excel/Admin-form ingestion, not AI-generated), a
-- data-driven rule engine (allergy/disease for MVP), plan instances built
-- FROM a template (never invented from scratch), a full adjustment audit
-- trail, and a shopping list.
--
-- Safe & additive: does NOT touch profiles/foods/nutrition_anchors/chat_*/
-- kb_*/admin_* tables. Idempotent (IF NOT EXISTS everywhere). Run once in
-- the Supabase SQL Editor.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) HOUSEHOLDS & MEMBERS
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.households (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  mode          text not null default 'chef' check (mode in ('family', 'chef')),
  region        text,
  budget_week   numeric,
  cooking_skill text,
  equipment     jsonb not null default '[]'::jsonb,
  meals_per_day integer not null default 3,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_households_owner on public.households (owner_id);

-- One household per owner for MVP (a "chef"/family head manages exactly one household).
create unique index if not exists idx_households_owner_unique on public.households (owner_id);

create table if not exists public.household_members (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  kind            text not null check (kind in ('linked', 'dependent')),
  user_id         uuid references auth.users(id) on delete cascade,
  display_name    text not null,
  relation        text,
  birth_year      integer,
  gender          text,
  height          numeric,
  weight          numeric,
  target_weight   numeric,
  goal            text,
  activity_level  numeric,
  disease         text,
  allergies       text[] not null default '{}',
  medications     text[] not null default '{}',
  religion        text,
  dislikes        text[] not null default '{}',
  likes           text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_linked_has_user check (
    (kind = 'linked' and user_id is not null) or
    (kind = 'dependent' and user_id is null)
  )
);

create index if not exists idx_household_members_household on public.household_members (household_id);

-- A real user can only be linked into a household once.
create unique index if not exists idx_household_members_user_unique
  on public.household_members (household_id, user_id)
  where kind = 'linked';

create table if not exists public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email        text not null,
  code         text not null unique,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'expired')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days')
);

create index if not exists idx_household_invites_code on public.household_invites (code);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) MENU TEMPLATE LIBRARY (curated — never AI-generated from scratch)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.menu_templates (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  tags               text[] not null default '{}',   -- goal/region/diet_type/age_group/budget_tier
  disease_target     text[] not null default '{}',
  status             text not null default 'published' check (status in ('draft', 'published')),
  visibility         text not null default 'public' check (visibility in ('public', 'private')),
  owner_household_id uuid references public.households(id) on delete set null,
  source             text,
  version            integer not null default 1,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_menu_templates_visibility on public.menu_templates (visibility, status);
create index if not exists idx_menu_templates_owner on public.menu_templates (owner_household_id);
create index if not exists idx_menu_templates_tags on public.menu_templates using gin (tags);

create table if not exists public.menu_template_days (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.menu_templates(id) on delete cascade,
  day_index   integer not null check (day_index between 1 and 7)
);

create index if not exists idx_menu_template_days_template on public.menu_template_days (template_id);

create table if not exists public.menu_template_meals (
  id              uuid primary key default gen_random_uuid(),
  template_day_id uuid not null references public.menu_template_days(id) on delete cascade,
  meal_type       text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack'))
);

create index if not exists idx_menu_template_meals_day on public.menu_template_meals (template_day_id);

create table if not exists public.menu_template_dishes (
  id               uuid primary key default gen_random_uuid(),
  template_meal_id uuid not null references public.menu_template_meals(id) on delete cascade,
  name             text not null,
  base_grams       numeric,
  calories         numeric,
  protein          numeric,
  fat              numeric,
  carbs            numeric,
  fiber            numeric,
  sugar            numeric,
  sodium           numeric,
  tags             text[] not null default '{}',  -- allergen / diet tags used by the Rule Engine
  source           text default 'manual',
  confidence       text default 'medium'
);

create index if not exists idx_menu_template_dishes_meal on public.menu_template_dishes (template_meal_id);
create index if not exists idx_menu_template_dishes_tags on public.menu_template_dishes using gin (tags);

create table if not exists public.menu_template_dish_ingredients (
  id       uuid primary key default gen_random_uuid(),
  dish_id  uuid not null references public.menu_template_dishes(id) on delete cascade,
  name     text not null,
  grams    numeric,
  unit     text default 'g',
  tags     text[] not null default '{}'
);

create index if not exists idx_menu_template_dish_ingredients_dish on public.menu_template_dish_ingredients (dish_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) RULE ENGINE (data-driven — MVP: allergy + disease only)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.rules (
  id              uuid primary key default gen_random_uuid(),
  condition_type  text not null check (condition_type in (
                     'allergy', 'disease', 'religion', 'dislike', 'region',
                     'budget', 'season', 'cook_time', 'skill', 'household_size', 'age_group'
                   )),
  condition_value text not null,
  action_type     text not null check (action_type in ('exclude', 'substitute', 'scale')),
  action_value    jsonb not null default '{}'::jsonb,
  priority        integer not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists idx_rules_active on public.rules (active, condition_type);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) PLAN INSTANCES (built FROM a template, then adjusted) + AUDIT
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_menu_plans (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  source_template_id uuid references public.menu_templates(id) on delete set null,
  scope             text not null default 'household' check (scope in ('household', 'person')),
  person_member_id  uuid references public.household_members(id) on delete set null,
  week_start_date   date not null default current_date,
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_weekly_menu_plans_household on public.weekly_menu_plans (household_id, status);

create table if not exists public.plan_days (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references public.weekly_menu_plans(id) on delete cascade,
  day_index integer not null check (day_index between 1 and 7)
);

create index if not exists idx_plan_days_plan on public.plan_days (plan_id);

create table if not exists public.plan_meals (
  id         uuid primary key default gen_random_uuid(),
  plan_day_id uuid not null references public.plan_days(id) on delete cascade,
  meal_type  text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack'))
);

create index if not exists idx_plan_meals_day on public.plan_meals (plan_day_id);

create table if not exists public.plan_dishes (
  id                     uuid primary key default gen_random_uuid(),
  plan_meal_id           uuid not null references public.plan_meals(id) on delete cascade,
  source_template_dish_id uuid references public.menu_template_dishes(id) on delete set null,
  name                   text not null,
  grams                  numeric,
  calories               numeric,
  protein                numeric,
  fat                    numeric,
  carbs                  numeric,
  fiber                  numeric,
  sugar                  numeric,
  sodium                 numeric,
  tags                   text[] not null default '{}'
);

create index if not exists idx_plan_dishes_meal on public.plan_dishes (plan_meal_id);

create table if not exists public.plan_dish_ingredients (
  id      uuid primary key default gen_random_uuid(),
  dish_id uuid not null references public.plan_dishes(id) on delete cascade,
  name    text not null,
  grams   numeric,
  unit    text default 'g',
  tags    text[] not null default '{}'
);

create index if not exists idx_plan_dish_ingredients_dish on public.plan_dish_ingredients (dish_id);

create table if not exists public.menu_adjustment_audit (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.weekly_menu_plans(id) on delete cascade,
  plan_dish_id  uuid references public.plan_dishes(id) on delete set null,
  before        jsonb,
  after         jsonb,
  rule_id       uuid references public.rules(id) on delete set null,
  reason        text,
  ai_request_id text,  -- reserved for Phase 3 (LLM-assisted ranking); unused in MVP
  actor         text not null default 'system' check (actor in ('system', 'user', 'ai')),
  created_at    timestamptz not null default now()
);

create index if not exists idx_menu_adjustment_audit_plan on public.menu_adjustment_audit (plan_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) SHOPPING LIST
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.shopping_lists (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.weekly_menu_plans(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_shopping_lists_plan on public.shopping_lists (plan_id);

create table if not exists public.shopping_list_items (
  id        uuid primary key default gen_random_uuid(),
  list_id   uuid not null references public.shopping_lists(id) on delete cascade,
  name      text not null,
  total_qty numeric,
  unit      text,
  category  text,
  est_cost  numeric
);

create index if not exists idx_shopping_list_items_list on public.shopping_list_items (list_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 6) RLS — server writes go through supabaseAdmin (service role, bypasses
--    RLS) exactly like the rest of this project (see lib/supabase.js).
--    Policies below are the client-facing read/write backstop.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.menu_templates enable row level security;
alter table public.menu_template_days enable row level security;
alter table public.menu_template_meals enable row level security;
alter table public.menu_template_dishes enable row level security;
alter table public.menu_template_dish_ingredients enable row level security;
alter table public.rules enable row level security;
alter table public.weekly_menu_plans enable row level security;
alter table public.plan_days enable row level security;
alter table public.plan_meals enable row level security;
alter table public.plan_dishes enable row level security;
alter table public.plan_dish_ingredients enable row level security;
alter table public.menu_adjustment_audit enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_list_items enable row level security;

-- households: owner full access; any linked member can read.
drop policy if exists "household owner all" on public.households;
create policy "household owner all" on public.households
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "household linked member read" on public.households;
create policy "household linked member read" on public.households
  for select using (
    exists (
      select 1 from public.household_members m
      where m.household_id = households.id and m.kind = 'linked' and m.user_id = auth.uid()
    )
  );

-- household_members: owner full access; a linked member can read (not write) their household's roster.
drop policy if exists "household_members owner all" on public.household_members;
create policy "household_members owner all" on public.household_members
  for all using (
    exists (select 1 from public.households h where h.id = household_members.household_id and h.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.households h where h.id = household_members.household_id and h.owner_id = auth.uid())
  );

drop policy if exists "household_members linked read" on public.household_members;
create policy "household_members linked read" on public.household_members
  for select using (
    exists (
      select 1 from public.household_members m
      where m.household_id = household_members.household_id and m.kind = 'linked' and m.user_id = auth.uid()
    )
  );

-- menu_templates: public+published readable by any authenticated user; private only by household members/owner.
drop policy if exists "menu_templates read public" on public.menu_templates;
create policy "menu_templates read public" on public.menu_templates
  for select using (visibility = 'public' and status = 'published');

drop policy if exists "menu_templates read own household" on public.menu_templates;
create policy "menu_templates read own household" on public.menu_templates
  for select using (
    owner_household_id is not null and (
      exists (select 1 from public.households h where h.id = owner_household_id and h.owner_id = auth.uid())
      or exists (
        select 1 from public.household_members m
        where m.household_id = owner_household_id and m.kind = 'linked' and m.user_id = auth.uid()
      )
    )
  );

-- weekly_menu_plans / plan_* / audit / shopping_*: readable by owner or any linked household member.
drop policy if exists "weekly_menu_plans household access" on public.weekly_menu_plans;
create policy "weekly_menu_plans household access" on public.weekly_menu_plans
  for select using (
    exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid())
    or exists (
      select 1 from public.household_members m
      where m.household_id = weekly_menu_plans.household_id and m.kind = 'linked' and m.user_id = auth.uid()
    )
  );

-- ============================================================
-- Seed a small set of MVP rules (allergy + disease). Adjust condition_value
-- strings to match how household_members.allergies/disease are populated by
-- the UI. Safe to re-run: guarded by a NOT EXISTS check per row.
-- ============================================================
insert into public.rules (condition_type, condition_value, action_type, action_value, priority)
select 'allergy', 'tôm', 'exclude', '{"tag": "tôm"}'::jsonb, 10
where not exists (select 1 from public.rules where condition_type = 'allergy' and condition_value = 'tôm');

insert into public.rules (condition_type, condition_value, action_type, action_value, priority)
select 'allergy', 'hải sản', 'exclude', '{"tag": "hải sản"}'::jsonb, 10
where not exists (select 1 from public.rules where condition_type = 'allergy' and condition_value = 'hải sản');

insert into public.rules (condition_type, condition_value, action_type, action_value, priority)
select 'allergy', 'đậu phộng', 'exclude', '{"tag": "đậu phộng"}'::jsonb, 10
where not exists (select 1 from public.rules where condition_type = 'allergy' and condition_value = 'đậu phộng');

insert into public.rules (condition_type, condition_value, action_type, action_value, priority)
select 'disease', 'tiểu đường', 'exclude', '{"tag": "high-sugar"}'::jsonb, 5
where not exists (select 1 from public.rules where condition_type = 'disease' and condition_value = 'tiểu đường');

insert into public.rules (condition_type, condition_value, action_type, action_value, priority)
select 'disease', 'gout', 'exclude', '{"tag": "high-purine"}'::jsonb, 5
where not exists (select 1 from public.rules where condition_type = 'disease' and condition_value = 'gout');

insert into public.rules (condition_type, condition_value, action_type, action_value, priority)
select 'disease', 'huyết áp', 'exclude', '{"tag": "high-sodium"}'::jsonb, 5
where not exists (select 1 from public.rules where condition_type = 'disease' and condition_value = 'huyết áp');
