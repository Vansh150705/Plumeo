-- Reference + demo data: a small org with three roles and three departments,
-- and goal sheets parked in every workflow state (Draft / Submitted / Returned /
-- Approved) so the app has something to show straight away.

-- thrust areas
insert into public.thrust_areas (name, description) values
  ('Revenue Growth',          'Top-line growth, sales, new accounts'),
  ('Operational Excellence',  'Process efficiency, TAT, throughput'),
  ('Customer Experience',     'NPS, CSAT, retention'),
  ('People & Culture',        'Engagement, retention, learning'),
  ('Innovation & Technology', 'New products, R&D, tech adoption'),
  ('Risk & Compliance',       'Regulatory, audit findings, controls'),
  ('Cost Optimisation',       'Cost-to-serve, vendor consolidation'),
  ('Safety & Quality',        'Zero-incident targets, defect rate')
on conflict (name) do nothing;

-- the active cycle: FY 2026-27 (1 May 2026 to 30 Apr 2027)
-- the goal-setting window is open from 1 May to 30 Jun 2026
insert into public.cycles (
  id, name, fiscal_year,
  goal_window_start, goal_window_end,
  q1_open, q1_close, q2_open, q2_close,
  q3_open, q3_close, q4_open, q4_close,
  is_active
) values (
  '00000000-0000-0000-0000-000000000001',
  'FY 2026-27',
  2026,
  '2026-05-01 00:00:00+00', '2026-06-30 23:59:59+00',
  '2026-07-01 00:00:00+00', '2026-07-31 23:59:59+00',
  '2026-10-01 00:00:00+00', '2026-10-31 23:59:59+00',
  '2027-01-01 00:00:00+00', '2027-01-31 23:59:59+00',
  '2027-03-01 00:00:00+00', '2027-04-30 23:59:59+00',
  true
) on conflict (id) do nothing;

-- escalation rules
insert into public.escalation_rules (name, trigger_type, threshold_days, escalate_to, is_active) values
  ('Goal submission overdue',          'goal_not_submitted', 10, 'Employee',  true),
  ('Goal submission overdue (L2)',     'goal_not_submitted', 15, 'Manager',   true),
  ('Approval pending',                 'approval_pending',    7, 'Manager',   true),
  ('Approval pending (HR)',            'approval_pending',   14, 'HR',        true),
  ('Quarterly check-in overdue',       'checkin_overdue',     5, 'Employee',  true),
  ('Check-in overdue (skip-level)',    'checkin_overdue',    10, 'SkipLevel', true)
on conflict do nothing;

-- demo users: these UUIDs must match the auth.users IDs created by scripts/seed.ts,
-- which reads this list and provisions the matching auth records.
-- We insert with placeholder UUIDs; the seed script in scripts/seed.ts upserts
-- corresponding auth.users via the Supabase admin API.
-- =============================================================================
