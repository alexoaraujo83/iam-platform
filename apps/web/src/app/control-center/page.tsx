"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./control-center.module.css";
import AuthorizationProbe from "../diagnostics/authorization-probe";

const modules = [
  { id: "overview", label: "Visão geral", eyebrow: "CONTROL CENTER", title: "Operational overview", description: "Visão unificada do estado operacional, segurança, entregas e evidências.", icon: "◫" },
  { id: "admin", label: "Admin Dashboard", eyebrow: "IDENTITY GOVERNANCE", title: "Admin Dashboard", description: "Usuários, organizações, roles, permissões e operações administrativas.", icon: "♙" },
  { id: "diagnostics", label: "Diagnostics Center", eyebrow: "SERVICE HEALTH", title: "Diagnostics Center", description: "Investigue erros, integrações, dependências e sinais de saúde dos serviços.", icon: "⌁" },
  { id: "testing", label: "Test & Evidence Lab", eyebrow: "QUALITY ENGINEERING", title: "Test & Evidence Lab", description: "Organize execuções controladas, resultados e artefatos verificáveis.", icon: "⚗" },
  { id: "runtime", label: "Context & Runtime", eyebrow: "EXECUTION CONTEXT", title: "Context & Runtime", description: "Compare código, deployment, ambiente e configuração efetivamente observada.", icon: "⌘" },
  { id: "security", label: "Security & Audit", eyebrow: "SECURITY POSTURE", title: "Security & Audit", description: "Acompanhe controles de acesso, riscos, eventos e trilhas de auditoria.", icon: "⬡" },
  { id: "delivery", label: "Delivery & Release", eyebrow: "SOFTWARE DELIVERY", title: "Delivery & Release", description: "Conecte commits, CI, previews, deployments, releases e rollback.", icon: "⇧" },
  { id: "clarim", label: "Clarim Console", eyebrow: "INCIDENT INTELLIGENCE", title: "Clarim Console", description: "Correlacione alertas, incidentes, timelines e ações propostas.", icon: "◉" },
  { id: "evidence", label: "Evidence & Compliance", eyebrow: "EVIDENCE STORE", title: "Evidence & Compliance", description: "Consulte proveniência, hashes, histórico de execuções e relatórios.", icon: "▤" },
] as const;

type ModuleId = (typeof modules)[number]["id"];

type AccessCheck = { loading: boolean; outcome: string; permissionGranted?: boolean; tenantId?: string | null; apiVersion?: string | null; correlationId?: string | null; detail?: string };
type Telemetry = {
  loading: boolean;
  outcome: string;
  workflow?: { name: string; status: string; conclusion: string | null; html_url: string | null; head_sha: string | null; head_branch: string; created_at: string | null; updated_at: string | null } | null;
  tests: Array<{ name: string; status: string; conclusion: string | null }>;
  deployments: Array<{ context: string; state: string; description: string | null; target_url: string | null; updated_at: string | null }>;
  evidence: Array<{ label: string; url: string; conclusion: string }>;
};
type DiagnosticState = { loading: boolean; label: string; detail?: string; permissionGranted?: boolean };

const integrations = [
  { name: "GitHub", detail: "Código-fonte e governança", icon: "GH" },
  { name: "GitHub Actions", detail: "CI e verificações", icon: "CI" },
  { name: "Vercel", detail: "Builds e deployments", icon: "Ve" },
  { name: "Neon", detail: "PostgreSQL e migrations", icon: "Ne" },
  { name: "Auth0", detail: "Identidade e autenticação", icon: "A0" },
];

