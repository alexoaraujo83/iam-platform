import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveActiveMembership } from "../src/membership-resolution.js";

const enabled =
  process.env.IAM_DATABASE_INTEGRATION === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.IAM_RUNTIME_DATABASE_URL);

describe.skipIf(!enabled)("PostgreSQL tenant RLS integration", () => {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const runtime = new Pool({ connectionString: process.env.IAM_RUNTIME_DATABASE_URL });
  let tenantA = "";
  let tenantB = "";
  let principalA = "";
  let principalB = "";
  let membershipA = "";
  let membershipB = "";
  let roleA = "";
  let roleB = "";
  let applicationA = "";
  let applicationB = "";

  async function withTenant<T>(tenantId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    const migration = await readFile(
      new URL("../migrations/0001_identity_tenancy.sql", import.meta.url),
      "utf8"
    );
    await admin.query(migration);

    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_runtime') THEN
          CREATE ROLE iam_runtime LOGIN PASSWORD 'runtime-test-only' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END
      $$;
      ALTER ROLE iam_runtime LOGIN PASSWORD 'runtime-test-only' NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO iam_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, memberships, roles, role_permissions, membership_roles, applications, audit_events TO iam_runtime;
      GRANT SELECT ON principals, external_identities, permissions TO iam_runtime;
    `);

    const tenantAResult = await admin.query<{ id: string }>(
      "INSERT INTO tenants (slug, display_name) VALUES ('tenant-a', 'Tenant A') RETURNING id"
    );
    const tenantBResult = await admin.query<{ id: string }>(
      "INSERT INTO tenants (slug, display_name) VALUES ('tenant-b', 'Tenant B') RETURNING id"
    );
    tenantA = tenantAResult.rows[0]!.id;
    tenantB = tenantBResult.rows[0]!.id;

    const principalAResult = await admin.query<{ id: string }>("INSERT INTO principals DEFAULT VALUES RETURNING id");
    const principalBResult = await admin.query<{ id: string }>("INSERT INTO principals DEFAULT VALUES RETURNING id");
    principalA = principalAResult.rows[0]!.id;
    principalB = principalBResult.rows[0]!.id;
    await admin.query(
      "INSERT INTO external_identities (principal_id, issuer, subject) VALUES ($1, 'https://issuer.example.test', 'subject-a'), ($2, 'https://issuer.example.test', 'subject-b')",
      [principalA, principalB]
    );

    const membershipAResult = await admin.query<{ id: string }>(
      "INSERT INTO memberships (tenant_id, principal_id) VALUES ($1, $2) RETURNING id",
      [tenantA, principalA]
    );
    const membershipBResult = await admin.query<{ id: string }>(
      "INSERT INTO memberships (tenant_id, principal_id) VALUES ($1, $2) RETURNING id",
      [tenantB, principalB]
    );
    membershipA = membershipAResult.rows[0]!.id;
    membershipB = membershipBResult.rows[0]!.id;

    const roleAResult = await admin.query<{ id: string }>(
      "INSERT INTO roles (tenant_id, role_key, display_name) VALUES ($1, 'operator', 'Operator') RETURNING id",
      [tenantA]
    );
    const roleBResult = await admin.query<{ id: string }>(
      "INSERT INTO roles (tenant_id, role_key, display_name) VALUES ($1, 'admin', 'Admin') RETURNING id",
      [tenantB]
    );
    roleA = roleAResult.rows[0]!.id;
    roleB = roleBResult.rows[0]!.id;
    const permissionResult = await admin.query<{ id: string }>(
      "INSERT INTO permissions (permission_key, description) VALUES ('freight.read', 'Read freight') RETURNING id"
    );
    await admin.query("INSERT INTO role_permissions (tenant_id, role_id, permission_id) VALUES ($1, $2, $3)", [tenantA, roleA, permissionResult.rows[0]!.id]);
    await admin.query("INSERT INTO role_permissions (tenant_id, role_id, permission_id) VALUES ($1, $2, $3)", [tenantB, roleB, permissionResult.rows[0]!.id]);
    await admin.query("INSERT INTO membership_roles (tenant_id, membership_id, role_id) VALUES ($1, $2, $3)", [tenantA, membershipA, roleA]);
    await admin.query("INSERT INTO membership_roles (tenant_id, membership_id, role_id) VALUES ($1, $2, $3)", [tenantB, membershipB, roleB]);

    const appA = await admin.query<{ id: string }>(
      "INSERT INTO applications (tenant_id, client_key, display_name) VALUES ($1, 'web-a', 'Tenant A Web') RETURNING id",
      [tenantA]
    );
    const appB = await admin.query<{ id: string }>(
      "INSERT INTO applications (tenant_id, client_key, display_name) VALUES ($1, 'web-b', 'Tenant B Web') RETURNING id",
      [tenantB]
    );
    applicationA = appA.rows[0]!.id;
    applicationB = appB.rows[0]!.id;
    await admin.query("INSERT INTO audit_events (tenant_id, actor_principal_id, action, target_type, target_id, outcome, correlation_id) VALUES ($1, $2, 'membership.created', 'membership', $3, 'success', 'seed-a')", [tenantA, principalA, membershipA]);
    await admin.query("INSERT INTO audit_events (tenant_id, actor_principal_id, action, target_type, target_id, outcome, correlation_id) VALUES ($1, $2, 'membership.created', 'membership', $3, 'success', 'seed-b')", [tenantB, principalB, membershipB]);

    const role = await admin.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'iam_runtime'"
    );
    expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
  });

  it("resolves an active external identity and persisted permissions as the restricted runtime role", async () => {
    const resolved = await withTenant(tenantA, (client) =>
      resolveActiveMembership(
        client,
        { issuer: "https://issuer.example.test", subject: "subject-a" },
        tenantA
      )
    );

    expect(resolved).toEqual({
      tenantId: tenantA,
      principalId: principalA,
      membershipId: membershipA,
      permissions: [{ resource: "freight", action: "read" }]
    });
  });

  it("denies visibility when no transaction-local tenant context is set", async () => {
    const client = await runtime.connect();
    try {
      await client.query("BEGIN");
      const tenants = await client.query("SELECT id FROM tenants");
      const memberships = await client.query("SELECT id FROM memberships");
      const principals = await client.query("SELECT id FROM principals");
      const externalIdentities = await client.query("SELECT id FROM external_identities");
      expect(tenants.rowCount).toBe(0);
      expect(memberships.rowCount).toBe(0);
      expect(principals.rowCount).toBe(0);
      expect(externalIdentities.rowCount).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("allows only the active tenant's rows in the tenant context", async () => {
    const result = await withTenant(tenantA, async (client) => {
      const tenants = await client.query<{ id: string }>("SELECT id FROM tenants");
      const memberships = await client.query<{ id: string }>("SELECT id FROM memberships");
      const principals = await client.query<{ id: string }>("SELECT id FROM principals");
      const externalIdentities = await client.query<{ issuer: string; subject: string }>(
        "SELECT issuer, subject FROM external_identities ORDER BY subject"
      );
      const roles = await client.query<{ id: string }>("SELECT id FROM roles");
      const rolePermissions = await client.query<{ role_id: string }>("SELECT role_id FROM role_permissions");
      const membershipRoles = await client.query<{ membership_id: string; role_id: string }>("SELECT membership_id, role_id FROM membership_roles");
      const applications = await client.query<{ id: string }>("SELECT id FROM applications");
      const auditEvents = await client.query<{ target_id: string | null }>("SELECT target_id FROM audit_events");
      return { tenants: tenants.rows, memberships: memberships.rows, principals: principals.rows, externalIdentities: externalIdentities.rows, roles: roles.rows, rolePermissions: rolePermissions.rows, membershipRoles: membershipRoles.rows, applications: applications.rows, auditEvents: auditEvents.rows };
    });

    expect(result.tenants).toEqual([{ id: tenantA }]);
    expect(result.memberships).toEqual([{ id: membershipA }]);
    expect(result.principals).toEqual([{ id: principalA }]);
    expect(result.externalIdentities).toEqual([
      { issuer: "https://issuer.example.test", subject: "subject-a" }
    ]);
    expect(result.tenants.some((row) => row.id === tenantB)).toBe(false);
    expect(result.memberships.some((row) => row.id === membershipB)).toBe(false);
    expect(result.roles).toEqual([{ id: roleA }]);
    expect(result.rolePermissions).toEqual([{ role_id: roleA }]);
    expect(result.membershipRoles).toEqual([{ membership_id: membershipA, role_id: roleA }]);
    expect(result.applications).toEqual([{ id: applicationA }]);
    expect(result.auditEvents).toEqual([{ target_id: membershipA }]);
    expect(result.applications.some((row) => row.id === applicationB)).toBe(false);
  });

  it("rejects cross-tenant inserts with SQLSTATE 42501", async () => {
    await expect(
      withTenant(tenantA, async (client) => {
        await client.query(
          "INSERT INTO memberships (tenant_id, principal_id) VALUES ($1, $2)",
          [tenantB, principalB]
        );
      })
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("does not update another tenant's membership through a cross-tenant predicate", async () => {
    const rowCount = await withTenant(tenantA, async (client) => {
      const result = await client.query(
        "UPDATE memberships SET status = 'revoked' WHERE tenant_id = $1 AND id = $2",
        [tenantB, membershipB]
      );
      return result.rowCount;
    });

    expect(rowCount).toBe(0);
    const persisted = await admin.query<{ status: string }>(
      "SELECT status FROM memberships WHERE id = $1",
      [membershipB]
    );
    expect(persisted.rows[0]?.status).toBe("active");
  });

  it("does not delete another tenant's membership through a cross-tenant predicate", async () => {
    const rowCount = await withTenant(tenantA, async (client) => {
      const result = await client.query(
        "DELETE FROM memberships WHERE tenant_id = $1 AND id = $2",
        [tenantB, membershipB]
      );
      return result.rowCount;
    });

    expect(rowCount).toBe(0);
    const persisted = await admin.query<{ status: string }>(
      "SELECT status FROM memberships WHERE id = $1",
      [membershipB]
    );
    expect(persisted.rows[0]?.status).toBe("active");
  });

  it("does not reassign another tenant's membership role", async () => {
    const rowCount = await withTenant(tenantA, async (client) => {
      const result = await client.query(
        "UPDATE membership_roles SET role_id = $1 WHERE tenant_id = $2 AND membership_id = $3",
        [roleA, tenantB, membershipB]
      );
      return result.rowCount;
    });
    expect(rowCount).toBe(0);
    const persisted = await admin.query<{ role_id: string }>(
      "SELECT role_id FROM membership_roles WHERE tenant_id = $1 AND membership_id = $2",
      [tenantB, membershipB]
    );
    expect(persisted.rows).toEqual([{ role_id: roleB }]);
  });

  it("rejects cross-tenant audit-event inserts with SQLSTATE 42501", async () => {
    await expect(
      withTenant(tenantA, async (client) => {
        await client.query(
          "INSERT INTO audit_events (tenant_id, action, target_type, outcome, correlation_id) VALUES ($1, 'admin.role_changed', 'membership', 'success', 'cross-tenant-probe')",
          [tenantB]
        );
      })
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("does not permit the runtime role to bypass RLS", async () => {
    const result = await runtime.query<{ current_user: string; row_count: string }>(
      "SELECT current_user, (SELECT count(*) FROM tenants)::text AS row_count"
    );
    expect(result.rows[0]?.current_user).toBe("iam_runtime");
    expect(result.rows[0]?.row_count).toBe("0");
  });
});
