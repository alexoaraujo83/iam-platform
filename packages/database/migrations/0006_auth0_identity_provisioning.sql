-- 0006_auth0_identity_provisioning.sql
-- Proposed narrow SECURITY DEFINER boundary. Do not apply to live Neon until reviewed.
-- The function owner is NOLOGIN and receives only the table privileges required here.
BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_identity_provisioner_owner') THEN
    CREATE ROLE iam_identity_provisioner_owner NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_identity_provisioner') THEN
    CREATE ROLE iam_identity_provisioner NOLOGIN NOBYPASSRLS;
  END IF;
END
$roles$;

-- Enforce role attributes even if a same-named role already existed.
ALTER ROLE iam_identity_provisioner_owner NOLOGIN BYPASSRLS NOCREATEROLE NOCREATEDB;
ALTER ROLE iam_identity_provisioner NOLOGIN NOBYPASSRLS NOCREATEROLE NOCREATEDB;

-- Never silently reuse either role if it already participates in role inheritance.
-- Membership could add privileges beyond the narrow grants below or allow another
-- principal to SET ROLE to the SECURITY DEFINER owner. Fail closed for manual review.
DO $membership_guard$
DECLARE
  v_role_ids oid[];
BEGIN
  SELECT array_agg(oid) INTO v_role_ids
    FROM pg_roles
   WHERE rolname IN ('iam_identity_provisioner_owner', 'iam_identity_provisioner');

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members
     WHERE roleid = ANY(v_role_ids)
        OR member = ANY(v_role_ids)
  ) THEN
    RAISE EXCEPTION 'identity_provisioner_role_membership_requires_review';
  END IF;
END
$membership_guard$;

-- CREATE is temporary and required by PostgreSQL for function ownership transfer.
GRANT USAGE, CREATE ON SCHEMA public TO iam_identity_provisioner_owner;
GRANT SELECT, INSERT ON TABLE public.principals TO iam_identity_provisioner_owner;
GRANT SELECT, INSERT ON TABLE public.external_identities TO iam_identity_provisioner_owner;

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

  RETURN v_principal_id;
END
$function$;

ALTER FUNCTION public.provision_external_identity(text, text)
  OWNER TO iam_identity_provisioner_owner;

REVOKE CREATE ON SCHEMA public FROM iam_identity_provisioner_owner;
REVOKE ALL ON FUNCTION public.provision_external_identity(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_external_identity(text, text)
  TO iam_identity_provisioner;

COMMIT;
