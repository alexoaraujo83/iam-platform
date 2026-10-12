import { Pool } from "pg";
import { authorize } from "@iam-platform/authorization";
import { withAuthenticatedTenant } from "@iam-platform/database";
import { createOidcVerifier } from "@iam-platform/identity";
import type { IdentityProviderConfig } from "@iam-platform/contracts";
import { createApiServer } from "./app.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_required_configuration:${name}`);
  return value;
}

const oidcConfig: IdentityProviderConfig = {
  issuer: requiredEnv("OIDC_ISSUER"),
  audience: requiredEnv("OIDC_AUDIENCE"),
  jwksUri: requiredEnv("OIDC_JWKS_URI"),
  allowedAlgorithms: (process.env.OIDC_ALLOWED_ALGORITHMS ?? "RS256")
    .split(",")
    .map((algorithm) => algorithm.trim())
    .filter(Boolean)
};
const oidcVerifier = createOidcVerifier(oidcConfig);

const INVALID_TOKEN_CODES = new Set([
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWT_EXPIRED",
  "ERR_JWT_INVALID",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JWKS_NO_MATCHING_KEY",
  "invalid_token",
  "token_issued_in_future",
  "invalid_verified_identity_claims"
]);

const verifyAccessToken = async (token: string) => {
  try {
    return await oidcVerifier(token);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error &&
      typeof error.code === "string" ? error.code :
      error instanceof Error ? error.message.split(":", 1)[0] : undefined;

    if (code && INVALID_TOKEN_CODES.has(code)) {
      throw new Error("invalid_access_token");
    }

    // Network errors, remote JWKS timeouts and provider keyset failures are operational,
    // not proof that the caller's credential is invalid.
    if (error instanceof TypeError || code?.startsWith("ERR_JWKS_")) {
      throw new Error("identity_provider_unavailable");
    }

    // Preserve unexpected failures as server errors instead of mislabeling them as 401.
    throw error;
  }
};

const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") });
const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("invalid_port_configuration");
}

const server = createApiServer(async (accessToken, tenantId) =>
  withAuthenticatedTenant(
    pool,
    verifyAccessToken,
    accessToken,
    tenantId,
    { resource: "iam", action: "context.read" },
    (authorizationContext, requiredPermission) => authorize(authorizationContext, requiredPermission),
    async (_client, membership) => membership
  )
);

server.listen(port, "0.0.0.0");

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await pool.end();
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
