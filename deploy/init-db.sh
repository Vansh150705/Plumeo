#!/bin/bash
# Runs once when the Postgres container is first created. Creates the restricted application login.
# The OWNER role (POSTGRES_USER) runs migrations; the app connects as plumeo_app, which is subject to
# row-level security and has no DDL, UPDATE/DELETE on the audit log, or BYPASSRLS.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'plumeo_app_role') then create role plumeo_app_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'plumeo_app') then create role plumeo_app login password '${APP_DB_PASSWORD}' in role plumeo_app_role; end if;
end \$\$;
grant connect on database "${POSTGRES_DB}" to plumeo_app_role;
grant usage on schema public to plumeo_app_role;
SQL
