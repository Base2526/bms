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
  // โอนย้ายระหว่างสาขา + นับสต็อก — seed ที่ 7.98
  // .count = เดินนับและกรอกตัวเลข · .count.apply = ยืนยันว่าของหายจริงเท่านั้น
  // (คนละการตัดสินใจ จึงคนละสิทธิ์ — Warehouse นับได้ แต่ปิดใบนับไม่ได้)
  "inventory.transfer",
  "inventory.count",
  "inventory.count.apply",
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
  "report.email",
  // จัดการทีมงานในร้านตัวเอง — seed ให้ Manager ที่ 7.78 (Administrator เป็น super อยู่แล้ว)
  // ยังมี rank guard อีกชั้นที่ `staffRoles.ts` + `userAdmin.ts`: มีสิทธิ์นี้ก็ยังแตะ
  // Administrator / Manager คนอื่น / platform admin ไม่ได้
  "user.view",
  "user.manage",
  "ai_quality.view",
  "ai_quality.review",
  "coupon.view",
  "coupon.manage",
  // สมาชิก + แต้มสะสม — seed ที่ 7.96
  // .adjust แยกจาก .manage เพราะปรับแต้มด้วยมือคือการสร้างมูลค่าให้ลูกค้าโดยตรง
  // (แต้มค้าง = หนี้สินของร้าน) ไม่ใช่แค่แก้ข้อมูลติดต่อ
  "member.view",
  "member.manage",
  "loyalty.adjust",
  "loyalty.settings",
  "followup.view",
  "followup.manage",
  "pharmacy.assessment.read",
  "pharmacy.assessment.assign",
  "pharmacy.assessment.request_more_information",
  "pharmacy.assessment.review",
  "pharmacy.assessment.approve",
  "pharmacy.assessment.reject",
  "pharmacy.protocol.manage",
  "pharmacy.audit.read",
  // จัดประเภทยา/นโยบายการขายรายสินค้า — seed ที่ 7.87
  // .review ให้เฉพาะ Pharmacist และโค้ดยังเช็ค is_licensed_pharmacist ซ้ำ
  // เหมือน approveAssessment() เพราะ Administrator ได้ทุก permission อัตโนมัติ
  "pharmacy.policy.read",
  "pharmacy.policy.review",
  // POS — seed ที่ 7.87
  "pos.sell",
  "pos.shift.open",
  "pos.shift.close",
  "pos.discount.approve",
  "pos.device.manage",
  "pos.pin.manage",
  // จัดการบัญชีพนักงานหน้าร้าน (role Cashier + ปิดทางเข้าหลังบ้าน) — seed ที่ 7.92
  "pos.staff.manage",
  "pos.void",
  "pos.cash.movement",
  "pos.shift.report",
  "pos.nosale",
  // คืนสินค้าโดยไม่มีใบเสร็จ — seed ให้ Manager เท่านั้นที่ 8.2
  // แยกจาก order.return: การคืนที่อ้างบิลได้เป็นงานประจำ ส่วนการคืนที่ไม่มีบิล
  // คือการจ่ายเงินออกโดยเชื่อคำบอกเล่า
  "pos.return.noreceipt",
  // ค่าคอมพนักงาน — seed ที่ 8.5 · .view แยกจาก .manage เพราะหัวหน้าทีมควรดูยอดของ
  // ทีมได้โดยไม่ต้องมีสิทธิ์แก้อัตรา (อัตราคือเงินเดือน ไม่ใช่รายงาน)
  "commission.view",
  "commission.manage",
  // ใบกำกับภาษี — seed ที่ 7.88
  "tax.document.view",
  "tax.document.issue",
  "tax.setting.manage",
  // e-Tax นำส่งกรมสรรพากร — seed ที่ 7.94
  "etax.view",
  "etax.manage",
] as const;
export type BmsPermission = (typeof BMS_PERMISSIONS)[number];

const SUPER_ROLE = "Administrator";

/** โหลดสิทธิ์ของ admin ปัจจุบัน (cache บน ctx เพื่อไม่ query ซ้ำต่อ request) */
export async function loadPermissions(ctx: any): Promise<Set<string>> {
  if (ctx.__bmsPerms) return ctx.__bmsPerms;

  const auth = requireAuth(ctx);
  const hasAdminIdentity = Boolean(ctx?.admin?.id);
  const canUseAdminPermissions = auth.scope === "admin" || (auth.scope === "web" && hasAdminIdentity);

  if (!canUseAdminPermissions) {
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
