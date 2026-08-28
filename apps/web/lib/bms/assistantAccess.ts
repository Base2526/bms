import { query } from "@/lib/db";
import { BMS_PERMISSIONS, type BmsPermission } from "./permissions";

export type AssistantStaffMatch = {
  id: string;
  displayName: string;
  /** users.username is nullable (added by 1.13 after the table already had rows). */
  username: string | null;
  role: string;
  posOnly: boolean;
  match: "EXACT" | "SIMILAR";
};

type StaffRow = {
  id: string;
  name: string;
  username: string | null;
  role: string;
  pos_only: boolean;
  exact_match: boolean;
};

/** users.id is a uuid column — a model-invented id would otherwise raise 22P02 mid-tool-call. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `%` and `_` are LIKE metacharacters: unescaped, a query of "%" lists the whole staff roster.
 * `!` is the escape character rather than a backslash so the SQL literal carries no backslash at
 * all and cannot change meaning with `standard_conforming_strings`.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

/** Tenant-scoped staff lookup for the assistant. Never returns email, phone, PIN, or session data. */
export async function searchTenantStaffUsers(
  tenantId: string,
  search: string,
  limit = 5
): Promise<AssistantStaffMatch[]> {
  const normalized = search.normalize("NFKC").trim();
  if (!normalized) return [];
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 10);
  const res = await query<StaffRow>(
    `SELECT id, name, username, role, pos_only,
            (lower(btrim(name)) = lower(btrim($2)) OR lower(btrim(username)) = lower(btrim($2))) AS exact_match
       FROM users
      WHERE tenant_id = $1
        AND is_platform_admin = FALSE
        AND (name ILIKE '%' || $3 || '%' ESCAPE '!' OR username ILIKE '%' || $3 || '%' ESCAPE '!')
      ORDER BY exact_match DESC, name ASC, id ASC
      LIMIT $4`,
    [tenantId, normalized, escapeLikePattern(normalized), safeLimit]
  );
  return res.rows.map((row) => ({
    id: row.id,
    displayName: row.name,
    username: row.username,
    role: row.role,
    posOnly: Boolean(row.pos_only),
    match: row.exact_match ? "EXACT" : "SIMILAR",
  }));
}

export type AssistantStaffAccess = Omit<AssistantStaffMatch, "match"> & {
  permissions: BmsPermission[];
};

/** Reads effective role permissions for exactly one current-tenant, non-platform staff account. */
export async function getTenantStaffUserAccess(
  tenantId: string,
  userId: string
): Promise<AssistantStaffAccess | null> {
  if (!UUID_RE.test(String(userId ?? "").trim())) return null;
  const user = await query<Omit<StaffRow, "exact_match">>(
    `SELECT id, name, username, role, pos_only
       FROM users
      WHERE id = $1 AND tenant_id = $2 AND is_platform_admin = FALSE
      LIMIT 1`,
    [userId, tenantId]
  );
  const row = user.rows[0];
  if (!row) return null;

  let permissions: BmsPermission[];
  if (row.role === "Administrator") {
    permissions = [...BMS_PERMISSIONS];
  } else {
    const result = await query<{ permission: string }>(
      `SELECT rp.permission
         FROM bms_role_permissions rp
         JOIN roles r ON r.id = rp.role_id
        WHERE rp.tenant_id = $1 AND r.name = $2
        ORDER BY rp.permission`,
      [tenantId, row.role]
    );
    permissions = result.rows
      .map((item) => item.permission)
      .filter((permission): permission is BmsPermission =>
        (BMS_PERMISSIONS as readonly string[]).includes(permission)
      );
  }

  return {
    id: row.id,
    displayName: row.name,
    username: row.username,
    role: row.role,
    posOnly: Boolean(row.pos_only),
    permissions,
  };
}

export type AssistantSelfProfile = {
  displayName: string | null;
  username: string | null;
  posOnly: boolean;
};

/**
 * Read the signed-in actor's own display fields.
 *
 * `ctx.admin` only carries what refreshAdminIdentity re-reads (id, email, role, tenant, platform
 * flag). `name`, `username` and `pos_only` are not in the session at all, so reading them from ctx
 * silently yields `null` / `false` — and a tool answering "posOnly: false" from an absent field is
 * stating a fact it never checked. Scoped by id only: this is the caller's own row.
 */
export async function getAssistantSelfProfile(userId: string): Promise<AssistantSelfProfile | null> {
  if (!UUID_RE.test(String(userId ?? "").trim())) return null;
  const res = await query<{ name: string; username: string | null; pos_only: boolean }>(
    `SELECT name, username, pos_only FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const row = res.rows[0];
  return row ? { displayName: row.name, username: row.username, posOnly: Boolean(row.pos_only) } : null;
}
