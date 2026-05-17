# Deployment guide — Vercel + Supabase (free tier)

End-to-end, copy-paste ready. Takes 20–30 minutes for a first-time deployer. **Both services have a free tier that fully supports this app.**

---

## Step 1 — Set up Supabase (5 min)

### 1.1 Create a project
1. Go to https://supabase.com → **Sign up** (use GitHub for one-click)
2. Click **New project**
3. Give it any name (e.g. `atomquest-goals`), set a strong DB password (you won't need it again — Supabase manages connections for you)
4. Pick the region closest to your users (for India, choose `ap-south-1 Mumbai`)
5. Click **Create new project** — wait ~90 seconds for provisioning

### 1.2 Grab your keys
Once provisioned, go to **Settings (gear icon) → API**:
- Copy **Project URL** → save as `NEXT_PUBLIC_SUPABASE_URL`
- Copy **anon public** key → save as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Copy **service_role secret** key → save as `SUPABASE_SERVICE_ROLE_KEY`

> ⚠️ The `service_role` key bypasses RLS. Never commit it. Only used server-side in seed script and admin-only routes.

### 1.3 Apply the schema
Go to **SQL Editor** (left sidebar) → **New query** → paste the contents of `supabase/migrations/0001_init.sql` → click **Run**.

You should see "Success. No rows returned."

Repeat for `supabase/migrations/0002_seed_reference.sql`.

### 1.4 Verify
Go to **Table Editor** in the sidebar — you should see `users`, `cycles`, `goal_sheets`, `goals`, `check_ins`, `audit_log`, `notifications`, `escalation_rules`, `escalation_events`, `thrust_areas`.

---

## Step 2 — Push the code to GitHub (3 min)

1. Create a new GitHub repo: https://github.com/new → name it `atomquest-goals` → **Private** is fine
2. From the project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit — AtomQuest Hackathon 2026 submission"
   git branch -M main
   git remote add origin https://github.com/<your-handle>/atomquest-goals.git
   git push -u origin main
   ```

---

## Step 3 — Deploy to Vercel (5 min)

### 3.1 Import
1. Go to https://vercel.com/new
2. Pick **Import Git Repository** → select your `atomquest-goals` repo
3. Framework preset will auto-detect **Next.js** — keep all defaults

### 3.2 Set environment variables
Before clicking deploy, expand **Environment Variables** and add three:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | from Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase dashboard |

(Optional, for cron auth) Add `CRON_SECRET` with any random string — only required if you want to lock down `/api/cron/escalations`.

### 3.3 Deploy
Click **Deploy**. Wait ~90 seconds. You'll get a URL like `https://atomquest-goals.vercel.app`.

---

## Step 4 — Seed demo data (2 min)

The seed script creates the 7 demo users + sheets in every workflow state.

Run it locally pointing at your production Supabase:

```bash
# 1. Set the same env vars locally
cp .env.example .env.local
# Edit .env.local with the same 3 keys

# 2. Install + run
npm install
npm run seed
```

You'll see:
```
🌱 Seeding AtomQuest demo data...
1/5 Provisioning users...
   ✓ Priya Shah (Admin)
   ✓ Arjun Mehta (Manager)
   ...
✅ Seed complete!

📋 Demo credentials:
   Admin    →  priya.shah@atomquest.io
   Manager  →  arjun.mehta@atomquest.io
   ...
```

---

## Step 5 — (Optional) Enable nightly escalation cron (1 min)

This makes the escalation engine fully autonomous.

1. Create `vercel.json` at the project root (already included):
   ```json
   {
     "crons": [{ "path": "/api/cron/escalations", "schedule": "0 2 * * *" }]
   }
   ```
2. Commit + push. Vercel auto-detects the cron config on next deploy.

Vercel's free tier includes daily cron — perfect for nightly sweeps.

---

## Step 6 — Test the deploy (3 min)

1. Open your Vercel URL
2. Click **Sign in with Microsoft Entra ID** on the landing page
3. Pick **Priya Shah** (HR Director) — you should land on the admin dashboard with seeded data
4. Pick **Arjun Mehta** — approvals queue should show Neha's submitted sheet
5. Pick **Kabir Malhotra** — Goal sheet should be locked, Q1 + Q2 check-ins visible

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Landing page loads but clicking a tile spins forever | Check that all 3 env vars are set in Vercel; redeploy after adding them |
| Seed script: "USER_NOT_PROVISIONED" | The migrations didn't apply. Re-run `0001_init.sql` then `0002_seed_reference.sql` |
| "GOAL_LIMIT_EXCEEDED" when seeding | Already seeded — script wipes and re-creates sheets on each run; the limit trigger is firing during a retry. Just re-run `npm run seed` once. |
| RLS blocking reads | Make sure you're signed in. RLS allows nothing for anonymous users by design. |
| Cron not firing | Vercel cron only runs on the production deployment, not preview branches. |

---

## Final submission checklist

- [ ] Live URL works on a browser
- [ ] Three demo tiles sign in successfully
- [ ] Admin can see the analytics page (charts render)
- [ ] Manager can approve / return a submitted sheet
- [ ] Employee can edit + submit + see returned-with-comment state
- [ ] CSV download works from `/admin/reports`
- [ ] GitHub repo URL in submission form
- [ ] Architecture diagram embedded in README

---

You're done. Submit your live URL + GitHub URL.
