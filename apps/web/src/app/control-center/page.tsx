import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { auth0 } from "../../lib/auth0";
import styles from "../page.module.css";

export const metadata = {
  title: "IAM Control Center | IAM Platform",
  description: "Painel central de identidade, tenancy, autorização e evidências de segurança.",
};

const areas = [
  { title: "Identidades", description: "Identidade externa baseada em emissor e sujeito (iss, sub).", status: "Requer integração de dados" },
  { title: "Tenants e memberships", description: "Associação ativa ao tenant resolvida no servidor e no banco.", status: "Requer validação operacional" },
  { title: "Permissões e RBAC", description: "Autorização com negação por padrão e privilégios mínimos.", status: "Contratos existentes; E2E pendente" },
  { title: "Auditoria", description: "Eventos duráveis para operações sensíveis, sem tokens ou segredos.", status: "Cobertura integral pendente" },
] as const;

async function ControlCenterSession() {
  await connection();
  const session = await auth0.getSession();

  if (!session) {
    return (
      <div className={styles.session} aria-labelledby="session-title">
        <h2 id="session-title">Entre para continuar</h2>
        <p>O login autentica a sessão, mas não concede automaticamente acesso a tenants ou funções administrativas.</p>
        <div className={styles.actions}>
          <a className={styles.button} href="/auth/login?returnTo=%2Fcontrol-center">Entrar com Auth0</a>
          <Link className={styles.secondary} href="/diagnostics">Abrir diagnóstico</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.session}>
      <h2>Sessão web detectada</h2>
      <p>Usuário da sessão: <strong>{session.user.name ?? session.user.email ?? "usuário autenticado"}</strong></p>
      <p className={styles.note}>A sessão não comprova membership, permissões ou acesso a qualquer tenant. Esses controles precisam ser verificados pela API IAM.</p>
      <div className={styles.actions}>
        <Link className={styles.button} href="/diagnostics">Executar diagnóstico de autorização</Link>
        <a className={styles.secondary} href="/auth/logout">Sair</a>
      </div>
    </div>
  );
}

function SessionFallback() {
  return <p className={styles.note} aria-live="polite">Verificando a sessão no servidor…</p>;
}

export default function ControlCenterPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="control-center-title">
        <p className={styles.eyebrow}>IDENTITY • TENANCY • AUTHORIZATION • EVIDENCE</p>
        <h1 id="control-center-title">IAM Control Center</h1>
        <p className={styles.description}>Ponto central de operação do IAM. Os estados abaixo distinguem componentes existentes de controles ainda não comprovados em integração real.</p>
        <Suspense fallback={<SessionFallback />}>
          <ControlCenterSession />
        </Suspense>
        <h2 style={{ marginTop: 36, fontSize: 22 }}>Áreas de controle</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12, marginTop: 16 }}>
          {areas.map((area) => (
            <article key={area.title} style={{ border: "1px solid #e4e7f0", borderRadius: 14, padding: 18, background: "#fff" }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>{area.title}</h3>
              <p style={{ color: "#586174", fontSize: 13, lineHeight: 1.6 }}>{area.description}</p>
              <p style={{ color: "#5146c7", fontSize: 12, fontWeight: 700, marginTop: 14 }}>{area.status}</p>
            </article>
          ))}
        </div>
        <p className={styles.footer}>Este painel não inventa contagens nem declara sistemas saudáveis sem consultar a API. Nenhuma credencial, token ou cookie é exibido. Use Diagnóstico para coletar evidências de sessão e autorização.</p>
        <div className={styles.actions}>
          <Link className={styles.secondary} href="/">Página inicial</Link>
          <Link className={styles.secondary} href="/diagnostics">Diagnóstico</Link>
        </div>
      </section>
    </main>
  );
}
