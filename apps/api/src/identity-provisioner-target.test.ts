import { describe, expect, it } from "vitest";
import { assertIdentityProvisionerDatabaseTarget } from "./identity-provisioner-target.js";

const expected = {
  branchId: "br-sweet-firefly-b6mr92zu",
  projectId: "curly-fog-91868394"
};
const valid = {
  roleName: "iam_identity_provisioner_login",
  databaseName: "iam_platform",
  branchId: expected.branchId,
  projectId: expected.projectId
};

describe("identity provisioner database target", () => {
  it("accepts the dedicated login role on the expected Neon branch and project", () => {
    expect(() => assertIdentityProvisionerDatabaseTarget(valid, expected)).not.toThrow();
  });

  it("rejects any role other than the dedicated login role", () => {
    expect(() => assertIdentityProvisionerDatabaseTarget(
      { ...valid, roleName: "iam_runtime" },
      expected
    )).toThrow("identity_provisioner_database_role_mismatch");
  });

  it("rejects a connection to a different Neon branch", () => {
    expect(() => assertIdentityProvisionerDatabaseTarget(
      { ...valid, branchId: "br-wrong-branch-12345678" },
      expected
    )).toThrow("identity_provisioner_database_target_mismatch");
  });

  it("rejects a connection to a different Neon project", () => {
    expect(() => assertIdentityProvisionerDatabaseTarget(
      { ...valid, projectId: "wrong-project-12345678" },
      expected
    )).toThrow("identity_provisioner_database_target_mismatch");
  });

  it("fails closed when expected branch or project is missing", () => {
    expect(() => assertIdentityProvisionerDatabaseTarget(
      valid,
      { branchId: "", projectId: "" }
    )).toThrow("identity_provisioner_database_target_mismatch");
  });
});
