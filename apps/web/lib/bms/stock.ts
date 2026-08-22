// =============================================================
// BMS Stock — Backend API (Postgres, real)
// -------------------------------------------------------------
// ตาราง: bms_products, bms_inventory (migration 3.2)
// ทำตาม BUSINESS_RULES.md:
//   Available = Current - Reserved,  stock ห้ามติดลบ,  inactive ขายไม่ได้
//   เวลาลูกค้าสั่ง → reserve (เพิ่ม reserved_stock) ไม่ตัด current ทันที
//
// type StockResult คงเดิม → pipeline / nlu / ai ไม่ต้องแก้
// (findSize ยังเป็น pure function ใช้ใน nlu.ts)
// =============================================================

import { query } from "@/lib/db";
import {
  findAlternativeProducts,
  listSellableProducts,
  resolveSellableProduct,
  type SellableProduct,
} from "./products";
import { listSellablePacksForSize } from "./productPacks";

export type StockAlternative = Pick<
  SellableProduct,
  "sku" | "name" | "price" | "category" | "brand" | "availableTotal" | "availableSizes"
>;

/**
 * หน่วยขายที่ขายได้นอกจากหน่วยฐาน (7.86) — บอกโมเดลว่าสินค้านี้ยกแผง/ยกกล่องได้
 * `price: null` = ร้านไม่ได้ตั้งราคายกหน่วยไว้ ระบบคิดจากราคาต่อหน่วยฐาน × baseQty
 * โมเดลใช้ได้แค่ `packCode` ห้ามคิดราคาหรือ baseQty เอง
 */
export type StockPackOption = {
  packCode: string;
  unitName: string;
  baseQty: number;
  price: number | null;
};

export type StockResult =
  | {
      status: "IN_STOCK";
      sku: string;
      name: string;
      price: number;
      size: string;
      available: number;
      /** เว้นไว้เมื่อสินค้านี้ขายเป็นหน่วยฐานอย่างเดียว */
      packs?: StockPackOption[];
    }
  | {
      status: "OUT_OF_STOCK";
      sku: string;
      name: string;
      price: number;
      size: string;
      availableSizes?: Array<{ size: string; available: number }>;
      alternatives?: StockAlternative[];
    }
  | {
      status: "SIZE_UNKNOWN";
      sku: string;
      name: string;
      price: number;
      sizes: Array<{ size: string; available: number }>;
    }
  | { status: "NOT_FOUND"; query: string; alternatives?: StockAlternative[] };

const SIZE_TOKENS = ["XXL", "XL", "L", "M", "S"];

/** ดึงไซซ์ออกจากข้อความ เช่น "Nike XL มีไหม" → "XL" (pure, ใช้ใน nlu.ts) */
export function findSize(text: string): string | null {
  const t = ` ${text.toUpperCase()} `;
  for (const size of SIZE_TOKENS) {
    const re = new RegExp(`(^|[^A-Z])${size}([^A-Z]|$)`);
    if (re.test(t)) return size;
  }
  return null;
}

export type ProductRow = { sku: string; name: string; price: string };

/** Resolve against the shared active catalog search (name/SKU/barcode/category/brand/aliases). */
export async function resolveProduct(tenantId: string, text: string): Promise<ProductRow | null> {
  const product = await resolveSellableProduct(tenantId, text);
  return product
    ? { sku: product.sku, name: product.name, price: String(product.price) }
    : null;
}

/**
 * Backend API — เช็คสต็อกที่ขายได้จริงจาก Postgres
 * เช่น productText="Nike XL มีไหม", size="XL" → { status:"IN_STOCK", available:5 }
 */
