"use client";

import { useState } from "react";
import styles from "../page.module.css";

type DiagnosticResult = {
  ok: boolean;
  outcome: string;
  execution?: { executedAtUtc: string; environment: string; webCommit: string; apiVersion: string | null };
  checks: {
    id: string;
    label: string;
    expectedStatus: number;
    actualStatus?: number;
    status: "pass" | "fail" | "not_configured" | "blocked";
    detail?: string;
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
          Executa testes no servidor contra a API usando a sessão atual. Testes que dependem de fixtures isoladas aparecem como não configurados até que o ambiente seja preparado. Nenhum token ou segredo é enviado ao navegador ou exibido.
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
            <ul className={styles.permissionList}>
              {result.execution && <li><strong>Executado em (UTC):</strong> {result.execution.executedAtUtc}<br /><strong>Ambiente:</strong> {result.execution.environment}<br /><strong>Commit web:</strong> <code>{result.execution.webCommit}</code><br /><strong>Versão/commit da API:</strong> <code>{result.execution.apiVersion ?? "Não informada pela API"}</code></li>}
              {result.checks.map((check) => (
                <li key={check.id}>
                  <strong>{statusLabels[check.status]}</strong> — {check.label}
                  <div className={styles.note}>
                    Esperado: HTTP {check.expectedStatus}
                    {check.actualStatus !== undefined ? `; recebido: HTTP ${check.actualStatus}` : ""}
                    {check.detail ? ` — ${check.detail}` : ""}
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
