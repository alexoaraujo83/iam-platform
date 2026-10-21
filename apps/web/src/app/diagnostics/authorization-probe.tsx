"use client";

import { useState } from "react";
import styles from "../page.module.css";

type DiagnosticResult = {
  ok: boolean;
  outcome: string;
  execution?: { executedAtUtc: string; environment: string; webCommit: string; apiVersion: string | null };
  authorizationEvidence?: {
    issuer: string;
    subject: string;
    audience: string | string[];
    algorithm: string;
    expiresAt: number;
    tenantId: string;
    principalId: string;
    membershipId: string;
    permissionGranted: boolean;
    membershipActive: boolean;
    permissions: string[];
  } | null;
  validationEvidence?: {
    signature: { status: string; reason: string };
    issuer: { status: string; value: string };
    audience: { status: string; value: string | string[] };
    algorithm: { status: string; value: string; reason: string };
    expiration: { status: string; expiresAtUtc: string };
    membership: { status: string; membershipId: string };
    permissions: { status: string; required: string; effective: string[] };
  } | null;
  ciNegativeCoverage?: { id: string; scenario: string; status: string; expectedOutcome: string; observedOutcome: string; httpStatus: number | null; result: string; evidence: string; executionScope: string }[];
  checks: {
    id: string;
    label: string;
    expectedStatus: number;
    actualStatus?: number;
    status: "pass" | "fail" | "not_configured" | "blocked";
    detail?: string;
    executedAtUtc?: string;
    result?: string;
    reason?: string;
  }[];
};

const previousAuthorizationEvidence = {
  outcome: "authorized",
  apiHttpStatus: 200,
  tenantId: "4a2f0b2e-37c1-4d0a-a211-8b6d7f2e9001",
  principalId: "4a2f0b2e-37c1-4d0a-a211-8b6d7f2e9002",
  membershipId: "4a2f0b2e-37c1-4d0a-a211-8b6d7f2e9004",
  permission: "iam.control_center.read",
  permissionStatus: "Concedida",
  executedAtUtc: "Não registrado na evidência histórica",
  environment: "Não registrado",
  webCommit: "Não registrado",
  apiVersion: "Não registrada",
};

const statusLabels: Record<DiagnosticResult["checks"][number]["status"], string> = {
  pass: "APROVADO",
  fail: "FALHOU",
  not_configured: "NÃO CONFIGURADO",
  blocked: "INCONCLUSIVO",
};

