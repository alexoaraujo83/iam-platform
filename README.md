# IAM Platform

A provider-independent Identity and Access Management foundation for multi-tenant applications.

## Principles

- Identity authentication is separate from authorization.
- OIDC adapters normalize verified identities; provider claims are not domain truth.
- Tenant membership and permissions are database-backed.
- Authorization denies by default.
- PostgreSQL RLS is defense in depth, not a replacement for application authorization.
- Security claims require reproducible tests and recorded evidence.

## Current scope

This repository contains shared domain contracts, an exact-match RBAC evaluator, an OIDC/JWT verifier package, a PostgreSQL schema migration and RLS tests, database-backed membership resolution, and a helper that keeps authenticated tenant work inside the same RLS-scoped transaction. The helper requires an explicit authorization evaluator and does not invoke protected work unless the required permission is allowed. An initial HTTP API now exists in `apps/api` with a health endpoint and a tenant-context route. It has HTTP-level tests, but is not yet deployed and has not been validated against a production database or target identity provider. An admin UI and durable audit operations remain pending. The API now has bounded HTTP/database settings and graceful shutdown; these controls still require deployment verification.

## Prerequisites

- Node.js 24 (matches CI; `engines.node` requires `>=24.0.0`)
- pnpm 12.12.1 (pinned by `packageManager` and CI)

## Commands

- `pnpm install --frozen-lockfile` (reproducible dependency installation)
- `pnpm typecheck`
- `pnpm test`

## Structure

- `packages/contracts`: provider-independent domain contracts
- `packages/identity`: OIDC JWT verification against a configured trusted issuer/JWKS
- `packages/authorization`: deny-by-default exact permission evaluator
- `packages/database`: PostgreSQL schema, RLS tests, membership resolver and authenticated-tenant transaction helper
- `apps/api`: HTTP API, OIDC-backed tenant-context endpoint and HTTP denial-path tests
- `docs/architecture`: architecture boundaries and tenancy invariants
- `docs/security`: initial threat model and required security gates

## OIDC verifier boundary

The verifier validates the cryptographic signature, configured issuer and audience, expiration, required subject/issued-at claims, and a fixed allowlist of asymmetric algorithms. Issuer and JWKS endpoints must use HTTPS. The JWKS URL is trusted server-side configuration and must never be derived from request input or unverified token data. The verifier returns normalized issuer/subject identity data only; it does not infer tenant membership, roles or permissions.

Unit tests use generated signing keys and a local JWKS resolver. Production issuer discovery, remote JWKS behavior against each target provider, database-backed principal mapping and end-to-end API authentication still require integration validation.

## HTTP API

`apps/api` exposes `GET /health` and `GET /v1/tenants/:tenantId/context`. The latter requires a Bearer access token, verifies it against the server-configured OIDC issuer/audience/JWKS, resolves active membership and the `iam.context.read` permission in the same RLS-scoped database transaction, and returns only the normalized tenant context. Missing credentials return `401`; invalid tokens return `401`; missing membership or denied permissions return `403`; remote OIDC/JWKS unavailability returns a sanitized `503`; unexpected failures return a sanitized `500`. Configure `DATABASE_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`, and optionally `OIDC_ALLOWED_ALGORITHMS` (defaults to `RS256`). `PORT` defaults to `3000`. Copy `.env.example` for local configuration and never commit real credentials. HTTP tests exercise health, malformed credentials, membership/permission denial, invalid tokens, sanitized errors and unknown routes; they do not replace end-to-end OIDC/PostgreSQL integration tests.

## Authenticated tenant transaction

Use `withAuthenticatedTenant` from the database package to verify an access token before acquiring a connection, resolve the active membership and DB-derived permissions, and pass an explicit required permission plus the shared deny-by-default authorization evaluator. Protected queries run on the same explicit transaction where the RLS tenant setting was established, and the callback is not invoked unless authorization allows. A missing membership fails closed. The helper is a composition primitive, not a deployed HTTP API or session service.

## PostgreSQL RLS evidence

The CI integration suite applies the migration to PostgreSQL 16 and verifies that the test runtime role has neither superuser nor `BYPASSRLS`, missing tenant context returns no tenant-scoped rows, a tenant sees only its own rows, cross-tenant inserts fail with SQLSTATE `42501`, and cross-tenant updates do not mutate another tenant's membership. This evidence is limited to the ephemeral CI database and does not establish production deployment or all-table coverage.

## Security notes

Never put secrets in source control. A tenant claim does not prove membership. Do not deploy until the runtime HTTP/session integration, real-provider and deployment-database validation, comprehensive migration/RLS integration tests, durable audit, and operational controls are implemented and reviewed.

## Production operations

See [`docs/operations/production-readiness-runbook.md`](docs/operations/production-readiness-runbook.md) for real-provider OIDC tests, target-PostgreSQL/RLS verification, durable audit requirements, deployment/recovery procedures, and the evidence ledger. The runbook is intentionally explicit that CI success is not production evidence. Real-provider OIDC/JWKS, deployment database validation, durable audit implementation, and a restore drill remain release blockers until recorded as passing.

## Delivery governance

Work is proposed through pull requests. Track each item as discovered, implemented, tested, integrated and operational separately; do not promote status without evidence.
