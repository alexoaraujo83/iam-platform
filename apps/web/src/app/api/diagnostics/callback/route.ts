import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";
import { handleAuth0Callback } from "../../../../lib/auth0-callback";

type CallbackCheck = {
  id: string;
  label: string;
  expectedStatus: number;
  actualStatus: number;
  status: "pass" | "fail";
  detail: string;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Runs safe, synthetic checks against the same callback error handler used by Auth0.
 * This does not fake an OAuth transaction or claim to replace a real provider E2E test.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return json(403, { ok: false, code: "same_origin_required" });
  }

  const session = await auth0.getSession();
  if (!session) return json(401, { ok: false, code: "login_required" });

  const baseUrl = request.nextUrl.origin;
  const checks: CallbackCheck[] = [];

  async function check(
    id: string,
    label: string,
    expectedStatus: number,
    run: () => Promise<Response>,
    validate?: (response: Response) => Promise<boolean>,
  ) {
    try {
      const response = await run();
      const valid = response.status === expectedStatus && (!validate || await validate(response));
      checks.push({
        id,
        label,
        expectedStatus,
        actualStatus: response.status,
        status: valid ? "pass" : "fail",
        detail: valid ? "Comportamento esperado confirmado no handler implantado." : "Resposta do handler diferente do esperado.",
      });
    } catch {
      checks.push({
        id,
        label,
        expectedStatus,
        actualStatus: 0,
        status: "fail",
        detail: "O teste do handler lançou uma exceção; detalhes internos foram omitidos.",
      });
    }
  }

  await check(
    "missing-state",
    "Callback sem state deve ser rejeitado (HTTP 400)",
    400,
    () => handleAuth0Callback({ code: "missing_state", name: "MissingStateError" }, { appBaseUrl: baseUrl }),
    async (response) => (await response.text()).includes("invalid or could not be completed"),
  );

  await check(
    "invalid-state",
    "Callback com state inválido deve ser rejeitado (HTTP 400)",
    400,
    () => handleAuth0Callback({ code: "invalid_state", name: "InvalidStateError" }, { appBaseUrl: baseUrl }),
  );

  await check(
    "provider-failure",
    "Falha temporária do provedor deve retornar HTTP 503",
    503,
    () => handleAuth0Callback(
      { code: "authorization_code_grant_request_error", name: "AuthorizationCodeGrantRequestError" },
      { appBaseUrl: baseUrl },
    ),
    async (response) => {
      const body = await response.text();
      return body.includes("temporarily unavailable") && !body.includes("authorization_code_grant_request_error");
    },
  );

  await check(
    "no-session",
    "Callback sem sessão autenticada não deve redirecionar (HTTP 400)",
    400,
    () => handleAuth0Callback(null, { appBaseUrl: baseUrl }, null),
    async (response) => response.headers.get("location") === null,
  );

  await check(
    "external-return-to",
    "returnTo externo deve ser limitado à origem da aplicação",
    307,
    () => handleAuth0Callback(
      null,
      { appBaseUrl: baseUrl, returnTo: "https://attacker.example/" },
      { user: { sub: "diagnostic-test-subject" } },
    ),
    async (response) => response.headers.get("location") === new URL("/", baseUrl).toString(),
  );

  const failed = checks.some((item) => item.status === "fail");
  return json(200, {
    ok: !failed,
    outcome: failed ? "callback_checks_failed" : "callback_checks_passed",
    scope: "synthetic_handler_checks",
    note: "Testes sintéticos do handler de callback; não equivalem a um fluxo OAuth real com state, cookies e troca de authorization code no provedor.",
    checks,
  });
}
