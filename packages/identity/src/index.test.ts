import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { IdentityProviderConfig } from "@iam-platform/contracts";
import { createOidcVerifier } from "./index.js";

const config: IdentityProviderConfig = {
  issuer: "https://issuer.example.test/",
  audience: "urn:iam-platform:test-api",
  jwksUri: "https://issuer.example.test/.well-known/jwks.json",
  allowedAlgorithms: ["RS256"]
};

async function makeFixture() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const now = Math.floor(Date.now() / 1000);

  async function token(overrides: {
    issuer?: string;
    audience?: string;
    subject?: string;
    expiresAt?: number;
    notBefore?: number;
    algorithm?: string;
    includeIssuedAt?: boolean;
  } = {}) {
    const builder = new SignJWT({}).setProtectedHeader({
      alg: overrides.algorithm ?? "RS256",
      kid: "test-key"
    });

    builder.setIssuer(overrides.issuer ?? config.issuer);
    builder.setAudience(overrides.audience ?? config.audience);
    builder.setSubject(overrides.subject !== undefined ? overrides.subject : "external-user-123");
    if (overrides.includeIssuedAt !== false) builder.setIssuedAt(now);
    if (overrides.notBefore !== undefined) builder.setNotBefore(overrides.notBefore);
    builder.setExpirationTime(overrides.expiresAt ?? now + 120);
    return builder.sign(privateKey);
  }

  return { keySet, token, now };
}

describe("OIDC verifier", () => {
  it("returns only normalized identity data after cryptographic verification", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier(config, fixture.keySet);
    const identity = await verifier(await fixture.token());

    expect(identity).toEqual({
      issuer: config.issuer,
      subject: "external-user-123",
      audience: config.audience,
      issuedAt: fixture.now,
      expiresAt: fixture.now + 120
    });
    expect(identity).not.toHaveProperty("tenantId");
    expect(identity).not.toHaveProperty("roles");
  });

  it("rejects a token with a tampered signature", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier(config, fixture.keySet);
    const signed = await fixture.token();
    const [header, payload, signature] = signed.split(".");
    const changedPayload = payload!.slice(0, -1) + (payload!.endsWith("A") ? "B" : "A");
    await expect(verifier(`${header}.${changedPayload}.${signature}`)).rejects.toThrow();
  });

  it("rejects a token with the wrong issuer", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier(config, fixture.keySet);
    await expect(verifier(await fixture.token({ issuer: "https://attacker.example/" }))).rejects.toThrow();
  });

  it("rejects a token with the wrong audience", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier(config, fixture.keySet);
    await expect(verifier(await fixture.token({ audience: "urn:other-api" }))).rejects.toThrow();
  });

  it("rejects expired tokens", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier(config, fixture.keySet);
    await expect(verifier(await fixture.token({ expiresAt: fixture.now - 10 }))).rejects.toThrow();
  });

  it("rejects tokens before their not-before time", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier(config, fixture.keySet);
    await expect(
      verifier(await fixture.token({ notBefore: fixture.now + 120, expiresAt: fixture.now + 300 }))
    ).rejects.toThrow();
  });

  it("rejects missing required issued-at claims", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier(config, fixture.keySet);
    await expect(verifier(await fixture.token({ includeIssuedAt: false }))).rejects.toThrow();
  });

  it("rejects an empty subject after token verification", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier(config, fixture.keySet);
    await expect(verifier(await fixture.token({ subject: "" }))).rejects.toThrow("invalid_verified_identity_claims");
  });

  it("rejects empty tokens before verification", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier(config, fixture.keySet);
    await expect(verifier(" ")).rejects.toThrow("invalid_token");
  });

  it("rejects non-HTTPS issuer and JWKS configuration", () => {
    expect(() => createOidcVerifier({ ...config, issuer: "http://issuer.example.test/" })).toThrow(
      "invalid_oidc_issuer"
    );
    expect(() => createOidcVerifier({ ...config, jwksUri: "http://issuer.example.test/keys" })).toThrow(
      "invalid_oidc_jwks_uri"
    );
  });

  it("rejects none, symmetric and unknown algorithms in configuration", () => {
    for (const algorithm of ["none", "HS256", "RS512"]) {
      expect(() => createOidcVerifier({ ...config, allowedAlgorithms: [algorithm] })).toThrow(
        "unsupported_oidc_algorithm"
      );
    }
  });

  it("rejects an algorithm not in the configured allowlist", async () => {
    const fixture = await makeFixture();
    const verifier = createOidcVerifier({ ...config, allowedAlgorithms: ["PS256"] }, fixture.keySet);
    await expect(verifier(await fixture.token())).rejects.toThrow();
  });
});
