// =============================================================
// BMS SaaS — platform admin (เจ้าของแพลตฟอร์ม เหนือทุกร้าน)
// -------------------------------------------------------------
// ต่างจาก Administrator (super ภายในร้านตัวเอง):
// platform admin = query/จัดการ "ข้ามร้าน" ได้
//
// ความปลอดภัย: เช็คสิทธิ์จาก DB ทุกครั้ง (ไม่เชื่อ flag ใน JWT)
// การอ่าน tenant list เป็น cross-tenant โดยตั้งใจ — ผ่าน query() ปกติ
// (bms_tenants ไม่ได้อยู่ใต้ per-tenant RLS)
// =============================================================

import { GraphQLError } from "graphql/error";
import { requireAuth } from "@/lib/auth";
import { query } from "@/lib/db";

/** platform admin หรือไม่ — อ่านสด ๆ จาก DB ด้วย id ใน session */
export async function isPlatformAdmin(ctx: any): Promise<boolean> {
  const auth = requireAuth(ctx, { optionalAdmin: true });
  if (auth.scope !== "admin" || !auth.author_id) return false;
  try {
    const res = await query<{ is_platform_admin: boolean }>(
      `SELECT is_platform_admin FROM users WHERE id = $1`,
      [auth.author_id]
    );
    return res.rows[0]?.is_platform_admin === true;
  } catch (e: any) {
    // migration 5.6 ยังไม่ apply (column ไม่มี) → ถือว่าไม่ใช่ platform admin
    // ป้องกันหน้า admin ล่มทั้งระบบถ้า deploy มาก่อน migrate
    if (e?.code === "42703") return false;
    throw e;
  }
}

/** ต้องเป็น platform admin ไม่งั้น throw FORBIDDEN */
export async function requirePlatformAdmin(ctx: any): Promise<void> {
  if (!(await isPlatformAdmin(ctx))) {
    throw new GraphQLError("เฉพาะแอดมินแพลตฟอร์มเท่านั้น", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }
}

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  active: boolean;
  created_at: string;
  users: number;
  products: number;
  orders: number;
  revenue: number;
};

/** รายการทุกร้าน + สถิติสรุป (cross-tenant — platform admin เท่านั้น) */
export async function listTenants(): Promise<TenantRow[]> {
  const res = await query<any>(
    `SELECT t.id, t.name, t.slug, t.plan, t.active, t.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id)::int AS users,
            (SELECT COUNT(*) FROM bms_products p WHERE p.tenant_id = t.id)::int AS products,
            (SELECT COUNT(*) FROM bms_orders o WHERE o.tenant_id = t.id)::int AS orders,
            COALESCE((SELECT SUM(o.total_amount) FROM bms_orders o
                       WHERE o.tenant_id = t.id
                         AND o.status IN ('PAID','PACKING','SHIPPED','COMPLETED')), 0) AS revenue
       FROM bms_tenants t
      ORDER BY t.created_at ASC`
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    plan: r.plan,
    active: r.active,
    created_at: r.created_at,
    users: r.users ?? 0,
    products: r.products ?? 0,
    orders: r.orders ?? 0,
    revenue: Number(r.revenue ?? 0),
  }));
}

/** เปิด/ปิดร้าน (ปิด = ระงับการใช้งาน) */
export async function setTenantActive(tenantId: string, active: boolean): Promise<boolean> {
  const res = await query(`UPDATE bms_tenants SET active = $2 WHERE id = $1`, [tenantId, active]);
  return (res.rowCount ?? 0) > 0;
}
