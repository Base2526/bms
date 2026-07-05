// =============================================================
// BMS Products & Inventory — admin management service
// -------------------------------------------------------------
// จัดการสินค้า (bms_products) และปรับสต็อก (bms_inventory)
// กฎ (BUSINESS_RULES): ราคาห้ามติดลบ, stock ห้ามติดลบ,
//   current_stock ห้ามต่ำกว่า reserved_stock (มี order จองค้างอยู่)
// reserved_stock ไม่ให้แก้มือ — ระบบจัดการผ่าน order เท่านั้น
// =============================================================

import { getClient, query } from "@/lib/db";
import { recordMovement } from "./movements";

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

export async function listProducts(): Promise<ProductRowFull[]> {
  const res = await query<ProductRowFull>(
    `SELECT sku, name, active, price, keywords, barcode
       FROM bms_products
      ORDER BY name`
  );
  return res.rows;
}

export async function listVariants(sku: string): Promise<VariantRow[]> {
  const res = await query<VariantRow>(
    `SELECT size, current_stock, reserved_stock, reorder_point
       FROM bms_inventory
      WHERE product_sku = $1
      ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], size), size`,
    [sku]
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

export async function upsertProduct(input: UpsertProductInput): Promise<ProductRowFull> {
  const sku = input.sku.trim();
  const name = input.name.trim();
  const price = Number(input.price);
  if (!sku || !name) throw new Error("sku และ name ห้ามว่าง");
  if (!Number.isFinite(price) || price < 0) throw new Error("ราคาไม่ถูกต้อง");

  const keywords = (input.keywords ?? [])
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const active = input.active ?? true;
  const barcode = input.barcode?.trim() || null;

  const res = await query<ProductRowFull>(
    `INSERT INTO bms_products (sku, name, price, keywords, active, barcode)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sku) DO UPDATE
       SET name = EXCLUDED.name,
           price = EXCLUDED.price,
           keywords = EXCLUDED.keywords,
           active = EXCLUDED.active,
           barcode = EXCLUDED.barcode,
           updated_at = now()
     RETURNING sku, name, active, price, keywords, barcode`,
    [sku, name, price, keywords, active, barcode]
  );
  return res.rows[0];
}

/** ตั้งจุดแจ้งเตือนของใกล้หมด (reorder point) ต่อไซซ์ */
export async function setReorderPoint(
  sku: string,
  size: string,
  reorderPoint: number
): Promise<VariantRow> {
  const rp = Math.max(0, Math.floor(Number(reorderPoint) || 0));
  const res = await query<VariantRow>(
    `UPDATE bms_inventory SET reorder_point = $3, updated_at = now()
      WHERE product_sku = $1 AND size = $2
      RETURNING size, current_stock, reserved_stock, reorder_point`,
    [sku, size.trim().toUpperCase(), rp]
  );
  if (res.rowCount === 0) throw new Error("ไม่พบไซซ์นี้");
  return res.rows[0];
}

/** รายการที่ของใกล้หมด/หมด (available <= reorder_point) ข้ามทุกสินค้า */
export async function listLowStock(): Promise<
  Array<VariantRow & { sku: string; name: string; available: number }>
> {
  const res = await query<any>(
    `SELECT p.sku, p.name, i.size, i.current_stock, i.reserved_stock, i.reorder_point,
            (i.current_stock - i.reserved_stock) AS available
       FROM bms_inventory i
       JOIN bms_products p ON p.sku = i.product_sku
      WHERE (i.current_stock - i.reserved_stock) <= i.reorder_point
        AND p.active
      ORDER BY available ASC, p.name`
  );
  return res.rows;
}

export async function setProductActive(sku: string, active: boolean): Promise<boolean> {
  const res = await query(
    `UPDATE bms_products SET active = $2, updated_at = now() WHERE sku = $1`,
    [sku, active]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * ปรับสต็อก (เติม/ลด current_stock) แบบ atomic — upsert ไซซ์ใหม่ได้
 * ป้องกัน: current_stock ห้ามติดลบ และห้ามต่ำกว่า reserved_stock
 * (ถ้ามี order จองค้าง จะลดต่ำกว่าที่จองไม่ได้)
 */
export async function adjustStock(
  sku: string,
  size: string,
  delta: number,
  note?: string | null,
  actor?: string | null
): Promise<VariantRow> {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error("delta ต้องเป็นจำนวนเต็มที่ไม่ใช่ 0");
  }
  const sizeUp = size.trim().toUpperCase();

  const client = await getClient();
  try {
    await client.query("BEGIN");

    // สินค้าต้องมีอยู่ (FK)
    const prod = await client.query(`SELECT 1 FROM bms_products WHERE sku = $1`, [sku]);
    if (prod.rowCount === 0) {
      await client.query("ROLLBACK");
      throw new Error(`ไม่พบสินค้า ${sku}`);
    }

    const cur = await client.query<VariantRow>(
      `SELECT size, current_stock, reserved_stock, reorder_point
         FROM bms_inventory
        WHERE product_sku = $1 AND size = $2
        FOR UPDATE`,
      [sku, sizeUp]
    );

    let row: VariantRow;
    if (cur.rowCount === 0) {
      if (delta < 0) {
        await client.query("ROLLBACK");
        throw new Error("ยังไม่มีไซซ์นี้ ลดสต็อกไม่ได้");
      }
      const ins = await client.query<VariantRow>(
        `INSERT INTO bms_inventory (product_sku, size, current_stock, reserved_stock)
         VALUES ($1, $2, $3, 0)
         RETURNING size, current_stock, reserved_stock, reorder_point`,
        [sku, sizeUp, delta]
      );
      row = ins.rows[0];
    } else {
      const next = cur.rows[0].current_stock + delta;
      if (next < cur.rows[0].reserved_stock) {
        await client.query("ROLLBACK");
        throw new Error(
          `ลดไม่ได้: current (${next}) จะต่ำกว่าที่จองไว้ (reserved ${cur.rows[0].reserved_stock})`
        );
      }
      const upd = await client.query<VariantRow>(
        `UPDATE bms_inventory
            SET current_stock = current_stock + $3, updated_at = now()
          WHERE product_sku = $1 AND size = $2
          RETURNING size, current_stock, reserved_stock, reorder_point`,
        [sku, sizeUp, delta]
      );
      row = upd.rows[0];
    }

    // ledger: บวก = STOCK_IN (รับเข้า), ลบ = STOCK_OUT (เบิกออก)
    await recordMovement(client, {
      sku,
      size: sizeUp,
      type: delta > 0 ? "STOCK_IN" : "STOCK_OUT",
      qty: Math.abs(delta),
      note: note ?? null,
      actor: actor ?? "admin",
    });

    await client.query("COMMIT");
    return row;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}
