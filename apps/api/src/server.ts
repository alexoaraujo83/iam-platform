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
const verifyAccessToken = async (token: string) => {
  try {
    return await oidcVerifier(token);
  } catch {
    throw new Error("invalid_access_token");
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
