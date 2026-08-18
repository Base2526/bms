// =============================================================
// BMS Product Packs — หน่วยขาย (7.86 + 7.93)
// -------------------------------------------------------------
// "หน่วยขาย" = สิ่งที่ลูกค้าซื้อจริงและมีบาร์โค้ดของตัวเอง
// ยาตัวเดียวกันอาจมี 2 หน่วยขาย: แผง 10 เม็ด กับ กล่อง 100 เม็ด
// คนละบาร์โค้ด คนละราคา — ตามที่ร้านค้าปลีกทำกันจริง
//
// สต็อกยังนับเป็น "หน่วยฐาน" หน่วยเดียวเสมอ (base_qty = 1)
// ขายเป็นกล่อง = ตัดสต็อก base_qty หน่วย ไม่ใช่แยกกองสต็อก
// =============================================================

import { query } from "@/lib/db";

export type ProductPack = {
  id: string;
  productSku: string;
  size: string | null;
  packCode: string;
  unitName: string;
  baseQty: number;
  barcode: string | null;
  /** null = คิดจากราคาสินค้า × baseQty (ไม่มีส่วนลดยกกล่อง) */
  price: number | null;
  isBase: boolean;
  active: boolean;
};

function mapPack(r: any): ProductPack {
  return {
    id: r.id,
    productSku: r.product_sku,
    size: r.size ?? null,
    packCode: r.pack_code,
    unitName: r.unit_name,
    baseQty: Number(r.base_qty),
    barcode: r.barcode ?? null,
    price: r.price == null ? null : Number(r.price),
    isBase: Boolean(r.is_base),
    active: Boolean(r.active),
  };
}

export async function listProductPacks(tenantId: string, productSku: string): Promise<ProductPack[]> {
  const res = await query(
    `SELECT * FROM bms_product_packs
      WHERE tenant_id = $1 AND product_sku = $2
      ORDER BY size NULLS FIRST, base_qty, pack_code`,
    [tenantId, productSku]
  );
  return res.rows.map(mapPack);
}

/**
 * หา pack ที่ขายได้จริงจาก packCode ที่ผู้เรียกอ้างมา (ใช้โดย create_order tool)
 *
 * ทำไมต้องมีตัวนี้แยกจาก listProductPacks: AI ส่งได้แค่ "ชื่อหน่วย" (packCode)
 * เท่านั้น **ห้ามส่ง baseQty หรือราคา** — ทั้งสองอย่างเป็นข้อเท็จจริงของร้านที่ต้อง
 * อ่านจากฐาน ไม่ใช่สิ่งที่โมเดลอนุมานได้ ถ้าปล่อยให้ส่งราคามา เท่ากับ AI ตั้งราคาขาย
 *
 * pack ที่ size เป็น null ใช้ได้กับทุกไซซ์ของสินค้านั้น (ตามที่ 7.86 ออกแบบไว้)
 */
export async function resolveSellablePack(
  tenantId: string,
  productSku: string,
  size: string | null,
  packCode: string
): Promise<ProductPack | null> {
  const code = String(packCode || "").trim();
  if (!code) return null;
  const res = await query(
    `SELECT * FROM bms_product_packs
      WHERE tenant_id = $1
        AND product_sku = $2
        AND upper(pack_code) = upper($3)
        AND active
        AND (size IS NULL OR size = $4)
      ORDER BY size NULLS LAST
      LIMIT 1`,
    [tenantId, productSku, code, size]
  );
  return res.rows[0] ? mapPack(res.rows[0]) : null;
}

/**
 * หน่วยขายที่ "ไม่ใช่หน่วยฐาน" ของสินค้า+ไซซ์นี้ — ใช้บอกโมเดลว่าสินค้านี้ขายยกแผง
 * ยกกล่องได้ด้วย ไม่ใช่แค่ทีละเม็ด
 *
 * ตัดหน่วยฐานออกเพราะการไม่ส่ง packCode หมายถึงหน่วยฐานอยู่แล้ว ส่งมาด้วยจะเปลือง
 * โทเคนใน tool result ทุกครั้งที่เช็กสต็อก โดยไม่เพิ่มข้อมูลให้ตัดสินใจ
 */
