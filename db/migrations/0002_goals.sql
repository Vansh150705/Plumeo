-- Plumeo 0002 — goal lifecycle: cycles, review periods, goals, key results,
-- versions, approvals, delegations, amendments, progress history, templates.

create table cycles (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references orgs(id),
  name                      text not null check (length(trim(name)) > 0),
  starts_on                 date not null,
  ends_on                   date not null,
  goal_setting_opens_on     date,
  goal_setting_closes_on    date,
  status                    text not null default 'planning' check (status in ('planning', 'active', 'closed')),
  created_by                uuid,
  created_at                timestamptz not null default now(),
  unique (org_id, id),
  check (starts_on <= ends_on),
  check (goal_setting_opens_on is null or goal_setting_closes_on is null or goal_setting_opens_on <= goal_setting_closes_on)
);
create unique index cycles_name_idx on cycles (org_id, lower(name));

create table review_periods (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id),
  cycle_id    uuid not null,
  name        text not null,
  kind        text not null default 'quarterly' check (kind in ('quarterly', 'custom')),
  sequence    int not null,
  starts_on   date not null,
  ends_on     date not null,
  opens_on    date not null,    -- check-ins may be submitted from this day
  due_on      date not null,    -- after this day a missing check-in is overdue
  created_at  timestamptz not null default now(),
  unique (org_id, id),
  unique (cycle_id, sequence),
  foreign key (org_id, cycle_id) references cycles (org_id, id),
  check (starts_on <= ends_on),
  check (opens_on <= due_on)
);
create index review_periods_cycle_idx on review_periods (org_id, cycle_id, sequence);

create table goals (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id),
  cycle_id         uuid not null,
  level            text not null check (level in ('company', 'department', 'team', 'individual')),
  title            text not null check (length(trim(title)) > 0 and length(title) <= 200),
  description      text check (length(description) <= 5000),
  expected_outcome text check (length(expected_outcome) <= 2000),
  context          text check (length(context) <= 5000),
  owner_id         uuid not null,
  department_id    uuid,
  team_id          uuid,
  parent_goal_id   uuid,
  priority         text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status           text not null default 'draft'
                   check (status in ('draft', 'pending_approval', 'changes_requested', 'rejected', 'active', 'completed', 'cancelled')),
  start_date       date,
  due_date         date,
  weight           numeric(8,2) not null default 1 check (weight > 0 and weight <= 1000),
  progress_mode    text not null default 'own' check (progress_mode in ('own', 'rollup')),
  version          int not null default 1,           -- bumps on every persisted change (optimistic locking)
  content_version  int not null default 0,           -- bumps on each submission and each applied amendment (matches goal_versions.version)
  template_id      uuid,
  submitted_at     timestamptz,
  approved_at      timestamptz,
  completed_at     timestamptz,
  completion_note  text,
  cancelled_at     timestamptz,
  cancel_reason    text,
  deleted_at       timestamptz,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, cycle_id) references cycles (org_id, id),
  foreign key (org_id, owner_id) references users (org_id, id),
  foreign key (org_id, created_by) references users (org_id, id),
  foreign key (org_id, department_id) references departments (org_id, id),
  foreign key (org_id, team_id) references teams (org_id, id),
  foreign key (org_id, parent_goal_id) references goals (org_id, id),
  constraint goals_dates check (start_date is null or due_date is null or start_date <= due_date),
  constraint goals_no_self_parent check (parent_goal_id is distinct from id),
  constraint goals_dept_level check (level <> 'department' or department_id is not null),
  constraint goals_team_level check (level <> 'team' or team_id is not null)
);
create index goals_owner_idx   on goals (org_id, owner_id, status) where deleted_at is null;
create index goals_cycle_idx   on goals (org_id, cycle_id, status) where deleted_at is null;
create index goals_parent_idx  on goals (org_id, parent_goal_id) where deleted_at is null;
create index goals_dept_idx    on goals (org_id, department_id) where deleted_at is null;
create index goals_team_idx    on goals (org_id, team_id) where deleted_at is null;
create index goals_due_idx     on goals (org_id, due_date) where status = 'active' and deleted_at is null;
create index goals_level_idx   on goals (org_id, level, status) where deleted_at is null;

