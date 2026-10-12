import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { authorize } from "@iam-platform/authorization";
import { withAuthenticatedTenant } from "@iam-platform/database";
import { createOidcVerifier, extractBearerToken } from "@iam-platform/identity";
import type { IdentityProviderConfig } from "@iam-platform/contracts";

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
    // Do not expose JWT/JWKS validation details to callers.
    throw new Error("invalid_access_token");
  }
};
const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") });
const port = Number(process.env.PORT ?? "3000");

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  void routeRequest(request, response).catch(() => {
    if (!response.headersSent) sendJson(response, 500, { error: "internal_server_error" });
    else response.destroy();
  });
}

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  const match = /^\/v1\/tenants\/([^/]+)\/context$/.exec(url.pathname);
  if (request.method !== "GET" || !match?.[1]) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  const accessToken = extractBearerToken(request.headers.authorization);
  if (!accessToken) {
    sendJson(response, 401, { error: "invalid_or_missing_bearer_token" });
    return;
  }

  const tenantId = decodeURIComponent(match[1]);
  if (!tenantId.trim() || tenantId.length > 128) {
    sendJson(response, 400, { error: "invalid_tenant_id" });
    return;
  }

  try {
    const context = await withAuthenticatedTenant(
      pool,
      verifyAccessToken,
      accessToken,
      tenantId,
      { resource: "iam", action: "context.read" },
      (authorizationContext, requiredPermission) => authorize(authorizationContext, requiredPermission),
      async (_client, membership) => membership
    );

    if (!context) {
      sendJson(response, 403, { error: "active_membership_required" });
      return;
    }

    sendJson(response, 200, {
      tenantId: context.tenantId,
      principalId: context.principalId,
      membershipId: context.membershipId,
      permissions: context.permissions
    });
  } catch (error) {
    if (error instanceof Error && error.message === "authorization_denied") {
      sendJson(response, 403, { error: "permission_denied" });
      return;
    }
    if (error instanceof Error && error.message === "invalid_access_token") {
      sendJson(response, 401, { error: "invalid_access_token" });
      return;
    }
    sendJson(response, 500, { error: "internal_server_error" });
  }
}

const server = createServer(handleRequest);
server.listen(port, "0.0.0.0");

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
}

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
