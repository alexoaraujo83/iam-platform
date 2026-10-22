export interface IdentityProvisionerDatabaseIdentity {
  readonly roleName: string | null;
  readonly databaseName: string | null;
  readonly branchId: string | null;
  readonly projectId: string | null;
}

export interface ExpectedIdentityProvisionerDatabaseTarget {
  readonly branchId: string;
  readonly projectId: string;
}

export function assertIdentityProvisionerDatabaseTarget(
  actual: IdentityProvisionerDatabaseIdentity,
  expected: ExpectedIdentityProvisionerDatabaseTarget
): void {
  if (actual.roleName !== "iam_identity_provisioner_login") {
    throw new Error("identity_provisioner_database_role_mismatch");
  }

  if (
    actual.databaseName !== "iam_platform" ||
    !expected.branchId ||
    !expected.projectId ||
    actual.branchId !== expected.branchId ||
    actual.projectId !== expected.projectId
  ) {
    throw new Error("identity_provisioner_database_target_mismatch");
  }
}
