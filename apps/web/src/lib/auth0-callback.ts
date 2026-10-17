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
  context: CallbackContext
): Promise<NextResponse> {
  if (error) {
    const identifier = `${error.code ?? ""} ${error.name ?? ""}`;
    const isStateError = /(missing|invalid).*state|state.*(missing|invalid)/i.test(
      identifier
    );
    const isProviderUnavailable =
      /(discovery|network|fetch|timeout|unavailable|econn|enotfound|eai_again|temporar)/i.test(
        identifier
      );

    const status = isProviderUnavailable ? 503 : isStateError ? 400 : 400;
    const message = isProviderUnavailable
      ? "Authentication provider is temporarily unavailable. Please try again."
      : "Authentication callback is invalid or could not be completed.";

    return new NextResponse(message, {
      status,
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
