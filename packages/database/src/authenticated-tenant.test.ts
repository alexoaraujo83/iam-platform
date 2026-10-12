import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedTenantContext } from "./authenticated-tenant.js";
import { withAuthenticatedTenant } from "./authenticated-tenant.js";

function fakeClient(results: Array<{ rows: unknown[] }> = []) {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    if (sql.includes("SELECT set_config")) return { rows: [] };
    if (sql.includes("SELECT m.tenant_id")) return results.shift() ?? { rows: [] };
    if (sql.includes("SELECT DISTINCT p.permission_key")) return results.shift() ?? { rows: [] };
    return { rows: [] };
  });
  const release = vi.fn();
  return {
    client: { query, release } as unknown as PoolClient,
    query,
    release,
    statements
  };
}

const identity = { issuer: "https://issuer.example.test/", subject: "subject-1" };
const activeMembership = {
  rows: [{ tenant_id: "tenant-a", principal_id: "principal-a", membership_id: "membership-a" }]
};

describe("withAuthenticatedTenant", () => {
  it("verifies first and keeps tenant RLS context in the operation transaction", async () => {
    const { client, query, release, statements } = fakeClient([
      activeMembership,
      { rows: [{ permission_key: "freight.read" }] }
    ]);
    const verify = vi.fn(async (_token: string) => identity);
    const connect = vi.fn(async () => client);
    const operation = vi.fn(async (_client: PoolClient, context: AuthenticatedTenantContext) => {
      expect(context).toEqual({
        tenantId: "tenant-a",
        principalId: "principal-a",
        membershipId: "membership-a",
        permissions: [{ resource: "freight", action: "read" }]
      });
      return "ok";
    });

    const result = await withAuthenticatedTenant(
      { connect } as unknown as Pick<Pool, "connect">,
      verify,
      "signed-access-token",
      "tenant-a",
      operation
    );

    expect(verify).toHaveBeenCalledWith("signed-access-token");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(result).toBe("ok");
    expect(statements[0]).toBe("BEGIN");
    expect(statements).toContain("COMMIT");
    expect(statements).not.toContain("ROLLBACK");
    expect(query.mock.calls.findIndex(([sql]) => sql.includes("set_config"))).toBeGreaterThan(0);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fails closed and never invokes protected work without an active membership", async () => {
    const { client, statements, release } = fakeClient([{ rows: [] }]);
    const operation = vi.fn();
    const result = await withAuthenticatedTenant(
      { connect: async () => client } as unknown as Pick<Pool, "connect">,
      async () => identity,
      "signed-access-token",
      "tenant-a",
      operation
    );

    expect(result).toBeNull();
    expect(operation).not.toHaveBeenCalled();
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when protected work fails", async () => {
    const { client, statements, release } = fakeClient([
      activeMembership,
      { rows: [{ permission_key: "freight.read" }] }
    ]);
    const failure = new Error("operation_failed");

    await expect(
      withAuthenticatedTenant(
        { connect: async () => client } as unknown as Pick<Pool, "connect">,
        async () => identity,
        "signed-access-token",
        "tenant-a",
        async () => { throw failure; }
      )
    ).rejects.toBe(failure);

    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not acquire a database connection when token verification fails", async () => {
    const connect = vi.fn();
    const failure = new Error("invalid_token");

    await expect(
      withAuthenticatedTenant(
        { connect } as unknown as Pick<Pool, "connect">,
        async () => { throw failure; },
        "invalid-token",
        "tenant-a",
        async () => "unreachable"
      )
    ).rejects.toBe(failure);

    expect(connect).not.toHaveBeenCalled();
  });
});
