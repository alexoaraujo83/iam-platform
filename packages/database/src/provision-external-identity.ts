import type { Pool } from "pg";
import type { VerifiedIdentity } from "./membership-resolution.js";

export interface ProvisionedIdentity {
  readonly principalId: string;
}

/**
 * Persist an already-verified OIDC identity through a dedicated provisioner pool.
 *
 * SECURITY: never pass the normal runtime pool here. The pool must connect using
 * a separately provisioned role that can only EXECUTE
 * public.provision_external_identity(text, text). The caller must obtain the
 * identity from the trusted OIDC verifier, never from request parameters or
 * unverified JWT claims. This function does not grant tenant membership.
 */
export async function provisionExternalIdentity(
  provisionerPool: Pick<Pool, "query">,
  identity: VerifiedIdentity
): Promise<ProvisionedIdentity> {
  if (
    !identity ||
    typeof identity.issuer !== "string" ||
    identity.issuer.trim().length === 0 ||
    typeof identity.subject !== "string" ||
    identity.subject.trim().length === 0
  ) {
    throw new Error("invalid_verified_identity");
  }

  const result = await provisionerPool.query<{ principal_id: string }>(
    "SELECT public.provision_external_identity($1, $2) AS principal_id",
    [identity.issuer, identity.subject]
  );
  const principalId = result.rows[0]?.principal_id;
  if (typeof principalId !== "string" || principalId.length === 0) {
    throw new Error("identity_provisioning_failed");
  }
  return { principalId };
}
