import { Pool } from "pg";
import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize } from "@iam-platform/authorization";
import { withAuthenticatedTenant } from "@iam-platform/database";
import { createOidcVerifier } from "@iam-platform/identity";
import type { IdentityProviderConfig } from "@iam-platform/contracts";
import { createApiHandler, type ResolveTenantContext } from "../apps/api/src/app.js";
import { normalizeOidcVerificationError } from "../apps/api/src/oidc-error.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_required_configuration:${name}`);
  return value;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid_positive_integer_configuration:${name}`);
  }
  return value;
}

let resolveTenantContext: ResolveTenantContext | undefined;
let runtimeInitializationError: unknown;
let runtimeInitialized = false;

function initializeRuntime(): ResolveTenantContext {
  if (runtimeInitialized) {
    if (runtimeInitializationError) throw runtimeInitializationError;
    if (resolveTenantContext) return resolveTenantContext;
    throw new Error("runtime_initialization_failed");
  }

  runtimeInitialized = true;
  try {
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
      max: positiveIntegerEnv("DATABASE_POOL_MAX", 5),
      connectionTimeoutMillis: positiveIntegerEnv("DATABASE_CONNECT_TIMEOUT_MS", 5_000),
      idleTimeoutMillis: positiveIntegerEnv("DATABASE_POOL_IDLE_TIMEOUT_MS", 10_000),
      application_name: "iam-platform-vercel-api"
    });
    pool.on("error", () => {
      console.error(JSON.stringify({ level: "error", event: "database_idle_client_error" }));
    });

    resolveTenantContext = async (accessToken, tenantId) =>
      withAuthenticatedTenant(
        pool,
        verifyAccessToken,
        accessToken,
        tenantId,
        { resource: "iam", action: "context.read" },
        (authorizationContext, requiredPermission) => authorize(authorizationContext, requiredPermission),
        async (_client, membership) => membership
      );
    return resolveTenantContext;
  } catch (error) {
    runtimeInitializationError = error;
    throw error;
  }
}

const handler = createApiHandler(async (accessToken, tenantId) =>
  initializeRuntime()(accessToken, tenantId)
);

export default function apiHandler(request: IncomingMessage, response: ServerResponse): void {
  handler(request, response);
}
