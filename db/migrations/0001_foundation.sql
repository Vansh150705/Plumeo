-- Plumeo 0001 — foundation: tenancy helpers, organisations, identity, structure,
-- RBAC, sessions, the hash-chained audit log, rate limiting and idempotency.
--
-- TENANCY MODEL
--   * Every tenant table carries org_id NOT NULL.
--   * Child rows reference parents with COMPOSITE foreign keys (org_id, id) so the
--     database itself refuses cross-organisation references.
--   * Row Level Security is ENABLED and FORCED on every tenant table. A policy lets
--     a row through only when org_id = app_org(), where app_org() reads the
--     transaction-local setting `app.org_id` that the application sets at the start
--     of every transaction. With no setting, no rows are visible (fail closed).
--   * `app.system = 'on'` is a narrow escape hatch used only for pre-authentication
--     lookups (login, session validation, SCIM token lookup) and background sweeps.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'plumeo_app_role') then
    create role plumeo_app_role nologin;
  end if;
end $$;

create or replace function app_org() returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

create or replace function app_is_system() returns boolean language sql stable as $$
  select coalesce(current_setting('app.system', true), '') = 'on'
$$;

create or replace function plumeo_block_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'table % is append-only', tg_table_name using errcode = '55000';
end $$;

create or replace function plumeo_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Applies the standard tenant protections to a table: RLS (forced), a tenant
-- policy, grants for the application role, and (optionally) append-only triggers.
create or replace procedure plumeo_secure_table(t regclass, p_immutable boolean default false)
language plpgsql as $$
declare
  tname text := (select relname from pg_class where oid = t);
begin
  execute format('alter table %s enable row level security', t);
  execute format('alter table %s force row level security', t);
  execute format('drop policy if exists tenant_isolation on %s', t);
  execute format(
    'create policy tenant_isolation on %s using (org_id = app_org() or app_is_system()) with check (org_id = app_org() or app_is_system())', t);
  if p_immutable then
    execute format('grant select, insert on %s to plumeo_app_role', t);
    execute format('revoke update, delete, truncate on %s from plumeo_app_role', t);
    execute format('drop trigger if exists trg_append_only on %s', t);
    execute format('create trigger trg_append_only before update or delete on %s for each row execute function plumeo_block_mutation()', t);
    execute format('drop trigger if exists trg_no_truncate on %s', t);
    execute format('create trigger trg_no_truncate before truncate on %s for each statement execute function plumeo_block_mutation()', t);
  else
    execute format('grant select, insert, update, delete on %s to plumeo_app_role', t);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Organisations
-- ---------------------------------------------------------------------------
create table orgs (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name        text not null check (length(name) between 2 and 120),
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table orgs enable row level security;
alter table orgs force row level security;
create policy org_self on orgs using (id = app_org() or app_is_system()) with check (id = app_org() or app_is_system());
grant select, insert, update on orgs to plumeo_app_role;

create table platform_admins (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique check (email = lower(email)),
  full_name      text not null,
  password_hash  text not null,
  failed_login_count int not null default 0,
  locked_until   timestamptz,
  created_at     timestamptz not null default now()
);
alter table platform_admins enable row level security;
alter table platform_admins force row level security;
create policy platform_system_only on platform_admins using (app_is_system()) with check (app_is_system());
grant select, insert, update on platform_admins to plumeo_app_role;

create table org_policies (
  org_id      uuid primary key references orgs(id),
  settings    jsonb not null default '{}'::jsonb,
  version     int not null default 1,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Users, departments, teams
-- ---------------------------------------------------------------------------
create table users (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id),
  email              text not null check (email = lower(email) and position('@' in email) > 1),
  full_name          text not null check (length(trim(full_name)) > 0),
  job_title          text,
  employee_number    text,
  status             text not null default 'active'
                     check (status in ('invited', 'active', 'suspended', 'deactivated', 'anonymized')),
  manager_id         uuid,
  department_id      uuid,
  team_id            uuid,
  password_hash      text,
  password_changed_at timestamptz,
  failed_login_count int not null default 0,
  locked_until       timestamptz,
  external_id        text,           -- SCIM externalId
  oidc_subject       text,           -- IdP "sub" claim, bound on first SSO login
  last_login_at      timestamptz,
  deactivated_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, email),
  constraint users_no_self_manager check (manager_id is distinct from id),
  foreign key (org_id, manager_id) references users (org_id, id)
);
create index users_manager_idx    on users (org_id, manager_id);
create index users_department_idx on users (org_id, department_id);
create index users_team_idx       on users (org_id, team_id);
create unique index users_external_idx on users (org_id, external_id) where external_id is not null;
create unique index users_oidc_idx     on users (org_id, oidc_subject) where oidc_subject is not null;
create trigger trg_users_touch before update on users for each row execute function plumeo_touch_updated_at();

