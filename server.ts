/**
 * Vercel Node.js runtime entrypoint.
 *
 * The API owns HTTP routing, OIDC verification, PostgreSQL tenant scoping,
 * bounded timeouts, and graceful shutdown in apps/api/src/server.ts.
 * Vercel's Node runtime captures the server.listen() call made by that module.
 */
import "./apps/api/src/server.ts";
