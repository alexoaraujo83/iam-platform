import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { resolveActiveMembership } from "./membership-resolution.js";

function clientWithResults(results: Array<{ rows: unknown[] }>) {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => {
    const result = results.shift();
    if (!result) throw new Error("unexpected_query");
    return result;
  });
  return { client: { query } as unknown as Pick<PoolClient, "query">, query };
}

describe("resolveActiveMembership", () => {
  it("sets transaction-local tenant context and returns DB-backed permissions", async () => {
    const { client, query } = clientWithResults([
      { rows: [] },
      { rows: [{ tenant_id: "tenant-a", principal_id: "principal-a", membership_id: "membership-a" }] },
      { rows: [{ permission_key: "freight.read" }, { permission_key: "iam:manage" }] }
    ]);

    const result = await resolveActiveMembership(
      client,
      { issuer: "https://issuer.example.test/", subject: "subject-123" },
      "tenant-a"
    );

    expect(query.mock.calls[0]?.[0]).toContain("set_config('app.tenant_id', $1, true)");
    expect(query.mock.calls[0]?.[1]).toEqual(["tenant-a"]);
    expect(query.mock.calls[1]?.[1]).toEqual(["https://issuer.example.test/", "subject-123", "tenant-a"]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      principalId: "principal-a",
      membershipId: "membership-a",
      permissions: [
        { resource: "freight", action: "read" },
        { resource: "iam", action: "manage" }
      ]
    });
  });

  it("fails closed when no active membership exists", async () => {
    const { client, query } = clientWithResults([{ rows: [] }, { rows: [] }]);

    const result = await resolveActiveMembership(
      client,
      { issuer: "https://issuer.example.test/", subject: "unknown-subject" },
      "tenant-a"
    );

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects empty identity and tenant inputs before querying", async () => {
    const { client, query } = clientWithResults([]);

    await expect(
      resolveActiveMembership(client, { issuer: " ", subject: "subject" }, "tenant-a")
    ).resolves.toBeNull();
    await expect(
      resolveActiveMembership(client, { issuer: "https://issuer.example.test/", subject: "subject" }, "")
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects malformed permission keys rather than granting ambiguous permissions", async () => {
    const { client } = clientWithResults([
      { rows: [] },
      { rows: [{ tenant_id: "tenant-a", principal_id: "principal-a", membership_id: "membership-a" }] },
      { rows: [{ permission_key: "malformed" }] }
    ]);

    await expect(
      resolveActiveMembership(
        client,
        { issuer: "https://issuer.example.test/", subject: "subject-123" },
        "tenant-a"
      )
    ).rejects.toThrow("invalid_permission_key_format");
  });
});