create table departments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id),
  name          text not null check (length(trim(name)) > 0),
  kind          text not null default 'department' check (kind in ('business_unit', 'department')),
  parent_id     uuid,
  head_user_id  uuid,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, parent_id) references departments (org_id, id),
  foreign key (org_id, head_user_id) references users (org_id, id),
  constraint departments_no_self_parent check (parent_id is distinct from id)
);
create unique index departments_name_idx on departments (org_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where archived_at is null;
create index departments_parent_idx on departments (org_id, parent_id);

create table teams (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id),
  department_id  uuid not null,
  parent_team_id uuid,
  name           text not null check (length(trim(name)) > 0),
  lead_user_id   uuid,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, department_id) references departments (org_id, id),
  foreign key (org_id, parent_team_id) references teams (org_id, id),
  foreign key (org_id, lead_user_id) references users (org_id, id),
  constraint teams_no_self_parent check (parent_team_id is distinct from id)
);
create unique index teams_name_idx on teams (org_id, department_id, lower(name)) where archived_at is null;
create index teams_department_idx on teams (org_id, department_id);
create index teams_parent_idx on teams (org_id, parent_team_id);

alter table users add foreign key (org_id, department_id) references departments (org_id, id);
alter table users add foreign key (org_id, team_id) references teams (org_id, id);

-- Reporting lines and org trees must stay acyclic. An advisory lock per org makes
-- concurrent re-parenting (A->B while B->A) serialise instead of racing past the check.
create or replace function plumeo_guard_user_tree() returns trigger language plpgsql as $$
declare cur uuid; depth int := 0;
begin
  if new.manager_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.manager_id is not distinct from old.manager_id then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('user-tree:' || new.org_id::text, 0));
  cur := new.manager_id;
  while cur is not null loop
    if cur = new.id then
      raise exception 'reporting line cycle detected' using errcode = '23514';
    end if;
    depth := depth + 1;
    if depth > 50 then raise exception 'reporting line too deep' using errcode = '23514'; end if;
    select manager_id into cur from users where org_id = new.org_id and id = cur;
  end loop;
  return new;
end $$;
create trigger trg_users_tree before insert or update of manager_id on users
  for each row execute function plumeo_guard_user_tree();

create or replace function plumeo_guard_dept_tree() returns trigger language plpgsql as $$
declare cur uuid; depth int := 0;
begin
  if new.parent_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('dept-tree:' || new.org_id::text, 0));
  cur := new.parent_id;
  while cur is not null loop
    if cur = new.id then raise exception 'department cycle detected' using errcode = '23514'; end if;
    depth := depth + 1;
    if depth > 20 then raise exception 'department tree too deep' using errcode = '23514'; end if;
    select parent_id into cur from departments where org_id = new.org_id and id = cur;
  end loop;
  return new;
end $$;
create trigger trg_dept_tree before insert or update of parent_id on departments
  for each row execute function plumeo_guard_dept_tree();

create or replace function plumeo_guard_team_tree() returns trigger language plpgsql as $$
declare cur uuid; depth int := 0;
begin
  if new.parent_team_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.parent_team_id is not distinct from old.parent_team_id then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('team-tree:' || new.org_id::text, 0));
  cur := new.parent_team_id;
  while cur is not null loop
    if cur = new.id then raise exception 'team cycle detected' using errcode = '23514'; end if;
    depth := depth + 1;
    if depth > 20 then raise exception 'team tree too deep' using errcode = '23514'; end if;
    select parent_team_id into cur from teams where org_id = new.org_id and id = cur;
  end loop;
  return new;
