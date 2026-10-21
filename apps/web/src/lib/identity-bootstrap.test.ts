import { describe, expect, it, vi } from "vitest";
import { bootstrapIdentityAfterAuth } from "./identity-bootstrap.js";

const base = {
  enabled: true,
  apiBaseUrl: "https://iam-platform-ruddy-preview.vercel.app",
  accessToken: "test-only-token"
} as const;

describe("bootstrapIdentityAfterAuth", () => {
  it("does not call the API while the feature flag is disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(bootstrapIdentityAfterAuth({ ...base, enabled: false, fetchImpl })).resolves.toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the access token only to the configured HTTPS API and accepts the exact success response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "identity_provisioned" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(bootstrapIdentityAfterAuth({ ...base, fetchImpl })).resolves.toBe("provisioned");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://iam-platform-ruddy-preview.vercel.app/v1/identity/bootstrap");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-only-token");
    expect(init?.redirect).toBe("manual");
    expect(init?.cache).toBe("no-store");
  });

  it.each([
    ["Vercel SSO redirect", new Response(null, { status: 302, headers: { location: "https://vercel.com/sso-api" } })],
    ["API rejection", new Response(JSON.stringify({ error: "identity_provisioning_not_enabled" }), { status: 503, headers: { "content-type": "application/json" } })],
    ["unexpected success payload", new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } })],
    ["non-JSON response", new Response("<html>protected</html>", { status: 200, headers: { "content-type": "text/html" } })]
  ])("fails closed on %s", async (_label, response) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(bootstrapIdentityAfterAuth({ ...base, fetchImpl })).resolves.toBe("unavailable");
  });

  it.each([
    ["missing token", { ...base, accessToken: undefined }],
    ["missing API URL", { ...base, apiBaseUrl: undefined }],
    ["plain HTTP remote URL", { ...base, apiBaseUrl: "http://api.example.com" }],
    ["credentials in URL", { ...base, apiBaseUrl: "https://user:pass@api.example.com" }],
    ["path prefix", { ...base, apiBaseUrl: "https://api.example.com/prefix" }]
  ])("rejects unsafe configuration: %s", async (_label, input) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(bootstrapIdentityAfterAuth({ ...input, fetchImpl })).resolves.toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the request throws", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("private network details"));
    await expect(bootstrapIdentityAfterAuth({ ...base, fetchImpl })).resolves.toBe("unavailable");
  });
});
