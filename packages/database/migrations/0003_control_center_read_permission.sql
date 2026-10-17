-- 0003_control_center_read_permission.sql
-- Register the explicit Control Center read capability.
-- This migration intentionally does NOT grant the permission to any role.
-- Tenant administrators must grant it through tenant-scoped role_permissions.
BEGIN;

INSERT INTO permissions (permission_key, description)
VALUES (
  'iam.control_center.read',
  'Read the IAM Platform Control Center for the active tenant'
)
ON CONFLICT (permission_key) DO NOTHING;

COMMIT;
