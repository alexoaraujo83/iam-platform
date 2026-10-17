import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { auth0 } from "../../lib/auth0";
import AuthorizationProbe from "./authorization-probe";
import styles from "../page.module.css";

export const metadata = {
  title: "Auth diagnostics | IAM Platform",
  description: "Safe diagnostics for the current Auth0 session and API authorization.",
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
        <h2>Authentication required</h2>
        <p>No active application session was found. Sign in with Auth0, then return here.</p>
        <a className={styles.button} href="/auth/login?returnTo=%2Fdiagnostics">Sign in with Auth0</a>
      </div>
    );
  }

  return (
    <div className={styles.session}>
      <h2>Application session detected</h2>
      <p className={styles.note}>
        A web session proves sign-in only. Use the API test below to verify token acceptance,
        active tenant membership, and the required permission.
      </p>
      <dl className={styles.fields}>
        <Field label="Web session" value="Present" />
        <Field label="Subject (sub)" value={session.user.sub ?? "Not present in session"} />
        <Field label="Issuer configured" value={process.env.OIDC_ISSUER ?? "Not configured in web environment"} />
        <Field label="Email verification claim" value={typeof session.user.email_verified === "boolean" ? String(session.user.email_verified) : "Not present"} />
        <Field label="Display name" value={session.user.name ?? "Not present"} />
        <Field label="Email" value={session.user.email ?? "Not present"} />
      </dl>
      <p className={styles.note}>
        Use the verified issuer and subject as the external identity key. Email is not a stable
        identity, and an unverified email must not be treated as verified. Tenant access is
        resolved from the IAM database, not from user_metadata or app_metadata.
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
      <h2>Loading session diagnostics…</h2>
      <p className={styles.note}>Checking the server-side Auth0 session.</p>
    </div>
  );
}

export default function AuthDiagnosticsPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="page-title">
        <p className={styles.eyebrow}>IDENTITY & ACCESS MANAGEMENT</p>
        <h1 id="page-title">Auth diagnostics</h1>
        <p className={styles.description}>
          Collect the evidence needed to diagnose Auth0 sign-in and IAM API authorization.
          Tokens and credentials are never displayed.
        </p>
        <Suspense fallback={<SessionDiagnosticsFallback />}>
          <SessionDiagnostics />
        </Suspense>
        <p className={styles.footer}>
          Security: this page never renders access tokens, ID tokens, cookies, client secrets, or raw session contents.
          The API test runs server-side and returns only the authorization outcome and non-secret IDs.
        </p>
      </section>
    </main>
  );
}
