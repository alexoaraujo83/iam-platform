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

This repository contains shared domain contracts, an exact-match RBAC evaluator, an OIDC/JWT verifier package, an initial PostgreSQL schema migration, baseline tests, architecture notes, a threat model and pull-request CI. It is not yet a production IAM service: there is no deployed API or admin UI, and the migration has not yet been validated against a real PostgreSQL instance with the intended runtime role. Tenant membership resolution, runtime RLS integration and durable audit operations remain pending.

## Prerequisites

- Node.js 22+
- pnpm 10.18+

## Commands

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`

## Structure

- `packages/contracts`: provider-independent domain contracts
- `packages/identity`: OIDC JWT verification against a configured trusted issuer/JWKS
- `packages/authorization`: deny-by-default exact permission evaluator
- `packages/database`: initial PostgreSQL schema migration
- `docs/architecture`: architecture boundaries and tenancy invariants
- `docs/security`: initial threat model and required security gates

## OIDC verifier boundary

The verifier validates the cryptographic signature, configured issuer and audience, expiration, required subject/issued-at claims, and a fixed allowlist of asymmetric algorithms. Issuer and JWKS endpoints must use HTTPS. The JWKS URL is trusted server-side configuration and must never be derived from request input or unverified token data. The verifier returns normalized issuer/subject identity data only; it does not infer tenant membership, roles or permissions.

The verifier has unit tests using generated signing keys and a local JWKS resolver. Production issuer discovery, remote JWKS behavior against each target provider, database-backed principal mapping and end-to-end API authentication still require integration validation.

## Security notes

Never put secrets in source control. A tenant claim does not prove membership. Do not deploy until identity persistence, membership resolution, migration/RLS integration tests, audit durability and operational controls are implemented and reviewed.

## Delivery governance

Work is proposed through pull requests. Track each item as discovered, implemented, tested, integrated and operational separately; do not promote status without evidence.
