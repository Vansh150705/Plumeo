-- Plumeo 0003 — quarterly (or custom-period) check-ins with immutable revisions,
-- manager feedback and follow-up actions.

create table checkins (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id),
  goal_id           uuid not null,
  period_id         uuid not null,
  owner_id          uuid not null,
  status            text not null default 'draft' check (status in ('draft', 'submitted', 'reviewed', 'reopened')),
  current_revision  int not null default 0,        -- latest submitted revision (0 = none yet)
  health            text check (health in ('on_track', 'at_risk', 'off_track', 'completed')),
  progress_snapshot numeric,                        -- goal progress frozen at last submission
  draft             jsonb,                          -- unsaved work-in-progress (mutable until submitted)
  submitted_at      timestamptz,
  is_late           boolean not null default false,
  reviewed_at       timestamptz,
  reviewed_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, id),
  unique (goal_id, period_id),
  foreign key (org_id, goal_id) references goals (org_id, id),
  foreign key (org_id, period_id) references review_periods (org_id, id),
  foreign key (org_id, owner_id) references users (org_id, id),
  foreign key (org_id, reviewed_by) references users (org_id, id)
);
create index checkins_owner_idx on checkins (org_id, owner_id, status);
create index checkins_period_idx on checkins (org_id, period_id, status);
create trigger trg_checkins_touch before update on checkins for each row execute function plumeo_touch_updated_at();

-- Each submission is frozen forever. Corrections create a new revision.
create table checkin_revisions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id),
  checkin_id    uuid not null,
  revision      int not null,
  kr_values     jsonb not null,       -- [{key_result_id, title, value, progress}]
  progress      numeric,
  health        text not null check (health in ('on_track', 'at_risk', 'off_track', 'completed')),
  achievements  text check (length(achievements) <= 4000),
  challenges    text check (length(challenges) <= 4000),
  blockers      text check (length(blockers) <= 4000),
  next_steps    text check (length(next_steps) <= 4000),
  reflection    text check (length(reflection) <= 4000),
  answers       jsonb not null default '{}'::jsonb,   -- answers to org-configured questions
  is_late       boolean not null default false,
  submitted_by  uuid not null,
  submitted_at  timestamptz not null default now(),
  unique (checkin_id, revision),
  foreign key (org_id, checkin_id) references checkins (org_id, id)
);

create table checkin_feedback (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id),
  checkin_id  uuid not null,
  revision    int not null,
  author_id   uuid not null,
  kind        text not null default 'feedback' check (kind in ('feedback', 'reopen')),
  body        text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at  timestamptz not null default now(),
  foreign key (org_id, checkin_id) references checkins (org_id, id),
  foreign key (org_id, author_id) references users (org_id, id)
);
create index checkin_feedback_idx on checkin_feedback (org_id, checkin_id, created_at);

create table action_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id),
  checkin_id    uuid,
  goal_id       uuid not null,
  assignee_id   uuid not null,
  title         text not null check (length(trim(title)) > 0 and length(title) <= 300),
  due_date      date,
  status        text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  foreign key (org_id, checkin_id) references checkins (org_id, id),
  foreign key (org_id, goal_id) references goals (org_id, id),
  foreign key (org_id, assignee_id) references users (org_id, id)
);
create index action_items_assignee_idx on action_items (org_id, assignee_id, status);
create index action_items_goal_idx on action_items (org_id, goal_id);

call plumeo_secure_table('checkins');
call plumeo_secure_table('checkin_revisions', true);
call plumeo_secure_table('checkin_feedback', true);
call plumeo_secure_table('action_items');
