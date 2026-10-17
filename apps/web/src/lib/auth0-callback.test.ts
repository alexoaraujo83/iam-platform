import { describe, expect, it } from "vitest";
import { handleAuth0Callback } from "./auth0-callback";

describe("handleAuth0Callback", () => {
  it("returns a controlled 400 for missing state without exposing SDK details", async () => {
    const response = await handleAuth0Callback(
      { code: "missing_state", name: "MissingStateError" },
      {}
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("MissingStateError");
  });

  it("returns a controlled 400 for invalid state", async () => {
    const response = await handleAuth0Callback(
      { code: "invalid_state", name: "InvalidStateError" },
      { appBaseUrl: "https://iam-platform-web-preview.vercel.app" }
    );

    expect(response.status).toBe(400);
  });

  it.each([
    { code: "discovery_error", name: "DiscoveryError" },
    {
      code: "authorization_code_grant_request_error",
      name: "AuthorizationCodeGrantRequestError"
    }
  ])("returns 503 for provider availability errors ($code)", async (error) => {
    const response = await handleAuth0Callback(error, {});
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain("temporarily unavailable");
    expect(body).not.toContain(error.code);
  });

  it("redirects successful callbacks to a same-origin return path", async () => {
    const response = await handleAuth0Callback(null, {
      appBaseUrl: "https://iam-platform-web-preview.vercel.app",
      returnTo: "/control-center"
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://iam-platform-web-preview.vercel.app/control-center"
    );
  });

  it("rejects an external returnTo target", async () => {
    const response = await handleAuth0Callback(null, {
      appBaseUrl: "https://iam-platform-web-preview.vercel.app",
      returnTo: "https://attacker.example/"
    });

    expect(response.headers.get("location")).toBe(
      "https://iam-platform-web-preview.vercel.app/"
    );
  });

  it("does not redirect when the base URL is missing", async () => {
    const response = await handleAuth0Callback(null, {});

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
