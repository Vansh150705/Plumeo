# Security notes

## Model
1. **Authentication** — password (scrypt, per-user salt) or OIDC. Sessions are opaque random tokens; only SHA-256 is stored.
2. **Authorisation** — permission strings from roles (re-read every request) + structural scope (reporting line, headed departments, goal membership) in one SQL predicate (`goalVisibility`). Records you may not see are **404**.
3. **Tenant isolation** — Postgres RLS (forced; `org_id = app.org_id`; fail-closed) + composite `(org_id,id)` foreign keys. The app role cannot DDL, bypass RLS, or modify append-only tables.
4. **Integrity** — state changes + audit in one transaction; trigger-computed per-org hash chain; append-only history tables.

## Controls → where
| Concern | Control |
|---|---|
| Broken access control / IDOR | `tests/security.test.ts`: foreign ids across every read/write path; 404 semantics |
| Privilege escalation | privileged-permission guard, no self role change, last-admin guard, self-approval blocked everywhere |
| Mass assignment | strict zod schemas on every input |
| SQL injection | parameterised queries only; filters tested with hostile input |
| XSS | React escaping, no `dangerouslySetInnerHTML` except the static theme bootstrap; CSP (`script-src 'self' 'unsafe-inline'` — Next bootstrap; tighten with nonces if desired) |
| CSRF | SameSite=Lax cookie + same-origin check + JSON-only writes |
| Brute force | account lockout (8 failures → 15 min), per-account and per-IP DB rate limits |
| Sessions | idle + absolute expiry, revoke on password change / deactivation / suspension |
| Secrets | AES-256-GCM at rest (`APP_ENCRYPTION_KEY`), hashed tokens, log redaction, never returned by APIs |
| SSRF | webhook host allow-list, no redirects; OIDC issuers must be https (http only in non-production when explicitly enabled) |
| Exports | permission + scope + tenant checks, rate limits, CSV formula neutralisation, themselves audited |
| Privacy | anonymisation of former employees (names/emails/credentials removed; ids kept), notification deletion, AI sends goal text only |
| Audit integrity | see README; verify endpoint; superuser caveat |

## Things to configure in production
* Strong, unique `APP_ENCRYPTION_KEY`, `APP_DB_PASSWORD`, `POSTGRES_PASSWORD`; TLS everywhere (`APP_URL=https://…` enables `Secure` cookies and HSTS is already sent).
* Run the app as `plumeo_app`; keep the owner credentials only for the migration job.
* Restrict database superuser access; consider periodically exporting `GET /audit/verify` (head count + verification) to an external write-once store.
* Set `ALLOW_SELF_SERVICE_SIGNUP=false` unless you intend open sign-up (default in production).
* Behind a proxy, make sure `X-Forwarded-For` is set by *your* proxy only (rate limits key on it).

## Not covered
MFA/passkeys, SAML, IP allow-lists, device management, field-level encryption of goal content, external pen-test, compliance attestations (SOC 2 / ISO 27001 / GDPR). Backups are not encrypted by Plumeo — encrypt them at the storage layer.
