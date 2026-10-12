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

This foundation introduces shared domain contracts, a deliberately small exact-match RBAC evaluator, baseline tests, architecture notes, a threat model and pull-request CI. It is not yet a production IAM service: there is no deployed API, real OIDC verifier, database schema/migrations, admin UI, or runtime RLS integration in this slice.

## Prerequisites

- Node.js 22+
- pnpm 10.18+

## Commands

- pnpm install
- pnpm typecheck
- pnpm test

## Structure

- packages/contracts: provider-independent domain contracts
- packages/authorization: deny-by-default exact permission evaluator
- docs/architecture: architecture boundaries and tenancy invariants
- docs/security: initial threat model and required security gates

## Security notes

Never put secrets in source control. Configure OIDC issuer, audience, JWKS URI and algorithm allowlist through trusted server-side configuration. A tenant claim does not prove membership. Do not deploy until JWT verification, persistence, migrations, tenant isolation tests, audit durability and operational controls are implemented and reviewed.

## Delivery governance

Work is proposed through pull requests. Track each item as discovered, implemented, tested, integrated and operational separately; do not promote status without evidence.
