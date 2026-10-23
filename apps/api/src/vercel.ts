import { Pool } from "pg";
import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize } from "@iam-platform/authorization";
import { appendPreAuthSecurityEvent, withAuthenticatedTenant } from "@iam-platform/database";
import { createOidcVerifier } from "@iam-platform/identity";
import type { IdentityProviderConfig } from "@iam-platform/contracts";
import { createApiHandler, type RecordPreAuthSecurityEvent, type ResolveTenantContext, type RequiredTenantPermission } from "./app.js";
import { normalizeOidcVerificationError } from "./oidc-error.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_required_configuration:${name}`);
  return value;
}

function databaseConnectionString(): string {
  const connectionString = requiredEnv("DATABASE_URL");
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("invalid_database_connection_string");
  }

  // Enforce hostname verification for every Neon environment even when an
  // older Vercel variable still contains sslmode=require. Keep local/non-Neon
  // PostgreSQL connection settings unchanged.
  if (parsed.hostname.toLowerCase().endsWith(".neon.tech")) {
    parsed.searchParams.set("sslmode", "verify-full");
  }

  return parsed.toString();
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
let checkReadiness: (() => Promise<boolean>) | undefined;
let recordPreAuthSecurityEvent: RecordPreAuthSecurityEvent | undefined;
let readDatabaseRuntimeIdentity: (() => Promise<{ roleName: string | null; databaseName: string | null; branchId: string | null; projectId: string | null }>) | undefined;
let initializationError: unknown;
let initialized = false;

function initializeRuntime(): ResolveTenantContext {
  if (initialized) {
    if (initializationError) throw initializationError;
    if (resolveTenantContext) return resolveTenantContext;
    throw new Error("runtime_initialization_failed");
  }

  initialized = true;
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
      connectionString: databaseConnectionString(),
      max: positiveIntegerEnv("DATABASE_POOL_MAX", 5),
      connectionTimeoutMillis: positiveIntegerEnv("DATABASE_CONNECT_TIMEOUT_MS", 5_000),
      idleTimeoutMillis: positiveIntegerEnv("DATABASE_POOL_IDLE_TIMEOUT_MS", 10_000),
      application_name: "iam-platform-vercel-api"
    });
    pool.on("error", () => {
      console.error(JSON.stringify({ level: "error", event: "database_idle_client_error" }));
    });
    readDatabaseRuntimeIdentity = async () => {
      const result = await pool.query<{
        role_name: string | null;
        database_name: string | null;
        branch_id: string | null;
        project_id: string | null;
      }>(`SELECT current_user AS role_name,
                current_database() AS database_name,
                current_setting('neon.branch_id', true) AS branch_id,
                current_setting('neon.project_id', true) AS project_id`);
      const row = result.rows[0];
      return {
        roleName: row?.role_name ?? null,
        databaseName: row?.database_name ?? null,
        branchId: row?.branch_id ?? null,
        projectId: row?.project_id ?? null
      };
    };
    checkReadiness = async () => {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    };
    recordPreAuthSecurityEvent = async (event) => {
      await appendPreAuthSecurityEvent(pool, event);
    };

    resolveTenantContext = async (accessToken, tenantId, requiredPermission?: RequiredTenantPermission) => {
      // Keep the verified claims request-local; the membership resolver intentionally
      // persists only the stable (issuer, subject) identity key and tenant membership.
      let verifiedIdentity: Awaited<ReturnType<typeof verifyAccessToken>> | undefined;
      const verifyAndCaptureIdentity = async (token: string) => {
        const identity = await verifyAccessToken(token);
        verifiedIdentity = identity;
        return identity;
      };

      return withAuthenticatedTenant(
        pool,
        verifyAndCaptureIdentity,
        accessToken,
        tenantId,
        requiredPermission ?? { resource: "iam", action: "context.read" },
        (authorizationContext, permission) => authorize(authorizationContext, permission),
        async (_client, membership) => {
          // withAuthenticatedTenant invokes the verifier before this callback.
          // Fail closed rather than emitting incomplete identity evidence if that contract changes.
          if (!verifiedIdentity) throw new Error("verified_identity_unavailable");
          return {
            ...membership,
            identityEvidence: {
              issuer: verifiedIdentity.issuer,
              subject: verifiedIdentity.subject,
              audience: verifiedIdentity.audience,
              algorithm: verifiedIdentity.algorithm,
              expiresAt: verifiedIdentity.expiresAt
            }
          };
        }
      );
    };
    return resolveTenantContext;
  } catch (error) {
    initializationError = error;
    throw error;
  }
}

const handler = createApiHandler(
  async (accessToken, tenantId, requiredPermission) =>
    initializeRuntime()(accessToken, tenantId, requiredPermission),
  async () => {
    try {
      initializeRuntime();
      return (await checkReadiness?.()) ?? false;
    } catch {
      return false;
    }
  },
  async (event) => {
    initializeRuntime();
    if (!recordPreAuthSecurityEvent) throw new Error("runtime_initialization_failed");
    await recordPreAuthSecurityEvent(event);
  },
  {
    getDatabaseRuntimeIdentity: async () => {
      initializeRuntime();
      if (!readDatabaseRuntimeIdentity) throw new Error("runtime_initialization_failed");
      return readDatabaseRuntimeIdentity();
    }
  }
);

export default function apiHandler(request: IncomingMessage, response: ServerResponse): void {
  handler(request, response);
}
