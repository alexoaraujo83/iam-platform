-- 0002_durable_audit_controls.sql
-- Apply with the migration owner. Runtime audit events are append-only.
BEGIN;

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 0001 may already have installed an equivalent metadata-object check under
-- another name. Avoid creating a duplicate constraint on existing databases.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.audit_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%jsonb_typeof(metadata)%object%'
  ) THEN
    ALTER TABLE audit_events
      ADD CONSTRAINT audit_events_metadata_object
      CHECK (jsonb_typeof(metadata) = 'object');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events_are_append_only' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON audit_events FROM PUBLIC;
DO $$
DECLARE
  runtime_role text;
BEGIN
  -- The migration may run before either runtime role is provisioned.
  -- Revoke mutation privileges from both the legacy and intended app roles
  -- when present, without making role creation a prerequisite.
  FOREACH runtime_role IN ARRAY ARRAY['iam_runtime', 'iam_app_runtime']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON audit_events FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END
$$;

COMMIT;
