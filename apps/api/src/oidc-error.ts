const INVALID_TOKEN_CODES = new Set([
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWT_EXPIRED",
  "ERR_JWT_INVALID",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JWKS_NO_MATCHING_KEY",
  "invalid_token",
  "token_issued_in_future",
  "invalid_verified_identity_claims"
]);

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.message.split(":", 1)[0] : undefined;
}

/** Normalize verifier failures without turning upstream outages into client auth failures. */
export function normalizeOidcVerificationError(error: unknown): Error {
  const code = errorCode(error);

  if (code && INVALID_TOKEN_CODES.has(code)) {
    return new Error("invalid_access_token");
  }
  if (error instanceof TypeError || code?.startsWith("ERR_JWKS_")) {
    return new Error("identity_provider_unavailable");
  }
  if (error instanceof Error) return error;
  return new Error("oidc_verification_failed");
}
