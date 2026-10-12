import { describe, expect, it } from "vitest";
import type { IdentityProviderConfig, TenantContext } from "./index.js";

describe("provider-independent contracts", () => {
  it("models OIDC configuration without provider-specific claim names", () => {
    const config: IdentityProviderConfig = {
      issuer: "https://identity.example.test/",
      audience: "urn:example:api",
      jwksUri: "https://identity.example.test/.well-known/jwks.json",
      allowedAlgorithms: ["RS256"]
    };
    expect(config.allowedAlgorithms).toEqual(["RS256"]);
  });
  it("requires explicit tenant, principal and membership context", () => {
    const tenant: TenantContext = { tenantId: "tenant-1", principalId: "principal-1", membershipId: "membership-1" };
    expect(Object.keys(tenant).sort()).toEqual(["membershipId", "principalId", "tenantId"]);
  });
});
