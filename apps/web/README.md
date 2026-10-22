# IAM Platform Web

Next.js 16 web application for the IAM Platform. The web app uses the Auth0 Next.js SDK for browser login, callback handling, and server-side session management. The IAM API remains authoritative for application authorization.

## Requirements

- Node.js 24 or newer
- pnpm 12.12.1 (managed from the repository root)
- A dedicated Auth0 Regular Web Application for local or test use

## Local development

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter web dev
```

Open http://localhost:3000.

Create `apps/web/.env.local` using the variables below. Do not commit this file or any real credentials.

```dotenv
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
AUTH0_SECRET=
APP_BASE_URL=http://localhost:3000
```

Generate a fresh session secret with:

```bash
openssl rand -hex 32
```

Use the Auth0 tenant domain exactly as shown in its dashboard, without the `https://` prefix in `AUTH0_DOMAIN`. Keep the confidential client secret and session secret server-side, in a local ignored env file or deployment secret store. Never expose them through `NEXT_PUBLIC_*` variables.

## Auth0 application allowlists

For local development, configure these exact values on the dedicated Auth0 application:

- **Allowed Callback URLs:** `http://localhost:3000/auth/callback`
- **Allowed Logout URLs:** `http://localhost:3000`
- **Allowed Web Origins:** `http://localhost:3000`

Add production URLs only after the deployed origin is known. Do not use wildcard callback URLs or origins. Use a dedicated non-production tenant for integration tests; do not reuse another product's tenant or production users.

### Environment reconciliation (Auth0 Next.js SDK v4)

The Web SDK consumes `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`, and (to request an access token for the IAM API) `AUTH0_AUDIENCE`. The audited origins are Development `http://localhost:3000`, Preview `https://iam-platform-web-preview.vercel.app`, and Production `https://iam-platform-web.vercel.app`. Auth0 allowlists must use the matching callback (`<origin>/auth/callback`), logout origin, and Web Origin for each environment, without wildcards.

The API has a separate trust boundary: `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`, and `OIDC_ALLOWED_ALGORITHMS=RS256`. Do not substitute Web SDK configuration for the API's trusted OIDC configuration. At the 2026-10-22 audit, `AUTH0_ISSUER_BASE_URL` and `AUTH0_JWKS_URL` remained in Vercel Web environment inventories, but neither is consumed by the audited `src/lib/auth0.ts`. They are tracked as legacy configuration pending rollback-dependency review; this documentation change does not delete them or change secret values.

The Next.js 16 `src/proxy.ts` entry point delegates to the Auth0 SDK, which handles `/auth/login`, `/auth/logout`, `/auth/callback`, and session cookies. The homepage displays the current session when present.

## Validation and security boundary

Run repository checks from the root:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

CI supplies disposable placeholder Auth0 values so the SDK can be initialized and the app can build. These values are not a real Auth0 tenant and do not prove end-to-end authentication; CI does not call the external provider.

After configuring a dedicated test tenant, record a separate smoke test for login, callback validation, session persistence, logout, and failure behavior when configuration is invalid or unavailable. Never paste credentials or tokens into issues, pull requests, logs, or this repository.

**Authentication is not authorization.** A valid Auth0 session does not by itself grant an IAM role or tenant access. The IAM API must validate access tokens for its configured audience, map the verified `(iss, sub)` identity to an internal principal, resolve active tenant membership and permissions server-side, and enforce tenant isolation and database RLS. Do not use email or client-supplied organization context as the authorization key.

## Release evidence still required

- [ ] Dedicated IAM Platform Auth0 tenant and actual issuer/domain recorded privately.
- [ ] API audience and web application settings reviewed.
- [ ] Exact callback/logout/origin allowlists configured.
- [ ] Real test account completes login, callback, session persistence, and logout.
- [ ] API authorization, missing/inactive membership, insufficient permission, and cross-tenant denial verified.
- [ ] Evidence is recorded without including secrets, access tokens, or session cookies.
