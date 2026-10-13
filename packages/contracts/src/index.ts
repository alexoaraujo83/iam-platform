/**
 * Provider-independent domain contracts. External IdP claims must be mapped
 * into these types by a trusted adapter; never trust tenant membership from a
 * token claim alone.
 */
export type UUID = string;
export type ISODateTime = string;

export interface Principal {
  readonly id: UUID;
  readonly issuer: string;
  readonly subject: string;
}

export interface TenantContext {
  readonly tenantId: UUID;
  readonly principalId: UUID;
  readonly membershipId: UUID;
}

export interface Membership {
  readonly id: UUID;
  readonly tenantId: UUID;
  readonly principalId: UUID;
  readonly status: "active" | "suspended" | "revoked";
}

export interface Permission {
  readonly resource: string;
  readonly action: string;
}

export interface AuthorizationContext {
  readonly principalId: UUID;
  readonly tenantId: UUID;
  readonly membershipId: UUID;
  readonly permissions: readonly Permission[];
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
}

export type AuthorizationDecision =
  | { readonly effect: "allow"; readonly reason: "permission_match" }
  | { readonly effect: "deny"; readonly reason: "missing_context" | "no_matching_permission" };

export interface IdentityProviderConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly allowedAlgorithms: readonly string[];
}

export interface AuditEvent {
  readonly id: UUID;
  readonly tenantId: UUID | null;
  readonly actorPrincipalId: UUID | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly occurredAt: ISODateTime;
  readonly outcome: "success" | "denied" | "failure";
  readonly correlationId: string;
}
