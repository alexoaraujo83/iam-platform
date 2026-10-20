# IAM Platform Control Center — discovery snapshot

Date: 2026-10-20
Status: discovery only; no production changes performed.

## Executive summary

The connected GitHub, Vercel and Neon accounts expose a real repository and infrastructure for IAM Platform. The repository already contains important identity, authorization, PostgreSQL RLS and audit primitives. The Control Center should initially be a read-only operational surface that aggregates verified evidence, not a dashboard that implies production readiness from a green deployment badge.

The immediate priority is to reconcile deployment/runtime/database evidence before implementing broad administrative controls.

## Evidence observed

### GitHub repository

- Repository: `alexoaraujo83/iam-platform`; default branch: `main`.
- Monorepo uses pnpm 12.12.1 and Node.js 24+.
- `apps/web` uses Next.js 16 / React 19 and Auth0's Next.js SDK.
- `apps/api` has `GET /health` and `GET /v1/tenants/:tenantId/context`; the API validates access tokens, resolves membership/permission from PostgreSQL and applies tenant-scoped RLS transaction handling.
- CI workflow runs Gitleaks against the checked-out source, `pnpm audit --audit-level high`, typecheck, lint, build and tests. It uses an ephemeral PostgreSQL 16 service for integration tests.
- The production-readiness runbook explicitly says production is NOT READY until environment-specific OIDC/JWKS, PostgreSQL/RLS, durable audit, secret configuration, graceful shutdown, backup/restore, monitoring and rollback evidence are recorded.
- Auth0 reference documentation is a specification; it explicitly does not prove that a dedicated Auth0 tenant has been created or configured.

References:
- https://github.com/alexoaraujo83/iam-platform
- https://github.com/alexoaraujo83/iam-platform/blob/main/.github/workflows/ci.yml
- https://github.com/alexoaraujo83/iam-platform/blob/main/docs/operations/production-readiness-runbook.md
- https://github.com/alexoaraujo83/iam-platform/blob/main/docs/identity/auth0-reference.md

### Vercel

Projects found:
- `iam-platform-web` (Next.js)
- `iam-platform-api` (Node)

Both projects report a latest READY deployment for branch `docs/control-center-baseline-v0.1`, commit `f40066eb6370e4ff5cc30f8e515bb5ea983ce389`. These latest deployments are previews (`target: null`), not production deployments.

Observed deployment drift:
- API has a READY production-target deployment for main commit `586041e9c04412e5fd8614e5d0bd3639c617a6d6`.
- Web's newest READY production-target deployment in the returned recent list is main commit `1a581e1254acd3e53a1fd02cc04b86fb77837660`; the later web deployment for `586041e9c04412e5fd8614e5d0bd3639c617a6d6` is reported CANCELED.
- Therefore, the currently reported production web and API deployments are not on the same commit. This is a release-consistency warning; determine whether the web changes require the API changes before promotion.
- Vercel reports SSO protection enabled for the web project (all except custom domains) and disabled for the API project. Confirm whether this is intentional. This is Vercel deployment protection, not a substitute for API-level authentication.

### Neon

Project:
- Name: `iam-platform`
- Project ID: `curly-fog-91868394`
- PostgreSQL 17, region `aws-sa-east-1`
- Branches include `main`, `development`, `preview`, and named validation branches for runtime role hardening, RLS, audit and restore.

Observed roles on Neon main:
- `iam_app_runtime`: `rolsuper=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolreplication=false`, `rolbypassrls=false`, login enabled.
- `iam_runtime`: `rolsuper=false`, but `rolcreatedb=true`, `rolcreaterole=true`, `rolreplication=true`, `rolbypassrls=true`, login enabled.
- `iam_owner`: privileged owner role; it is not suitable for application runtime.
- `iam_app_runtime` has table grants consistent with read access to domain tables, INSERT/SELECT on tenant audit events and INSERT-only on global pre-auth security events. The production runtime-security workflow confirmed the effective login as `iam_app_runtime`.
- RLS and FORCE RLS are enabled for tenants, memberships, principals, external identities, roles, role_permissions, membership_roles, applications, audit_events and global_security_events. The `permissions` table currently reports RLS disabled; verify whether it is intentionally global and contains no tenant-scoped data.

Additional read-only verification on the Neon `development` branch (`br-super-term-b6dt6vec`):
- The same role attributes were observed: `iam_app_runtime` is non-privileged and does not bypass RLS; `iam_runtime` still has `CREATEDB`, `CREATEROLE`, `REPLICATION` and `BYPASSRLS`; `iam_owner` remains privileged.
- RLS and FORCE RLS are enabled on the tenant/domain and audit tables inspected. The `permissions` lookup table has RLS disabled on this branch too. Read-only inspection of main shows only `id`, `permission_key`, `description` and `created_at` columns (no `tenant_id`), and `iam_app_runtime` has SELECT only. This supports treating it as global reference data for now; retain a schema-level regression test so tenant-scoped columns cannot be introduced silently without revisiting RLS.
- This confirms the legacy-role risk is present in development as well as main; it does not establish which role Vercel uses.

