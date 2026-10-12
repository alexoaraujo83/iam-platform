# Initial threat model

Status: draft; must be reviewed before production use.

| Threat | Required control | Verification evidence |
|---|---|---|
| Forged or incorrectly scoped JWT | Validate signature, fixed algorithm allowlist, issuer, audience, expiry and not-before | Negative token tests |
| Cross-tenant data access | Resolve active membership; server-built tenant context; PostgreSQL RLS | Cross-tenant read/write integration tests |
| Privilege escalation | DB-backed grants; deny by default; no client-authoritative roles | Authorization matrix tests |
| IdP substitution / confused deputy | Explicit issuer-to-provider configuration and audience binding | Wrong issuer/audience tests |
| Replay / duplicate event | Idempotency keys and unique constraints for side effects | Replay integration test |
| Audit tampering | Append-only application interface; restricted DB grants; export/retention policy | Permission and integrity tests |
| Secret leakage | No secrets in source, logs, fixtures or browser bundles | Secret scanning and log tests |
| Unsafe tenant switching | Re-resolve membership on every request or trusted session boundary | Tenant-switch negative tests |

## Security gates

- Never use JWT decode as a substitute for verification.
- Never accept arbitrary JWKS URLs from end-user input.
- Never infer membership or roles from untrusted token claims.
- Never mark a security gate passed without reproducible evidence.
- Keep production secrets out of repository and CI logs.