-- Alignment rules enforced in the database: parent must be at the same or a higher
-- organisational level (company > department > team > individual), same-level
-- nesting is limited to department/team goals, and the tree must be acyclic.
create or replace function plumeo_guard_goal_alignment() returns trigger language plpgsql as $$
declare
  p goals%rowtype; cur uuid; depth int := 0;
  rank_of constant jsonb := '{"company":0,"department":1,"team":2,"individual":3}';
begin
  if new.parent_goal_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.parent_goal_id is not distinct from old.parent_goal_id and new.level = old.level then
    return new;
  end if;
  select * into p from goals where org_id = new.org_id and id = new.parent_goal_id;
  if not found then raise exception 'parent goal not found' using errcode = '23503'; end if;
  if (rank_of ->> p.level)::int > (rank_of ->> new.level)::int then
    raise exception 'a % goal cannot align to a % goal', new.level, p.level using errcode = '23514';
  end if;
  if p.level = new.level and new.level in ('company', 'individual') then
    raise exception 'a % goal cannot align to another % goal', new.level, p.level using errcode = '23514';
  end if;
  if p.cycle_id <> new.cycle_id then
    raise exception 'parent goal belongs to a different cycle' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('goal-tree:' || new.org_id::text, 0));
  cur := new.parent_goal_id;
  while cur is not null loop
    if cur = new.id then raise exception 'goal alignment cycle detected' using errcode = '23514'; end if;
    depth := depth + 1;
    if depth > 12 then raise exception 'goal alignment too deep' using errcode = '23514'; end if;
    select parent_goal_id into cur from goals where org_id = new.org_id and id = cur;
  end loop;
  return new;
end $$;
create trigger trg_goal_alignment before insert or update of parent_goal_id, level on goals
  for each row execute function plumeo_guard_goal_alignment();

create table key_results (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id),
  goal_id       uuid not null,
  title         text not null check (length(trim(title)) > 0 and length(title) <= 300),
  metric_type   text not null default 'number' check (metric_type in ('number', 'percent', 'currency', 'boolean')),
  direction     text not null default 'increase' check (direction in ('increase', 'decrease')),
  unit          text check (length(unit) <= 20),
  start_value   numeric not null default 0,
  target_value  numeric not null,
  current_value numeric,
  weight        numeric(8,2) not null default 1 check (weight > 0 and weight <= 1000),
  position      int not null default 0,
  removed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, goal_id) references goals (org_id, id),
  constraint kr_distinct check (start_value <> target_value),
  constraint kr_direction check (
    (direction = 'increase' and target_value > start_value) or (direction = 'decrease' and target_value < start_value))
);
create index key_results_goal_idx on key_results (org_id, goal_id) where removed_at is null;

create table goal_collaborators (
  org_id     uuid not null references orgs(id),
  goal_id    uuid not null,
  user_id    uuid not null,
  role       text not null default 'contributor' check (role in ('contributor', 'reviewer')),
  added_by   uuid,
  added_at   timestamptz not null default now(),
  primary key (goal_id, user_id),
  foreign key (org_id, goal_id) references goals (org_id, id),
  foreign key (org_id, user_id) references users (org_id, id)
);
create index goal_collab_user_idx on goal_collaborators (org_id, user_id);

-- Immutable snapshots: one row per content version (create, submit, amendment...).
create table goal_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id),
  goal_id         uuid not null,
  version         int not null,
  snapshot        jsonb not null,
  change_summary  text,
  change_reason   text,
  changed_by      uuid,
  amendment_id    uuid,
  created_at      timestamptz not null default now(),
  unique (goal_id, version),
  foreign key (org_id, goal_id) references goals (org_id, id)
);

-- Append-only record of every progress value ever recorded against a key result.
create table progress_updates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id),
  goal_id        uuid not null,
  key_result_id  uuid not null,
  value          numeric not null,
  previous_value numeric,
  progress_pct   numeric,       -- KR progress (0-100) at the time of recording
  note           text check (length(note) <= 1000),
  source         text not null default 'manual' check (source in ('manual', 'checkin', 'import')),
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  foreign key (org_id, goal_id) references goals (org_id, id),
  foreign key (org_id, key_result_id) references key_results (org_id, id)
);
create index progress_goal_idx on progress_updates (org_id, goal_id, created_at desc);
create index progress_kr_idx on progress_updates (org_id, key_result_id, created_at desc);

