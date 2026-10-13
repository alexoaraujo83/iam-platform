import type { PoolClient } from "pg";

export interface VerifiedIdentity {
  readonly issuer: string;
  readonly subject: string;
}

export interface ResolvedMembership {
  readonly tenantId: string;
  readonly principalId: string;
  readonly membershipId: string;
  readonly permissions: readonly { readonly resource: string; readonly action: string }[];
}

interface MembershipRow {
  tenant_id: string;
  principal_id: string;
  membership_id: string;
}

interface PermissionRow {
  permission_key: string;
}

/**
 * Resolve a cryptographically verified external identity to an active local
 * membership. The caller MUST invoke this on a checked-out client inside an
 * explicit transaction and commit/rollback that transaction before releasing it.
 *
 * The requested tenant ID is used only to scope RLS; it never grants access by
 * itself. An active local membership is still required. Do not accept issuer or
 * subject from an unverified JWT.
 */
export async function resolveActiveMembership(
  client: Pick<PoolClient, "query">,
  identity: VerifiedIdentity,
  tenantId: string
): Promise<ResolvedMembership | null> {
  if (
    !identity ||
    typeof identity.issuer !== "string" ||
    identity.issuer.trim().length === 0 ||
    typeof identity.subject !== "string" ||
    identity.subject.trim().length === 0 ||
    typeof tenantId !== "string" ||
    tenantId.trim().length === 0
  ) {
    return null;
  }

  // Transaction-local: must not be replaced with session-level SET.
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

  const membership = await client.query<MembershipRow>(
    `SELECT m.tenant_id, m.principal_id, m.id AS membership_id
       FROM external_identities ei
       JOIN principals p ON p.id = ei.principal_id AND p.status = 'active'
       JOIN memberships m ON m.principal_id = p.id
       JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
      WHERE ei.issuer = $1
        AND ei.subject = $2
        AND m.tenant_id = $3
        AND m.status = 'active'
      LIMIT 1`,
    [identity.issuer, identity.subject, tenantId]
  );

  const row = membership.rows[0];
  if (!row) return null;

  const permissionRows = await client.query<PermissionRow>(
    `SELECT DISTINCT p.permission_key
       FROM membership_roles mr
       JOIN roles r
         ON r.tenant_id = mr.tenant_id
        AND r.id = mr.role_id
       JOIN role_permissions rp
         ON rp.tenant_id = r.tenant_id
        AND rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE mr.tenant_id = $1
        AND mr.membership_id = $2
      ORDER BY p.permission_key`,
    [row.tenant_id, row.membership_id]
  );

  const permissions = permissionRows.rows.map(({ permission_key }) => {
    const dot = permission_key.indexOf(".");
    const colon = permission_key.indexOf(":");
    const separators = [dot, colon].filter((index) => index >= 0);
    const separator = separators.length > 0 ? Math.min(...separators) : -1;
    if (separator <= 0 || separator === permission_key.length - 1) {
      throw new Error("invalid_permission_key_format");
    }
    return {
      resource: permission_key.slice(0, separator),
      action: permission_key.slice(separator + 1)
    };
  });

  return {
    tenantId: row.tenant_id,
    principalId: row.principal_id,
    membershipId: row.membership_id,
    permissions
  };
}