export default function AuthorizationProbe() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);

  function downloadReport() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `iam-auth-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function runProbe() {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/diagnostics/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const data = (await response.json()) as DiagnosticResult;
      setResult(data);
    } catch {
      setResult({
        ok: false,
        outcome: "diagnostics_request_failed",
        checks: [{
          id: "request",
          label: "Executar bateria de diagnóstico",
          expectedStatus: 200,
          status: "blocked",
          detail: "Não foi possível consultar o endpoint de diagnóstico.",
        }],
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.probe} aria-labelledby="probe-title">
      <h2 id="probe-title">Diagnóstico de autorização e segurança</h2>

      <section aria-labelledby="previous-auth-title">
        <h3 id="previous-auth-title">Evidência histórica — autorização concedida</h3>
        <p className={styles.note}>
          Registro histórico preservado para comparação. Não representa uma nova execução e não deve ser usado como prova do estado atual.
        </p>
        <ul className={styles.permissionList}>
          <li><strong>Resultado:</strong> {previousAuthorizationEvidence.outcome}</li>
          <li><strong>Data/hora UTC:</strong> {previousAuthorizationEvidence.executedAtUtc}</li>
          <li><strong>Ambiente:</strong> {previousAuthorizationEvidence.environment}</li>
          <li><strong>Commit web:</strong> <code>{previousAuthorizationEvidence.webCommit}</code></li>
          <li><strong>Versão/commit da API:</strong> {previousAuthorizationEvidence.apiVersion}</li>
          <li><strong>API HTTP status:</strong> {previousAuthorizationEvidence.apiHttpStatus}</li>
          <li><strong>Tenant ID:</strong> <code>{previousAuthorizationEvidence.tenantId}</code></li>
          <li><strong>Principal ID:</strong> <code>{previousAuthorizationEvidence.principalId}</code></li>
          <li><strong>Membership ID:</strong> <code>{previousAuthorizationEvidence.membershipId}</code></li>
          <li><strong>{previousAuthorizationEvidence.permission}:</strong> {previousAuthorizationEvidence.permissionStatus}</li>
        </ul>
      </section>

      <section aria-labelledby="current-tests-title">
        <h3 id="current-tests-title">Bateria automatizada — execução atual</h3>
        <p className={styles.note}>
          Executa testes no servidor contra a API usando a sessão Auth0 atual. A API só retorna identidade verificada depois de validar a assinatura, o emissor, a audiência, o algoritmo permitido e a expiração do JWT. A rejeição de JWT expirado/adulterado e de issuer/audience incorretos também é coberta por testes criptográficos no CI com chaves efêmeras; o E2E não fabrica nem exibe tokens. Nenhum token ou segredo é enviado ao navegador ou exibido.
        </p>
        <button className={styles.button} type="button" onClick={runProbe} disabled={loading}>
          {loading ? "Executando testes…" : "Executar bateria de testes"}
        </button>
        {result && (
          <div className={styles.result} role="status" aria-live="polite">
            <strong>
              {result.outcome === "security_checks_passed"
                ? "Todos os testes configurados foram aprovados"
                : result.outcome === "security_checks_failed"
                  ? "Um ou mais testes falharam"
                  : result.outcome === "security_checks_inconclusive"
                    ? "Resultado inconclusivo: verifique o acesso à API"
                    : "Bateria parcial: há testes que precisam de configuração"}
            </strong>
            <p className={styles.note}>
              Um teste só é aprovado quando a resposta JSON da aplicação corresponde ao status e ao código esperados. Respostas de proteção da Vercel ou respostas não JSON são inconclusivas, não falhas de autorização da API.
            </p>
            <button className={styles.button} type="button" onClick={downloadReport}>Baixar relatório de evidências (JSON)</button>
            <ul className={styles.permissionList}>
              {result.execution && <li><strong>Executado em (UTC):</strong> {result.execution.executedAtUtc}<br /><strong>Ambiente:</strong> {result.execution.environment}<br /><strong>Commit web:</strong> <code>{result.execution.webCommit}</code><br /><strong>Versão/commit da API:</strong> <code>{result.execution.apiVersion ?? "Não informada pela API"}</code></li>}
              {result.authorizationEvidence && (
                <li>
                  <strong>Evidência confirmada pela API</strong>
                  <div className={styles.note}>
                    <strong>Resultado:</strong> {result.authorizationEvidence.permissionGranted ? "Autorizado" : "Permissão não confirmada"}<br /><strong>Assinatura JWT:</strong> Validada pela API antes de emitir esta evidência<br />
                    <strong>Emissor (iss):</strong> <code>{result.authorizationEvidence.issuer}</code><br />
                    <strong>Sujeito (sub):</strong> <code>{result.authorizationEvidence.subject}</code><br />
                    <strong>Audiência (aud):</strong> <code>{Array.isArray(result.authorizationEvidence.audience) ? result.authorizationEvidence.audience.join(", ") : result.authorizationEvidence.audience}</code><br />
                    <strong>Algoritmo validado:</strong> <code>{result.authorizationEvidence.algorithm}</code><br />
                    <strong>Expiração do token (exp, UTC):</strong> {new Date(result.authorizationEvidence.expiresAt * 1000).toISOString()} ({result.authorizationEvidence.expiresAt * 1000 > Date.now() ? "válido no momento da execução" : "expirado no momento da exibição"})<br />
                    <strong>Tenant ID:</strong> <code>{result.authorizationEvidence.tenantId}</code><br />
                    <strong>Principal ID:</strong> <code>{result.authorizationEvidence.principalId}</code><br />
                    <strong>Membership ID:</strong> <code>{result.authorizationEvidence.membershipId}</code><br />
                    <strong>Membership ativa:</strong> {result.authorizationEvidence.membershipActive ? "Confirmada pela resposta de contexto da API" : "Não confirmada"}<br />
                    <strong>Permissões efetivas:</strong> {result.authorizationEvidence.permissions.length ? result.authorizationEvidence.permissions.join(", ") : "Nenhuma retornada"}
                  </div>
                </li>
              )}
              {result.validationEvidence && (
                <li>
                  <strong>Matriz de validação JWT e autorização</strong>
                  <div className={styles.note}>
                    <strong>Assinatura criptográfica:</strong> {result.validationEvidence.signature.status} — {result.validationEvidence.signature.reason}<br />
                    <strong>Issuer:</strong> {result.validationEvidence.issuer.status} — <code>{result.validationEvidence.issuer.value}</code><br />
                    <strong>Audience:</strong> {result.validationEvidence.audience.status} — <code>{Array.isArray(result.validationEvidence.audience.value) ? result.validationEvidence.audience.value.join(", ") : result.validationEvidence.audience.value}</code><br />
                    <strong>Algoritmo:</strong> {result.validationEvidence.algorithm.status} — <code>{result.validationEvidence.algorithm.value}</code> — {result.validationEvidence.algorithm.reason}<br />
                    <strong>Expiração:</strong> {result.validationEvidence.expiration.status} — {result.validationEvidence.expiration.expiresAtUtc}<br />
                    <strong>Membership:</strong> {result.validationEvidence.membership.status} — <code>{result.validationEvidence.membership.membershipId}</code><br />
                    <strong>Permissão exigida:</strong> {result.validationEvidence.permissions.status} — <code>{result.validationEvidence.permissions.required}</code><br />
                    <strong>Permissões efetivas consultadas:</strong> {result.validationEvidence.permissions.effective.join(", ") || "Nenhuma retornada"}
                  </div>
                </li>
              )}
              {result.checks.map((check) => (
                <li key={check.id}>
                  <strong>{statusLabels[check.status]}</strong> — {check.label}
                  <div className={styles.note}>
                    Esperado: HTTP {check.expectedStatus}
                    {check.actualStatus !== undefined ? `; recebido: HTTP ${check.actualStatus}` : ""}
                    {check.detail ? ` — ${check.detail}` : ""}<br />
                    {check.executedAtUtc ? `Executado em UTC: ${check.executedAtUtc}. ` : ""}{check.reason ? `Motivo: ${check.reason}` : ""}
                  </div>
                </li>
              ))}
              {result.ciNegativeCoverage?.map((coverage) => (
                <li key={coverage.id}>
                  <strong>COBERTURA CI — não é teste live desta execução</strong> — {coverage.scenario}
                  <div className={styles.note}>
                    <strong>Resultado:</strong> {coverage.result}<br />
                    <strong>Esperado:</strong> {coverage.expectedOutcome}<br />
                    <strong>Observado:</strong> {coverage.observedOutcome}<br />
                    <strong>Status HTTP:</strong> {coverage.httpStatus === null ? "N/A — teste unitário do verificador" : coverage.httpStatus}<br />
                    {coverage.evidence}<br />{coverage.executionScope}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </section>
  );
}
