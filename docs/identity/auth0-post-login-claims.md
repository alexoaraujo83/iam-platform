# Auth0 Post Login Claims — IAM Platform

Status: **prepared for review; not deployed to an Auth0 tenant**.

## Purpose and trust boundary

The Post Login Action emits Auth0-assigned roles as the namespaced access-token claim `<namespace>/auth0_roles`. Treat this as provider metadata for diagnostics or presentation only.

The IAM Platform architecture requires the server to validate the access token and then resolve the active tenant membership and permissions from PostgreSQL. Do **not** use this claim as proof of tenant membership, as the source of IAM permissions, or as the sole basis for an authorization decision. This Action intentionally does not emit `tenant_id` or IAM permission claims.

## Configure in Auth0

1. In the dedicated IAM Platform Auth0 tenant, open **Actions → Library** and create a **Login / Post Login** Action.
2. Copy the contents of [auth0-post-login-claims.js](./auth0-post-login-claims.js) into the Action editor.
3. Add an Action secret named `IAM_CLAIMS_NAMESPACE`.
4. Set its value to a stable HTTPS namespace on a domain you control, ending in `/claims`, for example `https://auth.your-company-domain.tld/claims`. The example hostname is illustrative only; do not use a domain you do not control.
5. Test the Action, deploy it, then add it to the Login flow. Deployment and flow activation are separate steps.
6. Verify the resulting **access token** for the IAM API contains `<namespace>/auth0_roles` and that the audience is the exact IAM API identifier. Never paste real tokens or secrets into tickets or chat.

The previously proposed `https://iam-platform.example.com/claims` is a placeholder under a reserved example domain and must not be used in a real tenant.

## Validation checklist

- [ ] Action secret is configured with a valid HTTPS namespace controlled by the organization.
- [ ] Login succeeds with and without assigned Auth0 roles.
- [ ] Access token contains `auth0_roles` under the configured namespace.
- [ ] No `tenant_id` or IAM permission claim is treated as authoritative.
- [ ] API rejects invalid signature, issuer, audience, and expired tokens.
- [ ] API resolves membership and permissions from PostgreSQL and denies missing/inactive membership.
- [ ] Cross-tenant access remains denied even if the token contains provider role metadata.
- [ ] Action has been deployed and added to the Login flow only after testing.

## Operational boundary

This repository change only prepares the Action source and instructions. It does not create or modify an Auth0 tenant, Action, secret, Login flow, application, API, or deployment. Those steps require access to the actual Auth0 tenant and must be verified there.
