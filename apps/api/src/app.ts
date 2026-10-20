import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extractBearerToken } from "@iam-platform/identity";
import type { PreAuthSecurityEvent } from "@iam-platform/database";
import type { RuntimeSnapshot, EvidenceStatus, ControlCenterEnvironment } from "@iam-platform/contracts";

export interface RequiredTenantPermission {
  readonly resource: string;
  readonly action: string;
}

export interface TenantContextResponse {
  readonly tenantId: string;
  readonly principalId: string;
  readonly membershipId: string;
  readonly permissions: readonly { readonly resource: string; readonly action: string }[];
  readonly identityEvidence?: {
    readonly issuer: string;
    readonly subject: string;
    readonly audience: string | readonly string[];
    readonly algorithm: string;
    readonly expiresAt: number;
  };
}

export type ResolveTenantContext = (
  accessToken: string,
  tenantId: string,
  requiredPermission?: RequiredTenantPermission
) => Promise<TenantContextResponse | null>;
export type CheckReadiness = () => Promise<boolean>;
export type RecordPreAuthSecurityEvent = (event: PreAuthSecurityEvent) => Promise<void>;
export type ApiRequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

const CONTEXT_PERMISSION: RequiredTenantPermission = { resource: "iam", action: "context.read" };
const CONTROL_CENTER_PERMISSION: RequiredTenantPermission = { resource: "iam", action: "control_center.read" };

export type PreAuthAuditSuppressionReason = "peer_limit" | "entry_cap";

export function createPreAuthAuditLimiter(
  maxEntries = 4096,
  windowMs = 60_000,
  perWindowLimit = 10,
  onSuppressed?: (reason: PreAuthAuditSuppressionReason) => void
): (peer: string, now?: number) => boolean {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error("invalid_audit_limiter_max_entries");
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error("invalid_audit_limiter_window_ms");
  }
  if (!Number.isSafeInteger(perWindowLimit) || perWindowLimit < 1) {
    throw new Error("invalid_audit_limiter_per_window_limit");
  }

  const windows = new Map<string, { startedAt: number; count: number }>();
  let lastSuppressionNoticeAt = Number.NEGATIVE_INFINITY;
  const notifySuppression = (reason: PreAuthAuditSuppressionReason, now: number): void => {
    if (now - lastSuppressionNoticeAt < windowMs) return;
    lastSuppressionNoticeAt = now;
    onSuppressed?.(reason);
  };

  return (peer: string, now = Date.now()): boolean => {
    let window = windows.get(peer);
    if (window && now - window.startedAt < windowMs) {
      if (window.count >= perWindowLimit) {
        notifySuppression("peer_limit", now);
        return false;
      }
      window.count += 1;
      return true;
    }

    if (window) windows.delete(peer);
    if (windows.size >= maxEntries) {
      for (const [address, current] of windows) {
        if (now - current.startedAt >= windowMs) windows.delete(address);
      }
      // Fail closed for audit writes under high-cardinality source pressure.
      // Do not evict live windows, which would reset a peer's rate limit.
      if (windows.size >= maxEntries) {
        notifySuppression("entry_cap", now);
        return false;
      }
    }

    windows.set(peer, { startedAt: now, count: 1 });
    return true;
  };
}

function resolveControlCenterEnvironment(): ControlCenterEnvironment {
  const value = process.env.VERCEL_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV;
  if (value === "production" || value === "preview" || value === "development" || value === "staging") return value;
  return "unknown";
}

function safeMetadata(value: string | undefined, pattern: RegExp): string | null {
  const candidate = value?.trim();
  return candidate && pattern.test(candidate) ? candidate : null;
}

function safeDeploymentUrl(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 255 || !/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(candidate)) return null;
  return `https://${candidate}`;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-iam-api-version": process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.API_VERSION ?? "unknown"
  });
  response.end(JSON.stringify(body));
}