Runtime login verification (production, read-only): GitHub Actions run [Verify runtime database security #6](https://github.com/alexoaraujo83/iam-platform/actions/runs/39493932141) completed successfully for commit `b5aed6d277c4743d166325cbb4fe0197eb60e4e2`. The script ran using the selected production GitHub Environment secret without exposing its value and reported `database_name=iam_platform`, `runtime_role=iam_app_runtime`, PostgreSQL `17.11`, `superuser=false`, `bypassrls=false`, forced RLS on all 10 protected tables, no protected-table ownership, append-only tenant audit permissions and INSERT-only global security event permissions. This proves the login used by that workflow's production database connection, not automatically every Vercel deployment/instance. The legacy `iam_runtime` role still has privileged attributes; establish that no deployed connection uses it and retire/harden it through a separately reviewed change.

References:
- https://github.com/alexoaraujo83/iam-platform/blob/main/packages/database/migrations/verify_runtime_security.sql
- https://github.com/alexoaraujo83/iam-platform/blob/main/.github/workflows/verify-runtime-security.yml

### Auth0 and Clarim

- Auth0 is present in the web package and there is a provider reference document, but no connected Auth0 tenant configuration was verified in this discovery.
- No implementation or contract for Clarim was confirmed. Keep Clarim as an integration placeholder until its repository, API contract, event format or owner is identified. Do not fabricate status metrics.

## Gap matrix

| Area | Current evidence | Gap / decision |
|---|---|---|
| Web / API | Projects and READY deployments exist | Production commit drift; smoke test login, health and protected tenant-context route |
| Auth0 / OIDC | SDK dependency and reference contract exist | Verify dedicated tenant, exact issuer/audience/JWKS and real-token integration |
| PostgreSQL / RLS | Production runtime-security workflow passed for `iam_app_runtime`; protected RLS and audit grants verified | Confirm all deployed instances use the same restricted login; retire/harden the privileged legacy role through a reviewed change |
| Audit | Append-only migrations/helpers exist | Prove sensitive flows write durable events; verify retention/alerting/export operations |
| CI evidence | Quality workflow and read-only runtime-security workflow exist | Collect exact run IDs/URLs, artifacts and statuses for release commit and target environment |
| Control Center UI | Home page is sign-in / account entry only | Build role-gated dashboard and read-only diagnostics with provenance |
| Test Runner / Evidence Engine | Test primitives and runbook exist | Standardize execution ID, commit SHA, deployment ID, environment, timestamps, status, artifact refs and evidence hash |
| Clarim | Not verified | Identify system boundary before integrating |
| Admin actions | No complete admin interface verified | Defer write/destructive actions until authorization, audit and approval workflow exist |

## Recommended first implementation increment

Build the first Control Center increment as **read-only Context + Runtime Diagnostics + Evidence Index**, rather than broad CRUD administration.

1. Define versioned contracts for `DiagnosticCheck`, `RuntimeSnapshot`, `TestExecution` and `EvidenceArtifact`.
2. Expose a server-side diagnostics aggregator that reads only approved health/status sources and sanitizes all output. Do not return secrets, connection strings, tokens, raw claims or raw provider errors.
3. Show source, timestamp, environment, commit/deployment identity and freshness for every status. Distinguish PASS / FAIL / NOT RUN / UNKNOWN; never infer PASS from missing data.
4. Integrate GitHub workflow status and Vercel deployment metadata first. Add Neon runtime-security results only from the approved read-only verification workflow/script, executed against the actual runtime login in the selected GitHub Environment.
5. Gate the dashboard behind server-side Auth0 session validation plus IAM authorization. Hiding buttons in the browser is not authorization.
6. Persist evidence references with the shared evidence contract; avoid storing bearer tokens, secrets or unredacted logs.
7. Add tests for unavailable integrations, stale evidence, malformed responses, permission denial, cross-tenant access and redaction.

## Release / operational blockers to surface prominently

- Production web/API commit mismatch (confirm compatibility before promotion).
- The production runtime-security workflow proved its selected connection uses `iam_app_runtime`; still verify every deployed API instance and retire/harden the privileged legacy `iam_runtime` role.
- Production OIDC/JWKS validation not evidenced.
- Full sensitive-flow audit integration and operational retention/alerting not evidenced.
- Backup/restore exercise and production runbook approvals not evidenced.
- Clarim's role and contract unknown.

## Safety boundary

This snapshot combines read-only repository/service inspection with the successful read-only production runtime-security workflow linked above. No secret values were retrieved or exposed, no SQL writes were performed, no deployment was promoted, and no production resource was changed. The next safe step is to collect equivalent non-production evidence and integrate the exact workflow/deployment references into the Control Center Evidence Engine without embedding secret configuration or treating a single successful run as proof of all deployments.
