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

type HomeSearchParams = Promise<{
  identity_bootstrap?: string | string[];
}>;

async function IdentityBootstrapStatus({ searchParams }: { searchParams: HomeSearchParams }) {
  const params = await searchParams;
  if (params.identity_bootstrap !== "unavailable") return null;

  return (
    <p className={styles.note} role="status">
      Sign-in succeeded, but identity synchronization is unavailable. No tenant access was granted; retry later or contact an administrator.
    </p>
  );
}

export default function Home({ searchParams }: { searchParams: HomeSearchParams }) {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="page-title">
        <p className={styles.eyebrow}>IDENTITY & ACCESS MANAGEMENT</p>
        <h1 id="page-title">IAM Platform</h1>
        <p className={styles.description}>
          Centralize identity, organization membership, and access policy management.
        </p>
        <Suspense fallback={null}>
          <IdentityBootstrapStatus searchParams={searchParams} />
        </Suspense>

        <Suspense fallback={<SessionActionsFallback />}>
          <SessionActions />
        </Suspense>
      </section>
    </main>
  );
}
