import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { handleAuth0Callback } from "./auth0-callback";

const audience = process.env.AUTH0_AUDIENCE?.trim();

/**
 * Server-side Auth0 client. Credentials must be supplied through deployment
 * secrets. When configured, the audience requests an access token for the IAM API.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: audience ? { audience } : {},
  onCallback: handleAuth0Callback
});
