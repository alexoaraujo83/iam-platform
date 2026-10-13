# Production readiness runbook

Status: **NOT PRODUCTION READY** until every required gate below has deployment-specific evidence attached to the release.

This runbook separates CI evidence from deployment evidence. Passing a disposable PostgreSQL container or a local generated-key test is not proof that the target identity provider, production database, secrets, network policy, or recovery path is correct.

## 1. OIDC provider configuration and verification

Configure the provider only through trusted server-side environment/secrets:

- `OIDC_ISSUER`: exact issuer identifier from provider metadata; compare byte-for-byte with the token `iss`.
- `OIDC_AUDIENCE`: resource-server audience expected in access tokens (not the client ID unless the provider contract explicitly says so).
- `OIDC_JWKS_URI`: HTTPS JWKS endpoint from trusted provider metadata. Never derive it from a request, JWT header, or unverified claim.
- `OIDC_ALLOWED_ALGORITHMS`: explicit asymmetric allowlist supported by the verifier (default `RS256`).
- `DATABASE_URL`: secret-manager value for the runtime role, not the migration/owner role.

Use a dedicated non-production OIDC client/API and test with a real access token issued for that audience. Record provider, environment, timestamp, test version, and redacted results; never attach bearer tokens, private keys, or client secrets.

Required cases:

1. Valid token maps stable `(issuer, subject)` to exactly one external identity and then to a database principal.
2. Invalid signature, unknown `kid`, unsupported algorithm, wrong issuer, wrong audience, expired token, future `nbf`, missing required claims, and future `iat` are rejected.
3. Rotate signing keys: old and new keys behave according to provider overlap policy; unknown key IDs fail closed.
4. Make JWKS unavailable / time out. Authentication must not silently accept an unverifiable token; API errors must be sanitized and operationally observable. Verify cache behavior and recovery after the endpoint returns.
5. Different issuer with the same subject must not resolve to the same external identity. Subject alone is not a globally unique identity key.
6. Test clock skew and token lifetime against the provider's documented contract.

A local signing-key fixture validates verifier logic only; it does not satisfy the real-provider gate.

## 2. PostgreSQL deployment gate

Run the actual release migration against a disposable clone of the target PostgreSQL major version first, then validate the target environment with an approved, read-only verification script. Use separate migration-owner and application-runtime credentials.

Capture and review:

- PostgreSQL server version and migration ledger; migrations apply once and are repeatable/safe on the supported path.
- Effective role attributes and inherited memberships: runtime role is not superuser, does not have `BYPASSRLS`, does not own protected tables, and cannot assume a privileged role.
- `relrowsecurity = true` and `relforcerowsecurity = true` for every tenant-protected table.
- Runtime grants are least-privilege; runtime cannot alter schema, disable RLS, change policies, or write migration history.
- With transaction-local tenant context set, tenant A can read/write only A rows; tenant B reads zero A rows and cross-tenant INSERT, UPDATE/reassignment and DELETE are denied.
- Missing tenant context, malformed tenant context, connection reuse after rollback, pooled connection reuse, and transaction failure all fail closed and do not leak tenant state.
- Verify using the actual runtime login, not the migration owner or a superuser. Preserve SQLSTATE and redacted evidence.

Do not run destructive probes against production. For a production-like target, use a dedicated test tenant and approved canary records; otherwise execute all write-denial tests in a production-equivalent clone and capture read-only effective privilege/RLS metadata from the target.

CI PostgreSQL tests are necessary but are not deployment evidence.

## 3. Durable audit controls

The repository now includes `packages/database/src/audit.ts`, an append-only migration (`0002_durable_audit_controls.sql`), and unit/integration tests. Before production, wire `appendAuditEvent` into each security-sensitive flow and persist security-relevant events (authentication outcomes, membership changes, permission denials, privileged administration, tenant-boundary denials and configuration changes) to PostgreSQL in a transactionally consistent append-only audit store.

Minimum event fields: generated event ID, UTC timestamp, outcome, action, actor principal (nullable for unauthenticated events), tenant (nullable where not yet trusted), target type/ID, correlation/request ID, and a minimal redacted metadata object. Never store access tokens, credentials, authorization headers, secrets, or unnecessary personal data.

- Define retention, export, access review, alerting and incident-response ownership.
- Runtime role may INSERT and, if required, SELECT according to policy; it must not UPDATE/DELETE audit rows or alter audit schema.
- Verify constraints, transaction rollback semantics, duplicate/retry behavior, and that audit-write failure follows an explicit fail-closed/fail-safe policy for each event class.
- Alert on repeated invalid tokens, JWKS outages, cross-tenant denials, audit write failures, migration failures and unexpected shutdowns.
- Document tamper detection and restore-time reconciliation. A table alone does not prove durable audit operations.

## 4. Deployment, shutdown and recovery

- Inject secrets via deployment secret management; no secrets in Git, image layers, browser bundles, logs or CI artifacts. Require TLS for external traffic and database connections where supported.
- Pin reviewed release commit and dependency lockfile; run frozen install, typecheck, build, unit/integration tests, migration dry-run, dependency/security scan and secret scan before promotion.
- Apply migrations with a one-shot migration identity before routing traffic. Never give schema-owner credentials to the API process.
- Configure readiness/liveness probes, resource limits, request/connection timeouts, pool limits, log redaction, metrics and alerts.
- On SIGTERM/SIGINT, stop accepting new requests, allow in-flight requests to finish within a bounded grace period, then close the PostgreSQL pool. Escalation must not leave the process hung indefinitely.
- Back up database and required configuration separately; define RPO/RTO, retention and access restrictions. Perform a restore into an isolated database and verify schema, tenant isolation, audit continuity and application startup before calling recovery tested.
- Use a staged rollout/canary and documented rollback. If a migration is not backward-compatible, rollback must be a forward repair/restore plan, not an assumed code rollback.

## 5. Evidence ledger and release decision

For each gate, record commit SHA, target environment identifier (never credentials), command/procedure, timestamp, result, operator, artifact/log reference, and any exception with owner and expiry. Mark each gate as `NOT RUN`, `PASS`, or `FAIL`; do not infer PASS from implementation or CI alone.

Production readiness requires all gates to pass: real OIDC/JWKS integration, deployment PostgreSQL/RLS verification, durable audit, secret/configuration review, graceful shutdown, backup/restore drill, monitoring/alerts, and reviewed rollback procedure. Until then the release status remains **BLOCKED**.
