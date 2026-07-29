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
