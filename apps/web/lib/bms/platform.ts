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
import { query, getClient } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "./tenant";

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
    // pg คืน created_at เป็น Date object — ต้องแปลงเป็น ISO string เอง
    // (GraphQLString.serialize บน Date จะเรียก .valueOf() ได้ epoch number แล้วแปลงเป็น string ตัวเลข ไม่ใช่วันที่)
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
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

/** ชื่อร้าน (bms_tenants.name) จาก tenantId — ใช้เป็นชื่อร้านชื่อเดียวทั้งระบบ (AI/เอกสาร) */
export async function getTenantName(tenantId: string): Promise<string | null> {
  const r = await query<{ name: string }>(`SELECT name FROM bms_tenants WHERE id = $1`, [tenantId]);
  return r.rows[0]?.name ?? null;
}

/** Stable public-shop handle used when customer-safe tools return a product link. */
export async function getTenantSlug(tenantId: string): Promise<string | null> {
  const r = await query<{ slug: string }>(
    `SELECT slug FROM bms_tenants WHERE id = $1 AND active = TRUE`,
    [tenantId]
  );
  return r.rows[0]?.slug ?? null;
}

/** normalize slug: ตัวเล็ก, อนุญาต a-z 0-9 และ '-' (อื่น ๆ → '-'), ตัด '-' ซ้ำ/หัวท้าย */
function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * แก้ชื่อร้าน (bms_tenants.name) + slug — ให้ Administrator ของร้านแก้เองได้
 * slug: validate รูปแบบ + unique (ยกเว้นตัวเอง) · bms_tenants ไม่มี revision trigger จึงแก้ได้ตรง ๆ
 */
export async function updateTenantIdentity(
  tenantId: string,
  patch: { name?: string | null; slug?: string | null }
): Promise<{ id: string; name: string; slug: string }> {
  const name = typeof patch.name === "string" && patch.name.trim() ? patch.name.trim() : null;

  let slug: string | null = null;
  if (typeof patch.slug === "string" && patch.slug.trim()) {
    slug = normalizeSlug(patch.slug);
    if (!slug) throw new Error("slug ไม่ถูกต้อง (ใช้ได้เฉพาะ a-z, 0-9, -)");
    const dup = await query(`SELECT 1 FROM bms_tenants WHERE slug = $1 AND id <> $2 LIMIT 1`, [slug, tenantId]);
    if ((dup.rowCount ?? 0) > 0) throw new Error(`slug "${slug}" ถูกใช้แล้วโดยร้านอื่น`);
  }

  const res = await query<{ id: string; name: string; slug: string }>(
    `UPDATE bms_tenants
        SET name = COALESCE($2, name),
            slug = COALESCE($3, slug)
      WHERE id = $1
      RETURNING id, name, slug`,
    [tenantId, name, slug]
  );
  if (res.rowCount === 0) throw new Error("ไม่พบร้าน");
  return res.rows[0];
}

/**
 * ลบร้านถาวร — **เฉพาะร้านทดสอบ** (slug ต้องขึ้นต้นด้วย "test-") กันมือลั่นลบร้านลูกค้าจริง
 * ห้ามลบ DEFAULT_TENANT_ID เด็ดขาด (ร้านระบบที่ fixture/seed เก่าอ้างถึง)
 *
 * ลำดับ DELETE อ้างจาก FK graph จริงใน db/migrations (verify แล้ว ไม่ใช่เดา):
 * เกือบทุกตาราง BMS ผูก tenant_id ... ON DELETE CASCADE เข้า bms_tenants อยู่แล้ว (ตั้งแต่ 5.1
 * เป็นต้นไป) ยกเว้น 8 ตารางเดิมจาก migration 4.0 ที่ตอนนั้นสร้าง FK แบบ RESTRICT (ไม่ cascade):
 * bms_products/bms_inventory/bms_orders/bms_order_items/bms_stock_movements/bms_customers/
 * bms_customer_identities/bms_customer_addresses — 6 ใน 8 ตัวนี้ cascade กันเองอยู่แล้วผ่าน FK
 * อื่นที่ระบุ ON DELETE CASCADE ทีหลัง (inventory/order_items ← products/orders, identities/
 * addresses ← customers) เหลือแค่ 2 จุดที่ต้องลบเอง: bms_stock_movements และ bms_purchase_order_items
 * (ทั้งคู่มี FK ไป bms_products แบบ RESTRICT) — purchase_order_items ลบไปพร้อม bms_purchase_orders
 * (cascade). users.tenant_id ก็เป็น RESTRICT (4.1) ต้องลบ user ก่อน DELETE bms_tenants เสมอ
 * ไม่งั้น FK error. ใช้ query() ธรรมดา (ไม่ใช้ beginTenantTx) เพราะ bms_app role ไม่มีสิทธิ์บนตาราง
 * users เลย (ดู 4.3__bms_rls_role.sql — grant เฉพาะตาราง bms_*)
 */
export async function deleteTenant(tenantId: string): Promise<{ slug: string; name: string }> {
  if (tenantId === DEFAULT_TENANT_ID) {
    throw new Error("ห้ามลบร้าน default");
  }
  const t = await query<{ slug: string; name: string }>(
    `SELECT slug, name FROM bms_tenants WHERE id = $1`,
    [tenantId]
  );
  if (!t.rowCount) throw new Error("ไม่พบร้าน");
  const { slug, name } = t.rows[0];
  if (!slug.startsWith("test-")) {
    throw new Error(`ลบได้เฉพาะร้านทดสอบ (slug ต้องขึ้นต้นด้วย "test-", ร้านนี้คือ "${slug}")`);
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM bms_purchase_orders WHERE tenant_id = $1`, [tenantId]); // cascade → bms_purchase_order_items
    await client.query(`DELETE FROM bms_orders WHERE tenant_id = $1`, [tenantId]); // cascade → order_items/payments/shipments
    await client.query(`DELETE FROM bms_products WHERE tenant_id = $1`, [tenantId]); // cascade → inventory/product_images
    await client.query(`DELETE FROM bms_customers WHERE tenant_id = $1`, [tenantId]); // cascade → identities/addresses/ai_summary/coupon_wallet
    await client.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM bms_tenants WHERE id = $1`, [tenantId]); // cascade → ตารางที่เหลือทั้งหมด (channels/coupons/inbox/ai config/…)
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { slug, name };
}
