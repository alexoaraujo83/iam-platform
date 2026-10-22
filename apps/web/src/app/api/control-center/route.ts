import { NextResponse } from "next/server";
import { auth0 } from "../../../lib/auth0";

function safeResult(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Checks the signed-in user's effective IAM Control Center access.
 * Provider secrets and access tokens remain on the server and are never
 * included in the response.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session) {
    return safeResult(401, { ok: false, outcome: "login_required" });
  }

  const accessToken = session.tokenSet?.accessToken;
  if (!accessToken) {
    return safeResult(409, {
      ok: false,
      outcome: "api_access_token_unavailable",
      detail: "Configure AUTH0_AUDIENCE for the IAM API and sign in again.",
    });
  }

  const apiBase = process.env.IAM_API_BASE_URL?.trim().replace(/\/$/, "");
  const tenantId = (
    process.env.IAM_CONTROL_CENTER_TENANT_ID ??
    process.env.IAM_DIAGNOSTICS_TENANT_ID
  )?.trim();

  if (!apiBase || !tenantId) {
    return safeResult(503, {
      ok: false,
      outcome: "control_center_not_configured",
      detail: "Configure IAM_API_BASE_URL and IAM_CONTROL_CENTER_TENANT_ID in the deployment environment.",
    });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    return safeResult(503, { ok: false, outcome: "invalid_tenant_configuration" });
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
    if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;

    const response = await fetch(
      `${apiBase}/v1/tenants/${encodeURIComponent(tenantId)}/control-center`,
      {
        method: "GET",
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? (await response.json().catch(() => ({}))) as Record<string, unknown>
      : {};

    if (!response.ok) {
      const outcome =
        response.status === 401 ? "token_rejected" :
        response.status === 403 ? "membership_or_permission_denied" :
        response.status === 503 ? "iam_service_unavailable" :
        "api_request_failed";
      return safeResult(200, {
        ok: false,
        apiStatus: response.status,
        outcome,
      });
    }

    const permissions = Array.isArray(payload.permissions)
      ? payload.permissions.filter((item): item is { resource: string; action: string } =>
          !!item && typeof item === "object" &&
          typeof (item as { resource?: unknown }).resource === "string" &&
          typeof (item as { action?: unknown }).action === "string",
        )
      : [];

    const permissionGranted = permissions.some(
      (permission) =>
        permission.resource === "iam" &&
        permission.action === "control_center.read",
    );

    return safeResult(200, {
      ok: true,
      outcome: permissionGranted ? "authorized" : "permission_not_confirmed",
      tenantId: typeof payload.tenantId === "string" ? payload.tenantId : null,
      permissionGranted,
      permissions,
      apiVersion: response.headers.get("x-iam-api-version"),
      correlationId: response.headers.get("x-correlation-id"),
    });
  } catch {
    return safeResult(200, { ok: false, outcome: "iam_api_unreachable" });
  }
}
