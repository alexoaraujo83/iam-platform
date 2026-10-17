"use client";

import { useState } from "react";
import styles from "../page.module.css";

type DiagnosticResult = {
  ok: boolean;
  apiStatus?: number;
  outcome: string;
  code?: string;
  detail?: string;
  tenantId?: string | null;
  principalId?: string | null;
  membershipId?: string | null;
  permissionGranted?: boolean;
  permissions?: { resource: string; action: string }[];
};

export default function AuthorizationProbe() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);

  async function runProbe() {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const data = (await response.json()) as DiagnosticResult;
      setResult(data);
    } catch {
      setResult({ ok: false, outcome: "request_failed", code: "diagnostics_request_failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.probe} aria-labelledby="probe-title">
      <h2 id="probe-title">API authorization test</h2>
      <p className={styles.note}>
        Runs a server-side request using the current session's access token. The token is never
        sent to the browser or displayed. The API checks tenant membership and the
        <code> iam.control_center.read</code> permission.
      </p>
      <button className={styles.button} type="button" onClick={runProbe} disabled={loading}>
        {loading ? "Testing API…" : "Run authorization test"}
      </button>
      {result && (
        <div className={styles.result} role="status" aria-live="polite">
          <strong>{result.ok ? "Authorization passed" : "Authorization not confirmed"}</strong>
          <dl className={styles.fields}>
            <div className={styles.field}><dt>Outcome</dt><dd>{result.outcome}</dd></div>
            {result.apiStatus !== undefined && <div className={styles.field}><dt>API HTTP status</dt><dd>{result.apiStatus}</dd></div>}
            {result.code && <div className={styles.field}><dt>Result code</dt><dd>{result.code}</dd></div>}
            {result.detail && <div className={styles.field}><dt>Next step</dt><dd>{result.detail}</dd></div>}
            {result.tenantId && <div className={styles.field}><dt>Tenant ID</dt><dd>{result.tenantId}</dd></div>}
            {result.principalId && <div className={styles.field}><dt>Principal ID</dt><dd>{result.principalId}</dd></div>}
            {result.membershipId && <div className={styles.field}><dt>Membership ID</dt><dd>{result.membershipId}</dd></div>}
            {result.permissionGranted !== undefined && <div className={styles.field}><dt>iam.control_center.read</dt><dd>{result.permissionGranted ? "Granted" : "Not granted"}</dd></div>}
          </dl>
          {result.permissions && result.permissions.length > 0 && (
            <div>
              <h3>Permissions returned by API</h3>
              <ul className={styles.permissionList}>
                {result.permissions.map((permission) => (
                  <li key={permission.resource + ":" + permission.action}>
                    {permission.resource}.{permission.action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