export function createApiHandler(
  resolveTenantContext: ResolveTenantContext,
  checkReadiness: CheckReadiness,
  recordPreAuthSecurityEvent: RecordPreAuthSecurityEvent
): ApiRequestHandler {
  // Bound unauthenticated write amplification per socket peer. Do not trust
  // X-Forwarded-For here; it is only safe behind a separately trusted proxy.
  const shouldRecordAudit = createPreAuthAuditLimiter(4096, 60_000, 10, (reason) => {
    // Aggregate limiter pressure into at most one warning per window; never log peer identifiers.
    console.warn(JSON.stringify({
      level: "warn",
      event: "pre_auth_audit_limiter_saturated",
      reason
    }));
  });

  async function recordAuthFailure(request: IncomingMessage, reason: string): Promise<boolean> {
    const key = request.socket.remoteAddress ?? "unknown";
    // A saturated limiter suppresses additional unauthenticated writes while
    // preserving denial; active windows are never evicted to reset rate limits.
    if (!shouldRecordAudit(key)) return true;

    const rawRequestId = request.headers["x-request-id"];
    const requestId = typeof rawRequestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(rawRequestId)
      ? rawRequestId
      : null;
    try {
      await recordPreAuthSecurityEvent({
        action: "security.authn_failed",
        outcome: "failure",
        correlationId: randomUUID(),
        requestId,
        metadata: { reason }
      });
      return true;
    } catch {
      // Authentication remains denied if the durable audit store is unavailable.
      return false;
    }
  }

  async function routeRequest(request: IncomingMessage, response: ServerResponse, requestCorrelationId: string): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const routePath = url.pathname === "/api/index" ? (url.searchParams.get("path") ?? "/") : url.pathname;
    if (request.method === "GET" && routePath === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "GET" && routePath === "/health/ready") {
      try {
        const ready = await checkReadiness();
        sendJson(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready" });
      } catch {
        sendJson(response, 503, { status: "not_ready" });
      }
      return;
    }

    const runtimeDiagnosticsMatch = /^\/v1\/tenants\/([^/]+)\/control-center\/runtime$/.exec(routePath);
    const controlCenterMatch = /^\/v1\/tenants\/([^/]+)\/control-center$/.exec(routePath);
    const contextMatch = /^\/v1\/tenants\/([^/]+)\/context$/.exec(routePath);
    const match = runtimeDiagnosticsMatch ?? controlCenterMatch ?? contextMatch;
    if (request.method !== "GET" || !match?.[1]) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    const requiredPermission = (controlCenterMatch || runtimeDiagnosticsMatch) ? CONTROL_CENTER_PERMISSION : CONTEXT_PERMISSION;
    const accessToken = extractBearerToken(request.headers.authorization);
    if (!accessToken) {
      const audited = await recordAuthFailure(request, "missing_or_invalid_bearer");
      sendJson(response, audited ? 401 : 503, { error: audited ? "invalid_or_missing_bearer_token" : "security_audit_unavailable" });
      return;
    }

    let tenantId: string;
    try {
      tenantId = decodeURIComponent(match[1]);
    } catch {
      sendJson(response, 400, { error: "invalid_tenant_id" });
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      sendJson(response, 400, { error: "invalid_tenant_id" });
      return;
    }

    try {
      const context = (controlCenterMatch || runtimeDiagnosticsMatch)
        ? await resolveTenantContext(accessToken, tenantId, requiredPermission)
        : await resolveTenantContext(accessToken, tenantId);
      if (!context) {
        sendJson(response, 403, { error: "active_membership_required" });
        return;
      }
      if (runtimeDiagnosticsMatch) {
        // Keep the request-scoped correlation identifier explicit in this block.
        const correlationId = requestCorrelationId;
        const databaseReady = await checkReadiness().catch(() => false);
        const environment = resolveControlCenterEnvironment();
        const now = new Date().toISOString();
        const commitSha = safeMetadata(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA, /^[0-9a-f]{7,64}$/i);
        const deploymentId = safeMetadata(process.env.VERCEL_DEPLOYMENT_ID, /^[A-Za-z0-9_-]{1,128}$/);
        const deploymentUrl = safeDeploymentUrl(process.env.VERCEL_URL);
        const checks = [
          {
            id: "api.runtime", name: "API runtime", status: "pass" as const, severity: "info" as const,
            summary: "Authenticated diagnostics endpoint is responding", environment,
            source: { system: "iam-platform-api", reference: commitSha, observedAt: now },
            checkedAt: now, validUntil: new Date(Date.now() + 60_000).toISOString(), correlationId
          },
          {
            id: "database.readiness", name: "Database readiness", status: databaseReady ? "pass" as const : "fail" as const,
            severity: databaseReady ? "info" as const : "critical" as const,
            summary: databaseReady ? "Database readiness query succeeded" : "Database readiness query failed", environment,
            source: { system: "postgresql-readiness", reference: null, observedAt: now },
            checkedAt: now, validUntil: new Date(Date.now() + 30_000).toISOString(), correlationId
          },
          {
            id: "deployment.metadata", name: "Deployment metadata",
            status: commitSha && environment !== "unknown" ? "pass" as const : "unknown" as const,
            severity: "warning" as const,
            summary: commitSha && environment !== "unknown"
              ? "Deployment commit and environment metadata are available"
              : "Deployment commit or environment metadata is unavailable",
            environment,
            source: { system: "deployment-platform", reference: commitSha, observedAt: now },
            checkedAt: now, validUntil: new Date(Date.now() + 300_000).toISOString(), correlationId
          }
        ];
        const overallStatus: EvidenceStatus = checks.some((check) => check.status === "fail")
          ? "fail" : checks.every((check) => check.status === "pass") ? "pass" : "unknown";
        const snapshot: RuntimeSnapshot = {
          id: randomUUID(), environment, capturedAt: now, commitSha, deploymentId, deploymentUrl,
          checks, overallStatus, correlationId
        };
        sendJson(response, databaseReady ? 200 : 503, snapshot);
        return;
      }
      sendJson(response, 200, {
        tenantId: context.tenantId,
        principalId: context.principalId,
        membershipId: context.membershipId,
        permissions: context.permissions,
        ...(context.identityEvidence ? { identityEvidence: context.identityEvidence } : {})
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.message.split(":", 1)[0] : undefined;
      if (errorCode === "authorization_denied") {
        sendJson(response, 403, { error: "permission_denied" });
        return;
      }
      if (errorCode === "invalid_access_token") {
        const audited = await recordAuthFailure(request, "invalid_access_token");
        sendJson(response, audited ? 401 : 503, { error: audited ? "invalid_access_token" : "security_audit_unavailable" });
        return;
      }
      if (errorCode === "identity_provider_unavailable") {
        sendJson(response, 503, { error: "identity_provider_unavailable" });
        return;
      }
      if (errorCode?.startsWith("missing_required_configuration") || errorCode?.startsWith("invalid_positive_integer_configuration")) {
        sendJson(response, 503, { error: "service_not_configured" });
        return;
      }
      sendJson(response, 500, { error: "internal_server_error" });
    }
  }

  return (request, response) => {
    const suppliedCorrelationId = request.headers["x-correlation-id"];
    const correlationId = typeof suppliedCorrelationId === "string" &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedCorrelationId)
      ? suppliedCorrelationId
      : randomUUID();
    const startedAt = performance.now();
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const routeLabel = pathname.replace(
      /^\/v1\/tenants\/[^/]+\/(control-center\/runtime|control-center|context)$/,
      "/v1/tenants/:tenantId/$1"
    );
    response.setHeader("x-correlation-id", correlationId);
    response.once("finish", () => {
      console.info(JSON.stringify({
        level: "info",
        event: "http_request_completed",
        correlation_id: correlationId,
        method: request.method ?? "UNKNOWN",
        route: routeLabel,
        status_code: response.statusCode,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt))
      }));
    });
    void routeRequest(request, response, correlationId).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "internal_server_error" });
      else response.destroy();
    });
  };
}

export function createApiServer(
  resolveTenantContext: ResolveTenantContext,
  checkReadiness: CheckReadiness,
  recordPreAuthSecurityEvent: RecordPreAuthSecurityEvent
): Server {
  return createServer(createApiHandler(resolveTenantContext, checkReadiness, recordPreAuthSecurityEvent));
}
