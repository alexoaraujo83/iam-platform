#!/usr/bin/env bash
set -Eeuo pipefail

# Runs only against the disposable PostgreSQL service created by GitHub Actions.
# Never point DATABASE_URL at Neon or any shared environment.
: "${DATABASE_URL:?DATABASE_URL must point to the disposable CI PostgreSQL service}"
case "$DATABASE_URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "refusing_non_local_database_for_identity_provisioning_test" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# Keep the migration test isolated from the shared iam_test database used by
# the existing RLS integration suite in the same CI job.
test_database_url="${DATABASE_URL%/iam_test}/iam_identity_provisioning_test"
if [[ "$test_database_url" == "$DATABASE_URL" ]]; then
  echo "unexpected_ci_database_name" >&2
  exit 2
fi
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE iam_identity_provisioning_test"
psql_cmd=(psql "$test_database_url" -X -v ON_ERROR_STOP=1)

"${psql_cmd[@]}" -f "$root/packages/database/migrations/0001_identity_tenancy.sql"
"${psql_cmd[@]}" -f "$root/packages/database/migrations/0002_durable_audit_controls.sql"
# Apply the full current schema before the proposed provisioning migration.
"${psql_cmd[@]}" <<'SQL'
CREATE ROLE iam_app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
SQL
"${psql_cmd[@]}" -f "$root/packages/database/migrations/0003_control_center_read_permission.sql"
"${psql_cmd[@]}" -f "$root/packages/database/migrations/0004_pre_auth_security_events.sql"
"${psql_cmd[@]}" -f "$root/packages/database/migrations/0005_harden_runtime_database_roles.sql"

# Model Neon’s admin membership plus a dedicated low-privilege LOGIN role.
# The application connects as the LOGIN role, which inherits only EXECUTE from the executor.
"${psql_cmd[@]}" <<'SQL'
CREATE ROLE iam_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE iam_identity_provisioner_owner NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE iam_identity_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE iam_identity_provisioner_login LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
GRANT iam_identity_provisioner_owner, iam_identity_provisioner TO iam_owner;
GRANT iam_identity_provisioner TO iam_identity_provisioner_login;
SQL

"${psql_cmd[@]}" -f "$root/packages/database/migrations/0006_auth0_identity_provisioning.sql"

# The function must be idempotent, scoped to issuer+subject, and create no access.
first_id="$("${psql_cmd[@]}" -Atqc "SELECT public.provision_external_identity('https://preview.example.test/','auth0|identity-test-1')")"
second_id="$("${psql_cmd[@]}" -Atqc "SELECT public.provision_external_identity('https://preview.example.test/','auth0|identity-test-1')")"
test "$first_id" = "$second_id"
other_issuer_id="$("${psql_cmd[@]}" -Atqc "SELECT public.provision_external_identity('https://other-preview.example.test/','auth0|identity-test-1')")"
test "$other_issuer_id" != "$first_id"

# Two concurrent requests for the same identity must converge on one principal.
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
"${psql_cmd[@]}" -Atqc "SELECT public.provision_external_identity('https://preview.example.test/','auth0|identity-concurrent')" > "$tmpdir/a" &
pid_a=$!
"${psql_cmd[@]}" -Atqc "SELECT public.provision_external_identity('https://preview.example.test/','auth0|identity-concurrent')" > "$tmpdir/b" &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
test "$(cat "$tmpdir/a")" = "$(cat "$tmpdir/b")"

# Transaction rollback must remove both rows created within the transaction.
"${psql_cmd[@]}" <<'SQL'
BEGIN;
SELECT public.provision_external_identity('https://preview.example.test/','auth0|identity-rollback');
ROLLBACK;
SQL
rollback_count="$("${psql_cmd[@]}" -Atqc "SELECT count(*) FROM public.external_identities WHERE issuer='https://preview.example.test/' AND subject='auth0|identity-rollback'")"
test "$rollback_count" = "0"

# Empty inputs fail closed.
if "${psql_cmd[@]}" -Atqc "SELECT public.provision_external_identity(' ','auth0|invalid')" >/dev/null 2>&1; then
  echo "empty_issuer_was_accepted" >&2
  exit 1
