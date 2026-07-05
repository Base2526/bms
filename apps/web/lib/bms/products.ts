// =============================================================
// BMS Products & Inventory — admin management service (tenant-scoped)
// =============================================================

import { getClient, query } from "@/lib/db";
import { recordMovement } from "./movements";
import { beginTenantTx } from "./tenant";
import { enforceProductQuota } from "./plans";

export type ProductRowFull = {
  sku: string;
  name: string;
  active: boolean;
  price: string;
  keywords: string[];
  barcode: string | null;
};

export type VariantRow = {
  size: string;
  current_stock: number;
  reserved_stock: number;
  reorder_point: number;
};

export async function listProducts(tenantId: string): Promise<ProductRowFull[]> {
  const res = await query<ProductRowFull>(
    `SELECT tenant_id, sku, name, active, price, keywords, barcode
       FROM bms_products WHERE tenant_id = $1
      ORDER BY name`,
    [tenantId]
  );
  return res.rows;
}

export async function listVariants(tenantId: string, sku: string): Promise<VariantRow[]> {
  const res = await query<VariantRow>(
    `SELECT size, current_stock, reserved_stock, reorder_point
       FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2
      ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], size), size`,
    [tenantId, sku]
  );
  return res.rows;
}

export type UpsertProductInput = {
  sku: string;
  name: string;
  price: number;
  keywords?: string[];
  active?: boolean;
  barcode?: string | null;
};

export async function upsertProduct(tenantId: string, input: UpsertProductInput): Promise<ProductRowFull> {
  const sku = input.sku.trim();
  const name = input.name.trim();
  const price = Number(input.price);
  if (!sku || !name) throw new Error("sku และ name ห้ามว่าง");
  if (!Number.isFinite(price) || price < 0) throw new Error("ราคาไม่ถูกต้อง");

  const keywords = (input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const active = input.active ?? true;
  const barcode = input.barcode?.trim() || null;

  // quota: เฉพาะสินค้าใหม่ (sku ยังไม่มีในร้าน) ต้องไม่เกินแพ็กเกจ
  const existing = await query(`SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, sku]);
  if (existing.rowCount === 0) await enforceProductQuota(tenantId);

  const res = await query<ProductRowFull>(
    `INSERT INTO bms_products (tenant_id, sku, name, price, keywords, active, barcode)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, sku) DO UPDATE
       SET name = EXCLUDED.name, price = EXCLUDED.price, keywords = EXCLUDED.keywords,
           active = EXCLUDED.active, barcode = EXCLUDED.barcode, updated_at = now()
     RETURNING sku, name, active, price, keywords, barcode`,
    [tenantId, sku, name, price, keywords, active, barcode]
  );
  return res.rows[0];
}

export async function setProductActive(tenantId: string, sku: string, active: boolean): Promise<boolean> {
  const res = await query(
    `UPDATE bms_products SET active = $3, updated_at = now() WHERE tenant_id = $1 AND sku = $2`,
    [tenantId, sku, active]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function setReorderPoint(
  tenantId: string, sku: string, size: string, reorderPoint: number
): Promise<VariantRow> {
  const rp = Math.max(0, Math.floor(Number(reorderPoint) || 0));
  const res = await query<VariantRow>(
    `UPDATE bms_inventory SET reorder_point = $4, updated_at = now()
      WHERE tenant_id = $1 AND product_sku = $2 AND size = $3
      RETURNING size, current_stock, reserved_stock, reorder_point`,
    [tenantId, sku, size.trim().toUpperCase(), rp]
  );
  if (res.rowCount === 0) throw new Error("ไม่พบไซซ์นี้");
  return res.rows[0];
}

export async function listLowStock(tenantId: string): Promise<
  Array<VariantRow & { sku: string; name: string; available: number }>
> {
  const res = await query<any>(
    `SELECT p.sku, p.name, i.size, i.current_stock, i.reserved_stock, i.reorder_point,
            (i.current_stock - i.reserved_stock) AS available
       FROM bms_inventory i
       JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
      WHERE i.tenant_id = $1
        AND (i.current_stock - i.reserved_stock) <= i.reorder_point
        AND p.active
      ORDER BY available ASC, p.name`,
    [tenantId]
  );
  return res.rows;
}

/**
 * ปรับสต็อก (เติม/ลด current_stock) แบบ atomic ในร้านนั้น — upsert ไซซ์ใหม่ได้
 * ป้องกัน: current ห้ามติดลบ และห้ามต่ำกว่า reserved
 */
export async function adjustStock(
  tenantId: string, sku: string, size: string, delta: number,
  note?: string | null, actor?: string | null
): Promise<VariantRow> {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("delta ต้องเป็นจำนวนเต็มที่ไม่ใช่ 0");
  const sizeUp = size.trim().toUpperCase();

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const prod = await client.query(`SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, sku]);
    if (prod.rowCount === 0) {
      await client.query("ROLLBACK");
      throw new Error(`ไม่พบสินค้า ${sku}`);
    }

    const cur = await client.query<VariantRow>(
      `SELECT size, current_stock, reserved_stock, reorder_point
         FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2 AND size = $3 FOR UPDATE`,
      [tenantId, sku, sizeUp]
    );

    let row: VariantRow;
    if (cur.rowCount === 0) {
      if (delta < 0) {
        await client.query("ROLLBACK");
        throw new Error("ยังไม่มีไซซ์นี้ ลดสต็อกไม่ได้");
      }
      const ins = await client.query<VariantRow>(
        `INSERT INTO bms_inventory (tenant_id, product_sku, size, current_stock, reserved_stock)
         VALUES ($1, $2, $3, $4, 0)
         RETURNING size, current_stock, reserved_stock, reorder_point`,
        [tenantId, sku, sizeUp, delta]
      );
      row = ins.rows[0];
    } else {
      const next = cur.rows[0].current_stock + delta;
      if (next < cur.rows[0].reserved_stock) {
        await client.query("ROLLBACK");
        throw new Error(`ลดไม่ได้: current (${next}) จะต่ำกว่าที่จองไว้ (reserved ${cur.rows[0].reserved_stock})`);
      }
      const upd = await client.query<VariantRow>(
        `UPDATE bms_inventory SET current_stock = current_stock + $4, updated_at = now()
          WHERE tenant_id = $1 AND product_sku = $2 AND size = $3
          RETURNING size, current_stock, reserved_stock, reorder_point`,
        [tenantId, sku, sizeUp, delta]
      );
      row = upd.rows[0];
    }

    await recordMovement(client, {
      tenantId, sku, size: sizeUp,
      type: delta > 0 ? "STOCK_IN" : "STOCK_OUT",
      qty: Math.abs(delta), note: note ?? null, actor: actor ?? "admin",
    });

    await client.query("COMMIT");
    return row;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
