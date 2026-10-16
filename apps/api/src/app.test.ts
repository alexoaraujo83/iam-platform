import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createApiServer, type CheckReadiness, type ResolveTenantContext, type TenantContextResponse } from "./app.js";

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
  checkReadiness?: CheckReadiness
): Promise<Response> {
  const server = createApiServer(resolver, checkReadiness);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`, headers ? { headers } : {});
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    )
  ));
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

  it("reports ready only after the readiness dependency check succeeds", async () => {
    const resolver = vi.fn<ResolveTenantContext>();
    const checkReadiness = vi.fn<CheckReadiness>().mockResolvedValue(undefined);
    const response = await requestApi(resolver, "/health/ready", undefined, checkReadiness);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(checkReadiness).toHaveBeenCalledOnce();
    expect(resolver).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a sanitized 503 when the readiness dependency check fails", async () => {
    const checkReadiness = vi.fn<CheckReadiness>().mockRejectedValue(new Error("database password leaked"));
    const response = await requestApi(async () => null, "/health/ready", undefined, checkReadiness);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready", reason: "dependency_unavailable" });
    expect(checkReadiness).toHaveBeenCalledOnce();
    expect(await response.text()).not.toContain("password");
  });

  it("fails closed when the readiness check is not configured", async () => {
    const response = await requestApi(async () => null, "/health/ready");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready", reason: "readiness_check_unconfigured" });
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

  it("returns 404 for unknown routes", async () => {
    const response = await requestApi(async () => context, "/unknown");
    expect(response.status).toBe(404);
  });
});
