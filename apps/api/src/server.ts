import { Pool } from "pg";
import { authorize } from "@iam-platform/authorization";
import { appendPreAuthSecurityEvent, withAuthenticatedTenant } from "@iam-platform/database";
import { createOidcVerifier } from "@iam-platform/identity";
import type { IdentityProviderConfig } from "@iam-platform/contracts";
import { createApiServer, type RequiredTenantPermission } from "./app.js";
import { normalizeOidcVerificationError } from "./oidc-error.js";

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
  } catch (error) {
    throw normalizeOidcVerificationError(error);
  }
};

const pool = new Pool({
  connectionString: requiredEnv("DATABASE_URL"),
  max: positiveIntegerEnv("DATABASE_POOL_MAX", 10),
  connectionTimeoutMillis: positiveIntegerEnv("DATABASE_CONNECT_TIMEOUT_MS", 5_000),
  idleTimeoutMillis: positiveIntegerEnv("DATABASE_IDLE_TIMEOUT_MS", 30_000),
  application_name: "iam-platform-api"
});
pool.on("error", () => {
  // Do not log connection strings or driver errors that may contain infrastructure details.
  console.error(JSON.stringify({ level: "error", event: "database_idle_client_error" }));
});

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid_positive_integer_configuration:${name}`);
  }
  return value;
}

const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("invalid_port_configuration");
}

const server = createApiServer(
  async (accessToken, tenantId, requiredPermission) =>
    withAuthenticatedTenant(
      pool,
      verifyAccessToken,
      accessToken,
      tenantId,
      requiredPermission ?? { resource: "iam", action: "context.read" },
      (authorizationContext, permission) => authorize(authorizationContext, permission),
      async (_client, membership) => membership
    ),
  async () => {
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  },
  async (event) => {
    await appendPreAuthSecurityEvent(pool, event);
  }
);

server.requestTimeout = positiveIntegerEnv("HTTP_REQUEST_TIMEOUT_MS", 15_000);
server.headersTimeout = positiveIntegerEnv("HTTP_HEADERS_TIMEOUT_MS", 10_000);
server.keepAliveTimeout = positiveIntegerEnv("HTTP_KEEP_ALIVE_TIMEOUT_MS", 5_000);

server.listen(port, "0.0.0.0", () => {
  console.info(JSON.stringify({ level: "info", event: "http_server_listening", port }));
});

let shutdownPromise: Promise<void> | undefined;
async function shutdown(signal: "SIGTERM" | "SIGINT"): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    console.info(JSON.stringify({ level: "info", event: "shutdown_started", signal }));
    const graceMs = positiveIntegerEnv("SHUTDOWN_GRACE_MS", 10_000);
    let graceExpired = false;
    const graceTimer = setTimeout(() => {
      graceExpired = true;
      console.error(JSON.stringify({ level: "error", event: "shutdown_grace_expired" }));
      server.closeAllConnections();
    }, graceMs);
    graceTimer.unref();

    try {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      // Stop idle keep-alive sockets immediately; in-flight requests get the grace period.
      server.closeIdleConnections();
      await closed;
      await pool.end();
      console.info(JSON.stringify({ level: "info", event: "shutdown_completed" }));
    } catch {
      console.error(JSON.stringify({ level: "error", event: "shutdown_failed" }));
      process.exitCode = 1;
    } finally {
      clearTimeout(graceTimer);
      if (graceExpired) process.exitCode = 1;
    }
  })();

  return shutdownPromise;
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
