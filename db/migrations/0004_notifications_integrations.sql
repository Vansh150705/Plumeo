-- Plumeo 0004 — notifications (outbox + delivery state), preferences, identity
-- providers (OIDC), SCIM tokens, chat webhooks, auth flows, job bookkeeping.

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id),
  user_id      uuid not null,
  category     text not null,    -- approvals | goals | checkins | feedback | org
  type         text not null,
  title        text not null,
  body         text not null,
  link         text,
  entity_type  text,
  entity_id    uuid,
  dedupe_key   text,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (org_id, user_id) references users (org_id, id)
);
-- Duplicate prevention: the same event key can only notify a user once.
create unique index notifications_dedupe_idx on notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_inbox_idx on notifications (org_id, user_id, created_at desc);
create index notifications_unread_idx on notifications (org_id, user_id) where read_at is null;

create table notification_preferences (
  org_id    uuid not null references orgs(id),
  user_id   uuid not null,
  category  text not null check (category in ('approvals', 'goals', 'checkins', 'feedback', 'org')),
  in_app    boolean not null default true,
  email     boolean not null default true,
  primary key (user_id, category),
  foreign key (org_id, user_id) references users (org_id, id)
);

create table webhook_integrations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id),
  kind         text not null check (kind in ('slack', 'teams')),
  name         text not null,
  url_enc      text not null,            -- AES-256-GCM encrypted incoming-webhook URL
  url_hint     text not null,            -- non-secret display hint (host only)
  events       text[] not null default '{}',
  enabled      boolean not null default true,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  unique (org_id, id)
);

create table notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id),
  channel         text not null check (channel in ('email', 'slack', 'teams')),
  notification_id uuid,
  integration_id  uuid,
  user_id         uuid,
  payload         jsonb not null,
  dedupe_key      text,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dead', 'skipped')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until    timestamptz,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (org_id, integration_id) references webhook_integrations (org_id, id)
);
create unique index deliveries_dedupe_idx on notification_deliveries (org_id, channel, dedupe_key) where dedupe_key is not null;
create index deliveries_due_idx on notification_deliveries (next_attempt_at) where status in ('pending', 'failed');
create index deliveries_org_idx on notification_deliveries (org_id, created_at desc);

create table identity_providers (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) unique,
  kind              text not null default 'oidc' check (kind = 'oidc'),
  issuer            text not null,
  client_id         text not null,
  client_secret_enc text not null,
  scopes            text not null default 'openid profile email',
  allowed_domains   text[] not null default '{}',
  jit_provisioning  boolean not null default false,
  enforce_sso       boolean not null default false,   -- disables password login for non-admins
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table scim_tokens (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id),
  name          text not null,
  token_hash    text not null unique,
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- Short-lived state for SSO logins (PKCE verifier, nonce, state hash).
create table auth_flows (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id),
  state_hash     text not null unique,
  nonce          text not null,
  code_verifier  text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

-- One-time tokens for invitations and password resets (only a hash is stored).
create table credential_tokens (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id),
  user_id     uuid not null,
  purpose     text not null check (purpose in ('invite', 'reset')),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  foreign key (org_id, user_id) references users (org_id, id)
);
create index credential_tokens_user_idx on credential_tokens (org_id, user_id);

create table job_runs (
  name         text primary key,
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_status  text,
  last_detail  jsonb
);
alter table job_runs enable row level security;
alter table job_runs force row level security;
create policy job_system_only on job_runs using (app_is_system()) with check (app_is_system());
grant select, insert, update on job_runs to plumeo_app_role;

call plumeo_secure_table('notifications');
call plumeo_secure_table('notification_preferences');
call plumeo_secure_table('webhook_integrations');
call plumeo_secure_table('notification_deliveries');
call plumeo_secure_table('identity_providers');
call plumeo_secure_table('scim_tokens');
call plumeo_secure_table('auth_flows');
call plumeo_secure_table('credential_tokens');
