-- Plumeo - database schema for the goal setting & tracking portal.
-- Covers the full lifecycle: goals, the audit trail, shared goals, escalations,
-- notifications, and the Entra ID user mapping. Role-based access is enforced
-- with Postgres + Supabase Row Level Security (RLS).

-- uuid + crypto helpers
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =============================================================================
-- ENUMS
-- =============================================================================
create type user_role        as enum ('Employee', 'Manager', 'Admin');
create type uom_type          as enum ('Numeric', 'Percentage', 'Timeline', 'Zero');
create type uom_direction     as enum ('min', 'max', 'timeline', 'zero');
create type sheet_status      as enum ('Draft', 'Submitted', 'Returned', 'Approved', 'Locked');
create type goal_progress     as enum ('NotStarted', 'OnTrack', 'AtRisk', 'Completed');
create type checkin_quarter   as enum ('Q1', 'Q2', 'Q3', 'Q4');
create type notif_channel     as enum ('Email', 'Teams', 'InApp');
create type escalation_level  as enum ('Employee', 'Manager', 'SkipLevel', 'HR');

-- =============================================================================
-- USERS  (mirrors auth.users; enriched with Entra ID attributes)
-- =============================================================================
create table public.users (
  id              uuid primary key,                              -- matches auth.users.id
  entra_oid       text unique,                                   -- Entra ID Object ID (oid claim)
  upn             text unique not null,                          -- userPrincipalName / email
  full_name       text not null,
  role            user_role not null default 'Employee',
  department      text,
  manager_id      uuid references public.users(id) on delete set null,
  entra_groups    text[] default '{}',                           -- AAD group names - drives role mapping
  avatar_color    text default '#f0b429',
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index users_manager_idx on public.users(manager_id);
create index users_role_idx    on public.users(role);

-- =============================================================================
-- CYCLES  (Admin creates an annual goal-setting cycle e.g. FY2025-26)
-- =============================================================================
create table public.cycles (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,                                  -- e.g. "FY 2025-26"
  fiscal_year     int not null,
  goal_window_start timestamptz not null,                          -- 1st May
  goal_window_end   timestamptz not null,                          -- before Q1
  q1_open         timestamptz not null,    q1_close timestamptz not null,
  q2_open         timestamptz not null,    q2_close timestamptz not null,
  q3_open         timestamptz not null,    q3_close timestamptz not null,
  q4_open         timestamptz not null,    q4_close timestamptz not null,
  is_active       boolean default true,
  created_by      uuid references public.users(id),
  created_at      timestamptz default now()
);

-- =============================================================================
-- GOAL SHEETS  (one per employee per cycle, holds approval state)
-- =============================================================================
create table public.goal_sheets (
  id              uuid primary key default uuid_generate_v4(),
  cycle_id        uuid not null references public.cycles(id) on delete cascade,
  employee_id     uuid not null references public.users(id) on delete cascade,
  status          sheet_status not null default 'Draft',
  submitted_at    timestamptz,
  approved_at     timestamptz,
  approved_by     uuid references public.users(id),
  returned_at     timestamptz,
  return_comment  text,
  locked_at       timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (cycle_id, employee_id)
);
create index goal_sheets_employee_idx on public.goal_sheets(employee_id);
create index goal_sheets_status_idx   on public.goal_sheets(status);

-- =============================================================================
-- GOALS  (individual KRA rows on a sheet)
-- BRD validation: max 8 per sheet, weightage 10–100, sum per sheet = 100.
-- Enforced both at DB level (constraints) and in business-logic layer.
-- =============================================================================
create table public.goals (
  id                uuid primary key default uuid_generate_v4(),
  sheet_id          uuid not null references public.goal_sheets(id) on delete cascade,
  thrust_area       text not null,
  title             text not null,
  description       text,
  uom               uom_type not null,
  direction         uom_direction not null,                -- min / max / timeline / zero
  target_numeric    numeric,                                -- used when uom in (Numeric, Percentage, Zero)
  target_date       date,                                   -- used when uom = Timeline
  weightage         int not null check (weightage between 10 and 100),
  -- shared-goal lineage
  is_shared_origin  boolean default false,                  -- true on the manager/admin's master copy
  shared_origin_id  uuid references public.goals(id) on delete set null,  -- non-null on recipients
  -- ordering
  display_order     int default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index goals_sheet_idx          on public.goals(sheet_id);
create index goals_shared_origin_idx  on public.goals(shared_origin_id);

-- Soft cap of 8 goals per sheet (enforced via trigger; constraint can't reference other rows portably)
create or replace function check_goal_limit() returns trigger as $$
begin
  if (select count(*) from public.goals where sheet_id = new.sheet_id) >= 8 then
    raise exception 'GOAL_LIMIT_EXCEEDED: A goal sheet can hold at most 8 goals.';
  end if;
  return new;
end; $$ language plpgsql;
create trigger trg_goal_limit before insert on public.goals
  for each row execute function check_goal_limit();

-- =============================================================================
-- CHECK-INS  (one row per goal per quarter; achievement capture)
-- =============================================================================
create table public.check_ins (
  id                  uuid primary key default uuid_generate_v4(),
  goal_id             uuid not null references public.goals(id) on delete cascade,
  quarter             checkin_quarter not null,
  actual_numeric      numeric,
  actual_date         date,
  zero_achieved       boolean,                              -- for Zero UoM: did 0 incidents hold?
  progress_status     goal_progress not null default 'NotStarted',
  employee_comment    text,
  manager_comment     text,
  manager_checked_at  timestamptz,
  manager_checked_by  uuid references public.users(id),
  computed_score      numeric,                              -- 0–100, computed by app and stored
  updated_at          timestamptz default now(),
  unique (goal_id, quarter)
);
create index checkins_goal_idx on public.check_ins(goal_id);

-- =============================================================================
-- AUDIT LOG  (BRD §4: every change after lock - who, what, when)
-- Captures changes on goals + check_ins + sheets.
-- =============================================================================
create table public.audit_log (
  id            bigserial primary key,
  entity_type   text not null,                              -- 'goal' | 'check_in' | 'sheet'
  entity_id     uuid not null,
  action        text not null,                              -- 'create' | 'update' | 'delete' | 'unlock' | ...
  before_data   jsonb,
  after_data    jsonb,
  actor_id      uuid references public.users(id),
  actor_name    text,
  reason        text,
  occurred_at   timestamptz default now()
);
create index audit_entity_idx  on public.audit_log(entity_type, entity_id);
create index audit_actor_idx   on public.audit_log(actor_id);
create index audit_time_idx    on public.audit_log(occurred_at desc);

-- =============================================================================
-- NOTIFICATIONS  (Email + Teams + InApp - see bonus §5.2)
-- Stored as a queue so a worker / cron / preview-mode can render them.
-- =============================================================================
create table public.notifications (
  id            uuid primary key default uuid_generate_v4(),
  recipient_id  uuid not null references public.users(id) on delete cascade,
  channel       notif_channel not null,
  subject       text not null,
  body          text not null,
  deep_link     text,                                       -- /employee/goals/<id>
  payload       jsonb,                                      -- raw event data
  sent_at       timestamptz,
  read_at       timestamptz,
  created_at    timestamptz default now()
);
create index notif_recipient_idx on public.notifications(recipient_id, read_at);

-- =============================================================================
-- ESCALATIONS  (bonus §5.3 - configurable rule-based escalations)
-- =============================================================================
create table public.escalation_rules (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  trigger_type  text not null,                              -- 'goal_not_submitted' | 'approval_pending' | 'checkin_overdue'
  threshold_days int not null,                              -- N days
  escalate_to   escalation_level not null,
  is_active     boolean default true,
  created_at    timestamptz default now()
);

create table public.escalation_events (
  id            uuid primary key default uuid_generate_v4(),
  rule_id       uuid references public.escalation_rules(id),
  subject_id    uuid references public.users(id),           -- whose lapse triggered this
  sheet_id      uuid references public.goal_sheets(id),
  level         escalation_level not null,
  reason        text,
  resolved_at   timestamptz,
  triggered_at  timestamptz default now()
);
create index escalation_events_subject_idx on public.escalation_events(subject_id);

-- =============================================================================
-- THRUST AREAS  (reference data - admin-configurable)
-- =============================================================================
create table public.thrust_areas (
  id          uuid primary key default uuid_generate_v4(),
  name        text unique not null,
  description text,
  is_active   boolean default true
);

-- =============================================================================
-- ROW LEVEL SECURITY  - enforces role separation at the DB layer.
-- This is the real "cost optimisation" win: no separate auth service required.
-- =============================================================================
alter table public.users           enable row level security;
alter table public.cycles          enable row level security;
alter table public.goal_sheets     enable row level security;
alter table public.goals           enable row level security;
alter table public.check_ins       enable row level security;
alter table public.audit_log       enable row level security;
alter table public.notifications   enable row level security;
alter table public.escalation_rules    enable row level security;
alter table public.escalation_events   enable row level security;
alter table public.thrust_areas    enable row level security;

-- Helper: current user's role
create or replace function public.current_user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

-- Helper: is current user the manager of this employee?
create or replace function public.is_manager_of(target_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.users
    where id = target_employee and manager_id = auth.uid()
  )
$$;

-- USERS policies
create policy "users_select_all" on public.users for select using (true);
create policy "users_update_self_or_admin" on public.users for update
  using (id = auth.uid() or current_user_role() = 'Admin');
create policy "users_insert_admin" on public.users for insert
  with check (current_user_role() = 'Admin');

-- CYCLES - read all, write Admin
create policy "cycles_select_all" on public.cycles for select using (true);
create policy "cycles_admin_write" on public.cycles for all
  using (current_user_role() = 'Admin') with check (current_user_role() = 'Admin');

-- GOAL SHEETS
create policy "sheets_owner_or_manager_or_admin_select" on public.goal_sheets for select using (
  employee_id = auth.uid()
  or is_manager_of(employee_id)
  or current_user_role() = 'Admin'
);
create policy "sheets_owner_modify_until_approved" on public.goal_sheets for update using (
  (employee_id = auth.uid() and status in ('Draft','Returned'))
  or is_manager_of(employee_id)
  or current_user_role() = 'Admin'
);
create policy "sheets_owner_create" on public.goal_sheets for insert with check (
  employee_id = auth.uid() or current_user_role() = 'Admin'
);

-- GOALS - mirror sheet policy via join
create policy "goals_select" on public.goals for select using (
  exists(
    select 1 from public.goal_sheets s
    where s.id = goals.sheet_id
      and (s.employee_id = auth.uid() or is_manager_of(s.employee_id) or current_user_role() = 'Admin')
  )
);
create policy "goals_modify" on public.goals for all using (
  exists(
    select 1 from public.goal_sheets s
    where s.id = goals.sheet_id
      and (
        (s.employee_id = auth.uid() and s.status in ('Draft','Returned'))
        or is_manager_of(s.employee_id)
        or current_user_role() = 'Admin'
      )
  )
);

-- CHECK-INS
create policy "checkins_select" on public.check_ins for select using (
  exists(
    select 1 from public.goals g
    join public.goal_sheets s on s.id = g.sheet_id
    where g.id = check_ins.goal_id
      and (s.employee_id = auth.uid() or is_manager_of(s.employee_id) or current_user_role() = 'Admin')
  )
);
create policy "checkins_modify" on public.check_ins for all using (
  exists(
    select 1 from public.goals g
    join public.goal_sheets s on s.id = g.sheet_id
    where g.id = check_ins.goal_id
      and (s.employee_id = auth.uid() or is_manager_of(s.employee_id) or current_user_role() = 'Admin')
  )
);

-- AUDIT LOG - Admin reads all, others read own
create policy "audit_select" on public.audit_log for select using (
  current_user_role() = 'Admin' or actor_id = auth.uid()
);
create policy "audit_insert_any" on public.audit_log for insert with check (true);

-- NOTIFICATIONS
create policy "notif_select_own" on public.notifications for select using (recipient_id = auth.uid());
create policy "notif_update_own" on public.notifications for update using (recipient_id = auth.uid());
create policy "notif_insert_any" on public.notifications for insert with check (true);

-- ESCALATIONS - Admin manages, all roles see events about themselves
create policy "escal_rules_admin" on public.escalation_rules for all
  using (current_user_role() = 'Admin') with check (current_user_role() = 'Admin');
create policy "escal_rules_select" on public.escalation_rules for select using (true);
create policy "escal_events_select" on public.escalation_events for select using (
  current_user_role() = 'Admin' or subject_id = auth.uid()
);
create policy "escal_events_insert" on public.escalation_events for insert with check (true);

-- THRUST AREAS
create policy "thrust_select" on public.thrust_areas for select using (true);
create policy "thrust_admin_write" on public.thrust_areas for all
  using (current_user_role() = 'Admin') with check (current_user_role() = 'Admin');

-- =============================================================================
-- TRIGGERS - updated_at maintenance
-- =============================================================================
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger trg_users_updated      before update on public.users      for each row execute function set_updated_at();
create trigger trg_sheets_updated     before update on public.goal_sheets for each row execute function set_updated_at();
create trigger trg_goals_updated      before update on public.goals      for each row execute function set_updated_at();
create trigger trg_checkins_updated   before update on public.check_ins  for each row execute function set_updated_at();

-- =============================================================================
-- VIEWS - convenience reads for dashboards
-- =============================================================================
create or replace view public.v_sheet_summary as
select
  s.id              as sheet_id,
  s.cycle_id,
  s.employee_id,
  u.full_name       as employee_name,
  u.department,
  u.manager_id,
  s.status,
  count(g.id)                                   as goal_count,
  coalesce(sum(g.weightage), 0)                 as total_weightage,
  count(g.id) filter (where g.is_shared_origin is false and g.shared_origin_id is not null) as shared_received_count
from public.goal_sheets s
join public.users u on u.id = s.employee_id
left join public.goals g on g.sheet_id = s.id
group by s.id, u.full_name, u.department, u.manager_id;