end $$;
create trigger trg_team_tree before insert or update of parent_team_id on teams
  for each row execute function plumeo_guard_team_tree();

-- Tree helpers used by visibility rules (all tenant-scoped through RLS + explicit org arg).
create or replace function reporting_subtree(p_org uuid, p_root uuid) returns setof uuid
language sql stable as $$
  with recursive t(id, depth) as (
    select u.id, 1 from users u where u.org_id = p_org and u.manager_id = p_root
    union all
    select u.id, t.depth + 1 from users u join t on u.manager_id = t.id
      where u.org_id = p_org and t.depth < 50
  ) select id from t
$$;

create or replace function department_descendants(p_org uuid, p_root uuid) returns setof uuid
language sql stable as $$
  with recursive d(id, depth) as (
    select p_root, 1
    union all
    select c.id, d.depth + 1 from departments c join d on c.parent_id = d.id
      where c.org_id = p_org and d.depth < 20
  ) select id from d
$$;

create or replace function department_ancestors(p_org uuid, p_leaf uuid) returns setof uuid
language sql stable as $$
  with recursive d(id, depth) as (
    select p_leaf, 1 where p_leaf is not null
    union all
    select p.id, d.depth + 1 from departments p join departments c on c.parent_id = p.id join d on d.id = c.id
      where p.org_id = p_org and d.depth < 20
  ) select id from d
$$;

create or replace function team_ancestors(p_org uuid, p_leaf uuid) returns setof uuid
language sql stable as $$
  with recursive t(id, depth) as (
    select p_leaf, 1 where p_leaf is not null
    union all
    select p.id, t.depth + 1 from teams p join teams c on c.parent_team_id = p.id join t on t.id = c.id
      where p.org_id = p_org and t.depth < 20
  ) select id from t
$$;

-- ---------------------------------------------------------------------------
-- RBAC: configurable roles made of permission strings
-- ---------------------------------------------------------------------------
create table roles (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id),
  key          text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name         text not null,
  description  text,
  permissions  text[] not null default '{}',
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, key)
);

create table user_roles (
  org_id      uuid not null references orgs(id),
  user_id     uuid not null,
  role_id     uuid not null,
  granted_by  uuid,
  granted_at  timestamptz not null default now(),
  primary key (user_id, role_id),
  foreign key (org_id, user_id) references users (org_id, id),
  foreign key (org_id, role_id) references roles (org_id, id)
);
create index user_roles_role_idx on user_roles (org_id, role_id);

-- ---------------------------------------------------------------------------
-- Sessions (opaque random tokens; only a SHA-256 of the token is stored)
-- ---------------------------------------------------------------------------
create table sessions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id),
  user_id       uuid not null,
  token_hash    text not null unique,
  auth_method   text not null default 'password' check (auth_method in ('password', 'oidc')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  ip            text,
  user_agent    text,
  foreign key (org_id, user_id) references users (org_id, id)
);
create index sessions_user_idx on sessions (org_id, user_id) where revoked_at is null;

create table platform_sessions (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null references platform_admins(id),
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);
alter table platform_sessions enable row level security;
alter table platform_sessions force row level security;
create policy platform_system_only on platform_sessions using (app_is_system()) with check (app_is_system());
grant select, insert, update on platform_sessions to plumeo_app_role;

-- ---------------------------------------------------------------------------
-- Audit log: append-only, per-organisation SHA-256 hash chain computed in the
-- database (the application cannot skip or forge the chain bookkeeping).
-- ---------------------------------------------------------------------------
create table audit_heads (
  org_id     uuid primary key references orgs(id),
  last_seq   bigint not null default 0,
  last_hash  text not null default repeat('0', 64)
);

