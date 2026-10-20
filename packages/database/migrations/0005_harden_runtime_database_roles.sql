-- 0005_harden_runtime_database_roles.sql
-- Close a privilege-escalation path found during the 2026-10-20 Neon audit.
-- Apply with the migration owner, never with an application runtime role.
-- Review application connection configuration before applying to a live environment.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_app_runtime')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_owner') THEN
    -- Runtime must not inherit owner privileges or have authority to SET ROLE to owner.
    REVOKE iam_owner FROM iam_app_runtime;
    ALTER ROLE iam_app_runtime NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_runtime') THEN
    -- Harden the legacy runtime role as well; it must not bypass tenant RLS.
    ALTER ROLE iam_runtime NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
  END IF;
END
$$;

COMMIT;
