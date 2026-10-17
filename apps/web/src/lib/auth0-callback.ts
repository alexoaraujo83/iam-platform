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

  return NextResponse.redirect(destination, {
    headers: { "Cache-Control": "no-store" }
  });
}
