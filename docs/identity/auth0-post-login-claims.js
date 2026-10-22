/**
 * IAM Platform — Auth0 Post Login Action
 *
 * Emits informational Auth0 role claims for downstream diagnostics/UI only.
 * Tenant membership and application permissions remain authoritative in IAM's
 * PostgreSQL-backed authorization layer; never authorize tenant access from
 * these claims alone.
 *
 * Required Auth0 Action secret:
 *   IAM_CLAIMS_NAMESPACE=https://<domain-you-control>/claims
 */
function getClaimsNamespace(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    const reservedHosts = new Set([
      "example.com",
      "example.net",
      "example.org",
      "example.edu",
    ]);

    if (
      url.protocol !== "https:" ||
      !hostname ||
      reservedHosts.has(hostname) ||
      hostname.endsWith(".example.com") ||
      hostname.endsWith(".example.net") ||
      hostname.endsWith(".example.org") ||
      hostname.endsWith(".example.edu") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.replace(/\/+$/, "").endsWith("/claims")
    ) {
      return null;
    }

    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

exports.onExecutePostLogin = async (event, api) => {
  const namespace = getClaimsNamespace(event.secrets?.IAM_CLAIMS_NAMESPACE);

  // Fail safely without breaking sign-in if optional diagnostic claims are not configured.
  if (!namespace) {
    console.warn(
      "IAM Post Login Claims skipped: IAM_CLAIMS_NAMESPACE must be a valid HTTPS /claims namespace on a domain you control."
    );
    return;
  }

  const roles = Array.isArray(event.authorization?.roles)
    ? event.authorization.roles.filter(
        (role) => typeof role === "string" && role.length > 0
      )
    : [];

  api.accessToken.setCustomClaim(`${namespace}/auth0_roles`, roles);
};
