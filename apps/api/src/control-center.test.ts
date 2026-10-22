import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createApiServer, type RecordPreAuthSecurityEvent, type ResolveTenantContext } from "./app.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const context = {
  tenantId,
  principalId: "principal-1",
  membershipId: "membership-1",
  membershipStatus: "active",
  permissions: [{ resource: "iam", action: "control_center.read" }]
};
const servers: ReturnType<typeof createApiServer>[] = [];
const recordSecurityEvent: RecordPreAuthSecurityEvent = async () => undefined;

async function requestControlCenter(resolver: ResolveTenantContext, authorization?: string): Promise<Response> {
  const server = createApiServer(resolver, async () => true, recordSecurityEvent);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const headers = authorization ? { authorization } : {};
  return fetch(`http://127.0.0.1:${address.port}/v1/tenants/${tenantId}/control-center`, { headers });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    )
  ));
});

describe("Control Center API authorization", () => {
  it("requires a bearer token before invoking the tenant resolver", async () => {
    const resolver = vi.fn<ResolveTenantContext>();
    const response = await requestControlCenter(resolver);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_or_missing_bearer_token" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("requires the explicit iam.control_center.read permission", async () => {
    const resolver = vi.fn<ResolveTenantContext>().mockResolvedValue(context);
    const response = await requestControlCenter(resolver, "Bearer valid-token");
    expect(response.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith("valid-token", tenantId, {
      resource: "iam",
      action: "control_center.read"
    });
  });

  it("returns a sanitized 403 when the permission is denied", async () => {
    const resolver = vi.fn<ResolveTenantContext>().mockRejectedValue(new Error("authorization_denied"));
    const response = await requestControlCenter(resolver, "Bearer valid-token");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "permission_denied" });
  });
});