create table audit_events (
  org_id       uuid not null references orgs(id),
  seq          bigint not null,
  id           uuid not null default gen_random_uuid(),
  occurred_at  timestamptz not null default clock_timestamp(),
  actor_id     uuid,
  actor_type   text not null default 'user' check (actor_type in ('user', 'system', 'scim', 'platform', 'anonymous')),
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  request_id   text,
  before_data  jsonb,
  after_data   jsonb,
  metadata     jsonb not null default '{}'::jsonb,
  prev_hash    text not null,
  hash         text not null,
  primary key (org_id, seq),
  unique (id)
);
create index audit_entity_idx on audit_events (org_id, entity_type, entity_id, seq desc);
create index audit_actor_idx  on audit_events (org_id, actor_id, seq desc);
create index audit_action_idx on audit_events (org_id, action, seq desc);
create index audit_time_idx   on audit_events (org_id, occurred_at desc);

create or replace function plumeo_audit_payload(e audit_events) returns text language sql immutable as $$
  select concat_ws('|',
    e.org_id::text, e.seq::text,
    to_char(e.occurred_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(e.actor_id::text, ''), e.actor_type, e.action, e.entity_type,
    coalesce(e.entity_id::text, ''), coalesce(e.request_id, ''),
    coalesce(e.before_data::text, ''), coalesce(e.after_data::text, ''),
    e.metadata::text, e.prev_hash)
$$;

create or replace function plumeo_audit_chain() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare h audit_heads%rowtype;
begin
  insert into audit_heads (org_id) values (new.org_id) on conflict (org_id) do nothing;
  select * into h from audit_heads where org_id = new.org_id for update;
  new.seq := h.last_seq + 1;
  new.prev_hash := h.last_hash;
  new.occurred_at := clock_timestamp();
  new.hash := encode(digest(plumeo_audit_payload(new), 'sha256'), 'hex');
  update audit_heads set last_seq = new.seq, last_hash = new.hash where org_id = new.org_id;
  return new;
end $$;
create trigger trg_audit_chain before insert on audit_events
  for each row execute function plumeo_audit_chain();

-- Recomputes the chain. Returns the first broken sequence number, or NULL if intact.
create or replace function verify_audit_chain(p_org uuid, out checked bigint, out broken_seq bigint, out head_ok boolean)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare r audit_events; expect_prev text := repeat('0', 64); expect_seq bigint := 1; h audit_heads;
begin
  if p_org is distinct from app_org() and not app_is_system() then
    raise exception 'audit verification is limited to the current organisation' using errcode = '42501';
  end if;
  checked := 0; broken_seq := null;
  for r in select * from audit_events where org_id = p_org order by seq loop
    checked := checked + 1;
    if r.seq <> expect_seq or r.prev_hash <> expect_prev
       or r.hash <> encode(digest(plumeo_audit_payload(r), 'sha256'), 'hex') then
      broken_seq := r.seq; exit;
    end if;
    expect_prev := r.hash; expect_seq := expect_seq + 1;
  end loop;
  select * into h from audit_heads where org_id = p_org;
  head_ok := (h.org_id is null and checked = 0) or (h.last_seq = expect_seq - 1 and h.last_hash = expect_prev);
  if broken_seq is null and not head_ok then broken_seq := expect_seq; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Rate limiting and idempotency
-- ---------------------------------------------------------------------------
create table rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  count         int not null
);
grant select, insert, update, delete on rate_limits to plumeo_app_role;

create table idempotency_keys (
  org_id        uuid not null references orgs(id),
  user_id       uuid not null,
  key           text not null,
  request_hash  text not null,
  status_code   int,
  response      jsonb,
  created_at    timestamptz not null default now(),
  primary key (org_id, user_id, key)
);

call plumeo_secure_table('users');
call plumeo_secure_table('departments');
call plumeo_secure_table('teams');
call plumeo_secure_table('roles');
call plumeo_secure_table('user_roles');
call plumeo_secure_table('sessions');
call plumeo_secure_table('org_policies');
call plumeo_secure_table('idempotency_keys');
call plumeo_secure_table('audit_events', true);

-- audit_heads is touched only by the SECURITY DEFINER trigger above.
alter table audit_heads enable row level security;
alter table audit_heads force row level security;
create policy tenant_isolation on audit_heads using (org_id = app_org() or app_is_system()) with check (org_id = app_org() or app_is_system());
grant execute on function verify_audit_chain(uuid) to plumeo_app_role;
