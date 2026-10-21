import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { provisionExternalIdentity } from "./provision-external-identity.js";

describe("provisionExternalIdentity", () => {
  it("calls only the narrow database function with issuer and subject", async () => {
    const query = vi.fn(async () => ({ rows: [{ principal_id: "principal-123" }] }));
    const result = await provisionExternalIdentity(
      { query } as unknown as Pick<Pool, "query">,
      { issuer: "https://issuer.example.test/", subject: "auth0|subject-123" }
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toBe(
      "SELECT public.provision_external_identity($1, $2) AS principal_id"
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      "https://issuer.example.test/",
      "auth0|subject-123"
    ]);
    expect(result).toEqual({ principalId: "principal-123" });
  });

  it.each([
    [{ issuer: "", subject: "subject" }],
    [{ issuer: "https://issuer.example.test/", subject: " " }],
    [{ issuer: " ", subject: "subject" }]
  ])("rejects invalid identity inputs before touching the database", async (identity) => {
    const query = vi.fn();
    await expect(
      provisionExternalIdentity(
        { query } as unknown as Pick<Pool, "query">,
        identity
      )
    ).rejects.toThrow("invalid_verified_identity");
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed if the database function returns no principal ID", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await expect(
      provisionExternalIdentity(
        { query } as unknown as Pick<Pool, "query">,
        { issuer: "https://issuer.example.test/", subject: "subject-123" }
      )
    ).rejects.toThrow("identity_provisioning_failed");
  });

  it("propagates database errors without converting them into success", async () => {
    const query = vi.fn(async () => {
      throw new Error("database_unavailable");
    });
    await expect(
      provisionExternalIdentity(
        { query } as unknown as Pick<Pool, "query">,
        { issuer: "https://issuer.example.test/", subject: "subject-123" }
      )
    ).rejects.toThrow("database_unavailable");
  });
});
