import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createApiServer, type ResolveTenantContext, type TenantContextResponse } from "./app.js";

const context: TenantContextResponse = {
  tenantId: "tenant-1",
  principalId: "principal-1",
  membershipId: "membership-1",
  permissions: [{ resource: "iam", action: "context.read" }]
};
const servers: ReturnType<typeof createApiServer>[] = [];

async function requestApi(
  resolver: ResolveTenantContext,
  path: string,
  headers?: Record<string, string>
): Promise<Response> {
  const server = createApiServer(resolver);
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
    const response = await requestApi(resolver, "/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["basic scheme", "Basic abc"],
    ["empty token", "Bearer "],
    ["multiple credentials", "Bearer a,b"]
  ])("rejects %s bearer credentials", async (_caseName, authorization) => {
    const resolver = vi.fn<ResolveTenantContext>();
    const headers = authorization === undefined ? {} : { authorization };
    const response = await requestApi(resolver, "/v1/tenants/tenant-1/context", headers);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_or_missing_bearer_token" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("returns context only when the resolver authorizes the tenant", async () => {
    const resolver = vi.fn<ResolveTenantContext>().mockResolvedValue(context);
    const response = await requestApi(resolver, "/v1/tenants/tenant-1/context", {
      authorization: "Bearer valid-token"
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(context);
    expect(resolver).toHaveBeenCalledWith("valid-token", "tenant-1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("denies a tenant without active membership", async () => {
    const response = await requestApi(async () => null, "/v1/tenants/tenant-2/context", {
      authorization: "Bearer valid-token"
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "active_membership_required" });
  });

  it("maps explicit permission denial to 403", async () => {
    const response = await requestApi(async () => { throw new Error("authorization_denied"); },
      "/v1/tenants/tenant-1/context", { authorization: "Bearer valid-token" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "permission_denied" });
  });

  it("maps invalid tokens to 401 without leaking verifier details", async () => {
    const response = await requestApi(async () => { throw new Error("invalid_access_token:secret-detail"); },
      "/v1/tenants/tenant-1/context", { authorization: "Bearer invalid-token" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_access_token" });
  });

  it("returns a sanitized 500 for unexpected resolver failures", async () => {
    const response = await requestApi(async () => { throw new Error("database password leaked"); },
      "/v1/tenants/tenant-1/context", { authorization: "Bearer valid-token" });
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

  it("returns 404 for unknown routes", async () => {
    const response = await requestApi(async () => context, "/unknown");
    expect(response.status).toBe(404);
  });
});
