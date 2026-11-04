# Plumeo

A lighter, more human way for organisations to set, align and track goals. Plumeo runs the complete goal lifecycle —
drafting, manager approval, alignment, quarterly check-ins, amendments and an audit trail that never forgets — for
multi-department organisations, with strict tenant isolation and enterprise identity (OIDC SSO, SCIM provisioning).

> **Status:** a complete, tested application suitable for **evaluation and pilot deployment**. Read
> [Known limitations](#known-limitations) before putting it in front of a real organisation. It has **not** been
> externally security-reviewed or certified (no SOC 2 / ISO 27001 / GDPR claims are made).

## Contents
[What it does](#what-it-does) · [Architecture](#architecture) · [Tenancy](#organisational-and-tenant-architecture) · [Roles & permissions](#roles-and-permissions) · [Goal lifecycle](#goal-lifecycle) · [Alignment & progress](#alignment-and-progress-calculation) · [Approvals](#approvals) · [Check-ins](#quarterly-check-ins) · [Analytics](#analytics-and-metric-definitions) · [Audit](#audit-trail) · [Notifications & integrations](#notifications-and-integrations) · [AI](#ai-assistance) · [API](#api) · [Database](#database-schema-and-migrations) · [Install & run](#installation-and-configuration) · [Deploy](#deployment) · [Tests](#testing) · [Security](#security-controls) · [Limitations](#known-limitations)

## What it does

| For | Capabilities |
|---|---|
| **Employees** | Draft goals with outcomes and measurable key results (templates, collaborators, alignment to a parent goal); submit for approval; record progress; quarterly check-ins with reflections, blockers and follow-ups; a personal home that shows what needs attention. |
| **Managers** | Approval queue (assigned, delegated), approve / request changes / reject with feedback; delegate approvals while away; team view with workload; review and reopen check-ins; amend approved goals under policy. |
| **Department heads** | See goals across the departments they head, approve department goals, scoped analytics. |
| **HR administrators** | Run cycles and review periods, edit organisation policies, goal library, oversee approvals across the organisation, org-wide analytics, exports, transfer goal ownership, privacy anonymisation. |
| **Organisation admins** | People, structure (business units → departments → teams → sub-teams), roles & custom roles, SSO, SCIM, Slack/Teams webhooks, audit trail. |
| **Auditors** | Read-only access to goals, analytics and the audit trail (with verified hash chain and export). |
| **Platform operators** | A separate console (`/platform`) to create/suspend organisations. It has no access to tenant data. |

## Architecture

```
Browser ──► Next.js 14 (App Router)                    Postgres 16
            ├─ Server components ─┐                     ├─ Row-level security on every tenant table
            ├─ /api/v1  (REST) ───┼─► server/services ──┤  (org_id = app.org_id, forced, fail-closed)
            └─ /api/scim/v2 ──────┘   (authorisation,   ├─ Composite (org_id, id) foreign keys
                                       validation,      ├─ Append-only audit chain (trigger-computed)
Worker (scripts/worker.ts) ──────────► transactions)    └─ Partial unique indexes (one pending approval…)
```

* **`server/core`** – config (zod, fail-fast), crypto (scrypt, AES-256-GCM), errors, logging with redaction, request context.
* **`server/db`** – pool, tenant-scoped transaction helper (`withOrg`), migration runner.
* **`server/auth`** – sessions, password login, OIDC, platform admins, rate limiting.
* **`server/services`** – one module per capability: goals, approvals, amendments, check-ins, analytics, audit, users, roles, structure, cycles, templates, notifications, integrations, SCIM, exports, AI, jobs. **All business rules live here** and are enforced on the server for the UI, the REST API and SCIM alike.
* **`server/http`** – the REST framework (CSRF, idempotency, rate limits, error envelope) and the single route table.
* **`lib`** – pure code shared with the browser and tests (progress maths, goal rules, permission catalogue, policy schema).
* **`app`, `components`** – the UI. Mutations call the same REST API that integrations use.

Why not Supabase RLS any more? The original app relied on a public anon key, a mock single-click SSO and RLS policies that let users edit their own role or approve their own sheet. Authorisation now lives in one audited service layer, with Postgres RLS as a second, independent line of defence — and it runs on any Postgres (Supabase Postgres included, if you connect to it as a plain database).

## Organisational and tenant architecture

* `orgs` → `departments` (tree; `business_unit` or `department`) → `teams` (tree) → `users` (manager tree). Reporting lines, department trees, team trees and goal alignment are **cycle-checked in the database** (advisory-locked triggers), so concurrent re-parenting cannot create loops.
* **Every tenant table has `org_id NOT NULL`.** Child rows reference parents with composite foreign keys `(org_id, id)`, so a row in tenant A *cannot* reference a row in tenant B even if application code is wrong.
* **Row-level security is enabled and forced** on all tenant tables with policy `org_id = app_org()`; `app_org()` reads a transaction-local setting set by `withOrg(orgId, …)`. With no tenant selected the application role sees **zero rows**. The application connects as `plumeo_app` (no DDL, no `BYPASSRLS`, no UPDATE/DELETE on append-only tables).
* A narrow, explicit `withSystem()` scope exists only for pre-authentication lookups (login, session validation, SCIM/SSO tokens) and background sweeps.
* Tests prove isolation at the SQL layer, the service layer (IDOR attempts with foreign ids), lists, analytics, exports, SCIM and notifications — see [Testing](#testing).

## Roles and permissions

Permissions are strings enforced by the server (`lib/permissions.ts`); roles are bundles of permissions, per organisation. Built-in roles can be combined with **custom roles** (Admin → Roles & access).

| Role | Permissions (summary) |
|---|---|
| Employee (everyone) | Own goals, own check-ins, see approved company goals and their own unit's goals |
| Team manager | approve goals of reports, review check-ins, see reporting-line goals, create team goals, scoped analytics |
| Department head | all of the above + department-tree visibility, create department goals |
| HR administrator | users, cycles, policies, templates, read all goals, approve any (oversight), reassign owners, org analytics, exports, audit read, anonymise |
| Auditor | read all goals, org analytics, audit read + export, directory — **read-only** |
| Organisation admin | everything organisational, incl. roles, integrations, structure, audit export |
| Platform operator | separate `/platform` console; organisation lifecycle only |

Safeguards: you can only grant *privileged* permissions you hold yourself; nobody can change their own roles; the last organisation admin cannot be removed or deactivated; managers get manager rights automatically when assigned reports (and department heads/team leads when appointed); role changes are audited and take effect immediately (permissions are read per request, not baked into tokens). Full matrix: `lib/permissions.ts`.

## Goal lifecycle

```
              ┌──────────── changes_requested ◄─────────┐
 draft ─submit─► pending_approval ──approve (all levels)──► active ──complete──► completed
   ▲  │            │      │                                  │ │
   │  └─delete     │      └──reject──► rejected ──edit+resubmit┘ └──cancel──► cancelled
   └──withdraw─────┘
```

* States change **only** through server functions that lock the row, validate the transition and write the audit event in the **same transaction** — a decision can never be recorded without its goal update, and no part of the app can see a goal as approved while another sees it pending.
* **Submission is gated**: title, description, expected outcome, dates and ≥1 measurable key result are required (configurable); invalid goals cannot enter approval. A rule-based *measurability check* flags vague wording (no AI involved).
* **Amendments** — approved goals change only through *amendments*: changes to targets, dates, scope or owner are classified; those the organisation's policy lists need re-approval (by someone other than the requester), others apply immediately. Every applied amendment creates an immutable **goal version** (full snapshot), keeps the person responsible and reason, and is audited with before/after values. Ownership can also be transferred by users with `goals.reassign`.
* Optimistic locking (`version`) rejects stale edits with `409`.

## Alignment and progress calculation

Goal levels: **company → department → team → individual** (department/team goals may nest under the same level). The database enforces that a goal aligns only to the same or a higher level, in the same cycle, without cycles; the service additionally requires the parent to be **approved** and **visible** to the author.

* **Key result progress** = `(current − start) / (target − start)` clamped to 0–100 (works for decrease targets; yes/no = 0 or 100; nothing recorded yet = 0).
* **Goal progress, mode "own"** = weight-averaged key-result progress. No key results ⇒ **unknown (null)**, never 0 — except a completed goal without key results = 100.
* **Goal progress, mode "rollup"** = weight-averaged *effective progress of its approved (active/completed) child goals*; no contributors ⇒ unknown. Drafts, pending and cancelled children do not contribute.
* Parent progress is **derived on read and never written** to children; a child's progress never includes its parent. A roll-up goal's own key results stay visible but do not feed the roll-up.
* **Risk** (dashboards): `overdue` = active and past due; `at_risk` = latest check-in says at-risk/off-track **or** progress trails the linear plan by more than the tolerance (default 20 pts); `stalled` = no progress or check-in activity for N days (default 30); `unknown` = nothing measurable. Thresholds are policy settings.

## Approvals

* On submit the server builds an approval chain from the **real reporting line**: *levels* per goal level come from policy (default: company 1 via the approver pool, department 2, team 1, individual 1), capped by how many active managers exist. Company goals (and goals whose owner has no manager) go to the **approver pool** (holders of `goals.approve_any`, never the owner).
* Level *n+1* becomes actionable only after level *n* approves; a different person must handle each level.
* **No self-approval, ever** — not as owner, not via delegation, not via oversight; an amendment cannot be decided by its requester or the proposed new owner.
* **Delegation**: an approver can delegate for a fixed window (≤90 days) to a named colleague; decisions are recorded `decided_by = delegate, on_behalf_of = approver`.
* **Races**: the goal row is locked before the request row; a partial unique index allows **one pending request per subject**. Under 100 simultaneous approvals of one request exactly one wins and 99 get `409` (tested, and measured below). Critical POSTs accept an `Idempotency-Key`.
* **SLA**: requests carry a due date; approvers are reminded (deduplicated) when overdue; managers see workload; HR sees organisation-wide oversight and turnaround statistics.
* Manager changes and deactivations move pending approvals along the reporting line.

## Quarterly check-ins

* A **cycle** (e.g. FY 2026) has **review periods** — quarterly by default, or custom — each with an *opens* and a *due* date. Approved goals that existed during a period are expected to have a check-in; `upcoming / due / overdue / submitted / reopened` is derived from dates and status.
* A check-in captures a current value for every key result (recorded in the key result's append-only progress history), overall health, achievements, challenges, blockers, next steps, reflection and organisation-defined questions (required or optional). Drafts can be saved.
* **Submitted check-ins are immutable revisions**; the progress at that moment is frozen. A manager can give feedback, create follow-up actions, or **reopen** a check-in for correction — the owner then submits a *new revision* and the old one stays visible. Late submissions are flagged.
* Reminders (configurable days before; repeating when overdue; manager digests for overdue reports) are idempotent per period/bucket. Check-ins are visible only to the owner, their management line, department heads and HR/auditors.

## Analytics and metric definitions

Everything is computed from stored facts and **restricted to the caller's scope** (organisation for HR/admin/auditor; reporting line for managers; headed departments for department heads; self otherwise).

| Metric | Definition |
|---|---|
| Average progress | Mean of effective progress over **active** goals that have a measurable value; the count of goals without one is shown separately |
| Completion rate | completed ÷ (active + completed) |
| Overdue / at risk / stalled | See *Risk* above, evaluated as of the report date |
| Approval turnaround | `decided_at − activated_at` (hours) for decided requests: mean, median, p90; pending and overdue counts; per-approver workload |
| Check-in completion | submitted ÷ expected for periods that have opened; on-time vs late vs missing |
| Quarterly trend | Mean progress frozen at each period's submitted check-ins; delta vs previous period |
| Alignment rate | non-company goals that have a parent ÷ non-company goals (approved or pending) |

Filter by cycle, department, team, level and status. Exports: goals CSV, check-ins CSV, audit CSV (permission + tenant + scope checked, spreadsheet-injection safe, themselves audited) and a PDF summary built from the same numbers.

## Audit trail

* `audit_events` is **append-only** for the application: no UPDATE/DELETE/TRUNCATE privileges, plus triggers that reject mutations even from the table owner. Goal versions, progress updates, check-in revisions and feedback are append-only by the same mechanism.
* Each event stores organisation, actor (user / system / SCIM / platform), action, entity, request id, **before/after values**, metadata, and a **per-organisation SHA-256 hash chain computed by a database trigger** (the application cannot skip or forge it). *Admin → Audit trail → Verify integrity* recomputes the chain; tampering with, deleting or truncating events is detected (tested with superuser powers).
* Events are written in the **same transaction** as the change they describe. Secrets are scrubbed; events carry user *ids*, so personal data can be anonymised without rewriting history.
* **Honest limit:** a database superuser (or anyone able to disable triggers *and* recompute the chain) can still rewrite history. The chain makes that *detectable*, not impossible. For stronger guarantees, periodically anchor the latest hash (`GET /api/v1/audit/verify`) outside the database and restrict superuser access.

## Notifications and integrations

* **In-app + email** notifications for submissions, pending/overdue approvals, decisions, requested changes, amendments, ownership changes, check-in reminders, manager feedback, completion, cancellations and deactivations. Per-user, per-category preferences. Created in the same transaction as the event; **deduplicated** by event key.
* **Outbox delivery** (`notification_deliveries`): `FOR UPDATE SKIP LOCKED` workers, exponential back-off, dead-lettering after 6 attempts, per-delivery status. Email needs `SMTP_URL`; **without it nothing is claimed as sent** — mail is simply not queued.
* **Slack / Microsoft Teams** incoming webhooks for organisation-level announcements (company/department goal approved or completed). Never personal notifications. URLs are encrypted at rest; only provider domains are accepted (SSRF guard); redirects are not followed. *Tested against a local receiver; not tested against real Slack/Teams.*
* **SSO — OpenID Connect** (Authorization Code + PKCE + state + nonce, signature/issuer/audience checks, domain allow-list, optional JIT provisioning, optional enforcement with admin break-glass). *Tested end-to-end against a local fake provider; not yet against Entra ID / Google / Okta in this environment.* Any compliant OIDC provider should work.
* **SCIM 2.0 Users** (`/api/scim/v2`): create, get, filter (`userName`/`externalId`/`id` `eq`), PUT, PATCH (active, name, title, enterprise manager/department/employeeNumber), delete = deactivate (sessions revoked immediately). Per-organisation bearer tokens (stored hashed). **Groups, bulk and SAML are not implemented.**
* Not built (and therefore not advertised): Google Workspace/Entra directory sync beyond SCIM, calendar and HRIS integrations, SAML.

## AI assistance

Optional, off by default, bounded: **suggest** clearer goal wording and key results, **summarise** a goal's check-ins, **draft** manager feedback. Enabled per organisation (Policies) and needs `GROQ_API_KEY`. Only goal text is sent (never names, emails or ratings); output is shown as an editable suggestion with a notice; AI cannot submit, approve, reject, rate or score anyone; each request is audited (type only, content not stored); rate-limited per user. The measurability check is deterministic and does not use AI.

## API

REST under `/api/v1` (+ `/api/scim/v2`). Conventions: JSON; `{ data }` envelope; lists `{ data, page: { limit, offset, total } }` (audit uses keyset `nextBeforeSeq`); errors `{ error: { code, message, details, requestId } }` with `401/403/404/409/422/429`; strict schemas (unknown fields rejected); optimistic locking via `expectedVersion`; `Idempotency-Key` for retried creations/submissions; same-origin/CSRF protection. See [docs/api.md](docs/api.md) and the generated [docs/endpoints.md](docs/endpoints.md) (113 endpoints). Invisible resources return **404, not 403**.

## Database schema and migrations

`db/migrations/*.sql` — applied in order by `npm run migrate` (checksummed, advisory-locked, one transaction each; edits to applied migrations are refused).

| Migration | Contents |
|---|---|
| `0001_foundation` | tenancy helpers, orgs, users, departments, teams (+ cycle guards), roles, sessions, **audit chain**, rate limits, idempotency |
| `0002_goals` | cycles, review periods, goals (+ alignment guard), key results, versions, progress history, amendments, approvals, delegations, templates |
| `0003_checkins` | check-ins, immutable revisions, feedback, action items |
| `0004_notifications_integrations` | notifications, preferences, delivery outbox, webhooks, OIDC providers, SCIM tokens, credential tokens, SSO flows, job runs |

Use the `plumeo_secure_table('<table>')` procedure in new migrations: it enables+forces RLS, adds the tenant policy and grants. Indexes cover owner/cycle/parent/department/team/due queries, approvals by approver and due date, audit by entity/actor/action/time. Soft deletion: drafts (`goals.deleted_at`); departments/teams archive; users deactivate (never hard-deleted). Retention job purges read notifications (180 d), expired sessions/tokens/flows, idempotency keys and delivered outbox rows; **audit and history are kept**.

## Installation and configuration

Requirements: Node ≥ 20, PostgreSQL 14+ (16 tested), `pgcrypto` extension.

```bash
npm install
cp .env.example .env.local      # set DATABASE_URL, MIGRATION_DATABASE_URL, APP_ENCRYPTION_KEY (openssl rand -base64 32)

# one-time, as a database superuser/owner: the restricted application login
psql "$MIGRATION_DATABASE_URL" -c "create role plumeo_app_role nologin" \
  -c "create role plumeo_app login password 'change-me' in role plumeo_app_role"

npm run migrate                 # applies db/migrations as the owner role
npm run seed                    # OPTIONAL synthetic demo org "northwind" (refuses to run in production)
npm run dev                     # http://localhost:3000     (production: npm run build && npm start)
npm run worker                  # background deliveries + reminders (separate process)
```

Demo (after `npm run seed`): workspace `northwind`, password `PlumeoDemo!2026` (override with `SEED_PASSWORD`) — `priya.shah@` (org admin), `hana.okafor@` (HR), `lakshmi.raman@` / `arjun.mehta@` (department heads), `kabir.malhotra@` (manager), `ananya.sharma@`, `rohan.kapoor@`, … `@northwind.test`. **Development data only.**

Operator tasks: `PLATFORM_ADMIN_PASSWORD=… npm run platform:admin -- you@example.com "Your Name"` (then `/platform`); `npx tsx scripts/gen-api-docs.ts`. All environment variables are documented in `.env.example`.

## Deployment

* **Docker Compose** (`docker-compose.yml`, `Dockerfile`, `deploy/init-db.sh`): Postgres + one-shot migrations + web + worker. `cp .env.example .env`, set `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `APP_ENCRYPTION_KEY`, then `docker compose up --build`. Put a TLS reverse proxy in front. *The compose files are provided but could not be built or run in the authoring environment (no Docker daemon) — treat as unverified until you run them.*
* **Vercel / serverless**: works (stateless app, Postgres via connection pooler); drive jobs by calling `/api/v1/jobs/run` with `Authorization: Bearer $CRON_SECRET` from a scheduler instead of the worker.
* Health: `GET /api/v1/health` (liveness), `GET /api/v1/ready` (DB + migration version). Logs are structured JSON with request ids and secret redaction. Boot fails fast on missing `APP_ENCRYPTION_KEY`/`DATABASE_URL` in production.
* Scaling: stateless app instances; sessions, rate limits, idempotency and job locks live in Postgres, so any number of replicas and workers can run. Use PgBouncer (transaction mode is compatible: tenant context is set per transaction). See [docs/operations.md](docs/operations.md) for backup, restore, retention and tuning.

## Testing

```bash
# needs a Postgres where you can create databases + the two roles above; defaults to postgres://postgres@localhost:5433
TEST_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npm test     # 123 tests
npm run typecheck
node e2e/journey.mjs        # real-browser journey against a running, seeded instance (needs Playwright + Chromium)
npm run loadtest -- 2000 5  # synthetic-scale benchmark (see below)
```

Each test file builds a throw-away database, runs the real migrations and connects **as the restricted application role**, so RLS and grants are genuinely exercised. Suites: pure progress/risk maths; goal lifecycle (creation validation, approvals, multi-level, delegation, concurrency, amendments, versions, ownership, alignment, visibility); security (RLS fail-closed, cross-tenant writes/FKs, IDOR, privilege escalation, mass assignment, injection, audit tamper detection); check-ins and analytics (hand-computed expected metrics, scope, exports); authentication, OIDC (fake IdP incl. PKCE/nonce/audience attacks), SCIM, notifications (dedupe, retries, dead-letter, competing workers, SSRF); HTTP API (CSRF, cookies, idempotency, platform console).

## Performance observations

Measured on this build machine (4 vCPU, 16 GB, Postgres 16 on the same host, 2,000 people, 10,000 goals, 20,000 key results, one organisation; **relative figures, not a capacity promise**; statistics analysed as autovacuum would):

| Operation | Time |
|---|---|
| List goals (admin, page of 50 / filtered by status+level+risk) | 64 ms / ~240 ms |
| List goals as VP / manager / employee (visibility rules) | ~60 / ~50 / ~45 ms |
| Goal detail · alignment graph (3,000 nodes) | ~66 ms · ~140 ms |
| Analytics — whole organisation (10,000 goals) / VP scope | ~445 ms / ~60 ms |
| 100 simultaneous approvals of one request | ~190 ms — **exactly 1 winner, 99 conflicts** |
| 200 concurrent progress updates on one goal | ~1.2 s |
| Audit: append 20,000 events (one hash chain) · keyset search · verify 20k-event chain | ~3 s · 4–16 ms · ~300 ms |
| Deliver 2,001 queued emails (fake SMTP, 4 competing workers) | ~1.1 s, none duplicated |
| CSV export of all 10,000 goals | ~6 s (paginated; capped at 10k rows, rate-limited) |

Honest notes: the audit hash chain serialises audit writes **per organisation** (a row lock held until commit) — fine at these rates, but a very write-heavy single tenant is bounded by it. A first run before `ANALYZE` showed multi-second list times; the risk filter and CSV export are the least optimised paths. Nothing was tested beyond 2,000 people / 10k goals, nor on multiple app instances.

## Security controls

Authentication & sessions: scrypt password hashing; opaque 256-bit session tokens stored **hashed**, `HttpOnly; SameSite=Lax; Secure` cookies, idle + absolute expiry (policy-configurable), revoked on password change/deactivation/suspension; account lockout and DB-backed rate limits (per account and per IP); uniform error messages (no account enumeration); one-time hashed invite/reset tokens; password policy. Authorisation: server-side permission checks on every call, scoped SQL visibility predicate shared by lists/detail/analytics/exports, 404 for invisible records, privilege-escalation guards. Tenant isolation: RLS + composite FKs. Input: strict zod schemas (no mass assignment), parameterised SQL only. Web: CSRF same-origin + JSON enforcement, CSP, HSTS, frame/sniff/referrer headers, spreadsheet-injection-safe CSV. Data: secrets encrypted with AES-256-GCM (`APP_ENCRYPTION_KEY`), logs redact secrets, anonymisation workflow, retention job. Integrations: SSRF allow-list, OIDC PKCE/nonce/JWKS verification, hashed SCIM tokens. Details and the threat notes: [docs/security.md](docs/security.md).

## Known limitations

* **No MFA / passkeys** in Plumeo itself (use your IdP via OIDC). No SAML. No SCIM Groups. No IP allow-listing.
* **Not externally reviewed or pen-tested.** Dependencies are audited in CI (`npm audit`) but supply-chain and runtime hardening are the operator's responsibility.
* OIDC, Slack/Teams webhooks and SMTP are verified only against local fakes; **Docker/Compose files are unbuilt here**; production TLS, backups and monitoring are yours to operate.
* Audit immutability is *tamper-evident*, not tamper-proof against a database superuser (see above). No built-in external anchoring.
* Scheduled/emailed reports, calendar and HRIS integrations are not implemented. Notification digests (batched email) are not implemented.
* Large organisations (>10k people, >100k goals) have not been tested; analytics load goals into application memory (capped at 20,000 per request) and would need materialised aggregates beyond that.
* `/app/goals/:id` returns HTTP 200 with the not-found page for invisible goals when streamed (Next.js limitation with `loading.tsx`); the **API returns a true 404** and no data leaks.
* i18n/localisation, per-org branding and data-residency controls are not implemented. The UI has had a keyboard/label/contrast pass but **no formal accessibility audit**.
* Data from the previous Supabase-based prototype is not migrated (it only held demo data); the new schema is a clean break.

## License
MIT.