export async function listSellablePacksForSize(
  tenantId: string,
  productSku: string,
  size: string | null
): Promise<ProductPack[]> {
  const res = await query(
    `SELECT * FROM bms_product_packs
      WHERE tenant_id = $1
        AND product_sku = $2
        AND active
        AND NOT is_base
        AND (size IS NULL OR size = $3)
      ORDER BY base_qty, pack_code`,
    [tenantId, productSku, size]
  );
  return res.rows.map(mapPack);
}

/** ไซซ์ที่มีแถวสต็อกจริง — หน่วยขายควรผูกกับไซซ์ที่ขายได้เท่านั้น */
export async function listSizesForProduct(tenantId: string, productSku: string): Promise<string[]> {
  const res = await query<{ size: string }>(
    `SELECT DISTINCT size FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2 ORDER BY size`,
    [tenantId, productSku]
  );
  return res.rows.map((r) => r.size);
}

export type UpsertPackInput = {
  id?: string | null;
  productSku: string;
  size?: string | null;
  packCode: string;
  unitName: string;
  baseQty: number;
  barcode?: string | null;
  price?: number | null;
  isBase?: boolean;
  active?: boolean;
};

export async function upsertProductPack(tenantId: string, input: UpsertPackInput): Promise<ProductPack> {
  const packCode = String(input.packCode ?? "").trim().toUpperCase();
  const unitName = String(input.unitName ?? "").trim();
  const baseQty = Math.floor(Number(input.baseQty));
  const size = input.size?.trim() || null;
  const barcode = input.barcode?.trim() || null;

  if (!packCode) throw new Error("ต้องระบุรหัสหน่วยขาย (เช่น BASE, BOX)");
  if (!unitName) throw new Error("ต้องระบุชื่อหน่วย (เช่น แผง, กล่อง)");
  if (!Number.isInteger(baseQty) || baseQty < 1) throw new Error("จำนวนต่อหน่วยต้องเป็นจำนวนเต็มตั้งแต่ 1");
  if (input.isBase && baseQty !== 1) throw new Error("หน่วยฐานต้องมีจำนวนต่อหน่วย = 1");
  if (input.price != null && Number(input.price) < 0) throw new Error("ราคาติดลบไม่ได้");

  const prod = await query(
    `SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2`,
    [tenantId, input.productSku]
  );
  if (!prod.rowCount) throw new Error("ไม่พบสินค้านี้ในร้าน");

  // บาร์โค้ดซ้ำในร้าน = ยิงแล้วไม่รู้ว่าหมายถึงอันไหน — กันไว้ก่อนถึง DB
  // เพื่อให้ข้อความอ่านรู้เรื่องกว่า unique violation
  if (barcode) {
    const dup = await query<{ product_sku: string; size: string | null }>(
      `SELECT product_sku, size FROM bms_product_packs
        WHERE tenant_id = $1 AND barcode = $2 AND ($3::uuid IS NULL OR id <> $3)`,
      [tenantId, barcode, input.id ?? null]
    );
    if (dup.rowCount) {
      const d = dup.rows[0];
      throw new Error(`บาร์โค้ดนี้ใช้กับ ${d.product_sku}${d.size ? ` (${d.size})` : ""} อยู่แล้ว`);
    }
  }

  // หน่วยฐานมีได้ตัวเดียวต่อไซซ์ — ปิดตัวเดิมก่อน ไม่งั้นชน unique index
  if (input.isBase) {
    await query(
      `UPDATE bms_product_packs SET is_base = FALSE, updated_at = now()
        WHERE tenant_id = $1 AND product_sku = $2 AND is_base
          AND size IS NOT DISTINCT FROM $3::text
          AND ($4::uuid IS NULL OR id <> $4)`,
      [tenantId, input.productSku, size, input.id ?? null]
    );
  }

  const res = await query(
    `INSERT INTO bms_product_packs
       (id, tenant_id, product_sku, size, pack_code, unit_name, base_qty, barcode, price, is_base, active)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, FALSE), COALESCE($11, TRUE))
     ON CONFLICT (id) DO UPDATE
       SET size = EXCLUDED.size, pack_code = EXCLUDED.pack_code, unit_name = EXCLUDED.unit_name,
           base_qty = EXCLUDED.base_qty, barcode = EXCLUDED.barcode, price = EXCLUDED.price,
           is_base = EXCLUDED.is_base, active = EXCLUDED.active, updated_at = now()
     RETURNING *`,
    [input.id ?? null, tenantId, input.productSku, size, packCode, unitName, baseQty,
      barcode, input.price ?? null, input.isBase ?? null, input.active ?? null]
  );
  return mapPack(res.rows[0]);
}

