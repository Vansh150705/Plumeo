-- 360° / peer feedback. Lets peers and skip-level managers leave structured,
-- ratings-plus-comment feedback on a colleague during a cycle. Visibility decides
-- whether the subject sees it ("Manager" = shared with them) or only their
-- management chain does ("Private"). RLS enforces all of that at the DB layer,
-- consistent with the rest of the schema.

create type feedback_visibility as enum ('Manager', 'Private');

create table public.feedback (
  id          uuid primary key default uuid_generate_v4(),
  cycle_id    uuid references public.cycles(id) on delete cascade,
  subject_id  uuid not null references public.users(id) on delete cascade,   -- who the feedback is about
  author_id   uuid not null references public.users(id) on delete cascade,   -- who wrote it
  goal_id     uuid references public.goals(id) on delete set null,           -- optional: tied to one goal
  rating      int  not null check (rating between 1 and 5),
  comment     text not null,
  visibility  feedback_visibility not null default 'Manager',
  created_at  timestamptz default now()
);
create index feedback_subject_idx on public.feedback(subject_id);
create index feedback_author_idx  on public.feedback(author_id);

alter table public.feedback enable row level security;

-- Read: authors see their own; admins see all; a manager sees everything about
-- their report; the subject sees only what was explicitly shared with them.
create policy "feedback_select" on public.feedback for select using (
  author_id = auth.uid()
  or current_user_role() = 'Admin'
  or is_manager_of(subject_id)
  or (visibility = 'Manager' and subject_id = auth.uid())
);

-- Write: anyone signed in may leave feedback as themselves, about someone else.
create policy "feedback_insert" on public.feedback for insert with check (
  author_id = auth.uid() and subject_id <> auth.uid()
);

-- Authors may withdraw their own feedback.
create policy "feedback_delete_own" on public.feedback for delete using (
  author_id = auth.uid()
);
