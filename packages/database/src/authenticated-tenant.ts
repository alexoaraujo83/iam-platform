import type { Pool, PoolClient } from "pg";
import { resolveActiveMembership, type ResolvedMembership, type VerifiedIdentity } from "./membership-resolution.js";

export type VerifyAccessToken = (token: string) => Promise<VerifiedIdentity>;

export interface AuthenticatedTenantContext extends ResolvedMembership {}

/**
 * Runs a tenant-scoped operation only after cryptographic token verification
 * and database-backed active-membership resolution.
 *
 * The callback runs inside the SAME transaction where app.tenant_id was set,
 * so PostgreSQL RLS remains scoped for all callback queries. The callback must
 * enforce the required permission with the deny-by-default authorization
 * package before performing protected work.
 *
 * The verifier must be built from trusted server-side OIDC configuration
 * (for example createOidcVerifier); never implement this callback by decoding
 * a JWT or by trusting caller-supplied issuer/subject claims.
 *
 * Returns null when the token has no active membership in the requested tenant.
 * Verification, database, and callback errors are propagated after rollback.
 */
export async function withAuthenticatedTenant<T>(
  pool: Pick<Pool, "connect">,
  verifyAccessToken: VerifyAccessToken,
  accessToken: string,
  tenantId: string,
  operation: (client: PoolClient, context: AuthenticatedTenantContext) => Promise<T>
): Promise<T | null> {
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

    const result = await operation(client, context);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original authentication/operation error.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
