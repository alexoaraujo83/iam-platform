import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { auth0 } from "../../lib/auth0";
import AuthorizationProbe from "./authorization-probe";
import styles from "../page.module.css";

export const metadata = {
  title: "Diagnóstico de autenticação | IAM Platform",
  description: "Diagnóstico seguro da sessão e da autorização na API IAM.",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.field}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

async function SessionDiagnostics() {
  await connection();
  const session = await auth0.getSession();

  if (!session) {
    return (
      <div className={styles.session}>
        <h2>Autenticação necessária</h2>
        <p>Nenhuma sessão ativa foi encontrada. Entre pelo Auth0 e volte a esta página.</p>
        <a className={styles.button} href="/auth/login?returnTo=%2Fdiagnostics">Entrar com Auth0</a>
      </div>
    );
  }

  const sessionMetadata = session as unknown as Record<string, unknown>;
  const tokenSet = sessionMetadata.tokenSet && typeof sessionMetadata.tokenSet === "object"
    ? sessionMetadata.tokenSet as Record<string, unknown>
    : {};
  const formatExpiry = (value: unknown) => typeof value === "number" && Number.isFinite(value)
    ? new Date(value > 10_000_000_000 ? value : value * 1000).toISOString()
    : "Não disponível nos metadados da sessão";
  const sessionExpiresAt = formatExpiry(sessionMetadata.expiresAt);
  const accessTokenExpiresAt = formatExpiry(tokenSet.expiresAt ?? tokenSet.expires_at);

  return (
    <div className={styles.session}>
      <h2>Sessão da aplicação detectada</h2>
      <p className={styles.note}>
        Uma sessão web comprova apenas o login. Use o teste da API abaixo para verificar a aceitação do token, a associação ativa ao tenant e a permissão exigida.
      </p>
      <dl className={styles.fields}>
        <Field label="Sessão web" value="Presente" />
        <Field label="Sujeito da sessão (sub)" value={session.user.sub ?? "Não presente na sessão"} />
        <Field label="Emissor configurado (não é prova de validação)" value={process.env.OIDC_ISSUER ?? "Não configurado no ambiente web"} />
        <Field label="Audiência solicitada (configuração)" value={process.env.AUTH0_AUDIENCE ?? "Não configurada"} />
        <Field label="Algoritmos permitidos (ambiente web; não confirma a API)" value={process.env.OIDC_ALLOWED_ALGORITHMS?.trim() || "Não definido no ambiente web; configuração efetiva da API não consultada"} />
        <Field label="Expiração da sessão web (UTC)" value={sessionExpiresAt} />
        <Field label="Expiração do token de acesso (UTC)" value={accessTokenExpiresAt} />
        <Field label="Ambiente" value={process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "Não informado"} />
        <Field label="Commit web" value={process.env.VERCEL_GIT_COMMIT_SHA ?? "Não informado"} />
        <Field label="E-mail verificado" value={typeof session.user.email_verified === "boolean" ? (session.user.email_verified ? "Sim" : "Não") : "Não informado"} />
        <Field label="Nome de exibição" value={session.user.name ?? "Não informado"} />
        <Field label="E-mail" value={session.user.email ?? "Não informado"} />
      </dl>
      <p className={styles.note}>
        Use o par (emissor, sujeito) validado como chave da identidade externa. E-mail não é uma chave estável
        e um endereço não verificado não deve ser tratado como verificado. O acesso ao tenant é resolvido
        pelo banco do IAM, nunca por user_metadata ou app_metadata. Emissor, audiência e algoritmos exibidos são configurações;
        esta tela não os apresenta como claims validados. A expiração é lida apenas dos metadados da sessão SDK; a API continua responsável pela validação do JWT.
      </p>
      <AuthorizationProbe />
      <div className={styles.actions}>
        <Link className={styles.secondary} href="/">Home</Link>
        <a className={styles.secondary} href="/auth/logout">Sign out</a>
      </div>
    </div>
  );
}

function SessionDiagnosticsFallback() {
  return (
    <div className={styles.session} aria-live="polite">
      <h2>Carregando diagnóstico da sessão…</h2>
      <p className={styles.note}>Verificando a sessão Auth0 no servidor.</p>
    </div>
  );
}

export default function AuthDiagnosticsPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="page-title">
        <p className={styles.eyebrow}>IDENTIDADE E CONTROLE DE ACESSO</p>
        <h1 id="page-title">Diagnóstico de autenticação</h1>
        <p className={styles.description}>
          Reúna evidências de login, validação de token e autorização na API IAM. Tokens e credenciais nunca são exibidos.
        </p>
        <Suspense fallback={<SessionDiagnosticsFallback />}>
          <SessionDiagnostics />
        </Suspense>
        <p className={styles.footer}>
          Segurança: esta página nunca exibe tokens de acesso, ID tokens, cookies, segredos de cliente ou o conteúdo bruto da sessão. Os testes são executados no servidor e retornam somente resultados e identificadores não secretos.
        </p>
      </section>
    </main>
  );
}
