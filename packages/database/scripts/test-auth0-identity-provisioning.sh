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

# A disposable superuser creates roles without granting role memberships.
"${psql_cmd[@]}" <<'SQL'
CREATE ROLE iam_identity_provisioner_owner NOLOGIN BYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE iam_identity_provisioner NOLOGIN NOBYPASSRLS NOCREATEROLE NOCREATEDB;
SQL

"${psql_cmd[@]}" -f "$root/packages/database/migrations/0006_auth0_identity_provisioning.sql"

# The function must be idempotent, scoped to issuer+subject, and create no access.
first_id="$("${psql_cmd[@]}" -Atqc "SELECT public.provision_external_identity('https://preview.example.test/','auth0|identity-test-1')")"
second_id="$("${psql_cmd[@]}" -Atqc "SELECT public.provision_external_identity('https://preview.example.test/','auth0|identity-test-1')")"
test "$first_id" = "$second_id"

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

# Executor has EXECUTE only: no direct table access, no BYPASSRLS, no login.
"${psql_cmd[@]}" <<'SQL'
DO $assert$
BEGIN
  IF NOT has_function_privilege('iam_identity_provisioner',
       'public.provision_external_identity(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'provisioner_missing_execute';
  END IF;
  IF has_table_privilege('iam_identity_provisioner', 'public.principals', 'SELECT')
     OR has_table_privilege('iam_identity_provisioner', 'public.principals', 'INSERT')
     OR has_table_privilege('iam_identity_provisioner', 'public.external_identities', 'SELECT')
     OR has_table_privilege('iam_identity_provisioner', 'public.external_identities', 'INSERT') THEN
    RAISE EXCEPTION 'provisioner_has_direct_identity_table_access';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iam_identity_provisioner'
      AND (rolcanlogin OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN
    RAISE EXCEPTION 'provisioner_role_has_excessive_attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m
      JOIN pg_roles r ON r.oid IN (m.roleid, m.member)
      WHERE r.rolname IN ('iam_identity_provisioner_owner','iam_identity_provisioner')) THEN
    RAISE EXCEPTION 'provisioner_role_membership_found';
  END IF;
  IF (SELECT count(*) FROM public.principals) <> 2
     OR (SELECT count(*) FROM public.external_identities) <> 2 THEN
    RAISE EXCEPTION 'unexpected_identity_row_counts';
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

if "${psql_cmd[@]}" -Atqc "SET ROLE iam_identity_provisioner; SELECT * FROM public.principals" >/dev/null 2>&1; then
  echo "provisioner_can_read_principals_directly" >&2
  exit 1
fi

echo "identity_provisioning_postgres_integration=PASS"
