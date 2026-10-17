"use client";

import { useState } from "react";
import styles from "../page.module.css";

type DiagnosticResult = {
  ok: boolean;
  outcome: string;
  checks: {
    id: string;
    label: string;
    expectedStatus: number;
    actualStatus?: number;
    status: "pass" | "fail" | "not_configured" | "blocked";
    detail?: string;
  }[];
};

const statusLabels: Record<DiagnosticResult["checks"][number]["status"], string> = {
  pass: "PASS",
  fail: "FAIL",
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
      <h2 id="probe-title">Testes de autorização e isolamento</h2>
      <p className={styles.note}>
        Executa testes server-side contra a API com a sessão atual: token ausente e malformado,
        tenant sem associação e, quando configurados, token expirado, tenant sem permissão e
        acesso a outro tenant. Nenhum token ou segredo é enviado ao navegador ou exibido.
      </p>
      <button className={styles.button} type="button" onClick={runProbe} disabled={loading}>
        {loading ? "Executando testes…" : "Executar bateria de testes"}
      </button>
      {result && (
        <div className={styles.result} role="status" aria-live="polite">
          <strong>
            {result.outcome === "security_checks_passed"
              ? "Todos os testes configurados passaram"
              : result.outcome === "security_checks_failed"
                ? "Falha em um ou mais testes"
                : result.outcome === "security_checks_inconclusive"
                  ? "Resultado inconclusivo: verifique acesso à API"
                  : "Bateria parcial: há testes que precisam de configuração"}
          </strong>
          <p className={styles.note}>
            Um teste só conta como PASS quando a resposta JSON da aplicação corresponde ao status esperado.
            Respostas de proteção da Vercel não são tratadas como falha de autorização da API.
          </p>
          <ul className={styles.permissionList}>
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
  );
}