fi
if "${psql_cmd[@]}" -Atqc "SELECT public.provision_external_identity('https://preview.example.test/',' ')" >/dev/null 2>&1; then
  echo "empty_subject_was_accepted" >&2
  exit 1
fi

# Executor has EXECUTE only: no direct table access, no BYPASSRLS, no login.
"${psql_cmd[@]}" <<'SQL'
DO $assert$
BEGIN
  IF NOT has_function_privilege('iam_identity_provisioner_login',
       'public.provision_external_identity(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'provisioner_login_missing_execute';
  END IF;
  IF has_table_privilege('iam_identity_provisioner_login', 'public.principals', 'SELECT')
     OR has_table_privilege('iam_identity_provisioner_login', 'public.principals', 'INSERT')
     OR has_table_privilege('iam_identity_provisioner_login', 'public.external_identities', 'SELECT')
     OR has_table_privilege('iam_identity_provisioner_login', 'public.external_identities', 'INSERT')
     OR has_table_privilege('iam_identity_provisioner_login', 'public.tenants', 'INSERT')
     OR has_table_privilege('iam_identity_provisioner_login', 'public.memberships', 'INSERT')
     OR has_table_privilege('iam_identity_provisioner_login', 'public.membership_roles', 'INSERT')
     OR has_table_privilege('iam_identity_provisioner_login', 'public.roles', 'INSERT')
     OR has_table_privilege('iam_identity_provisioner_login', 'public.role_permissions', 'INSERT')
     OR has_table_privilege('iam_identity_provisioner_login', 'public.permissions', 'INSERT') THEN
    RAISE EXCEPTION 'provisioner_login_has_direct_table_access';
  END IF;
  IF has_function_privilege('iam_app_runtime',
       'public.provision_external_identity(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime_can_execute_identity_provisioning';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iam_identity_provisioner'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'provisioner_executor_role_has_excessive_attributes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iam_identity_provisioner_login'
      AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) THEN
    RAISE EXCEPTION 'provisioner_login_role_has_excessive_attributes';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles granted ON granted.oid=m.roleid
      JOIN pg_roles member_role ON member_role.oid=m.member
     WHERE member_role.rolname IN ('iam_identity_provisioner_owner','iam_identity_provisioner')
        OR (granted.rolname='iam_identity_provisioner_owner' AND member_role.rolname <> 'iam_owner')
        OR (granted.rolname='iam_identity_provisioner'
            AND member_role.rolname NOT IN ('iam_owner','iam_identity_provisioner_login'))
        OR (member_role.rolname='iam_identity_provisioner_login'
            AND granted.rolname <> 'iam_identity_provisioner')
        OR granted.rolname='iam_identity_provisioner_login'
  ) THEN
    RAISE EXCEPTION 'unexpected_provisioning_role_membership';
  END IF;
  IF (SELECT count(*) FROM public.principals) <> 3
     OR (SELECT count(*) FROM public.external_identities) <> 3 THEN
    RAISE EXCEPTION 'unexpected_identity_row_counts';
  END IF;
  IF (SELECT count(*) FROM public.global_security_events WHERE action='identity.provisioned') <> 3 THEN
    RAISE EXCEPTION 'identity_provisioning_audit_count_mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.global_security_events
      WHERE action='identity.provisioned'
        AND (metadata ? 'issuer' OR metadata ? 'subject' OR metadata ? 'token' OR metadata ? 'claims')) THEN
    RAISE EXCEPTION 'identity_provisioning_audit_contains_sensitive_identity_data';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants)
     OR EXISTS (SELECT 1 FROM public.memberships)
     OR EXISTS (SELECT 1 FROM public.roles)
     OR EXISTS (SELECT 1 FROM public.membership_roles) THEN
    RAISE EXCEPTION 'provisioning_created_tenant_or_authorization';
  END IF;
END
$assert$;
SQL

if "${psql_cmd[@]}" -Atqc "SET ROLE iam_identity_provisioner_login; SELECT * FROM public.principals" >/dev/null 2>&1; then
  echo "provisioner_can_read_principals_directly" >&2
  exit 1
fi

echo "identity_provisioning_postgres_integration=PASS"
