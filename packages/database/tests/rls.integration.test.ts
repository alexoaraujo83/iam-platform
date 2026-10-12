import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
      GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, memberships TO iam_runtime;
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

    const role = await admin.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'iam_runtime'"
    );
    expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
  });

  it("denies visibility when no transaction-local tenant context is set", async () => {
    const client = await runtime.connect();
    try {
      await client.query("BEGIN");
      const tenants = await client.query("SELECT id FROM tenants");
      const memberships = await client.query("SELECT id FROM memberships");
      expect(tenants.rowCount).toBe(0);
      expect(memberships.rowCount).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("allows only the active tenant's rows in the tenant context", async () => {
    const result = await withTenant(tenantA, async (client) => {
      const tenants = await client.query<{ id: string }>("SELECT id FROM tenants");
      const memberships = await client.query<{ id: string }>("SELECT id FROM memberships");
      return { tenants: tenants.rows, memberships: memberships.rows };
    });

    expect(result.tenants).toEqual([{ id: tenantA }]);
    expect(result.memberships).toEqual([{ id: membershipA }]);
    expect(result.tenants.some((row) => row.id === tenantB)).toBe(false);
    expect(result.memberships.some((row) => row.id === membershipB)).toBe(false);
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

  it("does not permit the runtime role to bypass RLS", async () => {
    const result = await runtime.query<{ current_user: string; row_count: string }>(
      "SELECT current_user, (SELECT count(*) FROM tenants)::text AS row_count"
    );
    expect(result.rows[0]?.current_user).toBe("iam_runtime");
    expect(result.rows[0]?.row_count).toBe("0");
  });
});
