/**
 * Read-only operational contracts for the IAM Platform Control Center.
 *
 * These contracts describe evidence, not inferred health. Missing, stale, or
 * unavailable signals must remain UNKNOWN/NOT_RUN; they must never be rendered
 * as PASS. Never put credentials, tokens, connection strings, raw claims, or
 * unredacted provider errors into these objects.
 */

import type { ISODateTime, UUID } from "./index.js";

export type ControlCenterEnvironment =
  | "development"
  | "preview"
  | "staging"
  | "production"
  | "unknown";

export type EvidenceStatus = "pass" | "fail" | "not_run" | "unknown";

export type DiagnosticSeverity = "info" | "warning" | "critical";

export interface EvidenceSource {
  /** Stable integration name, e.g. github-actions, vercel, neon-runtime-check. */
  readonly system: string;
  /** Stable source identifier or URL to a non-secret run/deployment record. */
  readonly reference: string | null;
  readonly observedAt: ISODateTime;
}

export interface DiagnosticCheck {
  readonly id: string;
  readonly name: string;
  readonly status: EvidenceStatus;
  readonly severity: DiagnosticSeverity;
  readonly summary: string;
  readonly environment: ControlCenterEnvironment;
  readonly source: EvidenceSource;
  readonly checkedAt: ISODateTime;
  readonly validUntil: ISODateTime | null;
  readonly correlationId: string;
}

export interface DatabaseRuntimeIdentityEvidence {
  readonly roleName: string | null;
  readonly databaseName: string | null;
  readonly branchId: string | null;
  readonly projectId: string | null;
  readonly expectedBranchId: string | null;
  readonly expectedProjectId: string | null;
  readonly verified: boolean;
}

export interface RuntimeSnapshot {
  readonly id: UUID;
  readonly environment: ControlCenterEnvironment;
  readonly capturedAt: ISODateTime;
  readonly commitSha: string | null;
  readonly deploymentId: string | null;
  readonly deploymentUrl: string | null;
  /** Live values read from the same PostgreSQL pool used by the API. */
  readonly databaseIdentity: DatabaseRuntimeIdentityEvidence;
  readonly checks: readonly DiagnosticCheck[];
  readonly overallStatus: EvidenceStatus;
  readonly correlationId: string;
}

export interface TestExecution {
  readonly executionId: UUID;
  readonly testId: string;
  readonly status: EvidenceStatus;
  readonly environment: ControlCenterEnvironment;
  readonly commitSha: string | null;
  readonly deploymentId: string | null;
  readonly startedAt: ISODateTime | null;
  readonly finishedAt: ISODateTime | null;
  readonly actorId: string | null;
  readonly correlationId: string;
  readonly source: EvidenceSource;
  readonly artifactIds: readonly string[];
}

export interface EvidenceArtifact {
  readonly artifactId: string;
  readonly executionId: UUID;
  readonly kind:
    | "test-report"
    | "workflow-run"
    | "deployment"
    | "diagnostic"
    | "security-check"
    | "audit-export";
  readonly status: EvidenceStatus;
  readonly uri: string | null;
  readonly sha256: string | null;
  readonly createdAt: ISODateTime;
  readonly expiresAt: ISODateTime | null;
  readonly redacted: boolean;
}

/**
 * An unavailable integration is represented explicitly. Do not fabricate a
 * healthy result from a successful request to the dashboard itself.
 */
export interface IntegrationSnapshot {
  readonly integrationId: string;
  readonly displayName: string;
  readonly status: "connected" | "degraded" | "disconnected" | "unknown";
  readonly environment: ControlCenterEnvironment;
  readonly checkedAt: ISODateTime;
  readonly source: EvidenceSource | null;
  readonly summary: string;
}