export async function deleteProductPack(tenantId: string, id: string): Promise<boolean> {
  const res = await query(`DELETE FROM bms_product_packs WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return (res.rowCount ?? 0) > 0;
}

export type PackAudit = {
  sku: string;
  name: string;
  sizes: number;
  packs: number;
  sizesWithoutBarcode: string[];
};

/**
 * สินค้าหลายไซซ์ที่ยังมีบาร์โค้ดไม่ครบทุกไซซ์
 *
 * ไซซ์ที่ไม่มีบาร์โค้ดของตัวเองจะยิงไม่เจอ ต้องค้นชื่อแล้วกดเลือกไซซ์เอง
 * ซึ่งช้าและพลาดง่ายตอนมีคิว — หน้าจัดการใช้รายการนี้เป็นงานที่ต้องตามเก็บ
 */
export async function listProductsNeedingBarcodes(tenantId: string, limit = 200): Promise<PackAudit[]> {
  const res = await query<any>(
    `SELECT p.sku, p.name,
            count(DISTINCT i.size) AS sizes,
            count(DISTINCT k.id)   AS packs,
            COALESCE(array_agg(DISTINCT i.size) FILTER (
              WHERE NOT EXISTS (
                SELECT 1 FROM bms_product_packs k2
                 WHERE k2.tenant_id = p.tenant_id AND k2.product_sku = p.sku
                   AND k2.size IS NOT DISTINCT FROM i.size AND k2.barcode IS NOT NULL
              )
            ), '{}') AS sizes_without_barcode
       FROM bms_products p
       JOIN bms_inventory i ON i.tenant_id = p.tenant_id AND i.product_sku = p.sku
       LEFT JOIN bms_product_packs k ON k.tenant_id = p.tenant_id AND k.product_sku = p.sku
      WHERE p.tenant_id = $1 AND p.active
      GROUP BY p.tenant_id, p.sku, p.name
     HAVING count(DISTINCT i.size) > 1
        AND cardinality(COALESCE(array_agg(DISTINCT i.size) FILTER (
              WHERE NOT EXISTS (
                SELECT 1 FROM bms_product_packs k2
                 WHERE k2.tenant_id = p.tenant_id AND k2.product_sku = p.sku
                   AND k2.size IS NOT DISTINCT FROM i.size AND k2.barcode IS NOT NULL
              )
            ), '{}')) > 0
      ORDER BY p.name
      LIMIT $2`,
    [tenantId, Math.min(Math.max(limit, 1), 500)]
  );
  return res.rows.map((r: any) => ({
    sku: r.sku,
    name: r.name,
    sizes: Number(r.sizes),
    packs: Number(r.packs),
    sizesWithoutBarcode: r.sizes_without_barcode ?? [],
  }));
}
