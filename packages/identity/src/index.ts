import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload
} from "jose";
import type { IdentityProviderConfig } from "@iam-platform/contracts";

const SUPPORTED_ASYMMETRIC_ALGORITHMS = new Set(["RS256", "PS256", "ES256"]);

export interface VerifiedExternalIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string | readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly algorithm: string;
}

export type OidcTokenVerifier = (token: string) => Promise<VerifiedExternalIdentity>;

/**
 * Create a verifier for one explicitly trusted OIDC issuer.
 *
 * Configuration must come from trusted server-side settings, never from request
 * parameters or unverified token claims. The returned identity is authentication
 * output only; it does not establish tenant membership or application roles.
 */
export function createOidcVerifier(
  config: IdentityProviderConfig,
  keyResolver?: JWTVerifyGetKey
): OidcTokenVerifier {
  validateConfig(config);

  const jwks = keyResolver ?? createRemoteJWKSet(new URL(config.jwksUri));
  const allowedAlgorithms = [...config.allowedAlgorithms];

  return async (token: string): Promise<VerifiedExternalIdentity> => {
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new Error("invalid_token");
    }

    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      algorithms: allowedAlgorithms,
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ["iss", "sub", "aud", "exp", "iat"]
    });

    if (typeof payload.iat === "number" && payload.iat > Math.floor(Date.now() / 1000) + 60) {
      throw new Error("token_issued_in_future");
    }

    return toVerifiedIdentity(payload, protectedHeader.alg);
  };
}

function validateConfig(config: IdentityProviderConfig): void {
  if (!config.issuer.trim() || !config.audience.trim()) {
    throw new Error("invalid_oidc_configuration");
  }

  assertHttpsUrl(config.issuer, "invalid_oidc_issuer");
  assertHttpsUrl(config.jwksUri, "invalid_oidc_jwks_uri");

  if (
    config.allowedAlgorithms.length === 0 ||
    config.allowedAlgorithms.some((algorithm) => !SUPPORTED_ASYMMETRIC_ALGORITHMS.has(algorithm)) ||
    new Set(config.allowedAlgorithms).size !== config.allowedAlgorithms.length
  ) {
    throw new Error("unsupported_oidc_algorithm");
  }
}

function assertHttpsUrl(value: string, errorCode: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(errorCode);
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(errorCode);
  }
}

function toVerifiedIdentity(payload: JWTPayload, algorithm: string | undefined): VerifiedExternalIdentity {
  if (
    typeof payload.iss !== "string" ||
    typeof payload.sub !== "string" ||
    payload.sub.trim().length === 0 ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    typeof algorithm !== "string" ||
    (typeof payload.aud !== "string" &&
      (!Array.isArray(payload.aud) || !payload.aud.every((item) => typeof item === "string")))
  ) {
    throw new Error("invalid_verified_identity_claims");
  }

  return {
    issuer: payload.iss,
    subject: payload.sub,
    audience: payload.aud,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    algorithm
  };
}

export { extractBearerToken } from "./bearer-token.js";
