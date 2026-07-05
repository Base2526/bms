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

export type StockResult =
  | { status: "IN_STOCK"; sku: string; name: string; price: number; size: string; available: number }
  | { status: "OUT_OF_STOCK"; sku: string; name: string; price: number; size: string }
  | {
      status: "SIZE_UNKNOWN";
      sku: string;
      name: string;
      price: number;
      sizes: Array<{ size: string; available: number }>;
    }
  | { status: "NOT_FOUND"; query: string };

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

/** หาสินค้าจาก keyword: message มี keyword ตัวใดตัวหนึ่งเป็น substring */
export async function resolveProduct(text: string): Promise<ProductRow | null> {
  const res = await query<ProductRow>(
    `SELECT sku, name, price
       FROM bms_products
      WHERE active
        AND EXISTS (
          SELECT 1 FROM unnest(keywords) AS k
           WHERE $1 ILIKE '%' || k || '%'
        )
      ORDER BY char_length(name) DESC
      LIMIT 1`,
    [text]
  );
  return res.rows[0] ?? null;
}

/**
 * Backend API — เช็คสต็อกที่ขายได้จริงจาก Postgres
 * เช่น productText="Nike XL มีไหม", size="XL" → { status:"IN_STOCK", available:5 }
 */
export async function checkStock(
  productText: string,
  size: string | null
): Promise<StockResult> {
  const product = await resolveProduct(productText);
  if (!product) return { status: "NOT_FOUND", query: productText };

  const price = Number(product.price);

  if (!size) {
    const res = await query<{ size: string; available: number }>(
      `SELECT size, (current_stock - reserved_stock) AS available
         FROM bms_inventory
        WHERE product_sku = $1
        ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], size)`,
      [product.sku]
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
      WHERE product_sku = $1 AND size = $2`,
    [product.sku, size]
  );
  const available = Number(res.rows[0]?.available ?? 0);
  if (available <= 0) {
    return { status: "OUT_OF_STOCK", sku: product.sku, name: product.name, price, size };
  }

  return { status: "IN_STOCK", sku: product.sku, name: product.name, price, size, available };
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
