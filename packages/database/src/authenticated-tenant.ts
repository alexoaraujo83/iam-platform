import type { Pool, PoolClient } from "pg";
import { resolveActiveMembership, type ResolvedMembership, type VerifiedIdentity } from "./membership-resolution.js";

export type VerifyAccessToken = (token: string) => Promise<VerifiedIdentity>;

export interface AuthenticatedTenantContext extends ResolvedMembership {}

export interface RequiredPermission {
  readonly resource: string;
  readonly action: string;
}

export type AuthorizationEvaluator = (
  context: AuthenticatedTenantContext,
  required: RequiredPermission
) => { readonly effect: "allow" | "deny" };

/**
 * Runs a tenant-scoped operation only after cryptographic token verification,
 * database-backed active-membership resolution, and an explicit RBAC decision.
 *
 * The callback runs inside the SAME transaction where app.tenant_id was set,
 * so PostgreSQL RLS remains scoped for all callback queries. The required
 * permission and evaluator are mandatory; the callback is never invoked when
 * authorization denies the request.
 *
 * The verifier must be built from trusted server-side OIDC configuration
 * (for example createOidcVerifier); never decode a JWT or trust caller-supplied
 * issuer/subject claims. Pass the shared deny-by-default evaluator from the
 * authorization package, not an allow-all implementation.
 *
 * Returns null when the token has no active membership in the requested tenant.
 * Verification, database, authorization-denial, and callback errors are
 * propagated after rollback where a transaction has started.
 */
export async function withAuthenticatedTenant<T>(
  pool: Pick<Pool, "connect">,
  verifyAccessToken: VerifyAccessToken,
  accessToken: string,
  tenantId: string,
  requiredPermission: RequiredPermission,
  evaluateAuthorization: AuthorizationEvaluator,
  operation: (client: PoolClient, context: AuthenticatedTenantContext) => Promise<T>
): Promise<T | null> {
  if (
    !requiredPermission ||
    typeof requiredPermission.resource !== "string" ||
    !requiredPermission.resource.trim() ||
    typeof requiredPermission.action !== "string" ||
    !requiredPermission.action.trim()
  ) {
    throw new Error("invalid_required_permission");
  }

  // Verify before opening a DB connection; identity is not membership.
  const identity = await verifyAccessToken(accessToken);
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const context = await resolveActiveMembership(client, identity, tenantId);
    if (!context) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return null;
    }

    if (evaluateAuthorization(context, requiredPermission).effect !== "allow") {
      throw new Error("authorization_denied");
    }

    const result = await operation(client, context);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original authentication/authorization/operation error.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
