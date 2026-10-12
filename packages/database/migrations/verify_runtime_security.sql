-- Run as the actual runtime login against the target deployment database.
-- Read-only assertions; this script does not create, update or delete application data.
DO $$
DECLARE
  runtime_name text := current_user;
  role_super boolean;
  role_bypass boolean;
  bad_rls text;
  bad_owner text;
  can_update_audit boolean;
  can_delete_audit boolean;
BEGIN
  SELECT rolsuper, rolbypassrls INTO role_super, role_bypass
    FROM pg_roles WHERE rolname = runtime_name;
  IF COALESCE(role_super, true) OR COALESCE(role_bypass, true) THEN
    RAISE EXCEPTION 'runtime_role_has_privileged_attributes:%', runtime_name;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(ARRAY['tenants','memberships','principals','external_identities','roles','role_permissions','membership_roles','applications','audit_events'])
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF bad_rls IS NOT NULL THEN
    RAISE EXCEPTION 'RLS_NOT_FORCED:%', bad_rls;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad_owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(ARRAY['tenants','memberships','principals','external_identities','roles','role_permissions','membership_roles','applications','audit_events'])
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = runtime_name);
  IF bad_owner IS NOT NULL THEN
    RAISE EXCEPTION 'runtime_owns_protected_tables:%', bad_owner;
  END IF;

  can_update_audit := has_table_privilege(runtime_name, 'public.audit_events', 'UPDATE');
  can_delete_audit := has_table_privilege(runtime_name, 'public.audit_events', 'DELETE');
  IF can_update_audit OR can_delete_audit THEN
    RAISE EXCEPTION 'runtime_can_mutate_audit: update=%, delete=%', can_update_audit, can_delete_audit;
  END IF;

  RAISE NOTICE 'PASS runtime_role=% superuser=false bypassrls=false protected_rls=forced protected_owner=false audit_append_only=true', runtime_name;
END
$$;

-- Keep the output from these read-only queries as release evidence.
SELECT current_database() AS database_name, current_user AS runtime_role,
       current_setting('server_version') AS postgres_version;
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = ANY(ARRAY['tenants','memberships','principals','external_identities','roles','role_permissions','membership_roles','applications','audit_events'])
ORDER BY c.relname;
