import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";

type Check = {
  id: string;
  label: string;
  expectedStatus: number;
  actualStatus?: number;
  status: "pass" | "fail" | "not_configured" | "blocked";
  detail?: string;
};

function safeResult(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function isUuid(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function tokenExpiry(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
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
    return safeResult(409, { ok: false, code: "api_access_token_unavailable" });
  }

  const apiBase = process.env.IAM_API_BASE_URL?.trim().replace(/\/$/, "");
  const primaryTenantId = process.env.IAM_DIAGNOSTICS_TENANT_ID?.trim();
  if (!apiBase || !isUuid(primaryTenantId)) {
    return safeResult(503, { ok: false, code: "diagnostics_not_configured", detail: "Configure IAM_API_BASE_URL and a valid IAM_DIAGNOSTICS_TENANT_ID for this environment." });
  }

  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const commonHeaders: Record<string, string> = { Accept: "application/json" };
  if (bypassSecret) commonHeaders["x-vercel-protection-bypass"] = bypassSecret;

  const checks: Check[] = [];

  async function probe(
    id: string,
    label: string,
    tenantId: string,
    authorization: string | null,
    expectedStatus: number,
  ): Promise<void> {
    try {
      const headers: Record<string, string> = { ...commonHeaders };
      if (authorization) headers.Authorization = authorization;
      const response = await fetch(
        `${apiBase}/v1/tenants/${encodeURIComponent(tenantId)}/control-center`,
        { method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(8_000) },
      );
      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => ({})) as Record<string, unknown>
        : {};
      const isApplicationResponse = contentType.includes("application/json");
      checks.push({
        id,
        label,
        expectedStatus,
        actualStatus: response.status,
        status: !isApplicationResponse ? "blocked" : response.status === expectedStatus ? "pass" : "fail",
        detail: !isApplicationResponse
          ? "Resposta não JSON: a proteção da plataforma pode ter interceptado a chamada; resultado não conclusivo."
          : response.status === expectedStatus
            ? "O endpoint retornou o status esperado."
            : typeof payload.error === "string" ? payload.error : "Status inesperado.",
      });
    } catch {
      checks.push({ id, label, expectedStatus, status: "blocked", detail: "API indisponível ou inacessível; teste inconclusivo." });
    }
  }

  await probe("missing-token", "Token ausente deve retornar 401", primaryTenantId, null, 401);
  await probe("malformed-token", "Token malformado deve retornar 401", primaryTenantId, "Bearer invalid.diagnostic.token", 401);

  const noMembershipTenantId = process.env.IAM_DIAGNOSTICS_NO_MEMBERSHIP_TENANT_ID?.trim();
  if (isUuid(noMembershipTenantId)) {
    await probe("no-membership", "Tenant sem associação ativa deve retornar 403", noMembershipTenantId, `Bearer ${accessToken}`, 403);
  } else {
    checks.push({ id: "no-membership", label: "Tenant sem associação ativa deve retornar 403", expectedStatus: 403, status: "not_configured", detail: "Configure IAM_DIAGNOSTICS_NO_MEMBERSHIP_TENANT_ID com um UUID de tenant de teste sem associação para este usuário." });
  }

  const noPermissionTenantId = process.env.IAM_DIAGNOSTICS_NO_PERMISSION_TENANT_ID?.trim();
  if (isUuid(noPermissionTenantId)) {
    await probe("missing-permission", "Tenant sem a permissão exigida deve retornar 403", noPermissionTenantId, `Bearer ${accessToken}`, 403);
  } else {
    checks.push({ id: "missing-permission", label: "Tenant sem a permissão exigida deve retornar 403", expectedStatus: 403, status: "not_configured", detail: "Configure IAM_DIAGNOSTICS_NO_PERMISSION_TENANT_ID com uma associação ativa que não tenha iam.control_center.read." });
  }

  const otherTenantId = process.env.IAM_DIAGNOSTICS_OTHER_TENANT_ID?.trim();
  if (isUuid(otherTenantId)) {
    await probe("cross-tenant", "Acesso a outro tenant deve ser negado (403)", otherTenantId, `Bearer ${accessToken}`, 403);
  } else {
    checks.push({ id: "cross-tenant", label: "Acesso a outro tenant deve ser negado (403)", expectedStatus: 403, status: "not_configured", detail: "Configure IAM_DIAGNOSTICS_OTHER_TENANT_ID com um tenant isolado, pertencente a outra identidade e sem associação para a sessão atual." });
  }

  const expiredToken = process.env.IAM_DIAGNOSTICS_EXPIRED_ACCESS_TOKEN?.trim();
  if (expiredToken) {
    const exp = tokenExpiry(expiredToken);
    if (exp === null || exp >= Math.floor(Date.now() / 1000)) {
      checks.push({ id: "expired-token", label: "Token expirado deve retornar 401", expectedStatus: 401, status: "fail", detail: "O token configurado não possui exp válido já vencido; nenhum pedido foi enviado." });
    } else {
      await probe("expired-token", "Token expirado deve retornar 401", primaryTenantId, `Bearer ${expiredToken}`, 401);
    }
  } else {
    checks.push({ id: "expired-token", label: "Token expirado deve retornar 401", expectedStatus: 401, status: "not_configured", detail: "Configure IAM_DIAGNOSTICS_EXPIRED_ACCESS_TOKEN apenas com um token de teste expirado; ele será usado somente no servidor e nunca será retornado." });
  }

  const failed = checks.some((check) => check.status === "fail");
  const blocked = checks.some((check) => check.status === "blocked");
  const notConfigured = checks.some((check) => check.status === "not_configured");
  return safeResult(200, {
    ok: !failed && !blocked && !notConfigured,
    outcome: failed ? "security_checks_failed" : blocked ? "security_checks_inconclusive" : notConfigured ? "security_checks_partially_configured" : "security_checks_passed",
    checks,
  });
}
