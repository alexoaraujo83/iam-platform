/**
 * Extract a single Bearer access token from an HTTP Authorization header.
 * Reject duplicate/malformed values rather than guessing which credential to use.
 */
export function extractBearerToken(
  authorization: string | readonly string[] | undefined
): string | null {
  if (typeof authorization !== "string" || /[\r\n]/.test(authorization)) return null;

  // RFC 6750 Bearer credentials use one non-whitespace token value.
  const match = /^Bearer[ \t]+([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization);
  if (!match?.[1]) return null;
  return match[1];
}
