# Auth0 / Preview validation record

Date: 2026-10-22  
Scope: IAM Platform Preview only  
Repository: `alexoaraujo83/iam-platform`  
Branch: `chore/auth0-preview-validation`

## Public OIDC configuration

- Auth0 tenant domain: `iam-platform.us.auth0.com`
- Expected issuer: `https://iam-platform.us.auth0.com/` (issuer must include the trailing slash and match the token `iss` claim exactly)
- Expected JWKS endpoint: `https://iam-platform.us.auth0.com/.well-known/jwks.json`
- API audience: `https://iam-platform-api`
- Allowed signing algorithm: `RS256`

These values are public configuration, not credentials. The API must validate access tokens (not ID tokens), signature, issuer, audience, expiry and required claims before tenant membership or authorization checks.

## Live configuration inventory (metadata only)

The Vercel environment-variable inventory was inspected with decryption disabled.

### Web project: `iam-platform-web`

- `AUTH0_DOMAIN`: present for Development, Preview and Production; the configured public domain matches the tenant above.
- `AUTH0_AUDIENCE`: present for Development, Preview and Production; the configured audience matches the API identifier above.
- `AUTH0_CLIENT_ID`: present for all three environments.
- `AUTH0_CLIENT_SECRET`: present for Development, Preview and Production as a sensitive value; its value was not retrieved.
- `AUTH0_SECRET`: present as a sensitive value in Development, Preview and Production; its value was not retrieved.
- `APP_BASE_URL`: configured separately for Development, Preview and Production.
- Legacy `AUTH0_ISSUER_BASE_URL` and `AUTH0_JWKS_URL` keys are marked in Vercel as not consumed by the current `@auth0/nextjs-auth0` v4 client. Do not treat them as active web SDK configuration.

### API project: `iam-platform-api`

- `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`, `OIDC_ALLOWED_ALGORITHMS` and `AUTH0_AUDIENCE` are present in Vercel environment metadata.
- `DATABASE_URL` is configured as a sensitive variable per environment; values were not retrieved.
- The Preview environment has a separate sensitive `IDENTITY_PROVISIONER_DATABASE_URL`; its value was not retrieved.
- The identity bootstrap feature flag is configured fail-closed (`false`). Keep it disabled until dedicated end-to-end provisioning checks and database-role/branch checks pass.

## Validation status

| Check | Status | Evidence / next action |
|---|---|---|
| Public domain and audience supplied | Pass | User supplied the values recorded above |
| Vercel env names and target scopes | Pass | Inventory read with `decrypt=false`; no secret values retrieved |
| Web domain/audience match | Pass | Public values match the supplied domain and audience |
| Sensitive values disclosed | Pass | No secret values requested or retrieved |
| Auth0 discovery/JWKS reachable from this session | Not verified | Public metadata endpoint could not be fetched by the available web reader; verify from CI/runtime without logging tokens or secrets |
| Auth0 client credentials are valid | Not verified | Run a real Preview login; verify callback/logout allowlists in Auth0 Dashboard |
| API access-token acceptance and rejection cases | Not verified | Run the isolated Preview integration suite with a short-lived test token; do not use a real user token in logs |
| Neon Preview role/branch and RLS behavior | Not verified | Confirm runtime connects to the Preview branch with least privilege; test cross-tenant denial |
| Current Preview deployment end-to-end | Not verified | Latest deployments reported READY, but READY alone is not an auth smoke test |

## Safe Preview smoke test

1. Confirm the Auth0 Regular Web Application has exact callback, logout and web-origin URLs for the actual Preview URL; no wildcards.
2. Confirm the Auth0 API identifier is exactly `https://iam-platform-api` and the client is authorized to request that audience.
3. Trigger a fresh Preview deployment after any environment changes; Vercel does not retroactively inject environment changes into existing deployments.
4. Sign in via the web app and verify callback/session/logout without recording cookies, codes or tokens.
5. Call a protected API endpoint using a short-lived access token for the expected audience. Verify valid token succeeds only with an active IAM tenant membership and permission.
6. Verify expired, malformed, wrong-issuer, wrong-audience and unauthorized cross-tenant requests fail closed.
7. Record deployment URLs, timestamps, commit SHA, status codes and sanitized test outcomes only.
8. Keep bootstrap disabled and do not promote or merge until checks are reviewed.

## Security boundary

This document intentionally contains no client secret, session secret, database URL, access token, Vercel bypass secret or Auth0 Management API credential. Keep those in their respective secret stores. Do not enable a production rollout as part of this change.
