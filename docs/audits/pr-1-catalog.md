# PR #1 — technical audit catalog

- Repository: `alexoaraujo83/iam-platform`
- Pull request: [#1](https://github.com/alexoaraujo83/iam-platform/pull/1)
- Scope: provider-independent IAM MVP foundation
- Audit status: implementation reviewed; CI run #99 passed the prior head. A subsequent runtime-database privilege review found and patched missing tenant-scoped read policies for identity tables; CI for these new changes is pending.
- Merge status: keep open; do not merge as part of this audit.

## File inventory

| Area | Files / purpose |
|---|---|
| Workspace and toolchain | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `.gitignore`, `tsconfig.base.json`, `vitest.config.ts` |
| CI and dependency hygiene | `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.env.example` |
| API | `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/server.ts`, `apps/api/src/oidc-error.ts`, `apps/api/src/oidc-error.test.ts` |
| Contracts | `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`, `packages/contracts/src/index.test.ts` |
| Identity | `packages/identity/package.json`, `packages/identity/tsconfig.json`, `packages/identity/src/index.ts`, `packages/identity/src/index.test.ts`, `packages/identity/src/bearer-token.ts`, `packages/identity/src/bearer-token.test.ts` |
| Authorization | `packages/authorization/package.json`, `packages/authorization/tsconfig.json`, `packages/authorization/src/index.ts`, `packages/authorization/src/index.test.ts` |
| Database and tenant isolation | `packages/database/package.json`, `packages/database/tsconfig.json`, `packages/database/README.md`, `packages/database/src/index.ts`, `packages/database/src/membership-resolution.ts`, `packages/database/src/membership-resolution.test.ts`, `packages/database/src/authenticated-tenant.ts`, `packages/database/src/authenticated-tenant.test.ts`, `packages/database/migrations/0001_identity_tenancy.sql`, `packages/database/tests/rls.integration.test.ts` |
| Architecture and security documentation | `README.md`, `docs/architecture/overview.md`, `docs/decisions/ADR-0001-provider-independent-domain.md`, `docs/security/threat-model.md`, `docs/audits/pr-1-catalog.md` |

## Implemented controls observed

- Provider-independent contracts separate verified identity from tenant membership, roles and permissions.
- OIDC verification uses configured issuer/audience/JWKS, HTTPS configuration, asymmetric algorithm allowlisting, claim checks and signature verification.
- Bearer parsing rejects malformed/multiple credentials.
- RBAC uses deny-by-default exact permission matching.
- Tenant operations are composed in an explicit transaction with membership resolution, authorization, rollback and connection release.
- PostgreSQL migration applies ENABLE and FORCE RLS to tenant-scoped tables; CI exercises a restricted runtime role against PostgreSQL 16.
- API responses avoid caching and set `X-Content-Type-Options: nosniff`; unexpected errors are sanitized.
- CI enforces frozen dependency installation, typecheck, build and tests; Dependabot is configured for npm and GitHub Actions.

## Findings and disposition

| ID | Severity | Finding | Disposition / evidence |
|---|---|---|---|
| IAM-PR1-001 | High | The API server wrapped every OIDC verifier exception as `invalid_access_token`, so JWKS/network outages could be reported as client authentication failures (401). | Corrected in `apps/api/src/server.ts`: recognized token-validation failures map to `invalid_access_token`; remote JWKS errors/network `TypeError` map to `identity_provider_unavailable`; unknown failures remain server errors. |
| IAM-PR1-002 | Medium | API did not distinguish identity-provider outages from unexpected internal failures. | Added sanitized 503 mapping in `apps/api/src/app.ts`, HTTP regression test in `apps/api/src/app.test.ts`, and README documentation. Isolated the verifier error classifier in `apps/api/src/oidc-error.ts` and added direct tests for invalid credentials, remote JWKS failures, network errors and unexpected exceptions. |
| IAM-PR1-003 | Medium | API HTTP tests had previously been excluded from the root Vitest include pattern. | Fixed `vitest.config.ts` to include both `apps/**/*.test.ts` and `packages/**/*.test.ts`; prior CI run #88 passed the API suite. |
| IAM-PR1-004 | Medium | Tenant route accepted arbitrary tenant path strings before querying the resolver. | UUID format validation and regression test return 400 before resolver/database work. |
| IAM-PR1-005 | Low | Invalid-token HTTP classification previously compared the entire error message, failing when a diagnostic suffix was present. | Classifies stable error-code prefix; prior CI run #88 passed 63/63 tests. |
| IAM-PR1-006 | High | The runtime resolver reads `principals`, `external_identities` and `permissions`, but the restricted CI runtime role lacked SELECT grants on these tables; unrestricted grants to global identity tables would expose cross-tenant identity data. | Migration now applies ENABLE/FORCE RLS to `principals` and `external_identities`, restricting reads to principals with an active membership in the transaction-scoped tenant. The test runtime role receives SELECT-only access to these tables and `permissions`; integration tests now seed and assert tenant-scoped identity visibility. CI validation pending. |

## Remaining gates — not proven by this PR's CI

1. Run CI after the identity-table RLS/grant changes and verify frozen install, typecheck, build, OIDC tests and PostgreSQL integration tests.
2. Validate against a real configured OIDC provider and deployment PostgreSQL instance.
3. Review RLS coverage for every future tenant-scoped table and verify runtime grants in the target environment.
4. Implement durable audit write/read/retention and operational alerting/metrics.
5. Implement and review administration and lifecycle workflows before production claims.
6. Keep the PR open pending final diff/check review; do not treat a technical comment by the PR author as independent approval.

## Evidence boundary

CI uses an ephemeral PostgreSQL 16 instance and generated/local signing fixtures. Passing CI proves the covered automated scenarios only; it does not prove production identity-provider availability, production database policy, deployment security or operational readiness.
