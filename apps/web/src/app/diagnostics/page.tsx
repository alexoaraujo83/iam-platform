import { connection } from "next/server";
import { auth0 } from "../../lib/auth0";
import styles from "../page.module.css";

export const metadata = {
  title: "Auth diagnostics | IAM Platform",
  description: "Safe, non-secret diagnostics for the current Auth0 session.",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.field}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function AuthDiagnosticsPage() {
  await connection();
  const session = await auth0.getSession();

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="page-title">
        <p className={styles.eyebrow}>IDENTITY & ACCESS MANAGEMENT</p>
        <h1 id="page-title">Auth diagnostics</h1>
        <p className={styles.description}>
          Check the current Auth0 session without displaying access tokens, ID tokens,
          cookies, client secrets, or other credentials.
        </p>

        {!session ? (
          <div className={styles.session}>
            <h2>Authentication required</h2>
            <p>No active application session was found. Sign in with the configured Auth0 connection, then return here.</p>
            <a className={styles.button} href="/auth/login?returnTo=%2Fdiagnostics">Sign in with Auth0</a>
          </div>
        ) : (
          <div className={styles.session}>
            <h2>Application session detected</h2>
            <p className={styles.note}>
              This confirms that the web application can read a session. It does not by itself
              prove that the API accepted an access token or that tenant authorization passed.
            </p>
            <dl className={styles.fields}>
              <Field label="Session" value="Present" />
              <Field label="Subject (sub)" value={session.user.sub ?? "Not present in session"} />
              <Field label="Issuer configured for this deployment" value={process.env.OIDC_ISSUER ?? "Not exposed/configured in web environment"} />
              <Field label="Email verification claim" value={typeof session.user.email_verified === "boolean" ? String(session.user.email_verified) : "Not present"} />
              <Field label="Display name" value={session.user.name ?? "Not present"} />
              <Field label="Email" value={session.user.email ?? "Not present"} />
            </dl>
            <p className={styles.note}>
              Treat the subject as the external identity key; do not use email as the stable identity.
              Authorization must still be resolved server-side from tenant membership, roles, and permissions.
            </p>
            <div className={styles.actions}>
              <a className={styles.secondary} href="/">Home</a>
              <a className={styles.button} href="/auth/logout">Sign out</a>
            </div>
          </div>
        )}

        <p className={styles.footer}>
          Security note: this page intentionally does not render tokens or raw session contents.
          Do not paste credentials into support tickets or chat.
        </p>
      </section>
    </main>
  );
}
