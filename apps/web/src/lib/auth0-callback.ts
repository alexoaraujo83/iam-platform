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
    const tokenSet = session && "tokenSet" in session
      ? (session as { tokenSet?: { accessToken?: unknown } }).tokenSet
      : undefined;
    const accessToken = typeof tokenSet?.accessToken === "string"
      ? tokenSet.accessToken
      : undefined;
    const apiBase = process.env.IAM_API_BASE_URL?.trim().replace(/\/$/, "");

    if (!accessToken || !apiBase) {
      console.warn(JSON.stringify({
        level: "warn",
        event: "identity_bootstrap_unavailable",
        reason: "missing_configuration_or_access_token"
      }));
      destination.searchParams.set("identity_bootstrap", "unavailable");
    } else {
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        };
        const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
        if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;

        const response = await fetch(`${apiBase}/v1/identity/bootstrap`, {
          method: "POST",
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(8_000)
        });
        if (!response.ok) {
          console.warn(JSON.stringify({
            level: "warn",
            event: "identity_bootstrap_failed",
            reason: "upstream_rejected",
            status: response.status
          }));
          destination.searchParams.set("identity_bootstrap", "unavailable");
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
