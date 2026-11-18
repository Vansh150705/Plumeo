# Deploying to Vercel + managed Postgres (checklist)

Plumeo is stateless; all state is in Postgres. **Merging to `main` triggers a Vercel production deploy, so complete steps 1–3 first** — otherwise the live URL will show errors (the app refuses to start without its configuration).

Status: the build is verified (Vercel preview built successfully). The steps below were **not** executed against Vercel/Neon/Supabase from the authoring environment; the database bootstrap and the smoke test were verified locally against Postgres 16.

## 1. Create a fresh Postgres database
Neon, Supabase (a **new** project — do not reuse the old prototype's project; `db:setup` refuses a database that holds the old tables), RDS, etc. Note two connection strings:
* **Owner / direct** connection (used once, for setup) → `MIGRATION_DATABASE_URL`
* **Pooled** connection for the app (Neon: host with `-pooler`; Supabase: transaction pooler, port 6543, user `plumeo_app.<project-ref>`) → `DATABASE_URL`. Append `?sslmode=require` if the provider needs it. Transaction pooling is compatible (tenant context is set per transaction).

## 2. Bootstrap the database (from any machine with Node ≥ 20)
```bash
git clone https://github.com/Vansh150705/Plumeo && cd Plumeo && git checkout claude/nice-maxwell-g6p8hr   # or main after merging
npm ci
export MIGRATION_DATABASE_URL='postgres://<owner>:<pw>@<direct-host>/<db>?sslmode=require'
export APP_DB_PASSWORD='<a new strong password, 12+ chars>'
npm run db:setup          # creates the restricted role plumeo_app + applies all migrations (idempotent)
```
Then the app's `DATABASE_URL` is the **pooled** host with user `plumeo_app` and that password.

Optional demo data (synthetic "Northwind Labs" org; **use a private password** because this repository is public and the default demo password is published in the README):
```bash
export DATABASE_URL='postgres://plumeo_app:<APP_DB_PASSWORD>@<direct-or-pooled-host>/<db>?sslmode=require'
export APP_ENCRYPTION_KEY="$(openssl rand -base64 32)"   # use the SAME value you put in Vercel in step 3
SEED_PASSWORD='<private demo password>' npm run seed
```
Sign in at `/login` → workspace `northwind`, e.g. `priya.shah@northwind.test` (org admin), `hana.okafor@…` (HR), `kabir.malhotra@…` (manager), `ananya.sharma@…` (employee).

## 3. Vercel → Project → Settings → Environment Variables (Production)
| Name | Value |
|---|---|
| `DATABASE_URL` | pooled app connection (user `plumeo_app`) |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` (keep a backup; losing it makes stored SSO/webhook secrets unreadable) |
| `APP_URL` | your production URL, e.g. `https://plumeo-ai.vercel.app` (no trailing slash) |
| `DB_POOL_MAX` | `2` (serverless: small pool per function instance) |
| `CRON_SECRET` | random 16+ characters (Vercel sends it automatically to the cron route) |
| `ALLOW_SELF_SERVICE_SIGNUP` | `true` only if visitors may create workspaces; otherwise `false` |
| `SMTP_URL`, `SMTP_FROM`, `GROQ_API_KEY` | optional |

`MIGRATION_DATABASE_URL` is **not** needed on Vercel. Remove the old Supabase variables — they are unused.

## 4. Deploy and verify
Redeploy (or merge to `main`). Then:
```bash
BASE_URL=https://<your-url> npm run smoke
# with a login check (use your seeded/private password):
BASE_URL=https://<your-url> SMOKE_ORG=northwind SMOKE_EMAIL=priya.shah@northwind.test SMOKE_PASSWORD='…' npm run smoke
```
The smoke test checks liveness, database + migrations, pages, security headers, auth redirects, anonymous/cross-origin refusal and (optionally) a real login. Also open `/api/v1/ready` — it must say `"status":"ready"`.

## Serverless notes / known unknowns
* `vercel.json` schedules `GET /api/v1/jobs/run` daily (Hobby plan limit). That sweep sends reminders and delivers queued email/webhooks; for near-real-time delivery run `npm run worker` somewhere (any container) or use a more frequent scheduler.
* PDF export (`pdfkit`) bundling and email/SMTP/Slack/Teams/SSO have **not** been exercised on Vercel — verify those features before promising them.
* Function cold starts add latency to the first request; sign-in hashes passwords with scrypt (~100 ms).
