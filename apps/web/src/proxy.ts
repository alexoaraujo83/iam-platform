import { auth0 } from "./lib/auth0";

/** Auth0 SDK routes and session middleware for Next.js 16. */
export async function proxy(request: Request) {
  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
