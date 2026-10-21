import { NextResponse } from "next/server";

type CallbackError = {
  code?: string;
  name?: string;
};

type CallbackContext = {
  appBaseUrl?: string;
  returnTo?: string;
};

/**
 * Convert Auth0 callback failures into controlled, non-cacheable responses.
 * Never return provider error messages or other internal details to the browser.
 */
export async function handleAuth0Callback(
  error: CallbackError | null,
  context: CallbackContext,
  session: object | null = null
): Promise<NextResponse> {
  if (error) {
    const identifier = `${error.code ?? ""} ${error.name ?? ""}`;
    const isProviderUnavailable =
      /(discovery|network|fetch|timeout|unavailable|econn|enotfound|eai_again|temporar|authorization_code_grant_request_error)/i.test(
        identifier
      );

    return new NextResponse(
      isProviderUnavailable
        ? "Authentication provider is temporarily unavailable. Please try again."
        : "Authentication callback is invalid or could not be completed.",
      {
        status: isProviderUnavailable ? 503 : 400,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  if (!session) {
    return new NextResponse("Authentication callback is invalid or could not be completed.", {
      status: 400,
      headers: { "Cache-Control": "no-store" }
    });
  }

  if (!context.appBaseUrl) {
    return new NextResponse("Authentication callback could not be completed.", {
      status: 500,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const baseUrl = new URL(context.appBaseUrl);
  let destination: URL;

  try {
    destination = new URL(context.returnTo || "/", baseUrl);
  } catch {
    destination = new URL("/", baseUrl);
  }

  // Only allow same-origin post-login redirects.
  if (destination.origin !== baseUrl.origin) {
    destination = new URL("/", baseUrl);
  }

  if (process.env.IAM_IDENTITY_BOOTSTRAP_ENABLED === "true") {
    const tokenSet = "tokenSet" in session
      ? (session as { tokenSet?: { accessToken?: unknown } }).tokenSet
      : undefined;
    const accessToken = typeof tokenSet?.accessToken === "string"
      ? tokenSet.accessToken
      : undefined;
    const rawApiBase = process.env.IAM_API_BASE_URL?.trim();

    let apiUrl: URL | undefined;
    try {
      if (rawApiBase) apiUrl = new URL(rawApiBase);
    } catch {
      apiUrl = undefined;
    }

    const isLocalHttp =
      apiUrl?.protocol === "http:" &&
      (apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1" || apiUrl.hostname === "[::1]");
    const safeApiUrl = apiUrl &&
      (apiUrl.protocol === "https:" || isLocalHttp) &&
      !apiUrl.username &&
      !apiUrl.password &&
      (apiUrl.pathname === "/" || apiUrl.pathname === "")
      ? apiUrl
      : undefined;

    if (!accessToken || !safeApiUrl) {
      console.warn(JSON.stringify({
        level: "warn",
        event: "identity_bootstrap_unavailable",
        reason: "missing_configuration_or_access_token"
      }));
      destination.searchParams.set("identity_bootstrap", "unavailable");
    } else {
      try {
        safeApiUrl.search = "";
        safeApiUrl.hash = "";
        const endpoint = new URL("/v1/identity/bootstrap", safeApiUrl);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          },
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(8_000)
        });

        let provisioned = false;
        if (response.ok && response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
          try {
            const payload: unknown = await response.json();
            provisioned = typeof payload === "object" &&
              payload !== null &&
              "status" in payload &&
              payload.status === "identity_provisioned";
          } catch {
            provisioned = false;
          }
        }

        if (!provisioned) {
          console.warn(JSON.stringify({
            level: "warn",
            event: "identity_bootstrap_failed",
            reason: response.status >= 300 && response.status < 400
              ? "upstream_protection_redirect"
              : "upstream_rejected",
            status: response.status
          }));
          destination.searchParams.set("identity_bootstrap", "unavailable");
        } else {
          destination.searchParams.delete("identity_bootstrap");
        }
      } catch {
        console.warn(JSON.stringify({
          level: "warn",
          event: "identity_bootstrap_failed",
          reason: "upstream_unreachable"
        }));
        destination.searchParams.set("identity_bootstrap", "unavailable");
      }
    }
  }

  return NextResponse.redirect(destination, {
    headers: { "Cache-Control": "no-store" }
  });
}
