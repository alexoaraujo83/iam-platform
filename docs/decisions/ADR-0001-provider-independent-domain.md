# ADR-0001: Provider-independent identity domain

- Status: Accepted for MVP direction
- Date: 2026-10-12

## Context

The platform should be reusable by future applications and must not bind authorization rules or tenant membership to a single identity vendor.

## Decision

Use OIDC as an integration protocol, not as the internal domain model. Normalize a verified (issuer, subject) pair into an internal principal; keep memberships, permissions, tenant relationships and audit events in the platform database. Provider-specific adapters implement verification and claim mapping behind interfaces.

## Consequences

- Provider integrations can be replaced without rewriting domain authorization.
- Issuer, audience, JWKS and allowed algorithms must be configured server-side.
- Account linking and subject migration require explicit audited workflows.
- The platform must not claim SAML, SCIM or any adapter works until implemented and tested.
