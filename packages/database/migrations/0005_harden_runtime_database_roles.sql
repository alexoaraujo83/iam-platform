-- 0005_harden_runtime_database_roles.sql
-- Close a privilege-escalation path found during the 2026-10-20 Neon audit.
-- Apply with the migration owner, never with an application runtime role.
-- Review application connection configuration before applying to a live environment.
BEGIN;

DO $$
BEGIN
  -- Harden the application role independently of whether the owner role exists.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_app_runtime') THEN
    ALTER ROLE iam_app_runtime NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

    -- Remove direct membership only when both roles exist.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_owner') THEN
      REVOKE iam_owner FROM iam_app_runtime;
    END IF;
  END IF;

  -- Keep the legacy runtime role restricted too, when it is present.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_runtime') THEN
    ALTER ROLE iam_runtime NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
  END IF;
END
$$;

COMMIT;
