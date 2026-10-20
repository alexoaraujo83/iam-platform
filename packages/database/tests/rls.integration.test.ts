import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAuditEvent, appendPreAuthSecurityEvent } from "../src/audit.js";
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
    await admin.query(`
      DO $role$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iam_app_runtime') THEN
          CREATE ROLE iam_app_runtime LOGIN PASSWORD 'runtime-test-only' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END
      $role$;
    `);
    const migration = await readFile(
      new URL("../migrations/0001_identity_tenancy.sql", import.meta.url),
      "utf8"
    );
    await admin.query(migration);
    const auditMigration = await readFile(
      new URL("../migrations/0002_durable_audit_controls.sql", import.meta.url),
      "utf8"
    );
    await admin.query(auditMigration);
    const controlCenterPermissionMigration = await readFile(
      new URL("../migrations/0003_control_center_read_permission.sql", import.meta.url),
      "utf8"
    );
    await admin.query(controlCenterPermissionMigration);
    const globalSecurityMigration = await readFile(
      new URL("../migrations/0004_pre_auth_security_events.sql", import.meta.url),
      "utf8"
    );
    await admin.query(globalSecurityMigration);

    const runtimeRoleHardeningMigration = await readFile(
      new URL("../migrations/0005_harden_runtime_database_roles.sql", import.meta.url),
      "utf8"
    );
    await admin.query(runtimeRoleHardeningMigration);

    const runtimeRoleSecurity = await admin.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'iam_app_runtime'"
    );
    expect(runtimeRoleSecurity.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    const runtimeMemberships = await admin.query(
      "SELECT 1 FROM pg_auth_members am JOIN pg_roles member_role ON member_role.oid = am.member WHERE member_role.rolname = 'iam_app_runtime'"
    );
    expect(runtimeMemberships.rowCount).toBe(0);

    const legacyRuntimeSecurity = await admin.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
         FROM pg_roles WHERE rolname = 'iam_runtime'`
    );
    if (legacyRuntimeSecurity.rowCount === 1) {
      expect(legacyRuntimeSecurity.rows[0]).toEqual({
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      });
      const legacyMemberships = await admin.query(
        `SELECT 1
           FROM pg_auth_members am
           JOIN pg_roles member_role ON member_role.oid = am.member
          WHERE member_role.rolname = 'iam_runtime'`
      );
      expect(legacyMemberships.rowCount).toBe(0);
    }

    await admin.query(`
      ALTER ROLE iam_app_runtime LOGIN PASSWORD 'runtime-test-only' NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO iam_app_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, memberships, roles, role_permissions, membership_roles, applications TO iam_app_runtime;
      GRANT SELECT, INSERT ON audit_events TO iam_app_runtime;
      GRANT SELECT ON principals, external_identities, permissions TO iam_app_runtime;
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
    const controlCenterPermission = await admin.query<{ id: string }>(
      "SELECT id FROM permissions WHERE permission_key = 'iam.control_center.read'"
    );
    expect(controlCenterPermission.rows).toHaveLength(1);
    // Explicitly grant this capability to Tenant B's admin role only.
    await admin.query("INSERT INTO role_permissions (tenant_id, role_id, permission_id) VALUES ($1, $2, $3)", [tenantB, roleB, controlCenterPermission.rows[0]!.id]);
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
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'iam_app_runtime'"
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

  it("resolves Control Center read permission only for the tenant whose role was explicitly granted it", async () => {
    const tenantAResolved = await withTenant(tenantA, (client) =>
      resolveActiveMembership(
        client,
        { issuer: "https://issuer.example.test", subject: "subject-a" },
        tenantA
      )
    );
    const tenantBResolved = await withTenant(tenantB, (client) =>
      resolveActiveMembership(
        client,
        { issuer: "https://issuer.example.test", subject: "subject-b" },
        tenantB
      )
    );

    expect(tenantAResolved?.permissions).not.toContainEqual({
      resource: "iam",
      action: "control_center.read"
    });
    expect(tenantBResolved?.permissions).toContainEqual({
      resource: "iam",
      action: "control_center.read"
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
    expect(result.rows[0]?.current_user).toBe("iam_app_runtime");
    expect(result.rows[0]?.row_count).toBe("0");
  });
  it("keeps permissions as global reference data with runtime read-only access", async () => {
    const columns = await admin.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'permissions'
        ORDER BY ordinal_position`
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "permission_key",
      "description",
      "created_at"
    ]);
    expect(columns.rows.some((row) => row.column_name === "tenant_id")).toBe(false);

    const grants = await admin.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
    }>(`SELECT
      has_table_privilege('iam_app_runtime', 'public.permissions', 'SELECT') AS can_select,
      has_table_privilege('iam_app_runtime', 'public.permissions', 'INSERT') AS can_insert,
      has_table_privilege('iam_app_runtime', 'public.permissions', 'UPDATE') AS can_update,
      has_table_privilege('iam_app_runtime', 'public.permissions', 'DELETE') AS can_delete,
      has_table_privilege('iam_app_runtime', 'public.permissions', 'TRUNCATE') AS can_truncate`);
    expect(grants.rows[0]).toEqual({
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
      can_truncate: false
    });

    const referenceRows = await runtime.query<{ permission_key: string }>(
      "SELECT permission_key FROM permissions ORDER BY permission_key"
    );
    expect(referenceRows.rows.length).toBeGreaterThan(0);
  });

  it("forces RLS on every tenant-owned table", async () => {
    const result = await admin.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname
    `, [["tenants", "memberships", "principals", "external_identities", "roles", "role_permissions", "membership_roles", "applications", "audit_events"]]);
    expect(result.rows).toHaveLength(9);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it("prevents the runtime role from updating durable audit events", async () => {
    const eventId = await withTenant(tenantA, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO audit_events (tenant_id, action, target_type, outcome, correlation_id)
         VALUES ($1, 'security.audit_test', 'test', 'success', 'audit-append-only-test')
         RETURNING id`,
        [tenantA]
      );
      return inserted.rows[0]!.id;
    });
    await expect(withTenant(tenantA, async (client) => {
      await client.query("UPDATE audit_events SET target_id = 'tampered' WHERE id = $1", [eventId]);
    })).rejects.toMatchObject({ code: "42501" });
  });

  it("verifies runtime role is neither superuser nor RLS-bypass and does not own protected tables", async () => {
    const role = await runtime.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT current_user, r.rolsuper, r.rolbypassrls
         FROM pg_roles r WHERE r.rolname = current_user`
    );
    expect(role.rows[0]).toEqual({ current_user: "iam_app_runtime", rolsuper: false, rolbypassrls: false });
    const ownership = await runtime.query<{ owned_count: string }>(`
      SELECT count(*)::text AS owned_count
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
        AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    `, [["tenants", "memberships", "principals", "external_identities", "roles", "role_permissions", "membership_roles", "applications", "audit_events"]]);
    expect(ownership.rows[0]?.owned_count).toBe("0");
  });

  it("writes pre-auth security events to a separate global INSERT-only store without tenant context", async () => {
    const client = await runtime.connect();
    let eventId: string;
    try {
      await client.query("BEGIN");
      eventId = await appendPreAuthSecurityEvent(client, {
        action: "security.authn_failed",
        outcome: "failure",
        correlationId: "preauth-isolation-test",
        requestId: "preauth-request-test",
        metadata: { reason: "invalid_token" }
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const persisted = await admin.query<{
      id: string;
      action: string;
      outcome: string;
      correlation_id: string;
      metadata: Record<string, unknown>;
    }>(
      "SELECT id, action, outcome, correlation_id, metadata FROM global_security_events WHERE id = $1",
      [eventId!]
    );
    expect(persisted.rows).toEqual([{
      id: eventId!,
      action: "security.authn_failed",
      outcome: "failure",
      correlation_id: "preauth-isolation-test",
      metadata: { reason: "invalid_token" }
    }]);

    await expect(
      runtime.query("SELECT id FROM global_security_events WHERE id = $1", [eventId!])
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query("UPDATE global_security_events SET action = 'security.tampered' WHERE id = $1", [eventId!])
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query("DELETE FROM global_security_events WHERE id = $1", [eventId!])
    ).rejects.toMatchObject({ code: "42501" });

    const grants = await admin.query<{ can_insert: boolean; can_select: boolean; can_update: boolean; can_delete: boolean; can_truncate: boolean }>(`
      SELECT
        has_table_privilege('iam_app_runtime', 'public.global_security_events', 'INSERT') AS can_insert,
        has_table_privilege('iam_app_runtime', 'public.global_security_events', 'SELECT') AS can_select,
        has_table_privilege('iam_app_runtime', 'public.global_security_events', 'UPDATE') AS can_update,
        has_table_privilege('iam_app_runtime', 'public.global_security_events', 'DELETE') AS can_delete,
        has_table_privilege('iam_app_runtime', 'public.global_security_events', 'TRUNCATE') AS can_truncate
    `);
    expect(grants.rows[0]).toEqual({ can_insert: true, can_select: false, can_update: false, can_delete: false, can_truncate: false });
  });

  it("does not allow a pre-auth NULL-tenant event to bypass tenant audit RLS", async () => {
    const client = await runtime.connect();
    try {
      await expect(appendAuditEvent(client, {
        tenantId: null,
        actorPrincipalId: null,
        action: "security.authn_failed",
        targetType: "authentication",
        outcome: "failure",
        correlationId: "preauth-must-not-enter-tenant-audit"
      })).rejects.toMatchObject({ code: "42501" });
    } finally {
      client.release();
    }
  });

  it("forces RLS on the separate global security event store", async () => {
    const result = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE oid = 'public.global_security_events'::regclass
    `);
    expect(result.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

});
