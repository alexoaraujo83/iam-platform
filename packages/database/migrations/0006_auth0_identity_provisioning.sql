-- 0006_auth0_identity_provisioning.sql
-- Proposed narrow SECURITY DEFINER boundary. Do not apply to live Neon until reviewed.
-- The function owner is NOLOGIN and receives only the table privileges required here.
BEGIN;

DO $roles$
BEGIN
  -- Roles must be provisioned separately by an administrator and reviewed before
  -- this migration. Do not CREATE ROLE here: PostgreSQL/managed-provider role
  -- membership semantics can give the creator elevated membership privileges.
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'iam_identity_provisioner_owner'
       AND NOT rolcanlogin
       AND rolbypassrls
       AND NOT rolcreaterole
       AND NOT rolcreatedb
  ) THEN
    RAISE EXCEPTION 'identity_provisioner_owner_role_missing_or_misconfigured';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'iam_identity_provisioner'
       AND NOT rolcanlogin
       AND NOT rolbypassrls
       AND NOT rolcreaterole
       AND NOT rolcreatedb
       AND NOT rolsuper
       AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'identity_provisioner_role_missing_or_misconfigured';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'iam_identity_provisioner_login'
       AND rolcanlogin
       AND NOT rolsuper
       AND NOT rolbypassrls
       AND NOT rolcreaterole
       AND NOT rolcreatedb
       AND NOT rolreplication
       AND rolinherit
  ) THEN
    RAISE EXCEPTION 'identity_provisioner_login_role_missing_or_misconfigured';
  END IF;
END;
$roles$;

-- Enforce role attributes even if a same-named role already existed.
ALTER ROLE iam_identity_provisioner_owner NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE iam_identity_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
ALTER ROLE iam_identity_provisioner_login LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;

-- Neon administrators may be members of the narrowly scoped roles. The runtime
-- roles must never be members of either provisioning role; only iam_owner may
-- assume the definer owner, and only iam_owner/the dedicated login may assume
-- the executor. The login may inherit only the executor role.
DO $membership_guard$
DECLARE
  v_owner_id oid;
  v_executor_id oid;
  v_login_id oid;
  v_admin_id oid;
BEGIN
  SELECT oid INTO v_owner_id FROM pg_roles WHERE rolname = 'iam_identity_provisioner_owner';
  SELECT oid INTO v_executor_id FROM pg_roles WHERE rolname = 'iam_identity_provisioner';
  SELECT oid INTO v_login_id FROM pg_roles WHERE rolname = 'iam_identity_provisioner_login';
  SELECT oid INTO v_admin_id FROM pg_roles WHERE rolname = 'iam_owner';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'identity_provisioner_admin_role_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members WHERE roleid = v_executor_id AND member = v_login_id
  ) THEN
    RAISE EXCEPTION 'identity_provisioner_login_membership_missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members
     WHERE member IN (v_owner_id, v_executor_id)
        OR (roleid = v_owner_id AND member <> v_admin_id)
        OR (roleid = v_executor_id AND member NOT IN (v_admin_id, v_login_id))
        OR (member = v_login_id AND roleid <> v_executor_id)
        OR (roleid = v_login_id AND member <> v_admin_id)
  ) THEN
    RAISE EXCEPTION 'identity_provisioner_role_membership_requires_review';
  END IF;
END;
$membership_guard$;

-- CREATE is temporary and required by PostgreSQL for function ownership transfer.
GRANT USAGE, CREATE ON SCHEMA public TO iam_identity_provisioner_owner;
GRANT SELECT, INSERT ON TABLE public.principals TO iam_identity_provisioner_owner;
GRANT SELECT, INSERT ON TABLE public.external_identities TO iam_identity_provisioner_owner;
GRANT INSERT ON TABLE public.global_security_events TO iam_identity_provisioner_owner;

CREATE OR REPLACE FUNCTION public.provision_external_identity(
  p_issuer text,
  p_subject text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_principal_id uuid;
BEGIN
  IF p_issuer IS NULL OR length(btrim(p_issuer)) = 0
     OR p_subject IS NULL OR length(btrim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'invalid_external_identity' USING ERRCODE = '22023';
  END IF;

  -- Advisory-lock collisions only serialize unrelated identities; uniqueness
  -- remains enforced by the external_identities constraint.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_issuer || ':' || p_subject, 0)
  );

  SELECT ei.principal_id
    INTO v_principal_id
    FROM public.external_identities AS ei
   WHERE ei.issuer = p_issuer
     AND ei.subject = p_subject;

  IF v_principal_id IS NOT NULL THEN
    RETURN v_principal_id;
  END IF;

  INSERT INTO public.principals DEFAULT VALUES
  RETURNING id INTO v_principal_id;

  INSERT INTO public.external_identities (principal_id, issuer, subject)
  VALUES (v_principal_id, p_issuer, p_subject);

  -- Audit the creation atomically without storing issuer, subject, tokens, or claims.
  -- If the append-only security log is unavailable, roll back the identity too.
  INSERT INTO public.global_security_events
    (id, action, outcome, correlation_id, metadata)
  VALUES (
    gen_random_uuid(),
    'identity.provisioned',
    'success',
    gen_random_uuid()::text,
    jsonb_build_object('provider', 'oidc', 'result', 'created')
  );

  RETURN v_principal_id;
END;
$function$;

ALTER FUNCTION public.provision_external_identity(text, text)
  OWNER TO iam_identity_provisioner_owner;

REVOKE CREATE ON SCHEMA public FROM iam_identity_provisioner_owner;
REVOKE ALL ON FUNCTION public.provision_external_identity(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_external_identity(text, text)
  TO iam_identity_provisioner;

COMMIT;
