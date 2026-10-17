"use client";

import { useState } from "react";
import styles from "../page.module.css";

type CallbackResult = {
  ok: boolean;
  outcome: string;
  scope: string;
  note: string;
  checks: {
    id: string;
    label: string;
    expectedStatus: number;
    actualStatus: number;
    status: "pass" | "fail" | "blocked";
    detail: string;
  }[];
};

export default function CallbackProbe() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CallbackResult | null>(null);

  async function runTests() {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/diagnostics/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        setResult({
          ok: false,
          outcome: "callback_checks_inconclusive",
          scope: "synthetic_handler_checks",
          note: "A plataforma pode ter interceptado a chamada. Resposta não JSON não comprova falha do callback.",
          checks: [{
            id: "endpoint",
            label: "Endpoint de diagnóstico de callback",
            expectedStatus: 200,
            actualStatus: response.status,
            status: "blocked",
            detail: "Resposta não JSON; resultado inconclusivo.",
          }],
        });
        return;
      }
      const data = (await response.json()) as Partial<CallbackResult> & { code?: string };
      if (response.status === 401 && data.code === "login_required") {
        setResult({
          ok: false,
          outcome: "callback_checks_not_run",
          scope: "synthetic_handler_checks",
          note: "Entre com Auth0 e execute novamente. A bateria está visível, mas exige uma sessão autenticada.",
          checks: [{
            id: "session",
            label: "Sessão autenticada necessária para executar os testes",
            expectedStatus: 200,
            actualStatus: 401,
            status: "blocked",
            detail: "A API de diagnóstico recusou corretamente a execução sem sessão.",
          }],
        });
        return;
      }
      if (!response.ok) {
        setResult({
          ok: false,
          outcome: data.outcome ?? "callback_checks_inconclusive",
          scope: data.scope ?? "synthetic_handler_checks",
          note: data.note ?? "Não foi possível executar a bateria de callback.",
          checks: data.checks ?? [{
            id: "endpoint",
            label: "Endpoint de diagnóstico de callback",
            expectedStatus: 200,
            actualStatus: response.status,
            status: "blocked",
            detail: "A aplicação recusou a execução; confira a sessão e a proteção da plataforma.",
          }],
        });
        return;
      }
      setResult(data as CallbackResult);
    } catch {
      setResult({
        ok: false,
        outcome: "callback_checks_inconclusive",
        scope: "synthetic_handler_checks",
        note: "Não foi possível consultar o endpoint de diagnóstico.",
        checks: [{
          id: "endpoint",
          label: "Endpoint de diagnóstico de callback",
          expectedStatus: 200,
          actualStatus: 0,
          status: "blocked",
          detail: "Falha de rede; nenhum resultado de callback foi confirmado.",
        }],
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.probe} aria-labelledby="callback-probe-title">
      <h2 id="callback-probe-title">Diagnóstico do callback OAuth</h2>
      <p className={styles.note}>
        Verifica no servidor os comportamentos de rejeição de state ausente/inválido, falha do provedor,
        ausência de sessão e bloqueio de redirecionamento externo. Não exibe tokens nem segredos.
      </p>
      <p className={styles.note}>
        Importante: esta bateria testa o handler implantado com cenários sintéticos. Ela não substitui
        um E2E de login real que percorra Auth0, cookies, state e troca do authorization code.
      </p>
      <button className={styles.button} type="button" onClick={runTests} disabled={loading}>
        {loading ? "Testando callback…" : "Executar testes de callback"}
      </button>
      {result && (
        <div className={styles.result} role="status" aria-live="polite">
          <strong>
            {result.outcome === "callback_checks_passed"
              ? "Todos os testes sintéticos de callback passaram"
              : result.outcome === "callback_checks_failed"
                ? "Falha em um ou mais testes de callback"
                : result.outcome === "callback_checks_not_run"
                  ? "Autenticação necessária — testes ainda não executados"
                  : "Resultado inconclusivo"}
          </strong>
          <p className={styles.note}>{result.note}</p>
          <ul className={styles.permissionList}>
            {result.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "INCONCLUSIVO"}</strong> — {check.label}
                <div className={styles.note}>
                  Esperado: HTTP {check.expectedStatus}; recebido: {check.actualStatus ? `HTTP ${check.actualStatus}` : "sem resposta"}
                  {" — "}{check.detail}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
