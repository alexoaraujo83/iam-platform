import type { PoolClient } from "pg";

export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditEvent {
  readonly tenantId?: string | null;
  readonly actorPrincipalId?: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly outcome: AuditOutcome;
  readonly correlationId: string;
  readonly requestId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const SAFE_ACTION = /^[a-z][a-z0-9_.:-]{1,159}$/;
const SAFE_TARGET = /^[a-z][a-z0-9_.:-]{0,119}$/;

/**
 * Append an audit record using the caller's transaction.
 * Call within the transaction that performs the audited state change when
 * atomicity is required. Never pass credentials, tokens, headers or secrets
 * in metadata. Tenant-scoped calls must already have set app.tenant_id locally.
 */
export async function appendAuditEvent(client: Pick<PoolClient, "query">, event: AuditEvent): Promise<string> {
  if (!event || !SAFE_ACTION.test(event.action) || !SAFE_TARGET.test(event.targetType)) {
    throw new Error("invalid_audit_event");
  }
  if (!event.correlationId?.trim() || event.correlationId.length > 200) {
    throw new Error("invalid_audit_correlation_id");
  }
  const metadata = event.metadata ?? {};
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") {
    throw new Error("invalid_audit_metadata");
  }

  // JSON serialization also rejects cyclic values and BigInt; fail closed.
  let encodedMetadata: string;
  try {
    encodedMetadata = JSON.stringify(metadata);
  } catch {
    throw new Error("invalid_audit_metadata");
  }
  if (encodedMetadata.length > 16_384) throw new Error("audit_metadata_too_large");

  const result = await client.query<{ id: string }>(
    `INSERT INTO audit_events
       (tenant_id, actor_principal_id, action, target_type, target_id, outcome,
        correlation_id, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING id`,
    [
      event.tenantId ?? null,
      event.actorPrincipalId ?? null,
      event.action,
      event.targetType,
      event.targetId ?? null,
      event.outcome,
      event.correlationId,
      event.requestId ?? null,
      encodedMetadata
    ]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("audit_event_insert_failed");
  return id;
}
