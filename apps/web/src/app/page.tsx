import { auth0 } from "../lib/auth0";
import styles from "./page.module.css";

export default async function Home() {
  const session = await auth0.getSession();

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="page-title">
        <p className={styles.eyebrow}>IDENTITY & ACCESS MANAGEMENT</p>
        <h1 id="page-title">IAM Platform</h1>
        <p className={styles.description}>
          Centralize identity, organization membership, and access policy management.
        </p>

        {session ? (
          <div className={styles.session}>
            <h2>Authenticated session</h2>
            <p>
              Signed in as <strong>{session.user.name ?? session.user.email ?? "authenticated user"}</strong>.
            </p>
            <p className={styles.note}>
              Authentication is provided by Auth0. Authorization and tenant membership must still be
              evaluated by the IAM API.
            </p>
            <a className={styles.button} href="/auth/logout">Sign out</a>
          </div>
        ) : (
          <div className={styles.actions}>
            <a className={styles.button} href="/auth/login">Sign in with Auth0</a>
            <a className={styles.secondary} href="/auth/login?screen_hint=signup">Create account</a>
          </div>
        )}
        <p className={styles.footer}>Provider setup requires valid server-side environment variables.</p>
      </section>
    </main>
  );
}
