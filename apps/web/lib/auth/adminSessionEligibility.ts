import { isSessionVersionCurrent } from "./sessionVersion";

export type AdminAccountState = {
  role: string;
  tenant_id: string | null;
  is_platform_admin: boolean;
  admin_session_version: string | number;
  pos_only: boolean;
  is_email_verified: boolean;
  tenant_active: boolean | null;
};

/** Apply the same live account gates as admin login to every existing session. */
export function canUseAdminSession(sessionVersion: number | undefined, row: AdminAccountState): boolean {
  if (!isSessionVersionCurrent(sessionVersion, Number(row.admin_session_version ?? 0))) return false;
  if (row.pos_only || row.is_email_verified === false) return false;
  if (!row.is_platform_admin && (!row.tenant_id || String(row.role).toLowerCase() === "subscriber")) return false;
  if (row.tenant_id && row.tenant_active === false) return false;
  return true;
}
