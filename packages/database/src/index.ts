export { withAuthenticatedTenant } from "./authenticated-tenant.js";
export { appendAuditEvent, appendPreAuthSecurityEvent } from "./audit.js";
export type { AuditEvent, AuditOutcome, PreAuthSecurityEvent } from "./audit.js";
export type {
  AuthenticatedTenantContext,
  AuthorizationEvaluator,
  RequiredPermission,
  VerifyAccessToken
} from "./authenticated-tenant.js";
export { resolveActiveMembership } from "./membership-resolution.js";
export { provisionExternalIdentity } from "./provision-external-identity.js";
export type { ProvisionedIdentity } from "./provision-external-identity.js";
export type { ResolvedMembership, VerifiedIdentity } from "./membership-resolution.js";
