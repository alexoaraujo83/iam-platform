# Auth0 / Preview validation record

Date: 2026-10-22 (updated 2026-10-23 UTC)  
Scope: IAM Platform Preview only  
Repository: `alexoaraujo83/iam-platform`  
Branch: `chore/auth0-preview-validation`  
Pull request: https://github.com/alexoaraujo83/iam-platform/pull/55

## Public OIDC configuration

- Auth0 tenant domain: `iam-platform.us.auth0.com`
- Expected issuer: `https://iam-platform.us.auth0.com/` (must match the token `iss` claim exactly, including trailing slash)
- Expected JWKS endpoint: `https://iam-platform.us.auth0.com/.well-known/jwks.json`
- API audience: `https://iam-platform-api`
- Expected signing algorithm: `RS256`

These are public configuration values, not credentials. The API must validate access-token signature, issuer, audience, expiry and required claims before tenant membership or authorization checks. An ID token must not be accepted as an API access token.

## Live configuration inventory (metadata only)

The Vercel environment-variable inventory was inspected with decryption disabled. No secret values were retrieved.

### Web project: `iam-platform-web`

- `AUTH0_DOMAIN`: present for Development, Preview and Production; the configured public domain matches the supplied tenant.
- `AUTH0_AUDIENCE`: present for Development, Preview and Production; the configured audience matches the supplied API identifier.
- `AUTH0_CLIENT_ID`: present for all three environments.
- `AUTH0_CLIENT_SECRET` and `AUTH0_SECRET`: present as sensitive variables; values were not retrieved.
- `APP_BASE_URL`: configured separately by environment.
- Legacy `AUTH0_ISSUER_BASE_URL` and `AUTH0_JWKS_URL` keys are marked as not consumed by the current `@auth0/nextjs-auth0` v4 client; do not treat them as active web SDK configuration.

### API project: `iam-platform-api`

- `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`, `OIDC_ALLOWED_ALGORITHMS` and `AUTH0_AUDIENCE` are present in Vercel environment metadata.
- `DATABASE_URL` is configured as a sensitive variable per environment; values were not retrieved.
- Preview has a separate sensitive `IDENTITY_PROVISIONER_DATABASE_URL`; its value was not retrieved.
- The identity bootstrap feature flag is configured fail-closed (`false`). Keep it disabled until end-to-end provisioning and database-role/branch checks pass.

## Deployment and CI evidence

Current PR head: `ac2aadb6713ebadf8453dfc5b2e972089e3b6b22`.

- Web Preview deployment: READY for the current PR head. URL: https://iam-platform-nf4ay7jrv-alexoaraujo83-8387s-projects.vercel.app
- API Preview deployment: READY for the current PR head. URL: https://iam-platform-1rxb6hkx9-alexoaraujo83-8387s-projects.vercel.app
- GitHub Actions `quality` check: passed for the current PR head (run 39884208135).
- Vercel Preview Comments check: passed for the current PR head; zero unresolved Vercel feedback was reported.
- Neon workflow run `39883643534`: conclusion is failure, but the GitHub API currently reports `event=push` while the checked-in workflow declares only `workflow_dispatch`, and the run's jobs endpoint returns `total_count=0`. Therefore there is no job log or failed step available to diagnose. This is an anomalous/incomplete run record, not evidence that the database assertions themselves failed.
- The manual Neon workflow requires the `NEON_DATABASE_URL` secret in the selected GitHub Environment (`neon-preview` for Preview) and runs the read-only `verify_runtime_security.sql` assertions. Trigger it manually for Preview and inspect the new run's job logs before making configuration changes.
- A Vercel `READY` state confirms deployment completion, not successful login, API authorization, or tenant isolation.

## Validation status

| Check | Status | Evidence / next action |
|---|---|---|
| Public domain and audience supplied | Pass | Values supplied by the project owner |
| Vercel environment names/scopes | Pass | Metadata inventory read with decryption disabled |
| Web public domain/audience match | Pass | Values match the supplied tenant and API identifier |
| Secret values exposed in this work | Pass | No secret values requested or retrieved |
| Vercel Preview builds for current PR head | Pass | Web and API deployments READY on `ac2aadb` |
| CI quality check | Pass | Run 39884208135 completed successfully |
| Vercel Preview feedback | Pass | Current PR check reports zero unresolved feedback |
| Neon connection/security workflow | Blocked / investigate | Run 39883643534 has no jobs/logs; manually dispatch target=preview and inspect new run |
| Auth0 discovery/JWKS reachable | Not verified | Verify from CI/runtime using HTTPS without logging tokens |
| Auth0 client credentials and callback allowlists | Not verified | Complete a real Preview login and inspect exact callback/logout/origin allowlists in Auth0 Dashboard |
| API token acceptance/rejection cases | Not verified | Run integration tests for valid, expired, malformed, wrong-issuer and wrong-audience access tokens |
| Neon Preview role/branch and RLS behavior | Not verified | Confirm Preview branch and least-privilege role; test cross-tenant denial |
| End-to-end Preview authentication | Not verified | Run browser login/logout and protected API smoke tests; READY alone is insufficient |

## Safe Preview smoke test

1. Manually run the Neon connection/security workflow with target `preview`. Confirm the `neon-preview` GitHub Environment contains the correct `NEON_DATABASE_URL` secret; do not print the value.
2. If the workflow fails, inspect the actual failing step and sanitized error before changing secrets, role grants, RLS policies or branch configuration.
3. In Auth0, verify the Regular Web Application's Allowed Callback URLs, Allowed Logout URLs and Web Origins contain the exact Preview URL(s) required by the SDK. Avoid wildcards.
4. Verify the Auth0 API identifier is exactly `https://iam-platform-api`, the API signing algorithm is RS256, and the web client is authorized to request this audience.
5. Verify the Auth0 discovery document and JWKS endpoint from Preview runtime/CI using HTTPS, without logging credentials or tokens.
6. Perform a fresh Preview login, callback, session and logout. Never capture session cookies, authorization codes or tokens in logs.
7. Call a protected API endpoint with a short-lived access token for the expected audience. Verify a valid token still requires active IAM tenant membership and permission.
8. Verify expired, malformed, wrong-issuer, wrong-audience and unauthorized cross-tenant requests fail closed.
9. Record deployment URLs, timestamps, commit SHA, status codes and sanitized test outcomes only.
10. Keep identity bootstrap disabled and do not merge or promote until the Neon run is understood and the authentication/tenant-isolation tests pass.

## Security boundary

This record contains no client secret, session secret, database URL, access token, Vercel bypass secret or Auth0 Management API credential. Keep secrets in their designated secret stores. No production environment was changed or promoted as part of this work.
