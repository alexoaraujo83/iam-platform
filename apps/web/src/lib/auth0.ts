import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";
import { bootstrapIdentityAfterAuth } from "./identity-bootstrap.js";

const audience = process.env.AUTH0_AUDIENCE?.trim();

function callbackDestination(returnTo: string | undefined, baseUrl: string | undefined): URL {
  const safeReturnTo =
    returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  const safeBaseUrl = baseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  return new URL(safeReturnTo, safeBaseUrl);
}

/**
 * The SDK still owns state validation, code exchange, cookie/session persistence,
 * transaction cleanup, and the final redirect. This hook only performs an
 * idempotent, server-side identity bootstrap after a successful OIDC callback.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: audience ? { audience } : {},
  async onCallback(error, context, session) {
    const destination = callbackDestination(context.returnTo, context.appBaseUrl);

    if (error) {
      destination.pathname = "/";
      destination.searchParams.set("auth_callback", "failed");
      return NextResponse.redirect(destination);
    }

    if (session && process.env.IAM_IDENTITY_BOOTSTRAP_ENABLED === "true") {
      const outcome = await bootstrapIdentityAfterAuth({
        enabled: true,
        apiBaseUrl: process.env.IAM_API_BASE_URL,
        accessToken: session.tokenSet.accessToken
      });

      if (outcome !== "provisioned") {
        destination.searchParams.set("identity_bootstrap", "unavailable");
      } else {
        destination.searchParams.delete("identity_bootstrap");
      }
    }

    return NextResponse.redirect(destination);
  }
});
