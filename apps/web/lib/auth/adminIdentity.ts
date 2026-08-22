import "server-only";

import { query } from "@/lib/db";
import type { JWTPayload } from "./token";
import { isSessionVersionCurrent } from "./sessionVersion";

type AdminIdentityRow = {
  id: string;
  email: string;
  role: string;
  tenant_id: string | null;
  is_platform_admin: boolean;
  admin_session_version: string | number;
  tenant_active: boolean | null;
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
    `SELECT u.id, u.email, u.role, u.tenant_id, u.is_platform_admin,
            u.admin_session_version, t.active AS tenant_active
       FROM users u
       LEFT JOIN bms_tenants t ON t.id = u.tenant_id
      WHERE u.id = $1
      LIMIT 1`,
    [session.id]
  );
  const row = res.rows[0];
  if (!row) return null;

  const currentVersion = Number(row.admin_session_version ?? 0);
  if (!isSessionVersionCurrent(session.session_version, currentVersion)) return null;
  if (!row.is_platform_admin && row.tenant_id && row.tenant_active === false) return null;

  return {
    ...session,
    id: row.id,
    email: row.email,
    role: row.role,
    tenant_id: row.tenant_id ?? undefined,
    is_platform_admin: row.is_platform_admin,
    session_version: currentVersion,
  };
}