export async function checkStock(
  tenantId: string,
  productText: string,
  size: string | null
): Promise<StockResult> {
  const product = await resolveProduct(tenantId, productText);
  if (!product) {
    const { items } = await listSellableProducts(tenantId, {
      inStockOnly: true,
      sort: "availability",
      limit: 3,
    });
    return { status: "NOT_FOUND", query: productText, alternatives: items };
  }

  const price = Number(product.price);

  if (!size) {
    const res = await query<{ size: string; available: number }>(
      `SELECT size, (current_stock - reserved_stock) AS available
         FROM bms_inventory
        WHERE tenant_id = $2 AND product_sku = $1
        ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], size)`,
      [product.sku, tenantId]
    );
    return {
      status: "SIZE_UNKNOWN",
      sku: product.sku,
      name: product.name,
      price,
      sizes: res.rows.map((r) => ({ size: r.size, available: Number(r.available) })),
    };
  }

  const res = await query<{ available: number }>(
    `SELECT (current_stock - reserved_stock) AS available
       FROM bms_inventory
      WHERE tenant_id = $3 AND product_sku = $1 AND size = $2`,
    [product.sku, size, tenantId]
  );
  const available = Number(res.rows[0]?.available ?? 0);
  if (available <= 0) {
    const [variants, alternativeResult] = await Promise.all([
      query<{ size: string; available: number }>(
        `SELECT size, GREATEST(current_stock - reserved_stock, 0) AS available
           FROM bms_inventory
          WHERE tenant_id = $2 AND product_sku = $1
          ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], size), size`,
        [product.sku, tenantId]
      ),
      findAlternativeProducts(tenantId, { sku: product.sku, size, limit: 3 }),
    ]);
    return {
      status: "OUT_OF_STOCK",
      sku: product.sku,
      name: product.name,
      price,
      size,
      availableSizes: variants.rows
        .map((variant) => ({ size: variant.size, available: Number(variant.available) }))
        .filter((variant) => variant.available > 0),
      alternatives: alternativeResult.alternatives,
    };
  }

  // หน่วยขายอื่นนอกจากหน่วยฐาน — ถ้าไม่บอกตรงนี้ โมเดลไม่มีทางรู้รหัสหน่วยขายเลย
  // แล้ว packCode ของ create_order จะใช้ไม่ได้ (schema สั่งห้ามเดารหัสเอง)
  const packs = await listSellablePacksForSize(tenantId, product.sku, size);
  return {
    status: "IN_STOCK",
    sku: product.sku,
    name: product.name,
    price,
    size,
    available,
    ...(packs.length > 0
      ? {
          packs: packs.map((pack) => ({
            packCode: pack.packCode,
            unitName: pack.unitName,
            baseQty: pack.baseQty,
            price: pack.price,
          })),
        }
      : {}),
  };
}

// =============================================================
// Reserve stock — เวลาลูกค้ายืนยันสั่งซื้อ
// -------------------------------------------------------------
// เพิ่ม reserved_stock แบบ atomic (กัน oversell): UPDATE จะสำเร็จ
// ก็ต่อเมื่อ available (current - reserved) ยังพอ ถ้าไม่พอ rowCount=0
// =============================================================

export type ReserveResult =
  | { status: "RESERVED"; sku: string; size: string; qty: number; availableAfter: number }
  | { status: "INSUFFICIENT"; sku: string; size: string; available: number; requested: number }
  | { status: "NOT_FOUND"; sku: string; size: string };

export async function reserveStock(
  sku: string,
  size: string,
  qty: number
): Promise<ReserveResult> {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("qty must be a positive integer");
  }

  // atomic reserve: สำเร็จเฉพาะเมื่อ available >= qty
  const upd = await query<{ available_after: number }>(
    `UPDATE bms_inventory
        SET reserved_stock = reserved_stock + $3,
            updated_at = now()
      WHERE product_sku = $1
        AND size = $2
        AND (current_stock - reserved_stock) >= $3
      RETURNING (current_stock - reserved_stock) AS available_after`,
    [sku, size, qty]
  );

  if (upd.rowCount && upd.rows[0]) {
    return {
      status: "RESERVED",
      sku,
      size,
      qty,
      availableAfter: Number(upd.rows[0].available_after),
    };
  }

  // ไม่สำเร็จ: แยกว่า "ไม่พบ SKU/size" หรือ "ของไม่พอ"
  const cur = await query<{ available: number }>(
    `SELECT (current_stock - reserved_stock) AS available
       FROM bms_inventory
      WHERE product_sku = $1 AND size = $2`,
    [sku, size]
  );
  if (cur.rowCount === 0) return { status: "NOT_FOUND", sku, size };

  return {
    status: "INSUFFICIENT",
    sku,
    size,
    available: Number(cur.rows[0].available),
    requested: qty,
  };
}
