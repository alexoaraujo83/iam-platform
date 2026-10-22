import { describe, expect, it } from "vitest";
import { authorize } from "./index.js";
import type { AuthorizationContext } from "@iam-platform/contracts";

const context: AuthorizationContext = {
  principalId: "principal-1",
  tenantId: "tenant-a",
  membershipId: "membership-1",
  permissions: [{ resource: "freights", action: "read" }]
};

describe("authorize", () => {
  it("allows an exact permission match", () => {
    expect(authorize(context, { resource: "freights", action: "read" }).effect).toBe("allow");
  });
  it("denies when a permission is missing", () => {
    expect(authorize(context, { resource: "freights", action: "delete" })).toEqual({
      effect: "deny", reason: "no_matching_permission"
    });
  });
  it("denies without tenant-bound context", () => {
    expect(authorize(null, { resource: "freights", action: "read" })).toEqual({
      effect: "deny", reason: "missing_context"
    });
  });
  it("does not treat wildcard strings as implicit grants", () => {
    const wildcardContext = { ...context, permissions: [{ resource: "*", action: "*" }] };
    expect(authorize(wildcardContext, { resource: "freights", action: "read" }).effect).toBe("deny");
  });
});
