# Database package

This directory contains versioned PostgreSQL migrations for the IAM platform.

## Migration 0001

Creates tenants, principals, external OIDC identities, memberships, permissions, tenant roles, role grants, application registrations and audit events.

Tenant-owned tables use ENABLE ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY. The application must set app.tenant_id transaction-locally only after it has validated the authenticated principal and active membership. Never use an untrusted token claim as proof of membership.

## Deployment requirements

- Apply migrations with a dedicated schema/migration owner.
- The runtime database role must not be superuser and must not have BYPASSRLS.
- Grant runtime access explicitly; this migration intentionally does not create credentials or grant broad privileges.
- Keep principals and external_identities behind trusted server-side service boundaries.
- Audit records with NULL tenant_id are reserved for explicitly global security events and require separate authorization at the service layer.
- Before production, add integration tests using the actual runtime role for same-tenant visibility, cross-tenant read/write denial, role reassignment denial, missing tenant context and audit insert policy.

This migration is an initial schema baseline, not evidence that RLS is running in any deployed environment.
