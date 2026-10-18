import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { extractBearerToken } from "@iam-platform/identity";
import type { PreAuthSecurityEvent } from "@iam-platform/database";

export interface RequiredTenantPermission {
  readonly resource: string;
  readonly action: string;
}

export interface TenantContextResponse {
  readonly tenantId: string;
  readonly principalId: string;
  readonly membershipId: string;
  readonly permissions: readonly { readonly resource: string; readonly action: string }[];
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

export function createPreAuthAuditLimiter(
  maxEntries = 4096,
  windowMs = 60_000,
  perWindowLimit = 10
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
  return (peer: string, now = Date.now()): boolean => {
    let window = windows.get(peer);
    if (window && now - window.startedAt < windowMs) {
      if (window.count >= perWindowLimit) return false;
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
      if (windows.size >= maxEntries) return false;
    }

    windows.set(peer, { startedAt: now, count: 1 });
    return true;
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
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
  const shouldRecordAudit = createPreAuthAuditLimiter();

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

  async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
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

    const controlCenterMatch = /^\/v1\/tenants\/([^/]+)\/control-center$/.exec(routePath);
    const contextMatch = /^\/v1\/tenants\/([^/]+)\/context$/.exec(routePath);
    const match = controlCenterMatch ?? contextMatch;
    if (request.method !== "GET" || !match?.[1]) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    const requiredPermission = controlCenterMatch ? CONTROL_CENTER_PERMISSION : CONTEXT_PERMISSION;
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
      const context = controlCenterMatch
        ? await resolveTenantContext(accessToken, tenantId, requiredPermission)
        : await resolveTenantContext(accessToken, tenantId);
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
    void routeRequest(request, response).catch(() => {
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
