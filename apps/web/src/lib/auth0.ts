import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";

const audience = process.env.AUTH0_AUDIENCE?.trim();

/**
 * Server-side Auth0 client. Credentials must be supplied through deployment
 * secrets. When configured, the audience requests an access token for the IAM API.
 */
const identityBootstrapEnabled = process.env.IAM_IDENTITY_BOOTSTRAP_ENABLED === "true";

type Auth0Callback = NonNullable<ConstructorParameters<typeof Auth0Client>[0]["onCallback"]>;

const identityBootstrapCallback: Auth0Callback = async (error, context, session) => {
  const baseUrl = context.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const candidateReturnTo = context.returnTo ?? "/";
  const returnTo = candidateReturnTo.startsWith("/")
    && !candidateReturnTo.startsWith("//")
    && !candidateReturnTo.includes("\\")
    && !candidateReturnTo.includes("\r")
    && !candidateReturnTo.includes("\n")
    ? candidateReturnTo
    : "/";
  const redirectUrl = new URL(returnTo, baseUrl);

  if (error) {
    redirectUrl.searchParams.set("auth_callback", "failed");
    return NextResponse.redirect(redirectUrl);
  }

  const accessToken = session?.tokenSet?.accessToken;
  const apiBase = process.env.IAM_API_BASE_URL?.trim().replace(/\/$/, "");
  if (!accessToken || !apiBase) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "identity_bootstrap_unavailable",
      reason: "missing_configuration_or_access_token"
    }));
    redirectUrl.searchParams.set("identity_bootstrap", "unavailable");
    return NextResponse.redirect(redirectUrl);
  }

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
      redirectUrl.searchParams.set("identity_bootstrap", "unavailable");
    }
  } catch {
    console.warn(JSON.stringify({
      level: "warn",
      event: "identity_bootstrap_failed",
      reason: "upstream_unreachable"
    }));
    redirectUrl.searchParams.set("identity_bootstrap", "unavailable");
  }

  return NextResponse.redirect(redirectUrl);
};

export const auth0 = new Auth0Client({
  authorizationParameters: audience ? { audience } : {},
  ...(identityBootstrapEnabled ? { onCallback: identityBootstrapCallback } : {})
});
