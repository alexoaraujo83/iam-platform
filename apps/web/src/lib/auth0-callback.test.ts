import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAuth0Callback } from "./auth0-callback";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  it("does not redirect when the callback has no authenticated session", async () => {
    const response = await handleAuth0Callback(
      null,
      { appBaseUrl: "https://iam-platform-web-preview.vercel.app" },
      null
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("redirects successful callbacks to a same-origin return path", async () => {
    const response = await handleAuth0Callback(
      null,
      {
        appBaseUrl: "https://iam-platform-web-preview.vercel.app",
        returnTo: "/control-center"
      },
      { user: { sub: "auth0|test" } }
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://iam-platform-web-preview.vercel.app/control-center"
    );
  });

  it("rejects an external returnTo target", async () => {
    const response = await handleAuth0Callback(
      null,
      {
        appBaseUrl: "https://iam-platform-web-preview.vercel.app",
        returnTo: "https://attacker.example/"
      },
      { user: { sub: "auth0|test" } }
    );

    expect(response.headers.get("location")).toBe(
      "https://iam-platform-web-preview.vercel.app/"
    );
  });

  it("bootstraps the verified access token only when the feature flag is enabled", async () => {
    vi.stubEnv("IAM_IDENTITY_BOOTSTRAP_ENABLED", "true");
    vi.stubEnv("IAM_API_BASE_URL", "https://iam-platform-ruddy-preview.vercel.app/");
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "preview-bypass-secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleAuth0Callback(
      null,
      {
        appBaseUrl: "https://iam-platform-web-preview.vercel.app",
        returnTo: "/control-center"
      },
      { tokenSet: { accessToken: "test-access-token" } }
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://iam-platform-web-preview.vercel.app/control-center"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://iam-platform-ruddy-preview.vercel.app/v1/identity/bootstrap");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-access-token");
    expect(headers.get("x-vercel-protection-bypass")).toBe("preview-bypass-secret");
    expect(await response.text()).not.toContain("test-access-token");
  });

  it("keeps login available and marks bootstrap unavailable when the API rejects", async () => {
    vi.stubEnv("IAM_IDENTITY_BOOTSTRAP_ENABLED", "true");
    vi.stubEnv("IAM_API_BASE_URL", "https://iam-platform-ruddy-preview.vercel.app");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "identity_provisioning_not_configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await handleAuth0Callback(
      null,
      { appBaseUrl: "https://iam-platform-web-preview.vercel.app" },
      { tokenSet: { accessToken: "test-access-token" } }
    );
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.origin).toBe("https://iam-platform-web-preview.vercel.app");
    expect(location.searchParams.get("identity_bootstrap")).toBe("unavailable");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("test-access-token");
  });

  it("does not call the API when automatic bootstrap is disabled", async () => {
    vi.stubEnv("IAM_IDENTITY_BOOTSTRAP_ENABLED", "false");
    vi.stubEnv("IAM_API_BASE_URL", "https://iam-platform-ruddy-preview.vercel.app");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleAuth0Callback(
      null,
      { appBaseUrl: "https://iam-platform-web-preview.vercel.app" },
      { tokenSet: { accessToken: "test-access-token" } }
    );

    expect(response.status).toBe(307);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not redirect when the base URL is missing", async () => {
    const response = await handleAuth0Callback(
      null,
      {},
      { user: { sub: "auth0|test" } }
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
