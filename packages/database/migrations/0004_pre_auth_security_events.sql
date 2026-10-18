-- 0004_pre_auth_security_events.sql
-- Pre-authentication/global security events are intentionally separate from tenant audit rows.
-- Apply with the migration owner, never the application runtime role.
BEGIN;

CREATE TABLE global_security_events (
  id uuid PRIMARY KEY,
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.:-]{1,159}$'),
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  correlation_id text NOT NULL CHECK (length(trim(correlation_id)) BETWEEN 1 AND 200),
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX global_security_events_time_idx ON global_security_events (occurred_at DESC);
CREATE INDEX global_security_events_correlation_idx ON global_security_events (correlation_id);

ALTER TABLE global_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_security_events FORCE ROW LEVEL SECURITY;

-- This table has no tenant column and is only for global/pre-auth security events.
-- INSERT is further restricted by table grants; runtime gets no SELECT or mutation rights.
CREATE POLICY global_security_events_insert_policy ON global_security_events
  FOR INSERT TO PUBLIC WITH CHECK (true);

CREATE TRIGGER global_security_events_append_only
  BEFORE UPDATE OR DELETE ON global_security_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

REVOKE ALL ON global_security_events FROM PUBLIC;

DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['iam_runtime', 'iam_app_runtime']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format('REVOKE ALL ON global_security_events FROM %I', runtime_role);
      EXECUTE format('GRANT INSERT ON global_security_events TO %I', runtime_role);
    END IF;
  END LOOP;
END
$$;

COMMIT;
