import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extractBearerToken } from "@iam-platform/identity";

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
export type ApiRequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

const CONTEXT_PERMISSION: RequiredTenantPermission = { resource: "iam", action: "context.read" };
const CONTROL_CENTER_PERMISSION: RequiredTenantPermission = { resource: "iam", action: "control_center.read" };

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
  checkReadiness: CheckReadiness = async () => false
): ApiRequestHandler {
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
      sendJson(response, 401, { error: "invalid_or_missing_bearer_token" });
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
        sendJson(response, 401, { error: "invalid_access_token" });
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
  checkReadiness: CheckReadiness = async () => false
): Server {
  return createServer(createApiHandler(resolveTenantContext, checkReadiness));
}