const moduleDetails: Record<ModuleId, { heading: string; items: string[]; next: string }> = {
  overview: { heading: "Operational readiness", items: ["Estado de serviços e dependências", "Últimos testes e evidências", "Alertas e findings abertos", "Deployments e versão ativa"], next: "Conecte fontes de dados para substituir estados desconhecidos por sinais verificados." },
  admin: { heading: "Governança de identidade", items: ["Usuários e estados de conta", "Organizações e associações a tenants", "Roles, permissions e scopes", "Ações privilegiadas com confirmação"], next: "As operações administrativas deverão ser autorizadas no servidor e registradas em auditoria." },
  diagnostics: { heading: "Investigação de serviços", items: ["Health checks e conectividade", "Erros por serviço, rota e versão", "Logs e correlation IDs", "Dependências degradadas e configuração"], next: "Hipóteses de diagnóstico devem permanecer separadas de causas confirmadas." },
  testing: { heading: "Execuções e resultados", items: ["Testes unitários, integração e E2E", "Cenários de autenticação e autorização", "Artefatos, traces e relatórios", "Comparação entre execuções"], next: "Cada execução deverá registrar commit, ambiente, resultado e proveniência dos artefatos." },
  runtime: { heading: "Contexto efetivo", items: ["Commit e deployment observados", "Ambiente Development, Preview ou Production", "Presença de variáveis obrigatórias sem revelar valores", "Divergências de configuração"], next: "Configuração declarada e estado efetivamente observado devem ser apresentados separadamente." },
  security: { heading: "Postura de segurança", items: ["Falhas de autenticação e autorização", "Acessos negados e elevação de privilégios", "Dependências vulneráveis", "Findings, responsáveis e remediação"], next: "Não exiba tokens, credenciais ou valores secretos. Findings exigem evidência e severidade justificadas." },
  delivery: { heading: "Ciclo de entrega", items: ["Commits, pull requests e checks", "Execuções do GitHub Actions", "Builds e deployments da Vercel", "Aprovações, smoke tests e rollback"], next: "Build bem-sucedido não equivale a aplicação funcional; valide o deployment após a publicação." },
  clarim: { heading: "Inteligência operacional", items: ["Sinais e alertas recebidos", "Incidentes correlacionados", "Timeline e encaminhamento", "Recomendações e validação da resolução"], next: "A integração e o contrato real do Clarim ainda precisam ser confirmados na implementação." },
  evidence: { heading: "Proveniência e compliance", items: ["Dossiês de execução e auditoria", "Artefatos associados a commits e deployments", "Hashes para verificação de integridade", "Exportação JSON, CSV e PDF"], next: "Hashes comprovam integridade dos bytes, não a veracidade de uma conclusão ou a aprovação de um controle." },
};

