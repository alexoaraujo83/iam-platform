-- 0002_durable_audit_controls.sql
-- Apply with the migration owner. Runtime audit events are append-only.
BEGIN;

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_metadata_object
  CHECK (jsonb_typeof(metadata) = 'object');

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
BEGIN
  -- The migration may run before the dedicated runtime role is provisioned.
  -- If present, remove mutation privileges without making role creation a prerequisite.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_runtime') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON audit_events FROM iam_runtime';
  END IF;
END
$$;

COMMIT;
