// =============================================================
// ตัวช่วยยืนยันตัวตน + สิทธิ์ สำหรับ REST route ฝั่งแอดมิน
// -------------------------------------------------------------
// รูปแบบนี้ถูก copy-paste อยู่ในหลาย route แล้ว (ดู reports/pos-returns)
// การรวมไว้ที่เดียวสำคัญเพราะ "drill-down เข้าร้าน" ต้องตรวจว่า cookie
// BMS_ACT_TENANT ถูกเซ็นให้ admin คนนี้จริง — พลาดจุดนี้ที่เดียวคือแอดมินร้าน
// หนึ่งอ่าน/แก้ข้อมูลอีกร้านได้
// =============================================================

import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { verifyAdminSession } from "@/lib/auth/server";
import { refreshAdminIdentity } from "@/lib/auth/adminIdentity";
import { isAdminSessionActive } from "@/lib/redisSession";
import { ACT_TENANT_COOKIE, verifyActTenant, type JWTPayload } from "@/lib/auth/token";
import { DEFAULT_TENANT_ID } from "./tenant";
import { requirePermission, type BmsPermission } from "./permissions";

/**
 * ctx รูปเดียวกับที่ resolver GraphQL ส่งให้ `requirePermission()`/`audit()` — route ที่ต้อง
 * บันทึก audit หรือส่งต่อให้ service ที่รับ ctx (เช่น `generateReport()`) ใช้ตัวนี้ได้เลย
 * ไม่ต้องประกอบเอง ซึ่งเป็นจุดที่เคยลอกกันผิดได้ง่าย (ลืมใส่ tenant_id ที่ override แล้ว)
 */
export type AdminRouteCtx = {
  scope: "admin";
  admin: JWTPayload & { tenant_id: string };
};

export type AdminRouteAuth =
  | {
      ok: true;
      tenantId: string;
      adminId: string | number;
      /** session payload ดิบ — ใช้เมื่อต้องการ role/email */
      admin: JWTPayload;
      ctx: AdminRouteCtx;
    }
  | { ok: false; status: 401 | 403 };

/**
 * `permission = null` = "ต้องล็อกอินแต่ไม่ผูกกับสิทธิ์ใดเป็นพิเศษ" ใช้กับ route ที่ยังไม่มี
 * permission ตรงตัวใน catalog (เช่น AI playground) — เขียนให้ชัดดีกว่าปล่อยให้แต่ละ route
 * ไปเรียก `verifyAdminSession()` เองแล้วลืมส่วน acting-tenant
 */
export async function authorizeAdminRoute(permission: BmsPermission | null): Promise<AdminRouteAuth> {
  const session = verifyAdminSession();
  if (!session) return { ok: false, status: 401 };
  if (!(await isAdminSessionActive(session.jti))) return { ok: false, status: 401 };

  // JWT proves who signed in; current role, tenant, platform status and session
  // version still come from Postgres on every sensitive REST request. This
  // mirrors the GraphQL context and closes the window after logout/demotion.
  const admin = await refreshAdminIdentity(session);
  if (!admin) return { ok: false, status: 401 };

  const acting = verifyActTenant(cookies().get(ACT_TENANT_COOKIE)?.value);
  let tenantId = admin.tenant_id || DEFAULT_TENANT_ID;
  if (
    acting?.actTenantId &&
    String(acting.by) === String(admin.id) &&
    admin.is_platform_admin === true
  ) {
    const tenant = await query<{ id: string }>(
      `SELECT id FROM bms_tenants WHERE id = $1 LIMIT 1`,
      [acting.actTenantId]
    );
    if (tenant.rows[0]) tenantId = tenant.rows[0].id;
  }

  const ctx: AdminRouteCtx = { scope: "admin", admin: { ...admin, tenant_id: tenantId } };

  if (permission) {
    try {
      await requirePermission(ctx, permission);
    } catch {
      return { ok: false, status: 403 };
    }
  }
  return {
    ok: true,
    tenantId,
    adminId: admin.id,
    admin,
    ctx,
  };
}

/** Global operational logs contain data from every shop; drill-down does not narrow this surface. */
export async function authorizePlatformAdminRoute(): Promise<AdminRouteAuth> {
  const auth = await authorizeAdminRoute(null);
  if (!auth.ok) return auth;
  try {
    const result = await query<{ is_platform_admin: boolean }>(
      `SELECT is_platform_admin FROM users WHERE id = $1`,
      [auth.adminId]
    );
    return result.rows[0]?.is_platform_admin === true ? auth : { ok: false, status: 403 };
  } catch {
    return { ok: false, status: 403 };
  }
}
