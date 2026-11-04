# Operations

## Processes
| Process | Command | Notes |
|---|---|---|
| Migrations | `npm run migrate` (owner role) | idempotent; run before starting a new version; advisory-locked |
| Web | `npm start` | stateless; scale horizontally |
| Worker | `npm run worker` | deliveries every 20 s, reminders/retention hourly (`WORKER_*` env); several replicas are safe |
| Scheduler alternative | `GET /api/v1/jobs/run` + `Authorization: Bearer $CRON_SECRET` | e.g. Vercel Cron |

## Monitoring
`/api/v1/health` (liveness), `/api/v1/ready` (DB + latest migration). One JSON log line per request (`requestId`, route, status, ms, org/user ids). Job state: `select * from job_runs`. Delivery health: Admin → Integrations, or `notification_deliveries` grouped by status (`dead` rows need attention). Audit health: Admin → Audit trail → Verify integrity.

## Backup and recovery
Plumeo has no state outside Postgres. Use your platform's PITR / `pg_dump`. After a restore: run `npm run migrate`, then verify each organisation's audit chain. **Back up `APP_ENCRYPTION_KEY` separately** — without it stored SSO secrets and webhook URLs cannot be decrypted (they must be re-entered). Backups contain personal data: encrypt and access-control them. A restore resurrects data you may have anonymised — re-run anonymisation if your policy requires.

## Retention
The job purges read notifications (>180 d), sessions/tokens/SSO flows/idempotency keys after expiry, and delivered outbox rows (>90 d). Audit events, goal versions, progress updates and check-in revisions are **never deleted** by the application. Anonymise leavers (People → Deactivate → Anonymise).

## Tuning
`DB_POOL_MAX` (default 10 per instance). PgBouncer transaction pooling is compatible. Keep `autovacuum` on (planner statistics matter: the benchmark showed multi-second lists before `ANALYZE`). Analytics are computed on demand and capped at 20,000 goals per request.

## Upgrades
Never edit an applied migration (checksum guard). Add new files `0005_*.sql` and call `plumeo_secure_table` for new tenant tables.
