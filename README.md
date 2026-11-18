# Plumeo

A lighter, more human way to set, align, and track goals across a whole team.
Plumeo runs the full goal lifecycle: drafting, manager approval, quarterly
check-ins, and an audit trail that never forgets, all in one calm place.

[![Vercel](https://img.shields.io/badge/Hosted%20on-Vercel-000?style=for-the-badge&logo=vercel)](https://plumeo-ai.vercel.app)
[![Supabase](https://img.shields.io/badge/Database-Supabase-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com)
[![Next.js](https://img.shields.io/badge/Framework-Next.js-black?style=for-the-badge&logo=next.js)](https://nextjs.org)

**Live demo:** https://plumeo-ai.vercel.app

---

## Try it

The landing page has one-click sign-in for seven pre-seeded demo accounts, so you
can explore every role and workflow state without typing a password.

| Role | Name | Email |
|------|------|-------|
| Admin / HR | Priya Shah | `priya.shah@plumeo.io` |
| Manager (Sales) | Arjun Mehta | `arjun.mehta@plumeo.io` |
| Manager (Eng) | Lakshmi Raman | `lakshmi.r@plumeo.io` |
| Employee (Sales, Draft sheet) | Rohan Kapoor | `rohan.k@plumeo.io` |
| Employee (Sales, Submitted) | Neha Iyer | `neha.iyer@plumeo.io` |
| Employee (Eng, Approved + check-ins) | Kabir Malhotra | `kabir.malhotra@plumeo.io` |
| Employee (Eng, Returned for rework) | Ananya Sharma | `ananya.s@plumeo.io` |

The directory mirrors what Microsoft Graph would return; picking a tile signs you
in instantly, the same way it would after a real Entra OAuth callback.

---

## What's inside

**Goal creation & approval**
- Thrust area, title, description, and weightage per goal
- Four units of measure (Numeric, Percentage, Timeline, Zero-based), each with its own scoring formula
- Weightage validation: total must equal 100%, min 10% per goal, max 8 goals, enforced on the client and again on the server (and validated with Zod at the server-action boundary)
- Manager (L1) approval flow: inline edit, return for rework, approve and lock
- Shared goals: a manager or admin pushes one goal to many reports in a single action; weightage stays adjustable on each recipient

**Tracking & check-ins**
- Quarterly planned-vs-actual capture, one row per goal per quarter
- Status per goal: Not Started, On Track, At Risk, Completed
- Manager check-in comments with a structured log
- Live weighted sheet score, recomputed on every check-in
- 360° / peer feedback: peers and skip-level managers leave structured rating + comment feedback, shared with the person or kept private to their management chain (enforced by RLS)

**AI assist (optional, free)**
- "Refine with AI" rewrites a draft goal into a sharper, measurable SMART version
- "Summarize quarter" turns a sheet's check-ins into a plain-language progress narrative
- Powered by [Groq](https://console.groq.com/keys)'s free tier — set `GROQ_API_KEY` to enable; the features hide their errors gracefully and the app runs fully without it

**Across the board**
- ⌘K command palette to search and jump to any page for your role
- Light / dark theme toggle, remembered per browser
- Role-based access enforced with Row Level Security at the database layer
- Immutable audit log: every change after lock recorded with before/after snapshots
- CSV export for the achievement report and the audit log
- Microsoft Entra ID SSO (mocked with the same response shape as Graph `/me`)
- In-app notifications on every lifecycle event, surfaced in a per-user inbox
- Rule-based escalations on stale approvals *and overdue quarterly check-ins*, swept nightly by a Vercel cron (batched queries, no N+1)
- Tested core: Vitest covers every scoring formula and validation rule, the escalation sweep, the cron endpoint, and a 48-case Row Level Security suite that runs the real migrations in an in-memory Postgres; GitHub Actions runs lint + typecheck + tests + build on every push
- Analytics: quarter-over-quarter trends, distribution by thrust area, department heatmap, manager effectiveness

---

## Stack

| Tier | Tech | Why |
|------|------|-----|
| UI | Next.js (App Router) + TypeScript + Tailwind + Radix | RSC for fast SSR, type-safe end to end |
| Server | Next.js Server Actions + API routes | One project, one deploy |
| Database | Supabase Postgres + Row Level Security | RLS *is* the authorisation layer |
| Identity | Supabase Auth + mock Entra ID | Swaps to real Microsoft Graph with one HTTP call |
| Notifications | Postgres-backed in-app inbox | Per-user notifications on every lifecycle event |
| AI (optional) | Groq free tier (Llama 3.3) | Goal refinement + quarter summaries at $0 |
| Cron | Vercel Cron → escalations | Nightly escalation sweep (batched queries, no N+1) |
| Tests/CI | Vitest + GitHub Actions | Typecheck, unit tests, and build gated on every push |
| Hosting | Vercel + Supabase, both free tier | $0/month at demo volumes |

---

## Project structure

```
app/                      # Next.js App Router routes
  page.tsx                # landing + SSO sign-in
  employee/ manager/ admin/   # role dashboards
  api/reports/            # CSV streaming endpoints
  api/cron/escalations/   # nightly sweep
components/               # UI primitives + feature components
lib/
  goals.ts                # pure business logic: validation + the 4 scoring formulas
  actions.ts              # server actions (RLS-aware mutations)
  auth.ts                 # mock Entra ID SSO, swappable for MS Graph
supabase/migrations/      # full schema + RLS policies + triggers
scripts/seed.ts           # demo data in every workflow state
```

---

## Running locally

Requires Node 20+ and a free [Supabase](https://supabase.com) project.

```bash
npm install
cp .env.example .env.local   # then fill in the three Supabase values (Settings -> API)
```

**Set up the database.** In the Supabase SQL editor, run the files in `supabase/migrations/`
in order: `0001` to `0005`. `0005_security_hardening.sql` is required: it closes privilege-escalation
holes in the original policies and fixes employee submit / manager shared-goal push under RLS.
(If you use the Supabase CLI instead: `supabase db push`.)

```bash
npm run seed       # populate demo users and a goal sheet in every workflow state (needs the service-role key)
npm run dev        # http://localhost:3000, then click a demo tile to sign in
```

### Checks

```bash
npm run lint       # ESLint (next/core-web-vitals)
npm run typecheck  # tsc --noEmit
npm test           # Vitest: unit + escalation + cron + Row Level Security suite
npm run build      # production build
```

The RLS suite needs no database: it loads `supabase/migrations/*.sql` into an in-memory Postgres
([PGlite](https://pglite.dev)) and exercises each policy as the `authenticated` / `anon` roles, covering
both the flows that must work and the attacks that must be rejected.

---

## Deployment

Plumeo deploys to [Vercel](https://vercel.com) with Supabase as the database.

1. Import the repo in Vercel (framework preset: Next.js).
2. Set these environment variables for Production:

   | Variable | Required | Notes |
   |----------|----------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public anon key (safe in the browser; RLS protects the data) |
   | `SUPABASE_SERVICE_ROLE_KEY` | yes | **Secret.** Server only: demo sign-in provisioning and the cron |
   | `CRON_SECRET` | yes, for the nightly sweep | Any long random string. Vercel Cron sends it as `Authorization: Bearer ...`; the endpoint refuses to run without it |
   | `GROQ_API_KEY` | optional | Enables the AI assists; the app works without it |

3. Apply the five migrations to the production Supabase project (see above) and run `npm run seed` once.

`vercel.json` schedules `/api/cron/escalations` nightly at 02:00 UTC.

---

## Security notes

- **Authorisation is enforced in the database** with Row Level Security. The `0005` migration adds a
  sheet state machine (Draft -> Submitted -> Approved/Returned), blocks self-promotion, forged audit rows
  and self-approval, and restricts the user directory to signed-in users. Each rule has a regression test.
- **Sign-in is a demo.** The "Entra ID" directory is mocked, and one click signs you in as any seeded
  persona with a deterministic password. That is deliberate so reviewers can explore every role, and it is
  only appropriate for demo data. Do not put real data behind it; swap `lib/auth.ts` for a real OAuth callback first.
- **Known limitations:** `check_ins.computed_score` is calculated by the server action but is writable by
  the check-in owner through the REST API; the audit log is written by the app, not by database triggers; and
  the project is on Next.js 14, whose remaining advisories are fixed only in 15.x and later (upgrade tracked).

---

## License

MIT.
