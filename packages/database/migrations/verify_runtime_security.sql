-- Run as the actual runtime login against the target deployment database.
-- Read-only assertions; this script does not create, update or delete application data.
DO $$
DECLARE
  runtime_name text := current_user;
  role_super boolean;
  role_bypass boolean;
  role_create_role boolean;
  role_create_db boolean;
  role_replication boolean;
  bad_rls text;
  bad_owner text;
  can_update_audit boolean;
  can_delete_audit boolean;
  can_truncate_audit boolean;
  can_insert_global boolean;
  can_select_global boolean;
  can_update_global boolean;
  can_delete_global boolean;
  can_truncate_global boolean;
  bad_memberships text;
  can_create_public boolean;
BEGIN
  IF runtime_name <> 'iam_app_runtime' THEN
    RAISE EXCEPTION 'unexpected_runtime_identity:%', runtime_name;
  END IF;

  SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
    INTO role_super, role_bypass, role_create_role, role_create_db, role_replication
    FROM pg_roles WHERE rolname = runtime_name;
  IF COALESCE(role_super, true) OR COALESCE(role_bypass, true)
     OR COALESCE(role_create_role, true) OR COALESCE(role_create_db, true)
     OR COALESCE(role_replication, true) THEN
    RAISE EXCEPTION
      'runtime_role_has_privileged_attributes:% superuser=% bypassrls=% createrole=% createdb=% replication=%',
      runtime_name, role_super, role_bypass, role_create_role, role_create_db, role_replication;
  END IF;

  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO bad_memberships
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles r ON r.oid = am.roleid
    WHERE m.rolname = runtime_name;
  IF bad_memberships IS NOT NULL THEN
    RAISE EXCEPTION 'runtime_role_has_role_memberships:%', bad_memberships;
  END IF;

  can_create_public := has_schema_privilege(runtime_name, 'public', 'CREATE');
  IF can_create_public THEN
    RAISE EXCEPTION 'runtime_role_can_create_in_public_schema:%', runtime_name;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(ARRAY['tenants','memberships','principals','external_identities','roles','role_permissions','membership_roles','applications','audit_events','global_security_events'])
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
  IF bad_rls IS NOT NULL THEN
    RAISE EXCEPTION 'RLS_NOT_FORCED:%', bad_rls;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad_owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(ARRAY['tenants','memberships','principals','external_identities','roles','role_permissions','membership_roles','applications','audit_events','global_security_events'])
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = runtime_name);
  IF bad_owner IS NOT NULL THEN
    RAISE EXCEPTION 'runtime_owns_protected_tables:%', bad_owner;
  END IF;

  can_update_audit := has_table_privilege(runtime_name, 'public.audit_events', 'UPDATE');
  can_delete_audit := has_table_privilege(runtime_name, 'public.audit_events', 'DELETE');
  can_truncate_audit := has_table_privilege(runtime_name, 'public.audit_events', 'TRUNCATE');
  IF can_update_audit OR can_delete_audit OR can_truncate_audit THEN
    RAISE EXCEPTION 'runtime_can_mutate_audit: update=%, delete=%, truncate=%',
      can_update_audit, can_delete_audit, can_truncate_audit;
  END IF;

  can_insert_global := has_table_privilege(runtime_name, 'public.global_security_events', 'INSERT');
  can_select_global := has_table_privilege(runtime_name, 'public.global_security_events', 'SELECT');
  can_update_global := has_table_privilege(runtime_name, 'public.global_security_events', 'UPDATE');
  can_delete_global := has_table_privilege(runtime_name, 'public.global_security_events', 'DELETE');
  can_truncate_global := has_table_privilege(runtime_name, 'public.global_security_events', 'TRUNCATE');
  IF NOT can_insert_global OR can_select_global OR can_update_global OR can_delete_global OR can_truncate_global THEN
    RAISE EXCEPTION 'invalid_global_security_event_privileges: insert=%, select=%, update=%, delete=%, truncate=%',
      can_insert_global, can_select_global, can_update_global, can_delete_global, can_truncate_global;
  END IF;

  RAISE NOTICE 'PASS runtime_role=% superuser=false bypassrls=false createrole=false createdb=false replication=false protected_rls=forced protected_owner=false audit_append_only=true global_security_events_insert_only=true',
    runtime_name;
END
$$;

-- Keep the output from these read-only queries as release evidence.
SELECT current_database() AS database_name, current_user AS runtime_role,
       current_setting('server_version') AS postgres_version;
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
FROM pg_roles WHERE rolname = current_user;
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = ANY(ARRAY['tenants','memberships','principals','external_identities','roles','role_permissions','membership_roles','applications','audit_events','global_security_events'])
ORDER BY c.relname;
SELECT
  has_table_privilege(current_user, 'public.global_security_events', 'INSERT') AS global_events_insert,
  has_table_privilege(current_user, 'public.global_security_events', 'SELECT') AS global_events_select,
  has_table_privilege(current_user, 'public.global_security_events', 'UPDATE') AS global_events_update,
  has_table_privilege(current_user, 'public.global_security_events', 'DELETE') AS global_events_delete,
  has_table_privilege(current_user, 'public.global_security_events', 'TRUNCATE') AS global_events_truncate;
