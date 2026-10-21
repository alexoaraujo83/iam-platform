import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createApiServer, createPreAuthAuditLimiter, type CheckReadiness, type ProvisionIdentity, type RecordPreAuthSecurityEvent, type ResolveTenantContext, type TenantContextResponse } from "./app.js";

const context: TenantContextResponse = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  principalId: "principal-1",
  membershipId: "membership-1",
  permissions: [{ resource: "iam", action: "context.read" }]
};
const servers: ReturnType<typeof createApiServer>[] = [];

async function requestApi(
  resolver: ResolveTenantContext,
  path: string,
  headers?: Record<string, string>,
  checkReadiness: CheckReadiness = async () => true,
  recordSecurityEvent: RecordPreAuthSecurityEvent = async () => undefined,
  provisionIdentity?: ProvisionIdentity,
  method = "GET"
): Promise<Response> {
  const server = createApiServer(
    resolver,
    checkReadiness,
    recordSecurityEvent,
    provisionIdentity ? { provisionIdentity } : {}
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`, { ...(headers ? { headers } : {}), method });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    )
  ));
});

describe("pre-auth audit limiter", () => {
  it("enforces a hard entry cap without evicting active peer windows", () => {
    const shouldRecord = createPreAuthAuditLimiter(2, 60_000, 10);

    expect(shouldRecord("peer-a", 1_000)).toBe(true);
    expect(shouldRecord("peer-b", 1_000)).toBe(true);
    expect(shouldRecord("peer-c", 1_000)).toBe(false);
    // Existing active peers retain their windows while the map is saturated.
    expect(shouldRecord("peer-a", 1_100)).toBe(true);
    expect(shouldRecord("peer-b", 1_100)).toBe(true);
    expect(shouldRecord("peer-c", 1_100)).toBe(false);
    // Once windows expire, stale entries are pruned and a new peer can proceed.
    expect(shouldRecord("peer-c", 61_000)).toBe(true);
  });

  it("limits each peer to the configured number of events per window", () => {
    const shouldRecord = createPreAuthAuditLimiter(4, 60_000, 2);

    expect(shouldRecord("peer-a", 1_000)).toBe(true);
    expect(shouldRecord("peer-a", 1_001)).toBe(true);
    expect(shouldRecord("peer-a", 1_002)).toBe(false);
    expect(shouldRecord("peer-a", 61_000)).toBe(true);
  });

  it("throttles suppression notifications and omits peer identifiers", () => {
    const onSuppressed = vi.fn();
    const shouldRecord = createPreAuthAuditLimiter(1, 60_000, 1, onSuppressed);

    expect(shouldRecord("sensitive-peer-a", 1_000)).toBe(true);
    expect(shouldRecord("sensitive-peer-b", 1_001)).toBe(false);
    expect(shouldRecord("sensitive-peer-c", 1_002)).toBe(false);
    expect(onSuppressed).toHaveBeenCalledOnce();
    expect(onSuppressed).toHaveBeenCalledWith("entry_cap");

    // The warning is throttled even when additional unique peers are suppressed.
    expect(shouldRecord("sensitive-peer-d", 61_000)).toBe(true);
    expect(onSuppressed).toHaveBeenCalledOnce();
  });

  it("throttles per-peer rate-limit notifications", () => {
    const onSuppressed = vi.fn();
    const shouldRecord = createPreAuthAuditLimiter(4, 60_000, 1, onSuppressed);

    expect(shouldRecord("peer-a", 1_000)).toBe(true);
    expect(shouldRecord("peer-a", 1_001)).toBe(false);
    expect(shouldRecord("peer-a", 1_002)).toBe(false);
    expect(onSuppressed).toHaveBeenCalledOnce();
    expect(onSuppressed).toHaveBeenCalledWith("peer_limit");
  });

  it("rejects invalid limiter bounds", () => {
    expect(() => createPreAuthAuditLimiter(0)).toThrow("invalid_audit_limiter_max_entries");
    expect(() => createPreAuthAuditLimiter(1, 0)).toThrow("invalid_audit_limiter_window_ms");
    expect(() => createPreAuthAuditLimiter(1, 1, 0)).toThrow("invalid_audit_limiter_per_window_limit");
  });
});

describe("IAM HTTP API", () => {
  it("serves health without touching identity or the database", async () => {
    const resolver = vi.fn<ResolveTenantContext>();
    const checkReadiness = vi.fn<CheckReadiness>();
    const response = await requestApi(resolver, "/health", undefined, checkReadiness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(resolver).not.toHaveBeenCalled();
    expect(checkReadiness).not.toHaveBeenCalled();
  });

  it("preserves a safe correlation ID and returns API version metadata", async () => {
    const response = await requestApi(
      vi.fn<ResolveTenantContext>(),
      "/health",
      { "x-correlation-id": "diagnostic-correlation-123" }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("diagnostic-correlation-123");
    expect(response.headers.get("x-iam-api-version")).toBeTruthy();
  });

  it("reports readiness only when the dependency check succeeds", async () => {
    const checkReadiness = vi.fn<CheckReadiness>().mockResolvedValue(true);
    const response = await requestApi(vi.fn<ResolveTenantContext>(), "/health/ready", undefined, checkReadiness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(checkReadiness).toHaveBeenCalledOnce();
  });

  it("returns sanitized 503 when a required dependency is not ready", async () => {
    const checkReadiness = vi.fn<CheckReadiness>().mockResolvedValue(false);
    const response = await requestApi(vi.fn<ResolveTenantContext>(), "/health/ready", undefined, checkReadiness);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
  });

  it("returns sanitized 503 when the readiness check throws", async () => {
    const checkReadiness = vi.fn<CheckReadiness>().mockRejectedValue(new Error("database credentials leaked"));
    const response = await requestApi(vi.fn<ResolveTenantContext>(), "/health/ready", undefined, checkReadiness);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
  });

  it.each([
    ["missing", undefined],
    ["basic scheme", "Basic abc"],
    ["empty token", "Bearer "],
    ["multiple credentials", "Bearer a,b"]
  ])("rejects %s bearer credentials", async (_caseName, authorization) => {
    const resolver = vi.fn<ResolveTenantContext>();
    const headers = authorization === undefined ? {} : { authorization };
    const response = await requestApi(resolver, "/v1/tenants/11111111-1111-4111-8111-111111111111/context", headers);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_or_missing_bearer_token" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("records a sanitized pre-auth event for missing bearer credentials", async () => {
    const recordSecurityEvent = vi.fn<RecordPreAuthSecurityEvent>().mockResolvedValue(undefined);
    const response = await requestApi(
      vi.fn<ResolveTenantContext>(),
      "/v1/tenants/11111111-1111-4111-8111-111111111111/context",
      {},
      async () => true,
      recordSecurityEvent
    );
    expect(response.status).toBe(401);
    expect(recordSecurityEvent).toHaveBeenCalledOnce();
    expect(recordSecurityEvent.mock.calls[0]?.[0]).toMatchObject({
      action: "security.authn_failed",
      outcome: "failure",
      metadata: { reason: "missing_or_invalid_bearer" }
    });
    expect(JSON.stringify(recordSecurityEvent.mock.calls[0]?.[0])).not.toContain("authorization");
  });

  it("fails closed with sanitized 503 when pre-auth audit persistence fails", async () => {
    const recordSecurityEvent = vi.fn<RecordPreAuthSecurityEvent>().mockRejectedValue(new Error("database secret"));
    const response = await requestApi(
      vi.fn<ResolveTenantContext>(),
      "/v1/tenants/11111111-1111-4111-8111-111111111111/context",
      {},
      async () => true,
      recordSecurityEvent
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "security_audit_unavailable" });
    expect(JSON.stringify(body)).not.toContain("database secret");
  });

  it("records invalid token failures without storing the token", async () => {
    const recordSecurityEvent = vi.fn<RecordPreAuthSecurityEvent>().mockResolvedValue(undefined);
    const response = await requestApi(
      async () => { throw new Error("invalid_access_token:provider detail"); },
      "/v1/tenants/11111111-1111-4111-8111-111111111111/context",
      { authorization: "Bearer do-not-store-this-token" },
      async () => true,
      recordSecurityEvent
    );
    expect(response.status).toBe(401);
    expect(recordSecurityEvent).toHaveBeenCalledOnce();
    expect(JSON.stringify(recordSecurityEvent.mock.calls[0]?.[0])).not.toContain("do-not-store-this-token");
    expect(recordSecurityEvent.mock.calls[0]?.[0]).toMatchObject({
      action: "security.authn_failed",
      metadata: { reason: "invalid_access_token" }
    });
  });

  it("bounds pre-auth audit writes to ten events per peer per minute", async () => {
    const recordSecurityEvent = vi.fn<RecordPreAuthSecurityEvent>().mockResolvedValue(undefined);
    const server = createApiServer(vi.fn<ResolveTenantContext>(), async () => true, recordSecurityEvent);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      fetch(`http://127.0.0.1:${address.port}/v1/tenants/11111111-1111-4111-8111-111111111111/context`, {
        headers: { "x-forwarded-for": `198.51.100.${index + 1}` }
      })
    ));
    expect(responses.every((response) => response.status === 401)).toBe(true);
    expect(recordSecurityEvent).toHaveBeenCalledTimes(10);
  });

  it("returns context only when the resolver authorizes the tenant", async () => {
    const resolver = vi.fn<ResolveTenantContext>().mockResolvedValue(context);
    const response = await requestApi(resolver, "/v1/tenants/11111111-1111-4111-8111-111111111111/context", {
      authorization: "Bearer valid-token"
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(context);
    expect(resolver).toHaveBeenCalledWith("valid-token", "11111111-1111-4111-8111-111111111111");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns only verified identity metadata with authorized tenant context", async () => {
    const verifiedContext: TenantContextResponse = {
      ...context,
      identityEvidence: {
        issuer: "https://issuer.example.test/",
        subject: "external-subject-1",
        audience: "urn:iam-platform:test-api",
        algorithm: "RS256",
        expiresAt: 1_900_000_000
      }
    };
    const response = await requestApi(
      vi.fn<ResolveTenantContext>().mockResolvedValue(verifiedContext),
      "/v1/tenants/11111111-1111-4111-8111-111111111111/context",
      { authorization: "Bearer valid-token" }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(verifiedContext);
    expect(JSON.stringify(verifiedContext)).not.toContain("token");
  });

  it("denies a tenant without active membership", async () => {
    const response = await requestApi(async () => null, "/v1/tenants/22222222-2222-4222-8222-222222222222/context", {
      authorization: "Bearer valid-token"
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "active_membership_required" });
  });

  it("maps explicit permission denial to 403", async () => {
    const response = await requestApi(async () => { throw new Error("authorization_denied"); },
      "/v1/tenants/11111111-1111-4111-8111-111111111111/context", { authorization: "Bearer valid-token" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "permission_denied" });
  });

  it("maps invalid tokens to 401 without leaking verifier details", async () => {
    const response = await requestApi(async () => { throw new Error("invalid_access_token:secret-detail"); },
      "/v1/tenants/11111111-1111-4111-8111-111111111111/context", { authorization: "Bearer invalid-token" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_access_token" });
  });

  it("returns a sanitized 503 when the identity provider is unavailable", async () => {
    const response = await requestApi(async () => { throw new Error("identity_provider_unavailable:upstream-timeout"); },
      "/v1/tenants/11111111-1111-4111-8111-111111111111/context", { authorization: "Bearer valid-token" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "identity_provider_unavailable" });
  });

  it("returns a sanitized 500 for unexpected resolver failures", async () => {
    const response = await requestApi(async () => { throw new Error("database password leaked"); },
      "/v1/tenants/11111111-1111-4111-8111-111111111111/context", { authorization: "Bearer valid-token" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_server_error" });
  });

  it("returns 400 for malformed percent encoding in tenant IDs", async () => {
    const resolver = vi.fn<ResolveTenantContext>();
    const response = await requestApi(resolver, "/v1/tenants/%E0%A4%A/context", {
      authorization: "Bearer valid-token"
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_tenant_id" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects non-UUID tenant IDs before calling the resolver", async () => {
    const resolver = vi.fn<ResolveTenantContext>();
    const response = await requestApi(resolver, "/v1/tenants/not-a-uuid/context", {
      authorization: "Bearer valid-token"
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_tenant_id" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("requires the control-center permission on the control-center endpoint", async () => {
    const controlCenterContext: TenantContextResponse = {
      ...context,
      permissions: [{ resource: "iam", action: "control_center.read" }]
    };
    const resolver = vi.fn<ResolveTenantContext>().mockResolvedValue(controlCenterContext);
    const response = await requestApi(
      resolver,
      "/v1/tenants/11111111-1111-4111-8111-111111111111/control-center",
      { authorization: "Bearer valid-token" }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(controlCenterContext);
    expect(resolver).toHaveBeenCalledWith(
      "valid-token",
      "11111111-1111-4111-8111-111111111111",
      { resource: "iam", action: "control_center.read" }
    );
  });

  it("denies control-center access when the required permission is missing", async () => {
    const resolver = vi.fn<ResolveTenantContext>().mockRejectedValue(new Error("authorization_denied"));
    const response = await requestApi(
      resolver,
      "/v1/tenants/11111111-1111-4111-8111-111111111111/control-center",
      { authorization: "Bearer valid-token" }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "permission_denied" });
    expect(resolver).toHaveBeenCalledWith(
      "valid-token",
      "11111111-1111-4111-8111-111111111111",
      { resource: "iam", action: "control_center.read" }
    );
  });

  it("denies control-center access when the tenant has no active membership", async () => {
    const response = await requestApi(
      async () => null,
      "/v1/tenants/22222222-2222-4222-8222-222222222222/control-center",
      { authorization: "Bearer valid-token" }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "active_membership_required" });
  });

  it("provisions a verified identity through the explicit bootstrap endpoint", async () => {
    const provisionIdentity = vi.fn<ProvisionIdentity>().mockResolvedValue(undefined);
    const resolver = vi.fn<ResolveTenantContext>();
    const recordSecurityEvent = vi.fn<RecordPreAuthSecurityEvent>().mockResolvedValue(undefined);
    const response = await requestApi(
      resolver,
      "/v1/identity/bootstrap",
      { authorization: "Bearer verified-access-token" },
      async () => true,
      recordSecurityEvent,
      provisionIdentity,
      "POST"
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "identity_provisioned" });
    expect(provisionIdentity).toHaveBeenCalledTimes(1);
    expect(provisionIdentity).toHaveBeenCalledWith("verified-access-token");
    expect(resolver).not.toHaveBeenCalled();
    expect(recordSecurityEvent).not.toHaveBeenCalled();
  });

  it("denies bootstrap without a bearer token and records a sanitized failure", async () => {
    const provisionIdentity = vi.fn<ProvisionIdentity>();
    const recordSecurityEvent = vi.fn<RecordPreAuthSecurityEvent>().mockResolvedValue(undefined);
    const response = await requestApi(
      vi.fn<ResolveTenantContext>(),
      "/v1/identity/bootstrap",
      {},
      async () => true,
      recordSecurityEvent,
      provisionIdentity,
      "POST"
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_or_missing_bearer_token" });
    expect(provisionIdentity).not.toHaveBeenCalled();
    expect(recordSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "security.authn_failed",
      outcome: "failure",
      metadata: { reason: "missing_or_invalid_bearer" }
    }));
  });

  it("fails closed and audits bootstrap when the provisioner pool is not configured", async () => {
    const recordSecurityEvent = vi.fn<RecordPreAuthSecurityEvent>().mockResolvedValue(undefined);
    const response = await requestApi(
      vi.fn<ResolveTenantContext>(),
      "/v1/identity/bootstrap",
      { authorization: "Bearer verified-access-token" },
      async () => true,
      recordSecurityEvent,
      undefined,
      "POST"
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "identity_provisioning_not_configured" });
    expect(recordSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "identity.provisioning_failed",
      outcome: "failure",
      metadata: { reason: "not_configured" }
    }));
  });

  it("does not leak database details when bootstrap provisioning fails", async () => {
    const provisionIdentity = vi.fn<ProvisionIdentity>().mockRejectedValue(
      new Error("database_unavailable:password-do-not-leak")
    );
    const recordSecurityEvent = vi.fn<RecordPreAuthSecurityEvent>().mockResolvedValue(undefined);
    const response = await requestApi(
      vi.fn<ResolveTenantContext>(),
      "/v1/identity/bootstrap",
      { authorization: "Bearer verified-access-token" },
      async () => true,
      recordSecurityEvent,
      provisionIdentity,
      "POST"
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "identity_provisioning_unavailable" });
    expect(JSON.stringify(body)).not.toContain("password-do-not-leak");
    expect(recordSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "identity.provisioning_failed",
      outcome: "failure",
      metadata: { reason: "database_unavailable" }
    }));
  });

  it("returns 404 for unknown routes", async () => {
    const response = await requestApi(async () => context, "/unknown");
    expect(response.status).toBe(404);
  });
});
