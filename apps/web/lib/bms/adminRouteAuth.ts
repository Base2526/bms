// =============================================================
// ตัวช่วยยืนยันตัวตน + สิทธิ์ สำหรับ REST route ฝั่งแอดมิน
// -------------------------------------------------------------
// รูปแบบนี้ถูก copy-paste อยู่ในหลาย route แล้ว (ดู reports/pos-returns)
// การรวมไว้ที่เดียวสำคัญเพราะ "drill-down เข้าร้าน" ต้องตรวจว่า cookie
// BMS_ACT_TENANT ถูกเซ็นให้ admin คนนี้จริง — พลาดจุดนี้ที่เดียวคือแอดมินร้าน
// หนึ่งอ่าน/แก้ข้อมูลอีกร้านได้
// =============================================================

import { cookies } from "next/headers";
import { verifyAdminSession } from "@/lib/auth/server";
import { ACT_TENANT_COOKIE, verifyActTenant } from "@/lib/auth/token";
import { DEFAULT_TENANT_ID } from "./tenant";
import { requirePermission, type BmsPermission } from "./permissions";

export type AdminRouteAuth =
  | { ok: true; tenantId: string; adminId: string | number }
  | { ok: false; status: 401 | 403 };

export async function authorizeAdminRoute(permission: BmsPermission): Promise<AdminRouteAuth> {
  const admin = verifyAdminSession();
  if (!admin) return { ok: false, status: 401 };

  const acting = verifyActTenant(cookies().get(ACT_TENANT_COOKIE)?.value);
  const tenantId = acting?.actTenantId && String(acting.by) === String(admin.id)
    ? acting.actTenantId
    : admin.tenant_id || DEFAULT_TENANT_ID;

  try {
    await requirePermission({ scope: "admin", admin: { ...admin, tenant_id: tenantId } }, permission);
  } catch {
    return { ok: false, status: 403 };
  }
  return { ok: true, tenantId, adminId: admin.id };
}
