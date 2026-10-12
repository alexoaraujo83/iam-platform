import { describe, expect, it } from "vitest";
import { extractBearerToken } from "./bearer-token.js";

describe("extractBearerToken", () => {
  it("extracts a single Bearer token", () => {
    expect(extractBearerToken("Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature"))
      .toBe("eyJhbGciOiJSUzI1NiJ9.payload.signature");
  });

  it("accepts case-insensitive scheme and horizontal whitespace", () => {
    expect(extractBearerToken("bEaReR\topaque-token")).toBe("opaque-token");
  });

  it.each([
    undefined,
    ["Bearer token", "Bearer other"],
    "",
    "Basic abc",
    "Bearer",
    "Bearer token extra",
    "Bearer token, Bearer other",
    "Bearer token\nInjected: value",
    "Bearer token with-space",
    "Bearer "
  ])("rejects malformed or ambiguous authorization header: %s", (header) => {
    expect(extractBearerToken(header)).toBeNull();
  });
});
