# Auth0 reference provider (OIDC)

Status: reference-provider setup specification for IAM Platform. The provider adapter and CI contract remain vendor-independent. This document is not evidence that an Auth0 tenant has already been created or configured.

## Decision and free-plan boundary (verified 2026-10-12)

Use a **dedicated Auth0 tenant for IAM Platform**, separate from the TMS tenant, so application registrations, callbacks, test users, Organizations, Actions, and secrets do not couple the projects.

Auth0 Free currently lists OIDC-capable applications/APIs, up to 25,000 monthly active users, and up to **5 Organizations**. However, the current public pricing page does **not** include Pro/Enterprise MFA factors in Free; the MFA factors listed for paid plans must not be treated as usable after a trial expires. Therefore:

- Free plan is acceptable for OIDC login/token validation and a reference Organization flow (within the 5-Organization limit).
- Do not claim or require Auth0-enforced MFA in Free. If MFA is a release requirement, either use a plan that explicitly includes the required factor or implement and independently verify a separate MFA capability; do not simulate MFA by trusting a client claim.
- Free-plan Organizations are a routing/onboarding feature only. IAM Platform remains authoritative for tenant membership, RBAC/ABAC, policy evaluation, and audit.
- Avoid custom-domain verification if it asks for a credit card; use the default Auth0 domain.
- Recheck the live dashboard and official pricing before relying on any quota or feature. A trial showing a toggle is not proof that it remains entitled on Free.

## Create the reference configuration

Create a **new tenant** in the Auth0 Dashboard with a unique available name for IAM Platform. Do not reuse the TMS tenant and do not put credentials in GitHub source. Use the tenant's actual region/domain as displayed by Auth0; do not assume a domain based on this document.

1. Record the tenant domain and exact issuer (https://<tenant-domain>/) in the private deployment configuration.
2. Create an API/resource server named "IAM Platform API". Set its identifier to a stable, environment-specific audience (for example, https://iam-platform-api-dev for development). Use that exact identifier as OIDC_AUDIENCE.
3. Create a Regular Web Application for the IAM Platform web client. Start with local development URLs only when developing locally; add the actual deployed callback, logout, and web-origin URLs only after the deployment URLs are known. Never use wildcard callback URLs or wildcard origins.
4. Keep the web client and API resource server distinct. Configure the API to issue JWT access tokens for the API audience; the API validates the access token, not an ID token.
5. Use Universal Login and an allowed database/passkey/social connection as appropriate. Do not add secrets to a public SPA. Keep any confidential client secret in the server's secret manager only.
6. For the Free-plan smoke test, create one test Organization (within the five-Organization cap) and a test user. Treat the org_id as context for routing only; link the verified (iss, sub) identity to an internal organization membership through an auditable IAM flow.
7. Keep the Management API and tenant administration credentials out of normal runtime configuration. CI must not depend on a broad Management API client unless a separate, least-privilege automation setup is deliberately approved.

## Runtime configuration

Use deployment secrets/configuration, never request parameters or unverified token claims:

~~~dotenv
OIDC_ISSUER=https://<actual-tenant-domain>/
OIDC_AUDIENCE=<exact-API-identifier-for-this-environment>
OIDC_JWKS_URI=https://<actual-tenant-domain>/.well-known/jwks.json
OIDC_ALLOWED_ALGORITHMS=RS256
~~~

The angle-bracket values are placeholders and must be replaced with the actual dashboard values. Development, staging, and production must use explicit environment-specific configuration. Never put client secrets, Management API tokens, signing material, or real tokens in this file or in source control.

## Verification contract

The provider adapter must validate the signature against the configured JWKS, exact issuer, expected API audience, expiry, required claims, and a fixed allowlist of asymmetric algorithms. It must fail closed on malformed/expired tokens, issuer/audience mismatch, unavailable JWKS, and invalid configuration. JWKS caching/rotation and remote failure behavior need provider integration tests; unit tests must use generated local keys and must not require an Auth0 account or network.

After token verification, map (iss, sub) to an internal principal and resolve active membership and permissions from PostgreSQL inside the transaction that sets the tenant-local RLS context. Never accept tenant membership or permission decisions solely from token claims. Never use email as the stable identity key.

## MFA, Organizations, and access policies

- The Free plan is not a valid basis for an Auth0-enforced MFA requirement according to the current public plan comparison. Any trial-only behavior must be considered unavailable after the tenant moves to Free.
- Until an MFA mechanism with verifiable assurance evidence is configured and tested, sensitive operations requiring MFA must be denied or explicitly remain out of scope; do not claim MFA protection.
- Keep policy decisions enforceable by IAM Platform even if Auth0 MFA, Organizations, RBAC, or Actions are unavailable.
- Do not assume a generic OIDC access token proves MFA occurred. When a supported MFA flow is later enabled, define server-side step-up requirements and test missing/insufficient assurance as a denial.
- Organization login context is an input to identity routing, not the canonical tenant database. Link a verified external identity to a tenant through an explicit, auditable membership flow.
- Do not rely on Auth0 organization-scoped RBAC, advanced attack protection, audit-log streaming, or other paid-plan features unless entitlement and cost are confirmed.

## Provider-independent test matrix

The normal CI suite must not call Auth0 or require provider credentials. It should cover signature tampering, invalid issuer/audience, expiration, missing claims, unsupported algorithms, empty subject, unknown identity, inactive/missing membership, missing permission, cross-tenant access denial, and fail-closed provider/JWKS errors. A separate opt-in smoke/integration suite may use a dedicated Auth0 test tenant and short-lived credentials supplied by CI secrets. Do not make a successful external provider call a prerequisite for local unit tests.

A second OIDC implementation (for example, a local Keycloak test realm) should eventually run the same adapter contract suite to detect Auth0-specific assumptions.

## Evidence checklist

Record the following in the deployment/release evidence ledger; do not mark the provider integration as operational until the applicable items are proven:

- [ ] Dedicated IAM Platform Auth0 tenant exists; actual domain, region, and issuer recorded.
- [ ] API/resource server exists; exact audience recorded.
- [ ] Web application callback/logout/origin allowlists contain only the required exact URLs.
- [ ] Public configuration contains no secret; confidential credentials are stored outside source control.
- [ ] JWKS URL responds and a real access token has the expected issuer and audience.
- [ ] Valid token succeeds; invalid signature, issuer, audience, expiry, and missing subject fail closed.
- [ ] Unknown identity, missing/inactive membership, missing permission, and cross-tenant access are denied.
- [ ] Organization behavior is tested within the Free limit; IAM database remains canonical.
- [ ] MFA entitlement is explicitly recorded. If unavailable on Free, no protected operation is represented as MFA-verified.
- [ ] A deployment smoke test is recorded separately from unit/CI evidence.

## References

- [Auth0 pricing (official)](https://auth0.com/pt/pricing)
- [Auth0 entity limit policy](https://auth0.com/docs/troubleshoot/customer-support/operational-policies/entity-limit-policy)
- [Auth0 Organizations setup](https://auth0.com/docs/manage-users/organizations/create-first-organization)
- [Auth0 MFA documentation](https://auth0.com/docs/secure/multi-factor-authentication)
