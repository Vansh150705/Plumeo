# API conventions

Endpoint list: [endpoints.md](endpoints.md) (generated). Base path `/api/v1`; SCIM at `/api/scim/v2`.

## Authentication
`POST /auth/login {orgSlug, email, password}` sets the `plumeo_session` cookie (`HttpOnly; SameSite=Lax; Secure` over HTTPS). Browser SSO: `GET /auth/sso/start?org=<slug>`. Non-browser clients keep the cookie and must send `X-Plumeo-Client: <name>` on writes (browsers send `Origin`, which must match the app's host). There are no long-lived personal API tokens; SCIM uses per-organisation bearer tokens (`Authorization: Bearer plm_scim_…`).

## Requests
* `Content-Type: application/json` for bodies. Unknown fields are **rejected** (422) — there is no mass assignment.
* Pagination: `limit` (≤200) and `offset`; audit uses keyset `beforeSeq` → `nextBeforeSeq`.
* Filters are server-side (`GET /goals?status=active,completed&level=team&departmentId=…&q=…&risk=at_risk&mine=true`).
* Optimistic locking: `PATCH /goals/:id` requires `expectedVersion`; stale → `409 conflict`.
* **Idempotency**: send `Idempotency-Key: <≤100 chars>` on `POST` to make retries safe. Same key + same body replays the stored response (`Idempotent-Replay: true`); same key + different body → 422; concurrent duplicates run once.
* Rate limits: writes 240/min/user, exports 10/min (audit export 5/min), public writes 120/min/IP, login 10/10 min per account. `429` carries `Retry-After`.

## Responses
Success `200 { "data": … }`; lists `{ "data": [...], "page": { "limit", "offset", "total" } }`; CSV/PDF exports stream files. Errors:

```json
{ "error": { "code": "validation_failed", "message": "title: Required", "details": [{"path":"title","message":"Required"}], "requestId": "…" } }
```
Codes: `unauthenticated` 401 · `forbidden` 403 · `not_found` 404 (also used for records you may not see) · `conflict` / `invalid_state` 409 · `validation_failed` 422 · `rate_limited` 429 · `busy` 503 (retry) · `internal` 500 (no internals leaked; quote `requestId`).

## Selected workflows
```
POST /goals                          {cycleId, level, title, keyResults:[…], …}          → {id, version}
POST /goals/:id/submit               {expectedVersion?}                                  → pending_approval
POST /approvals/:id/decision         {decision:"approve"|"reject"|"request_changes", comment}
POST /goals/:id/amendments           {reason, changes:{dueDate?, keyResults?, ownerId?, …}} → {requiresApproval}
POST /goals/:id/progress             {updates:[{keyResultId, value, note?}]}
POST /checkins/:goalId/:periodId/submit  {krValues:[…], health, achievements?, …}        (immutable revision)
POST /checkins/:id/review            {feedback, actionItems?}    POST /checkins/:id/reopen {reason}
GET  /analytics?cycleId&departmentId&teamId&level&status         GET /exports/goals.csv
GET  /audit?entityId=&action=goal.*&from=&to=&q=                  GET /audit/verify
```

## SCIM 2.0
`ServiceProviderConfig`, `Users` (GET list/filter, POST, GET, PUT, PATCH, DELETE=deactivate). Supported filter: `userName|externalId|id eq "value"`. Enterprise extension: `employeeNumber`, `department` (matched to an existing department by name), `manager.value` (Plumeo user id). Groups/Bulk/Sort/ETag are not supported.