export default function ControlCenterPage() {
  const [active, setActive] = useState<ModuleId>("overview");
  const [query, setQuery] = useState("");
  const [environment, setEnvironment] = useState("All environments");
  const [accessCheck, setAccessCheck] = useState<AccessCheck>({ loading: true, outcome: "checking" });
  const [telemetry, setTelemetry] = useState<Telemetry>({ loading: true, outcome: "checking", tests: [], deployments: [], evidence: [] });
  const [diagnostics, setDiagnostics] = useState<DiagnosticState>({ loading: true, label: "A verificar diagnóstico IAM…" });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/control-center", { method: "GET", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as Omit<AccessCheck, "loading">;
        if (!cancelled) setAccessCheck({
          loading: false,
          outcome: typeof payload.outcome === "string" ? payload.outcome : "invalid_response",
          permissionGranted: payload.permissionGranted,
          tenantId: payload.tenantId,
          apiVersion: payload.apiVersion,
          correlationId: payload.correlationId,
          detail: payload.detail,
        });
      })
      .catch(() => {
        if (!cancelled) setAccessCheck({ loading: false, outcome: "control_center_probe_failed" });
      });
    fetch("/api/control-center/telemetry", { method: "GET", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as Omit<Telemetry, "loading">;
        if (!cancelled) setTelemetry({
          loading: false,
          outcome: typeof payload.outcome === "string" ? payload.outcome : "invalid_response",
          workflow: payload.workflow ?? null,
          tests: Array.isArray(payload.tests) ? payload.tests : [],
          deployments: Array.isArray(payload.deployments) ? payload.deployments : [],
          evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
        });
      })
      .catch(() => {
        if (!cancelled) setTelemetry({ loading: false, outcome: "telemetry_request_failed", tests: [], deployments: [], evidence: [] });
      });
    fetch("/api/diagnostics", { method: "POST", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { outcome?: string; code?: string; permissionGranted?: boolean; apiStatus?: number };
        if (!cancelled) setDiagnostics({
          loading: false,
          label: payload.outcome ?? payload.code ?? (response.ok ? "diagnostic_response_received" : `http_${response.status}`),
          detail: payload.apiStatus ? `API HTTP ${payload.apiStatus}` : undefined,
          permissionGranted: payload.permissionGranted,
        });
      })
      .catch(() => {
        if (!cancelled) setDiagnostics({ loading: false, label: "diagnostics_request_failed" });
      });
    return () => { cancelled = true; };
  }, []);
  const activeModule = modules.find((item) => item.id === active) ?? modules[0];
  const detail = moduleDetails[active];
  const filteredIntegrations = useMemo(
    () => integrations.filter((item) => (item.name + " " + item.detail).toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/control-center" aria-label="IAM Platform Control Center home">
          <span className={styles.brandMark}>i</span>
          <span className={styles.brandCopy}><strong>iam platform</strong><small>CONTROL CENTER</small></span>
        </Link>
        <div className={styles.navLabel}>WORKSPACE</div>
        <nav className={styles.nav} aria-label="Control Center modules">
          {modules.map((item) => (
            <button key={item.id} type="button" className={active === item.id ? styles.navItemActive : styles.navItem} onClick={() => setActive(item.id)} aria-current={active === item.id ? "page" : undefined}>
              <span className={styles.navIcon} aria-hidden="true">{item.icon}</span><span>{item.label}</span>
              {item.id === "security" && <span className={styles.navDot} aria-label="Security module" />}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.connectionBadge}><span className={styles.pulse} /> Integration setup</div>
          <p>Dashboard foundation</p>
          <small>Live telemetry not connected</small>
        </div>
      </aside>

      <section className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}><span>Workspace</span><span className={styles.slash}>/</span><strong>{activeModule.label}</strong></div>
          <div className={styles.topActions}>
            <label className={styles.environmentSelect}><span>Environment</span><select value={environment} onChange={(event) => setEnvironment(event.target.value)} aria-label="Select environment"><option>All environments</option><option>Development</option><option>Preview</option><option>Production</option></select></label>
            <span className={styles.avatar} aria-label="Administrator workspace">AD</span>
          </div>
        </header>

        <div className={styles.content}>
          <div className={styles.pageIntro}>
            <div><p className={styles.eyebrow}>{activeModule.eyebrow}</p><h1>{activeModule.title}</h1><p className={styles.subtitle}>{activeModule.description}</p></div>
            <div className={styles.introMeta}><span className={styles.statusPill}><span /> {accessCheck.loading ? "Checking IAM access" : accessCheck.permissionGranted ? "IAM access verified" : accessCheck.outcome.replaceAll("_", " ")}</span><span className={styles.updated}>{accessCheck.permissionGranted ? "API authorization confirmed" : "Operational data not connected"}</span></div>
          </div>

          {active === "overview" ? (
            <>
              <div className={styles.hero}>
                <div className={styles.heroText}><div className={styles.heroEyebrow}><span className={styles.heroDot} /> CONTROL PLANE</div><h2>Clarity for every<br />identity and release.</h2><p>Um único ponto de controle para operação, segurança e evidências verificáveis da IAM Platform.</p><button type="button" className={styles.heroButton} onClick={() => setActive("diagnostics")}>Explore diagnostics <span aria-hidden="true">→</span></button></div>
                <div className={styles.heroGraphic} aria-hidden="true"><div className={`${styles.orbit} ${styles.orbitOne}`} /><div className={`${styles.orbit} ${styles.orbitTwo}`} /><div className={`${styles.orbit} ${styles.orbitThree}`} /><div className={styles.core}><span>IAM</span><small>CONTROL</small></div><span className={`${styles.node} ${styles.nodeOne}`}>AUTH</span><span className={`${styles.node} ${styles.nodeTwo}`}>CI/CD</span><span className={`${styles.node} ${styles.nodeThree}`}>DATA</span></div>
              </div>

              <div className={styles.sectionHeading}><div><h2>Operational signals</h2><p>Indicadores aguardando fontes confiáveis</p></div><span className={styles.smallTag}>{accessCheck.permissionGranted ? "IAM ACCESS · VERIFIED" : "LIVE DATA · PENDING"}</span></div>
              <section className={styles.accessPanel} aria-live="polite">
                <div className={styles.accessIndicator} data-authorized={accessCheck.permissionGranted === true}>{accessCheck.loading ? "…" : accessCheck.permissionGranted ? "✓" : "!"}</div>
                <div className={styles.accessCopy}>
                  <strong>{accessCheck.loading ? "Verificando autorização no IAM API…" : accessCheck.permissionGranted ? "Permissão iam.control_center.read confirmada" : "A autorização operacional ainda não foi confirmada"}</strong>
                  <p>{accessCheck.loading ? "A consulta ocorre no servidor usando a sessão Auth0 atual." : accessCheck.detail ?? (accessCheck.permissionGranted ? "A sessão foi aceita pela API e a permissão de leitura foi confirmada. Isso não significa que os provedores externos já estejam conectados." : "Resultado: " + accessCheck.outcome.replaceAll("_", " ") + ". Verifique a sessão Auth0, as variáveis de ambiente e a associação/permissão do tenant.")}</p>
                  {accessCheck.correlationId && <small>Correlation ID: {accessCheck.correlationId}</small>}
                </div>
                {!accessCheck.loading && <button type="button" className={styles.outlineButton} onClick={() => {
                  setAccessCheck({ loading: true, outcome: "checking" });
                  fetch("/api/control-center", { cache: "no-store" })
                    .then(async (response) => {
                      const payload = await response.json().catch(() => ({})) as Omit<AccessCheck, "loading">;
                      setAccessCheck({ loading: false, outcome: payload.outcome ?? "invalid_response", permissionGranted: payload.permissionGranted, tenantId: payload.tenantId, apiVersion: payload.apiVersion, correlationId: payload.correlationId, detail: payload.detail });
                    })
                    .catch(() => setAccessCheck({ loading: false, outcome: "control_center_probe_failed" }));
                }}>Recheck access</button>}
              </section>
              <div className={styles.metricGrid}>
                {[["Service health","Unknown","Conecte health checks"],["Security findings","Not available","Conecte scanners e auditoria"],["Test executions",telemetry.loading ? "Checking" : telemetry.tests.find((step) => step.name === "Test")?.conclusion ?? "No evidence","Último GitHub Actions run"],["Active deployments",telemetry.deployments.length ? String(telemetry.deployments.length) : "Not available","Checks de deployment no commit"]].map(([label, value, hint]) => <article className={styles.metricCard} key={label}><div className={styles.metricTop}><span>{label}</span><span className={styles.metricGlyph}>↗</span></div><strong className={styles.metricValue}>{value}</strong><p>{hint}</p><div className={styles.metricLine}><span /></div></article>)}
              </div>

              <div className={styles.sectionHeading}><div><h2>Live telemetry & evidence</h2><p>Fontes verificadas no servidor; estados ausentes não são simulados</p></div><span className={styles.smallTag}>{telemetry.loading ? "LOADING" : telemetry.outcome.replaceAll("_", " ").toUpperCase()}</span></div>
              <div className={styles.telemetryGrid}>
                <article className={styles.telemetryCard}>
                  <div className={styles.telemetryCardHeader}><strong>GitHub Actions</strong><span className={styles.telemetryState} data-state={telemetry.workflow?.conclusion ?? telemetry.workflow?.status ?? telemetry.outcome}>{telemetry.loading ? "Checking" : telemetry.workflow?.conclusion ?? telemetry.workflow?.status ?? "Unavailable"}</span></div>
                  {telemetry.workflow ? <><p>{telemetry.workflow.name} · {telemetry.workflow.head_branch}</p><small>Commit: {telemetry.workflow.head_sha?.slice(0, 12) ?? "unknown"}</small>{telemetry.workflow.html_url && <a className={styles.evidenceLink} href={telemetry.workflow.html_url} target="_blank" rel="noreferrer">Open workflow evidence ↗</a>}</> : <p>Não foi possível obter uma execução verificável para este branch.</p>}
                </article>
                <article className={styles.telemetryCard}>
                  <div className={styles.telemetryCardHeader}><strong>Testes e quality gates</strong><span className={styles.telemetryState} data-state={telemetry.tests.some((step) => step.conclusion === "failure") ? "failure" : telemetry.tests.length ? "success" : "unknown"}>{telemetry.tests.length ? `${telemetry.tests.filter((step) => step.conclusion === "success").length}/${telemetry.tests.length} passed` : "No evidence"}</span></div>
                  {telemetry.tests.length ? <ul className={styles.telemetryList}>{telemetry.tests.map((step, index) => <li key={step.name + index}><span>{step.name}</span><span>{step.conclusion ?? step.status}</span></li>)}</ul> : <p>Resultados de testes ainda indisponíveis nesta leitura.</p>}
                </article>
                <article className={styles.telemetryCard}>
                  <div className={styles.telemetryCardHeader}><strong>Vercel deployments</strong><span className={styles.telemetryState} data-state={telemetry.deployments.some((item) => item.state === "failure" || item.state === "error") ? "failure" : telemetry.deployments.length ? "success" : "unknown"}>{telemetry.deployments.length ? `${telemetry.deployments.length} checks` : "No status"}</span></div>
                  {telemetry.deployments.length ? <ul className={styles.telemetryList}>{telemetry.deployments.map((item, index) => <li key={item.context + index}><span>{item.context}</span>{item.target_url ? <a href={item.target_url} target="_blank" rel="noreferrer">{item.state} ↗</a> : <span>{item.state}</span>}</li>)}</ul> : <p>Sem checks Vercel publicados no commit observado. O acesso direto à API Vercel requer token próprio.</p>}
                </article>
                <article className={styles.telemetryCard}>
                  <div className={styles.telemetryCardHeader}><strong>IAM diagnostics</strong><span className={styles.telemetryState} data-state={diagnostics.permissionGranted ? "success" : diagnostics.loading ? "unknown" : "failure"}>{diagnostics.loading ? "Checking" : diagnostics.permissionGranted ? "Authorized" : diagnostics.label.replaceAll("_", " ")}</span></div>
                  <p>{diagnostics.detail ?? (diagnostics.permissionGranted ? "A API confirmou a permissão iam.control_center.read." : "O resultado distingue autorização, configuração e conectividade; consulte o código de resultado.")}</p>
                  <small>Probe autenticado via endpoint de diagnóstico do próprio app.</small>
                </article>
              </div>

              <div className={styles.lowerGrid}>
                <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Integration registry</h2><p>Serviços previstos na arquitetura</p></div><span className={styles.counter}>{integrations.length}</span></div><label className={styles.searchBox}><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search integrations" aria-label="Search integrations" /></label><div className={styles.integrationList}>{filteredIntegrations.map((item) => <div className={styles.integrationRow} key={item.name}><span className={styles.integrationIcon}>{item.icon}</span><span className={styles.integrationCopy}><strong>{item.name}</strong><small>{item.detail}</small></span><span className={styles.notConnected}><i /> {item.name === "GitHub Actions" && telemetry.workflow ? "Live telemetry" : item.name === "Vercel" && telemetry.deployments.length ? "Status available" : "Not connected"}</span></div>)}{filteredIntegrations.length === 0 && <p className={styles.empty}>Nenhuma integração corresponde à busca.</p>}</div></section>
                <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Module directory</h2><p>Explore a arquitetura funcional</p></div></div><div className={styles.moduleList}>{modules.filter((item) => item.id !== "overview").slice(0, 5).map((item) => <button key={item.id} type="button" className={styles.moduleRow} onClick={() => setActive(item.id)}><span className={styles.moduleIcon}>{item.icon}</span><span><strong>{item.label}</strong><small>{item.description}</small></span><span className={styles.rowArrow}>↗</span></button>)}<button className={styles.viewAll} type="button" onClick={() => setActive("evidence")}>Open evidence center <span>→</span></button></div></section>
              </div>
            </>
          ) : (
            <section className={styles.moduleDetail}>
              <div className={styles.detailBanner}><div className={styles.detailIcon}>{activeModule.icon}</div><div><p className={styles.eyebrow}>MODULE WORKSPACE</p><h2>{detail.heading}</h2><p>Estrutura funcional preparada; conectores e dados operacionais ainda precisam ser implementados e validados.</p></div></div>
              <div className={styles.sectionHeading}><div><h2>Capabilities</h2><p>Escopo previsto para este módulo</p></div><span className={styles.smallTag}>DESIGNED · NOT VERIFIED</span></div>
              <div className={styles.capabilityGrid}>{detail.items.map((item, index) => <div className={styles.capability} key={item}><span className={styles.capabilityIndex}>{String(index + 1).padStart(2, "0")}</span><span>{item}</span><span className={styles.capabilityArrow}>↗</span></div>)}</div>
              {(active === "testing" || active === "security") && <div className={styles.authFlowTest}><div className={styles.sectionHeading}><div><h2>Authenticated flow · live evidence</h2><p>Executa a bateria autenticada no servidor com a sessão Auth0 atual e mostra o resultado da API.</p></div><span className={styles.smallTag}>NO TOKEN DISPLAY</span></div><AuthorizationProbe /></div>}
              <div className={styles.notice}><span className={styles.noticeIcon}>i</span><div><strong>Implementation note</strong><p>{detail.next}</p></div></div>
              <div className={styles.sectionHeading}><div><h2>Data availability</h2><p>{environment === "All environments" ? "Todos os ambientes" : environment} · fontes de dados</p></div></div>
              <div className={styles.dataState}><div className={styles.dataStateIcon}>⌁</div><div><strong>Nenhuma fonte operacional conectada nesta interface</strong><p>Este painel não simula métricas de produção. A próxima etapa é integrar a API e os provedores autorizados, com evidências de validação.</p></div><button type="button" className={styles.outlineButton} onClick={() => setActive("overview")}>Back to overview</button></div>
            </section>
          )}
          <footer className={styles.footer}><span>IAM Platform Control Center</span><span>Security-first · Evidence-driven · Default deny</span></footer>
        </div>
      </section>
    </main>
  );
}
