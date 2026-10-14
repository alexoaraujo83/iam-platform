import { Auth0Client } from "@auth0/nextjs-auth0/server";

/** Server-side Auth0 client. Credentials must be supplied through deployment secrets. */
export const auth0 = new Auth0Client();
