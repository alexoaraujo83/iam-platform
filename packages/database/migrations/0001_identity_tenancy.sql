-- 0001_identity_tenancy.sql
-- PostgreSQL 15+ recommended. Apply with a migration owner, not the runtime role.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  issuer text NOT NULL CHECK (length(trim(issuer)) > 0),
  subject text NOT NULL CHECK (length(trim(subject)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject),
  UNIQUE (principal_id, issuer, subject)
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  principal_id uuid NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, principal_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key text NOT NULL UNIQUE CHECK (permission_key ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  role_key text NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, role_key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE role_permissions (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_id, permission_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE membership_roles (
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by_principal_id uuid REFERENCES principals(id) ON DELETE RESTRICT,
  PRIMARY KEY (tenant_id, membership_id, role_id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  client_key text NOT NULL,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_principal_id uuid REFERENCES principals(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(trim(action)) BETWEEN 1 AND 160),
  target_type text NOT NULL CHECK (length(trim(target_type)) BETWEEN 1 AND 120),
  target_id text,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  correlation_id text NOT NULL CHECK (length(trim(correlation_id)) BETWEEN 1 AND 160),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memberships_principal_status_idx ON memberships (principal_id, status);
CREATE INDEX roles_tenant_idx ON roles (tenant_id);
CREATE INDEX membership_roles_membership_idx ON membership_roles (tenant_id, membership_id);
CREATE INDEX audit_events_tenant_time_idx ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx ON audit_events (correlation_id);

-- Tenant-scoped tables require a server-set, transaction-local tenant context.
-- The API must first verify the principal's active membership outside this
-- scoped query path, then SET LOCAL app.tenant_id to the validated UUID.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_isolation ON memberships
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_isolation ON roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_isolation ON role_permissions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_roles_isolation ON membership_roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications FORCE ROW LEVEL SECURITY;
CREATE POLICY applications_isolation ON applications
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_tenant_isolation ON audit_events
  USING (
    tenant_id IS NULL OR
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id IS NULL OR
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

COMMIT;
