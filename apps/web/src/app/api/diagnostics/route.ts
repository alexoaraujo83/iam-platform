import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "../../../lib/auth0";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeResult(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return safeResult(403, { ok: false, code: "same_origin_required" });
  }

  const session = await auth0.getSession();
  if (!session) return safeResult(401, { ok: false, code: "login_required" });

  const accessToken = session.tokenSet?.accessToken;
  if (!accessToken) {
    return safeResult(409, {
      ok: false,
      code: "api_access_token_unavailable",
      detail: "Configure AUTH0_AUDIENCE for the IAM API and sign in again.",
    });
  }

  const apiBase = process.env.IAM_API_BASE_URL?.trim().replace(/\/$/, "");
  const tenantId = process.env.IAM_DIAGNOSTICS_TENANT_ID?.trim();
  if (!apiBase || !tenantId) {
    return safeResult(503, {
      ok: false,
      code: "diagnostics_not_configured",
      detail: "Set IAM_API_BASE_URL and IAM_DIAGNOSTICS_TENANT_ID in this deployment.",
    });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    return safeResult(503, { ok: false, code: "invalid_diagnostics_tenant_configuration" });
  }

  try {
    const response = await fetch(
      `${apiBase}/v1/tenants/${encodeURIComponent(tenantId)}/control-center`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const code = typeof payload.error === "string" ? payload.error : "api_request_failed";
      return safeResult(200, {
        ok: false,
        apiStatus: response.status,
        code,
        outcome:
          response.status === 401 ? "token_rejected" :
          response.status === 403 ? "membership_or_permission_denied" :
          response.status === 503 ? "identity_provider_or_service_unavailable" :
          "api_request_failed",
      });
    }

    const permissions = Array.isArray(payload.permissions)
      ? payload.permissions.filter((item): item is { resource: string; action: string } =>
          !!item && typeof item === "object" &&
          typeof (item as { resource?: unknown }).resource === "string" &&
          typeof (item as { action?: unknown }).action === "string",
        )
      : [];

    return safeResult(200, {
      ok: true,
      apiStatus: response.status,
      outcome: "authorized",
      tenantId: typeof payload.tenantId === "string" ? payload.tenantId : null,
      principalId: typeof payload.principalId === "string" ? payload.principalId : null,
      membershipId: typeof payload.membershipId === "string" ? payload.membershipId : null,
      permissionGranted: permissions.some(
        (permission) => permission.resource === "iam" && permission.action === "control_center.read",
      ),
      permissions,
    });
  } catch {
    return safeResult(200, { ok: false, code: "api_unreachable", outcome: "api_unreachable" });
  }
}
