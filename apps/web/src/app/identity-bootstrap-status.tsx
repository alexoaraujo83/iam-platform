"use client";

import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";

export default function IdentityBootstrapStatus() {
  const params = useSearchParams();
  const bootstrapUnavailable = params.get("identity_bootstrap") === "unavailable";
  const callbackFailed = params.get("auth_callback") === "failed";

  if (!bootstrapUnavailable && !callbackFailed) return null;

  return (
    <>
      {bootstrapUnavailable && (
        <p className={styles.note} role="status">
          Sign-in succeeded, but identity synchronization is unavailable. No tenant access was granted; retry later or contact an administrator.
        </p>
      )}
      {callbackFailed && (
        <p className={styles.note} role="alert">
          Authentication could not be completed. Please try signing in again.
        </p>
      )}
    </>
  );
}
