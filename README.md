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
- Weightage validation: total must equal 100%, min 10% per goal, max 8 goals, enforced on the client and again on the server
- Manager (L1) approval flow: inline edit, return for rework, approve and lock
- Shared goals: a manager or admin pushes one goal to many reports in a single action; weightage stays adjustable on each recipient

**Tracking & check-ins**
- Quarterly planned-vs-actual capture, one row per goal per quarter
- Status per goal: Not Started, On Track, At Risk, Completed
- Manager check-in comments with a structured log
- Live weighted sheet score, recomputed on every check-in

**Across the board**
- Role-based access enforced with Row Level Security at the database layer
- Immutable audit log: every change after lock recorded with before/after snapshots
- CSV export for the achievement report and the audit log
- Microsoft Entra ID SSO (mocked with the same response shape as Graph `/me`)
- Email + MS Teams + in-app notifications on every lifecycle event
- Rule-based escalations on stale approvals, swept nightly by a Vercel cron
- Analytics: quarter-over-quarter trends, distribution by thrust area, department heatmap, manager effectiveness

---

## Stack

| Tier | Tech | Why |
|------|------|-----|
| UI | Next.js (App Router) + TypeScript + Tailwind + Radix | RSC for fast SSR, type-safe end to end |
| Server | Next.js Server Actions + API routes | One project, one deploy |
| Database | Supabase Postgres + Row Level Security | RLS *is* the authorisation layer |
| Identity | Supabase Auth + mock Entra ID | Swaps to real Microsoft Graph with one HTTP call |
| Notifications | Postgres queue table | Channel-agnostic, testable without external accounts |
| Cron | Vercel Cron → `/api/cron/escalations` | Nightly escalation sweep |
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

```bash
npm install
# add Supabase keys to .env.local (see .env.example)
npm run dev        # http://localhost:3000
npm run seed       # populate demo data (needs the service-role key)
```

---

## License

MIT.
