# Auth0 reference provider (OIDC)

Status: reference integration and operating contract; not a platform dependency.

## Purpose

Auth0 is the first interoperability target for OIDC login and access-token verification. The IAM domain remains provider-independent: principals are keyed by the verified pair `(issuer, subject)`; tenant membership, roles, permissions, and policy decisions are stored and evaluated by IAM Platform. Auth0 Organizations may help route B2B login, but an `org_id`, email domain, email address, role claim, or client-supplied tenant identifier is not sufficient proof of IAM membership or authorization.

## Server-side configuration

Use deployment secrets/configuration, never request parameters or unverified token claims:

```dotenv
OIDC_ISSUER=https://tms-platform.us.auth0.com/
OIDC_AUDIENCE=<the-exact-Auth0-API-identifier-for-this-environment>
OIDC_JWKS_URI=https://tms-platform.us.auth0.com/.well-known/jwks.json
OIDC_ALLOWED_ALGORITHMS=RS256
```

The issuer above records the existing Auth0 tenant as the reference example. Confirm the actual issuer and API identifier in the target tenant before enabling a deployment. Development, staging, and production must use explicit, environment-specific configuration. Never put client secrets, Management API tokens, or signing material in this file or in source control.

## Verification contract

The provider adapter must validate the signature against the configured JWKS, exact issuer, expected API audience, expiry, required claims, and a fixed allowlist of asymmetric algorithms. It must fail closed on malformed/expired tokens, issuer/audience mismatch, unavailable JWKS, and invalid configuration. JWKS caching/rotation and remote failure behavior need provider integration tests; unit tests must use generated local keys and must not require an Auth0 account or network.

After token verification, map `(iss, sub)` to an internal principal and resolve active membership and permissions from PostgreSQL inside the transaction that sets the tenant-local RLS context. Never accept tenant membership or permission decisions solely from token claims.

## MFA, Organizations, and access policies

- Treat Auth0 as the authentication/step-up provider where the selected subscription supports the required MFA factors and policies.
- Keep authorization policies and permission checks enforceable by IAM Platform even if Auth0 MFA, Organizations, RBAC, or Actions are unavailable.
- If the application requires MFA, define a server-side policy for which operations require step-up, verify the applicable assurance evidence supported by the chosen Auth0 flow, and test missing/insufficient assurance as a denial. Do not assume that a generic OIDC access token proves MFA occurred.
- Organization login context is an input to identity routing, not the canonical tenant database. Link a verified external identity to a tenant through an explicit, auditable membership flow.
- Avoid dependence on paid-only capabilities such as specific MFA factors, organization-scoped RBAC, M2M access for organizations, advanced attack protection, or audit-log streaming unless entitlement and cost have been confirmed.

## Provider-independent test matrix

The normal CI suite must not call Auth0 or require provider credentials. It should cover signature tampering, invalid issuer/audience, expiration, missing claims, unsupported algorithms, empty subject, unknown identity, inactive/missing membership, missing permission, cross-tenant access denial, and fail-closed provider/JWKS errors. A separate opt-in smoke/integration suite may use a dedicated Auth0 test tenant and short-lived credentials supplied by CI secrets. Do not make a successful external provider call a prerequisite for local unit tests.

A second OIDC implementation (for example, a local Keycloak test realm) should eventually run the same adapter contract suite to detect Auth0-specific assumptions.

## Plan, limits, and commercial gate

Checked against Auth0's public pricing and entity-limit pages on 2026-10-12; these are a snapshot, not a contractual quote:

- The public pricing page currently lists Free with up to 25,000 monthly active users and 5 Organizations, while Essentials lists 10 Organizations and MFA capabilities beyond Free. The exact MFA factor set differs by tier; phone/email/WebAuthn/push should not be assumed available on Free.
- Auth0's entity-limit policy separately defines hard entity limits; those are not the same as plan entitlements. For example, the Free tenant has limits on applications, API resource servers, admins, and social connections.
- Custom-domain setup may require card verification, according to the public pricing page.
- Feature availability, regional terms, trial conversion, MAU counting, rate limits, retention, and pricing can change or vary by contract.

Before depending on any feature, verify the live tenant's plan, entitlement and limits in the dashboard and official pricing/docs; record the date and evidence in the deployment checklist. The platform must still boot and pass its provider-independent tests if Auth0 plan features change. No production requirement should silently depend on a paid feature or on a free-tier quota.

References:
- [Auth0 pricing](https://auth0.com/pt/pricing)
- [Auth0 entity limit policy](https://auth0.com/docs/troubleshoot/customer-support/operational-policies/entity-limit-policy)
- [Auth0 Organizations setup](https://auth0.com/docs/manage-users/organizations/create-first-organization)
- [Auth0 MFA documentation](https://auth0.com/docs/secure/multi-factor-authentication)
