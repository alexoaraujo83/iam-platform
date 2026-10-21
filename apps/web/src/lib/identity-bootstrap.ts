export type IdentityBootstrapOutcome = "disabled" | "provisioned" | "unavailable";

export interface IdentityBootstrapInput {
  readonly enabled: boolean;
  readonly apiBaseUrl: string | undefined;
  readonly accessToken: string | undefined;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Call the IAM API only from the trusted server-side Auth0 callback.
 * Tokens are never returned to or logged by the browser.
 */
export async function bootstrapIdentityAfterAuth(
  input: IdentityBootstrapInput
): Promise<IdentityBootstrapOutcome> {
  if (!input.enabled) return "disabled";
  if (!input.accessToken?.trim() || !input.apiBaseUrl?.trim()) return "unavailable";

  let baseUrl: URL;
  try {
    baseUrl = new URL(input.apiBaseUrl);
  } catch {
    return "unavailable";
  }

  const isLocalHttp =
    baseUrl.protocol === "http:" &&
    (baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1" || baseUrl.hostname === "[::1]");

  if (
    (baseUrl.protocol !== "https:" && !isLocalHttp) ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    return "unavailable";
  }

  baseUrl.search = "";
  baseUrl.hash = "";

  try {
    const response = await (input.fetchImpl ?? fetch)(
      new URL("/v1/identity/bootstrap", baseUrl),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.accessToken}`
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000)
      }
    );

    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return "unavailable";
    }

    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "status" in payload &&
      payload.status === "identity_provisioned"
    ) {
      return "provisioned";
    }

    return "unavailable";
  } catch {
    // Fail closed for provisioning while allowing the authenticated session to complete.
    return "unavailable";
  }
}
