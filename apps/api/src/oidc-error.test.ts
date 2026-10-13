import { describe, expect, it } from "vitest";
import { normalizeOidcVerificationError } from "./oidc-error.js";

describe("OIDC verifier error classification", () => {
  it.each([
    ["ERR_JWT_EXPIRED", "invalid_access_token"],
    ["ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "invalid_access_token"],
    ["ERR_JWKS_NO_MATCHING_KEY", "invalid_access_token"],
    ["token_issued_in_future", "invalid_access_token"]
  ])("normalizes credential failure %s", (code, expected) => {
    const error = Object.assign(new Error(code), { code });
    expect(normalizeOidcVerificationError(error).message).toBe(expected);
  });

  it.each([
    ["ERR_JWKS_TIMEOUT", "identity_provider_unavailable"],
    ["ERR_JWKS_INVALID", "identity_provider_unavailable"]
  ])("classifies remote JWKS failure %s as an outage", (code, expected) => {
    const error = Object.assign(new Error("remote key service failed"), { code });
    expect(normalizeOidcVerificationError(error).message).toBe(expected);
  });

  it("classifies network TypeErrors as provider outages", () => {
    expect(normalizeOidcVerificationError(new TypeError("fetch failed")).message)
      .toBe("identity_provider_unavailable");
  });

  it("preserves unexpected Error instances for sanitized 500 handling", () => {
    const original = new Error("unexpected verifier defect");
    expect(normalizeOidcVerificationError(original)).toBe(original);
  });

  it("does not expose non-Error thrown values", () => {
    expect(normalizeOidcVerificationError("secret upstream response").message)
      .toBe("oidc_verification_failed");
  });
});
