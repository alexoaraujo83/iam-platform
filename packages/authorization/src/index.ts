import type { AuthorizationContext, AuthorizationDecision, Permission } from "@iam-platform/contracts";

function isValidContext(context: AuthorizationContext | null | undefined): context is AuthorizationContext {
  return Boolean(context && context.principalId.trim() && context.tenantId.trim() && context.membershipId.trim());
}

/** Exact-match RBAC evaluator. Denies by default; wildcard and role inheritance are not implicit. */
export function authorize(
  context: AuthorizationContext | null | undefined,
  required: Permission
): AuthorizationDecision {
  if (!isValidContext(context)) return { effect: "deny", reason: "missing_context" };

  const matched = context.permissions.some(
    (permission) => permission.resource === required.resource && permission.action === required.action
  );

  return matched
    ? { effect: "allow", reason: "permission_match" }
    : { effect: "deny", reason: "no_matching_permission" };
}
