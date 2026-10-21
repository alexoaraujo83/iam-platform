import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";

type Check = {
  id: string;
  label: string;
  expectedStatus: number;
  actualStatus?: number;
  status: "pass" | "fail" | "not_configured" | "blocked";
  detail?: string;
  executedAtUtc?: string;
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
  let apiVersion: string | null = null;
  const authorizationEvidence: {
    current: {
      issuer: string;
      subject: string;
      audience: string | string[];
      algorithm: string;
      expiresAt: number;
      tenantId: string;
      principalId: string;
      membershipId: string;
      permissionGranted: boolean;
      permissions: string[];
    } | null;
  } = { current: null };

  async function probe(
    id: string,
    label: string,
    tenantId: string,
    authorization: string | null,
    expectedStatus: number,
    expectedError?: string,
    requireControlCenterPermission = false,
  ): Promise<void> {
    try {
      const headers: Record<string, string> = { ...commonHeaders };
      if (authorization) headers.Authorization = authorization;
      const response = await fetch(
        `${apiBase}/v1/tenants/${encodeURIComponent(tenantId)}/control-center`,
        { method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(8_000) },
      );
      apiVersion = response.headers.get("x-iam-api-version") ?? apiVersion;
      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => ({})) as Record<string, unknown>
        : {};
      const isApplicationResponse = contentType.includes("application/json");
      const permissions = Array.isArray(payload.permissions) ? payload.permissions as { resource?: unknown; action?: unknown }[] : [];
      const permissionGranted = permissions.some((permission) =>
        permission?.resource === "iam" && permission?.action === "control_center.read",
      );
      if (id === "valid-session" && response.status === 200 && isApplicationResponse) {
        const identity = payload.identityEvidence as Record<string, unknown> | undefined;
        if (
          identity &&
          typeof identity.issuer === "string" &&
          typeof identity.subject === "string" &&
          (typeof identity.audience === "string" ||
            (Array.isArray(identity.audience) && identity.audience.every((item) => typeof item === "string"))) &&
          typeof identity.algorithm === "string" &&
          typeof identity.expiresAt === "number" &&
          typeof payload.tenantId === "string" &&
          typeof payload.principalId === "string" &&
          typeof payload.membershipId === "string"
        ) {
          authorizationEvidence.current = {
            issuer: identity.issuer,
            subject: identity.subject,
            audience: identity.audience as string | string[],
            algorithm: identity.algorithm,
            expiresAt: identity.expiresAt,
            tenantId: payload.tenantId,
            principalId: payload.principalId,
            membershipId: payload.membershipId,
            permissionGranted,
            permissions: permissions
              .filter((permission) => typeof permission?.resource === "string" && typeof permission?.action === "string")
              .map((permission) => `${permission.resource}.${permission.action}`),
          };
        }
      }
      const codeMatches = !expectedError || payload.error === expectedError;
      const expectedBehavior = response.status === expectedStatus && codeMatches &&
        (!requireControlCenterPermission || permissionGranted);
      checks.push({
        id,
        label,
        executedAtUtc: new Date().toISOString(),
        expectedStatus,
        actualStatus: response.status,
        status: !isApplicationResponse ? "blocked" : expectedBehavior ? "pass" : "fail",
        detail: !isApplicationResponse
          ? "Resposta não JSON: a proteção da plataforma pode ter interceptado a chamada; resultado não conclusivo."
          : response.status !== expectedStatus
            ? typeof payload.error === "string" ? payload.error : "Status inesperado."
            : !codeMatches
              ? `Código inesperado: ${typeof payload.error === "string" ? payload.error : "ausente"}.`
              : requireControlCenterPermission && !permissionGranted
                ? "HTTP 200 sem a permissão iam.control_center.read na resposta."
                : id === "valid-session"
                ? "A API aceitou o token, retornou HTTP 200 e confirmou a permissão iam.control_center.read."
                : "O endpoint retornou o status e o código de negação esperados.",
      });
    } catch {
      checks.push({ id, label, expectedStatus, status: "blocked", executedAtUtc: new Date().toISOString(), detail: "API indisponível ou inacessível; teste inconclusivo." });
    }
  }

  await probe("valid-session", "Sessão atual deve ser autorizada e ter iam.control_center.read", primaryTenantId, `Bearer ${accessToken}`, 200, undefined, true);
  await probe("missing-token", "Token ausente deve retornar 401", primaryTenantId, null, 401, "invalid_or_missing_bearer_token");
  await probe("malformed-token", "Token malformado deve retornar 401", primaryTenantId, "Bearer invalid.diagnostic.token", 401, "invalid_access_token");

  const noMembershipTenantId = process.env.IAM_DIAGNOSTICS_NO_MEMBERSHIP_TENANT_ID?.trim();
  if (isUuid(noMembershipTenantId)) {
    await probe("no-membership", "Tenant sem associação ativa deve retornar 403", noMembershipTenantId, `Bearer ${accessToken}`, 403, "active_membership_required");
  } else {
    checks.push({ id: "no-membership", label: "Tenant sem associação ativa deve retornar 403", expectedStatus: 403, status: "not_configured", detail: "Configure IAM_DIAGNOSTICS_NO_MEMBERSHIP_TENANT_ID com um UUID de tenant de teste sem associação para este usuário." });
  }

  const noPermissionTenantId = process.env.IAM_DIAGNOSTICS_NO_PERMISSION_TENANT_ID?.trim();
  if (isUuid(noPermissionTenantId)) {
    await probe("missing-permission", "Tenant sem a permissão exigida deve retornar 403", noPermissionTenantId, `Bearer ${accessToken}`, 403, "permission_denied");
  } else {
    checks.push({ id: "missing-permission", label: "Tenant sem a permissão exigida deve retornar 403", expectedStatus: 403, status: "not_configured", detail: "Configure IAM_DIAGNOSTICS_NO_PERMISSION_TENANT_ID com uma associação ativa que não tenha iam.control_center.read." });
  }

  const otherTenantId = process.env.IAM_DIAGNOSTICS_OTHER_TENANT_ID?.trim();
  if (isUuid(otherTenantId)) {
    await probe("cross-tenant", "Acesso a outro tenant deve ser negado (403)", otherTenantId, `Bearer ${accessToken}`, 403, "active_membership_required");
  } else {
    checks.push({ id: "cross-tenant", label: "Acesso a outro tenant deve ser negado (403)", expectedStatus: 403, status: "not_configured", detail: "Configure IAM_DIAGNOSTICS_OTHER_TENANT_ID com um tenant isolado, pertencente a outra identidade e sem associação para a sessão atual." });
  }

  checks.push({
    id: "expired-token",
    label: "Token expirado deve retornar 401",
    expectedStatus: 401,
    status: "not_configured",
    detail: "O teste criptográfico de token expirado é gerado com chaves locais controladas no CI. O E2E de Preview requer uma fixture efêmera específica do ambiente; nenhum JWT manual permanente é lido de variáveis de ambiente."
  });

  const reportTimestamp = new Date().toISOString();
  const evidenceChecks = checks.map((check) => ({
    ...check,
    executedAtUtc: check.executedAtUtc ?? reportTimestamp,
    result: check.status === "pass" ? "approved" : check.status === "fail" ? "rejected" : "inconclusive",
    reason: check.detail ?? (check.status === "pass" ? "Comportamento observado corresponde ao esperado." : "Não foi possível confirmar o comportamento esperado."),
  }));
  // Read the mutable holder after all awaited probes have completed.
  // This preserves the evidence type without a cast or weakening type safety.
  const confirmedEvidence = authorizationEvidence.current;
  const failed = checks.some((check) => check.status === "fail");
  const blocked = checks.some((check) => check.status === "blocked");
  const notConfigured = checks.some((check) => check.status === "not_configured");
  return safeResult(200, {
    ok: !failed && !blocked && !notConfigured,
    outcome: failed ? "security_checks_failed" : blocked ? "security_checks_inconclusive" : notConfigured ? "security_checks_partially_configured" : "security_checks_passed",
    execution: {
      executedAtUtc: reportTimestamp,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      webCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
      apiVersion,
    },
    authorizationEvidence: confirmedEvidence,
    validationEvidence: confirmedEvidence ? {
      signature: { status: "validated_by_api", reason: "A API só retorna identityEvidence depois que o verificador OIDC conclui jwtVerify; este relatório registra a evidência retornada, não uma segunda verificação independente." },
      issuer: { status: "accepted_by_api", value: confirmedEvidence.issuer },
      audience: { status: "accepted_by_api", value: confirmedEvidence.audience },
      algorithm: { status: "accepted_by_api", value: confirmedEvidence.algorithm, reason: "Algoritmo informado pela identidade verificada; a allowlist é aplicada pelo verificador OIDC no servidor." },
      expiration: { status: confirmedEvidence.expiresAt * 1000 > Date.now() ? "valid_at_execution" : "expired", expiresAtUtc: new Date(confirmedEvidence.expiresAt * 1000).toISOString() },
      membership: { status: "membership_id_returned_not_independently_verified", membershipId: confirmedEvidence.membershipId, reason: "A resposta contém um membershipId, mas este relatório não recebeu um campo explícito de estado da associação; não infere estado ativo apenas pela presença do identificador." },
      permissions: { status: confirmedEvidence.permissionGranted ? "granted" : "missing", required: "iam.control_center.read", effective: confirmedEvidence.permissions },
    } : null,
    ciNegativeCoverage: [
      { id: "expired-token", scenario: "JWT expirado", status: "covered_by_unit_test", expectedOutcome: "Rejeição pelo verificador OIDC", observedOutcome: "O teste exige que o verificador lance erro", httpStatus: null, result: "asserted_in_unit_test", evidence: "packages/identity/src/index.test.ts — rejects expired tokens", executionScope: "Teste unitário com chaves efêmeras; HTTP N/A e não é uma chamada negativa ao tenant real nesta execução." },
      { id: "wrong-issuer", scenario: "JWT com issuer incorreto", status: "covered_by_unit_test", expectedOutcome: "Rejeição pelo verificador OIDC", observedOutcome: "O teste exige que o verificador lance erro", httpStatus: null, result: "asserted_in_unit_test", evidence: "packages/identity/src/index.test.ts — rejects a token with the wrong issuer", executionScope: "Teste unitário com chaves efêmeras; HTTP N/A e não é uma chamada negativa ao tenant real nesta execução." },
      { id: "wrong-audience", scenario: "JWT com audience incorreta", status: "covered_by_unit_test", expectedOutcome: "Rejeição pelo verificador OIDC", observedOutcome: "O teste exige que o verificador lance erro", httpStatus: null, result: "asserted_in_unit_test", evidence: "packages/identity/src/index.test.ts — rejects a token with the wrong audience", executionScope: "Teste unitário com chaves efêmeras; HTTP N/A e não é uma chamada negativa ao tenant real nesta execução." },
      { id: "wrong-algorithm", scenario: "JWT com algoritmo fora da allowlist", status: "covered_by_unit_test", expectedOutcome: "Rejeição pelo verificador OIDC", observedOutcome: "O teste exige que o verificador lance erro", httpStatus: null, result: "asserted_in_unit_test", evidence: "packages/identity/src/index.test.ts — rejects an algorithm not in the configured allowlist", executionScope: "Teste unitário com chaves efêmeras; HTTP N/A e não é uma chamada negativa ao tenant real nesta execução." },
    ],
    checks: evidenceChecks,
  });
}
