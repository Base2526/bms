// =============================================================
// BMS RBAC — permission catalog + enforcement
// -------------------------------------------------------------
// Administrator = super (ได้ทุกสิทธิ์เสมอ กันล็อกตัวเองออก)
// role อื่นดึงสิทธิ์จาก bms_role_permissions
// =============================================================

import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { getTenantId } from "./tenant";

export const BMS_PERMISSIONS = [
  "product.view",
  "product.edit",
  "product.delete",
  "stock.adjust",
  "order.view",
  "order.create",
  "order.pay",
  "order.ship",
  "order.cancel",
  "order.return",
  "purchase.view",
  "purchase.edit",
  "purchase.receive",
  "purchase.cancel",
  "payment.view",
  "payment.submit",
  "payment.confirm",
  "payment.refund",
  "shipping.view",
  "shipping.create",
  "shipping.update",
  "inbox.view",
  "inbox.reply",
  "inbox.manage",
  "inbox.assign",
  "customer.view",
  "customer.edit",
  "report.view",
] as const;
export type BmsPermission = (typeof BMS_PERMISSIONS)[number];

const SUPER_ROLE = "Administrator";

/** โหลดสิทธิ์ของ admin ปัจจุบัน (cache บน ctx เพื่อไม่ query ซ้ำต่อ request) */
export async function loadPermissions(ctx: any): Promise<Set<string>> {
  if (ctx.__bmsPerms) return ctx.__bmsPerms;

  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }

  const roleName: string = ctx?.admin?.role || "";
  let perms: Set<string>;
  if (roleName === SUPER_ROLE) {
    perms = new Set(BMS_PERMISSIONS); // super: ทุกสิทธิ์
  } else {
    // per-tenant: สิทธิ์ของ role แยกตามร้าน
    const res = await query<{ permission: string }>(
      `SELECT rp.permission
         FROM bms_role_permissions rp
         JOIN roles r ON r.id = rp.role_id
        WHERE r.name = $1 AND rp.tenant_id = $2`,
      [roleName, getTenantId(ctx)]
    );
    perms = new Set(res.rows.map((r) => r.permission));
  }
  ctx.__bmsPerms = perms;
  return perms;
}

/** ต้องมีสิทธิ์ที่ระบุ ไม่งั้น throw FORBIDDEN */
export async function requirePermission(ctx: any, perm: BmsPermission): Promise<void> {
  const perms = await loadPermissions(ctx);
  if (!perms.has(perm)) {
    throw new GraphQLError(`ไม่มีสิทธิ์: ${perm}`, {
      extensions: { code: "FORBIDDEN", http: { status: 403 }, permission: perm },
    });
  }
}

/** รายชื่อสิทธิ์ของ admin ปัจจุบัน (สำหรับ UI gating) */
export async function myPermissions(ctx: any): Promise<string[]> {
  const perms = await loadPermissions(ctx);
  return [...perms];
}

// ---- matrix editor (จัดการสิทธิ์ต่อ role, per-tenant) ----
export async function listRolesWithPermissions(tenantId: string) {
  const res = await query<{ id: string; name: string; is_super: boolean; permissions: string[] }>(
    `SELECT r.id, r.name,
            (r.name = $1) AS is_super,
            COALESCE(array_agg(rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
       FROM roles r
       LEFT JOIN bms_role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = $2
      WHERE r.is_active
      GROUP BY r.id, r.name
      ORDER BY r.name`,
    [SUPER_ROLE, tenantId]
  );
  // super role: แสดงว่าได้ทุกสิทธิ์
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    is_super: r.is_super,
    permissions: r.is_super ? [...BMS_PERMISSIONS] : r.permissions,
  }));
}

/** แทนที่สิทธิ์ทั้งชุดของ role เฉพาะร้านนี้ (ยกเว้น Administrator ที่เป็น super) */
export async function setRolePermissions(tenantId: string, roleId: string, permissions: string[]): Promise<boolean> {
  const role = await query<{ name: string }>(`SELECT name FROM roles WHERE id = $1`, [roleId]);
  if (role.rowCount === 0) throw new GraphQLError("ไม่พบ role");
  if (role.rows[0].name === SUPER_ROLE) {
    throw new GraphQLError("แก้สิทธิ์ Administrator ไม่ได้ (super role ได้ทุกสิทธิ์เสมอ)", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const valid = permissions.filter((p) => (BMS_PERMISSIONS as readonly string[]).includes(p));

  await query(`DELETE FROM bms_role_permissions WHERE tenant_id = $1 AND role_id = $2`, [tenantId, roleId]);
  if (valid.length > 0) {
    const values = valid.map((_, i) => `($1, $2, $${i + 3})`).join(", ");
    await query(
      `INSERT INTO bms_role_permissions (tenant_id, role_id, permission) VALUES ${values}`,
      [tenantId, roleId, ...valid]
    );
  }
  return true;
}
