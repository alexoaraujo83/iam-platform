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

This repository contains shared domain contracts, an exact-match RBAC evaluator, an OIDC/JWT verifier package, an initial PostgreSQL schema migration, baseline tests, architecture notes, a threat model and pull-request CI. CI now validates the migration against an ephemeral PostgreSQL 16 instance and exercises tenant RLS using a non-superuser, non-BYPASSRLS test role. This is not yet a production IAM service: there is no deployed API or admin UI, and no production database or target identity provider has been validated. Tenant membership resolution, runtime API integration and durable audit operations remain pending.

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
- `packages/database`: PostgreSQL schema migration and RLS integration tests
- `docs/architecture`: architecture boundaries and tenancy invariants
- `docs/security`: initial threat model and required security gates

## OIDC verifier boundary

The verifier validates the cryptographic signature, configured issuer and audience, expiration, required subject/issued-at claims, and a fixed allowlist of asymmetric algorithms. Issuer and JWKS endpoints must use HTTPS. The JWKS URL is trusted server-side configuration and must never be derived from request input or unverified token data. The verifier returns normalized issuer/subject identity data only; it does not infer tenant membership, roles or permissions.

Unit tests use generated signing keys and a local JWKS resolver. Production issuer discovery, remote JWKS behavior against each target provider, database-backed principal mapping and end-to-end API authentication still require integration validation.

## PostgreSQL RLS evidence

The CI integration suite applies the migration to PostgreSQL 16 and verifies that the test runtime role has neither superuser nor `BYPASSRLS`, missing tenant context returns no tenant-scoped rows, a tenant sees only its own rows, cross-tenant inserts fail with SQLSTATE `42501`, and cross-tenant updates do not mutate another tenant's membership. This evidence is limited to the ephemeral CI database and does not establish production deployment or all-table coverage.

## Security notes

Never put secrets in source control. A tenant claim does not prove membership. Do not deploy until identity persistence, membership resolution, comprehensive migration/RLS integration tests, audit durability and operational controls are implemented and reviewed.

## Delivery governance

Work is proposed through pull requests. Track each item as discovered, implemented, tested, integrated and operational separately; do not promote status without evidence.
