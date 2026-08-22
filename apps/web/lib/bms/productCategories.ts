// =============================================================
// BMS Product Categories — รายการหมวดหมู่สินค้าที่ร้านจัดการเอง (tenant-scoped)
// -------------------------------------------------------------
// bms_products.category ยังเป็น TEXT อิสระ (ไม่ใช่ FK) — ตารางนี้คือ "list ที่แนะนำ"
// ให้เลือกจากฟอร์มสินค้า + หน้าจัดการ ไม่ได้บังคับว่าสินค้าเก่าต้องอ้างชื่อในนี้เท่านั้น
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type ProductCategory = { id: string; name: string };

export async function listCategories(tenantId: string): Promise<ProductCategory[]> {
  const res = await query<ProductCategory>(
    `SELECT id, name FROM bms_product_categories WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  );
  return res.rows;
}

export async function createCategory(tenantId: string, name: string): Promise<ProductCategory> {
  const n = name.trim();
  if (!n) throw new Error("ชื่อหมวดหมู่ห้ามว่าง");

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const res = await client.query<ProductCategory>(
      `INSERT INTO bms_product_categories (tenant_id, name) VALUES ($1, $2)
       ON CONFLICT (tenant_id, name) DO NOTHING
       RETURNING id, name`,
      [tenantId, n]
    );
    if (res.rowCount === 0) {
      await client.query("ROLLBACK");
      throw new Error(`มีหมวดหมู่ "${n}" อยู่แล้ว`);
    }
    await client.query("COMMIT");
    return res.rows[0];
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** เปลี่ยนชื่อหมวดหมู่ — sync ชื่อเดิมไปยังสินค้าที่อ้างอยู่ด้วย (category เป็น text อิสระ ไม่ใช่ FK) */
export async function renameCategory(tenantId: string, id: string, name: string): Promise<ProductCategory> {
  const n = name.trim();
  if (!n) throw new Error("ชื่อหมวดหมู่ห้ามว่าง");

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const old = await client.query<{ name: string }>(
      `SELECT name FROM bms_product_categories WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    if (old.rowCount === 0) {
      await client.query("ROLLBACK");
      throw new Error("ไม่พบหมวดหมู่");
    }
    const res = await client.query<ProductCategory>(
      `UPDATE bms_product_categories SET name = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, name`,
      [tenantId, id, n]
    );
    await client.query(
      `UPDATE bms_products SET category = $3, updated_at = now() WHERE tenant_id = $1 AND category = $2`,
      [tenantId, old.rows[0].name, n]
    );
    await client.query("COMMIT");
    return res.rows[0];
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    if ((err as any)?.code === "23505") throw new Error(`มีหมวดหมู่ "${n}" อยู่แล้ว`);
    throw err;
  } finally {
    client.release();
  }
}

/** ลบหมวดหมู่จาก list — สินค้าที่เคยอ้างชื่อนี้ไม่ถูกลบ แค่ไม่โผล่ใน dropdown อีก (category ยังคงค่าเดิมไว้) */
export async function deleteCategory(tenantId: string, id: string): Promise<boolean> {
  const res = await query(
    `DELETE FROM bms_product_categories WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return (res.rowCount ?? 0) > 0;
}
