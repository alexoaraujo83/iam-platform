# Architecture overview

## MVP boundaries

- Identity adapters verify external credentials and normalize authenticated subjects into internal principals.
- Domain identity stores internal principals, tenants, memberships and application registrations.
- Authorization evaluates explicit permissions against validated tenant context; deny by default.
- Policy evolution starts with exact-match RBAC. ABAC and policy versioning are separate, testable extensions.
- Audit records security-relevant decisions and administrative mutations with correlation IDs.
- Admin API/UI consume the same domain services and authorization policies.

## Provider independence

The domain layer must not import an Auth0, Keycloak, Cognito or other provider SDK. An OIDC adapter is responsible for issuer/audience validation, signature verification, expiry and not-before checks, fixed algorithm allowlists, and trusted JWKS configuration. The adapter maps (issuer, subject) to an internal principal. Provider claims are not authorization truth.

## Tenant isolation invariants

1. A tenant identifier in a token is a selector, not proof of membership.
2. Resolve an active membership in the database for the authenticated principal and requested tenant.
3. Build tenant context server-side; never accept a caller-supplied role as authoritative.
4. Apply tenant scoping to every data-access path; use PostgreSQL RLS as defense in depth.
5. Runtime database roles must not be superusers or have BYPASSRLS.
6. Missing identity, tenant, membership or policy context results in denial.

## Proposed module boundaries

contracts, identity, tenancy, authorization, applications, audit, api, admin-web, worker, sdk-typescript.

## Out of scope for first slice

SAML, SCIM, complex policy language, automatic role inheritance, cross-tenant administrators, billing, and production compliance claims. Add these only with threat models and regression tests.