create table goal_amendments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id),
  goal_id         uuid not null,
  base_version    int not null,
  changes         jsonb not null,           -- validated patch (fields + key result operations)
  change_kinds    text[] not null default '{}',   -- target | deadline | owner | scope
  reason          text not null check (length(trim(reason)) >= 5),
  significant     boolean not null,
  status          text not null check (status in ('pending_approval', 'applied', 'rejected', 'withdrawn')),
  requested_by    uuid not null,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  applied_version int,
  unique (org_id, id),
  foreign key (org_id, goal_id) references goals (org_id, id)
);
create unique index amendments_one_pending on goal_amendments (goal_id) where status = 'pending_approval';
create index amendments_goal_idx on goal_amendments (org_id, goal_id, requested_at desc);

create table approval_requests (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id),
  goal_id          uuid not null,
  amendment_id     uuid,
  round            int not null,                 -- submission round (resubmissions increment it)
  level            int not null check (level between 1 and 3),
  approver_id      uuid,                         -- null = pool of holders of goals.approve_any
  status           text not null check (status in ('waiting', 'pending', 'approved', 'rejected', 'changes_requested', 'superseded', 'cancelled')),
  goal_version     int not null,
  requested_by     uuid not null,
  requested_at     timestamptz not null default now(),
  activated_at     timestamptz,                  -- when this level became actionable
  due_at           timestamptz,
  decided_by       uuid,
  on_behalf_of     uuid,
  decided_at       timestamptz,
  decision_comment text,
  reminder_count   int not null default 0,
  last_reminded_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, goal_id) references goals (org_id, id),
  foreign key (org_id, amendment_id) references goal_amendments (org_id, id),
  foreign key (org_id, approver_id) references users (org_id, id),
  foreign key (org_id, decided_by) references users (org_id, id),
  constraint approval_decided_consistent check ((status in ('approved', 'rejected', 'changes_requested')) = (decided_at is not null))
);
-- At most ONE actionable request per subject: the database, not application timing, prevents double decisions.
create unique index approval_one_pending_goal on approval_requests (goal_id) where status = 'pending' and amendment_id is null;
create unique index approval_one_pending_amendment on approval_requests (amendment_id) where status = 'pending' and amendment_id is not null;
create index approval_approver_idx on approval_requests (org_id, approver_id, status);
create index approval_goal_idx on approval_requests (org_id, goal_id, round, level);
create index approval_pending_due_idx on approval_requests (org_id, due_at) where status = 'pending';

create table approval_delegations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id),
  delegator_id  uuid not null,
  delegate_id   uuid not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  reason        text,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  foreign key (org_id, delegator_id) references users (org_id, id),
  foreign key (org_id, delegate_id) references users (org_id, id),
  check (delegator_id <> delegate_id),
  check (ends_at > starts_at)
);
create index delegations_delegate_idx on approval_delegations (org_id, delegate_id) where revoked_at is null;
create index delegations_delegator_idx on approval_delegations (org_id, delegator_id) where revoked_at is null;

create table goal_templates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id),
  name           text not null check (length(trim(name)) > 0 and length(name) <= 120),
  description    text,
  level          text not null check (level in ('company', 'department', 'team', 'individual')),
  department_id  uuid,
  content        jsonb not null,
  usage_count    int not null default 0,
  created_by     uuid not null,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, department_id) references departments (org_id, id)
);

create trigger trg_goals_touch before update on goals for each row execute function plumeo_touch_updated_at();
create trigger trg_kr_touch before update on key_results for each row execute function plumeo_touch_updated_at();

call plumeo_secure_table('cycles');
call plumeo_secure_table('review_periods');
call plumeo_secure_table('goals');
call plumeo_secure_table('key_results');
call plumeo_secure_table('goal_collaborators');
call plumeo_secure_table('goal_versions', true);
call plumeo_secure_table('progress_updates', true);
call plumeo_secure_table('goal_amendments');
call plumeo_secure_table('approval_requests');
call plumeo_secure_table('approval_delegations');
call plumeo_secure_table('goal_templates');
