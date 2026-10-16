import { Suspense } from "react";
import { connection } from "next/server";
import { auth0 } from "../lib/auth0";
import styles from "./page.module.css";

async function SessionActions() {
  // Session cookies are request-specific; keep this access behind Suspense.
  await connection();
  const session = await auth0.getSession();

  if (session) {
    return (
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
    );
  }

  return (
    <div className={styles.actions}>
      <a className={styles.button} href="/auth/login">Sign in with Auth0</a>
      <a className={styles.secondary} href="/auth/login?screen_hint=signup">Create account</a>
    </div>
  );
}

function SessionActionsFallback() {
  return (
    <div className={styles.actions}>
      <a className={styles.button} href="/auth/login">Sign in with Auth0</a>
      <a className={styles.secondary} href="/auth/login?screen_hint=signup">Create account</a>
    </div>
  );
}

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="page-title">
        <p className={styles.eyebrow}>IDENTITY & ACCESS MANAGEMENT</p>
        <h1 id="page-title">IAM Platform</h1>
        <p className={styles.description}>
          Centralize identity, organization membership, and access policy management.
        </p>

        <Suspense fallback={<SessionActionsFallback />}>
          <SessionActions />
        </Suspense>

        <p className={styles.footer}>Provider setup requires valid server-side environment variables.</p>
      </section>
    </main>
  );
}
