-- Security hardening for the RLS layer.
--
-- Problems in 0001/0003 this migration fixes (each is covered by a probe in
-- tests/rls/ so a regression fails CI):
--   * any signed-in user could UPDATE their own users.role / manager_id (self-promotion to Admin)
--   * an employee could not submit their own sheet at all: the UPDATE policy's implicit
--     WITH CHECK rejected the new status 'Submitted'
--   * managers could not create a missing sheet for a report (shared-goal push)
--   * sheet state machine was not enforced: Draft -> Approved, admin self-approval,
--     approving "as" someone else, or inserting a sheet that is already Approved
--   * audit_log / notifications / escalation_events accepted any INSERT (forged audit rows, spam)
--   * an employee could stamp their own check-in with a manager review
--   * anonymous (logged-out) visitors could read the whole user directory
--
-- Trusted backend code (service role, SQL editor) has no JWT subject, so auth.uid() is NULL there;
-- the triggers below deliberately let that through (the SSO sync and the seed script rely on it).
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Can the caller act as reviewer (manager of, or Admin over) this person?
-- Never true for the person themselves: nobody reviews or approves their own work.
create or replace function public.is_reviewer_of(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select target is distinct from auth.uid()
     and (public.is_manager_of(target) or public.current_user_role() = 'Admin')
$$;

-- ---------------------------------------------------------------------------
-- users: protect privileged columns, hide the directory from logged-out visitors
-- ---------------------------------------------------------------------------
create or replace function public.guard_user_columns() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;                  -- trusted backend
  if public.current_user_role() = 'Admin' then return new; end if; -- admins manage people
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.manager_id is distinct from old.manager_id
     or new.entra_oid is distinct from old.entra_oid
     or new.upn is distinct from old.upn
     or new.entra_groups is distinct from old.entra_groups
     or new.is_active is distinct from old.is_active then
    raise exception 'FORBIDDEN: only an admin can change role, manager, identity or status';
  end if;
  return new;
end; $$;

drop trigger if exists trg_users_guard on public.users;
create trigger trg_users_guard before update on public.users
  for each row execute function public.guard_user_columns();

drop policy if exists "users_select_all" on public.users;
create policy "users_select_authenticated" on public.users for select to authenticated using (true);

drop policy if exists "cycles_select_all" on public.cycles;
create policy "cycles_select_authenticated" on public.cycles for select to authenticated using (true);

drop policy if exists "thrust_select" on public.thrust_areas;
create policy "thrust_select_authenticated" on public.thrust_areas for select to authenticated using (true);

drop policy if exists "escal_rules_select" on public.escalation_rules;
create policy "escal_rules_select_authenticated" on public.escalation_rules for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- goal_sheets: enforce the Draft -> Submitted -> Approved/Returned state machine
-- ---------------------------------------------------------------------------
drop policy if exists "sheets_owner_modify_until_approved" on public.goal_sheets;
drop policy if exists "sheets_owner_create" on public.goal_sheets;

-- Owner: may work on a Draft/Returned sheet and hand it in (-> Submitted). Nothing else.
drop policy if exists "sheets_update_owner" on public.goal_sheets;
create policy "sheets_update_owner" on public.goal_sheets for update to authenticated
  using (employee_id = auth.uid() and status in ('Draft', 'Returned'))
  with check (
    employee_id = auth.uid()
    and status in ('Draft', 'Returned', 'Submitted')
    and approved_at is null and approved_by is null and locked_at is null
  );

-- Reviewer (manager of the owner, or an Admin who is not the owner): may only act on a
-- Submitted sheet, and only to Approve or Return it, recording themselves as the approver.
drop policy if exists "sheets_update_reviewer" on public.goal_sheets;
create policy "sheets_update_reviewer" on public.goal_sheets for update to authenticated
  using (public.is_reviewer_of(employee_id) and status = 'Submitted')
  with check (
    public.is_reviewer_of(employee_id)
    and status in ('Approved', 'Returned')
    and (approved_by is null or approved_by = auth.uid())
  );

-- New sheets always start as an untouched Draft. A manager may create one for a report
-- (this is what pushing a shared goal to someone without a sheet does).
drop policy if exists "sheets_insert_draft" on public.goal_sheets;
create policy "sheets_insert_draft" on public.goal_sheets for insert to authenticated
  with check (
    status = 'Draft'
    and approved_at is null and approved_by is null and locked_at is null and submitted_at is null
    and (employee_id = auth.uid() or public.is_reviewer_of(employee_id))
  );

-- ---------------------------------------------------------------------------
-- check_ins: only a real reviewer can write the manager-review columns, and only as themselves
-- ---------------------------------------------------------------------------
create or replace function public.guard_checkin_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
  touches_review boolean;
begin
  if auth.uid() is null then return new; end if;                  -- trusted backend

  if tg_op = 'INSERT' then
    touches_review := new.manager_comment is not null
                   or new.manager_checked_at is not null
                   or new.manager_checked_by is not null;
  else
    touches_review := new.manager_comment    is distinct from old.manager_comment
                   or new.manager_checked_at is distinct from old.manager_checked_at
                   or new.manager_checked_by is distinct from old.manager_checked_by;
  end if;
  if not touches_review then return new; end if;

  select s.employee_id into owner_id
    from public.goals g join public.goal_sheets s on s.id = g.sheet_id
   where g.id = new.goal_id;

  if not public.is_reviewer_of(owner_id) then
    raise exception 'FORBIDDEN: only the reviewing manager can record a manager review';
  end if;
  if new.manager_checked_by is distinct from auth.uid() then
    raise exception 'FORBIDDEN: a manager review must be recorded as yourself';
  end if;
  return new;
end; $$;

drop trigger if exists trg_checkins_guard on public.check_ins;
create trigger trg_checkins_guard before insert or update on public.check_ins
  for each row execute function public.guard_checkin_review();

-- ---------------------------------------------------------------------------
-- audit_log / notifications / escalation_events: no more open INSERT policies
-- ---------------------------------------------------------------------------
drop policy if exists "audit_insert_any" on public.audit_log;
drop policy if exists "audit_insert_self" on public.audit_log;
create policy "audit_insert_self" on public.audit_log for insert to authenticated
  with check (actor_id = auth.uid());

-- You may notify: yourself, your manager, your direct reports, or (Admin) anyone, which the
-- escalation sweep needs. Peer-feedback notifications are NOT allowed through this policy:
-- anyone can leave feedback about anyone, so "I left feedback about them" would let any user
-- send arbitrary text to any user. They are created by the trigger below, with fixed wording.
drop policy if exists "notif_insert_any" on public.notifications;
drop policy if exists "notif_insert_related" on public.notifications;
create policy "notif_insert_related" on public.notifications for insert to authenticated
  with check (
    recipient_id = auth.uid()
    or public.is_manager_of(recipient_id)
    or recipient_id = (select u.manager_id from public.users u where u.id = auth.uid())
    or public.current_user_role() = 'Admin'
  );

-- Shared feedback notifies its subject, from a trusted server-side path with a fixed template.
create or replace function public.notify_on_feedback() returns trigger
language plpgsql security definer set search_path = public as $$
declare author_name text;
begin
  if new.visibility = 'Manager' then
    select full_name into author_name from public.users where id = new.author_id;
    insert into public.notifications (recipient_id, channel, subject, body, deep_link, payload)
    values (
      new.subject_id, 'InApp',
      'New feedback from ' || coalesce(author_name, 'a colleague'),
      coalesce(author_name, 'A colleague') || ' shared feedback on your goals: "' || left(new.comment, 500) || '"',
      '/employee/checkins',
      jsonb_build_object('event', 'feedback_received', 'feedback_id', new.id)
    );
  end if;
  return new;
end; $$;

drop trigger if exists trg_feedback_notify on public.feedback;
create trigger trg_feedback_notify after insert on public.feedback
  for each row execute function public.notify_on_feedback();

-- Your own notifications can be marked read, but not handed to someone else.
drop policy if exists "notif_update_own" on public.notifications;
create policy "notif_update_own" on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Only the escalation sweep (Admin, or the service role from the cron) creates events.
drop policy if exists "escal_events_insert" on public.escalation_events;
drop policy if exists "escal_events_insert_admin" on public.escalation_events;
create policy "escal_events_insert_admin" on public.escalation_events for insert to authenticated
  with check (public.current_user_role() = 'Admin');
