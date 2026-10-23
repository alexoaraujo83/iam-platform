-- 0005_harden_runtime_database_roles.sql
-- Close privilege-escalation paths found during the 2026-10-20 Neon audit.
-- Apply with a database administrator that owns these roles or has sufficient
-- admin option; never apply with an application runtime role.
-- Review application connection configuration before applying to a live environment.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_app_runtime') THEN
    ALTER ROLE iam_app_runtime
      NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_runtime') THEN
    ALTER ROLE iam_runtime
      NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;

    -- Remove elevated membership from the legacy runtime role.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser') THEN
      REVOKE neon_superuser FROM iam_runtime;
    END IF;
  END IF;

  -- The observed membership direction was iam_owner -> iam_app_runtime.
  -- The owner role must not inherit application runtime grants.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_owner')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_app_runtime') THEN
    REVOKE iam_app_runtime FROM iam_owner;
  END IF;
END
$$;

COMMIT;
