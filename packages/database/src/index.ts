export { withAuthenticatedTenant } from "./authenticated-tenant.js";
export { appendAuditEvent } from "./audit.js";
export type { AuditEvent, AuditOutcome } from "./audit.js";
export type {
  AuthenticatedTenantContext,
  AuthorizationEvaluator,
  RequiredPermission,
  VerifyAccessToken
} from "./authenticated-tenant.js";
export { resolveActiveMembership } from "./membership-resolution.js";
export type { ResolvedMembership, VerifiedIdentity } from "./membership-resolution.js";
