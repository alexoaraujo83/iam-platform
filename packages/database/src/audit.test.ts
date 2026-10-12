import { describe, expect, it, vi } from "vitest";
import { appendAuditEvent } from "./audit.js";

describe("appendAuditEvent", () => {
  it("inserts a bounded, redacted-by-contract JSON event and returns its durable id", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "audit-1" }] }));
    const id = await appendAuditEvent({ query } as never, {
      tenantId: "tenant-1",
      actorPrincipalId: "principal-1",
      action: "identity.login",
      targetType: "principal",
      targetId: "principal-1",
      outcome: "success",
      correlationId: "corr-1",
      requestId: "req-1",
      metadata: { provider: "test", method: "oidc" }
    });
    expect(id).toBe("audit-1");
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO audit_events");
    expect(query.mock.calls[0]?.[1]?.[8]).toBe(JSON.stringify({ provider: "test", method: "oidc" }));
  });

  it("rejects malformed actions and oversized metadata before writing", async () => {
    const query = vi.fn();
    await expect(appendAuditEvent({ query } as never, {
      action: "Bearer eyJ.secret",
      targetType: "principal",
      outcome: "failure",
      correlationId: "corr"
    })).rejects.toThrow("invalid_audit_event");
    await expect(appendAuditEvent({ query } as never, {
      action: "identity.login",
      targetType: "principal",
      outcome: "failure",
      correlationId: "corr",
      metadata: { details: "x".repeat(17_000) }
    })).rejects.toThrow("audit_metadata_too_large");
    expect(query).not.toHaveBeenCalled();
  });

  it("fails when persistence fails instead of silently dropping audit events", async () => {
    const query = vi.fn(async () => { throw new Error("database unavailable"); });
    await expect(appendAuditEvent({ query } as never, {
      action: "identity.login",
      targetType: "principal",
      outcome: "failure",
      correlationId: "corr"
    })).rejects.toThrow("database unavailable");
  });
});
