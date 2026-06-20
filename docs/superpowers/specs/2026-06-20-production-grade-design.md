# Plumeo — Production-Grade Upgrade

**Date:** 2026-06-20
**Goal:** Take Plumeo from a 2-day hackathon build to a production-grade project by
removing dead/faked code and adding a full hardening layer plus three flagship
features.

## Context

Plumeo is a goal-setting & performance-tracking portal (Next.js 14 App Router +
Supabase Postgres with RLS as the authorization layer). The feature surface is
already broad — goal lifecycle, approvals, shared goals, quarterly check-ins,
audit log, notifications queue, escalations, analytics, CSV reports. What it
lacks is the plumbing and proof that separate a demo from a real product.

## Scope

### 1. Remove / fix (honesty + dead code)

- **Duplicate SQL** — `0001_init.sql` declares the `uuid-ossp` / `pgcrypto`
  extensions twice. Collapse to one block.
- **Faked notification delivery** — `notify()` sets `sent_at` immediately for
  Email/Teams to fake a "Sent" state with no delivery. Replace with an honest
  delivery layer (see §4): rows start un-sent and only flip when a real (or
  explicitly mocked) transport ships them.
- **Dead `checkin_overdue` escalation branch** — currently an empty stub.
  Implement it properly against the active quarter's close date.

### 2. Hardening

- **Tests (Vitest)** — full coverage of `lib/goals.ts`: all four scoring
  formulas + edge cases, and every `validateSheet` rule. Pure functions, highest
  value-per-test in the codebase.
- **Input validation (Zod)** — schemas on every server-action input. `zod` is
  already a dependency.
- **Error handling** — a single `ActionResult<T>` result shape + an `actionError`
  helper so server actions never throw raw to the client; add `error.tsx` and
  `not-found.tsx` boundaries.
- **Resilience** — batch the N+1 query loops in `runEscalationSweep` and
  `pushSharedGoal`.
- **CI** — GitHub Actions: typecheck + lint + tests on every push/PR.

### 3. Flagship: AI goal-drafting assistant

Employee describes their role/intent in plain language; an LLM (Claude via the
Vercel AI Gateway) proposes 3–5 well-formed goals — thrust area, UoM, direction,
target, and weightages that sum to 100 — validated through the same
`validateSheet` rules before they can be inserted. Degrades gracefully to a
disabled state when no API key is configured.

### 4. Flagship: real notification delivery

A pluggable `lib/notifications/delivery.ts` transport layer:
- **Teams** via an incoming-webhook URL (`TEAMS_WEBHOOK_URL`).
- **Email** via a generic webhook relay URL (`EMAIL_WEBHOOK_URL`); no-ops
  cleanly when unset.
- Notifications carry an honest status: rows are inserted un-sent, a delivery
  pass flips `sent_at` on success and records `delivery_error` on failure.
  Exposed via a `/api/cron/notifications` drain plus inline best-effort send.

### 5. Flagship: 360° / peer feedback

New `feedback` table (+ RLS) letting peers and skip-level managers leave
structured feedback (rating + comment) on an employee's goals during a check-in
window. Surfaced on the employee dashboard and in the manager check-in view.

## Out of scope

- Replacing the mock Entra directory with a live Microsoft OAuth tenant (the code
  is already shaped for a one-call swap; doing it for real needs a tenant we
  don't have here).
- Real SMTP credentials / a live Teams tenant — the delivery layer is built and
  wired, but exercising it end-to-end requires the operator's secrets.

## Verification

- `tsc --noEmit`, `next lint`, and `vitest run` all green (run locally here).
- DB migrations and AI/Teams/email transports are typechecked and unit-tested
  where possible; full runtime exercise requires the operator's Supabase keys,
  AI Gateway key, and webhook URLs.

## Delivery

Work lands on `feat/production-hardening` in reviewable commits, pushed to
`origin`, with a PR opened against `main`.
