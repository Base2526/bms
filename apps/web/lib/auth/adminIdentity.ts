import "server-only";

import { query } from "@/lib/db";
import type { JWTPayload } from "./token";
import { canUseAdminSession, type AdminAccountState } from "./adminSessionEligibility";

type AdminIdentityRow = AdminAccountState & {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
  avatar: string | null;
};

/**
 * Rehydrate security-sensitive admin claims on every API request.
 *
 * JWTs remain the authentication proof, but role, tenant and account existence
 * are authoritative in Postgres. The session version also invalidates every
 * token issued before a password or role change.
 */
export async function refreshAdminIdentity(session: JWTPayload | null): Promise<JWTPayload | null> {
  if (!session?.id) return null;

  const res = await query<AdminIdentityRow>(
    `SELECT u.id, u.email, u.role, u.name, u.username, u.avatar,
            u.tenant_id, u.is_platform_admin,
            u.admin_session_version, u.pos_only, u.is_email_verified,
            t.active AS tenant_active
       FROM users u
       LEFT JOIN bms_tenants t ON t.id = u.tenant_id
      WHERE u.id = $1
      LIMIT 1`,
    [session.id]
  );
  const row = res.rows[0];
  if (!row) return null;

  if (!canUseAdminSession(session.session_version, row)) return null;
  const currentVersion = Number(row.admin_session_version ?? 0);

  return {
    ...session,
    id: row.id,
    email: row.email,
    role: row.role,
    name: row.name,
    username: row.username,
    avatar: row.avatar,
    tenant_id: row.tenant_id ?? undefined,
    is_platform_admin: row.is_platform_admin,
    session_version: currentVersion,
  };
}
