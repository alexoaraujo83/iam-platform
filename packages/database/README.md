# Database package

This directory contains versioned PostgreSQL migrations, tenant-isolation integration tests, and the database-side authenticated-tenant transaction boundary for the IAM platform.

## Migration 0001

Creates tenants, principals, external OIDC identities, memberships, permissions, tenant roles, role grants, application registrations and audit events.

Tenant-owned tables use ENABLE ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY. The application must set `app.tenant_id` transaction-locally only after it has validated the authenticated principal and active membership. Never use an untrusted token claim as proof of membership.

## Identity-to-membership resolution

`src/membership-resolution.ts` maps a cryptographically verified `(issuer, subject)` pair to an active local principal, tenant and membership, then loads permissions from active membership-role grants. The requested tenant ID is only an RLS scope selector; it never proves access. The resolver fails closed when the principal, tenant or membership is inactive/missing and rejects malformed permission keys.

## Authenticated tenant transaction

`src/authenticated-tenant.ts` composes token verification, membership resolution, and protected database work:

1. Verify the access token before acquiring a database connection.
2. Start an explicit PostgreSQL transaction.
3. Resolve the active membership and DB-derived permissions, setting `app.tenant_id` transaction-locally.
4. Invoke the protected-operation callback on the same client/transaction.
5. Commit on success; roll back on missing membership or errors; always release the client.

Pass a verifier created from trusted server-side OIDC configuration (for example `createOidcVerifier`). Never pass decoded, unverified JWT claims. The callback must call the deny-by-default authorization evaluator for the operation's required permission before doing protected work. Keep all tenant-scoped queries inside that callback; a transaction-local RLS setting does not survive commit.

The unit tests cover membership resolution and transaction lifecycle, including verification failure before DB acquisition, missing membership, rollback, and client release. These tests do not replace end-to-end validation with a real OIDC provider and PostgreSQL.

## Automated integration evidence

The GitHub Actions CI starts an ephemeral PostgreSQL 16 service, applies this migration, and connects as a dedicated `iam_runtime` test role with `NOSUPERUSER` and `NOBYPASSRLS`. Current tests verify:

- Missing tenant context exposes no rows from `tenants` or `memberships`.
- Tenant A can read its own rows but not tenant B's rows.
- A cross-tenant membership insert is rejected with SQLSTATE `42501`.
- A cross-tenant update affects zero rows and leaves the target membership unchanged.
- The runtime role is not a superuser and does not bypass RLS.

Run this suite only against a disposable PostgreSQL database by setting `IAM_DATABASE_INTEGRATION=1`, `DATABASE_URL` (migration/test administrator), and `IAM_RUNTIME_DATABASE_URL` (runtime test role). The CI database is ephemeral; this is not production evidence.

## Deployment requirements

- Apply migrations with a dedicated schema/migration owner.
- The runtime database role must not be superuser and must not have BYPASSRLS.
- Grant runtime access explicitly; this migration intentionally does not create credentials or grant broad privileges.
- Keep principals and external_identities behind trusted server-side service boundaries.
- Audit records with NULL tenant_id are reserved for explicitly global security events and require separate authorization at the service layer.
- Extend integration coverage to role reassignment, delete denial, audit-event policies, and all tenant-scoped tables before production.
- Validate the migration against the actual deployment database and verify runtime grants before any production claim.

This migration is an initial schema baseline. CI validation demonstrates behavior in an ephemeral test database only; it does not prove RLS is enabled or correctly configured in any deployed environment.
