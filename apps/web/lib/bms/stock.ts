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
import { getVariantBasePrice, listSellablePacksForSize } from "./productPacks";

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
      sizes: Array<{ size: string; available: number; price: number }>;
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

  if (!size) {
    const res = await query<{ size: string; available: number; price: string }>(
      `SELECT i.size, (i.current_stock - i.reserved_stock) AS available,
              COALESCE(sized.price, shared.price, p.price)::text AS price
         FROM bms_inventory i
         JOIN bms_products p ON p.tenant_id = i.tenant_id AND p.sku = i.product_sku
         LEFT JOIN bms_product_packs sized
           ON sized.tenant_id = i.tenant_id AND sized.product_sku = i.product_sku
          AND sized.size = i.size AND sized.is_base AND sized.active
         LEFT JOIN bms_product_packs shared
           ON shared.tenant_id = i.tenant_id AND shared.product_sku = i.product_sku
          AND shared.size IS NULL AND shared.is_base AND shared.active
        WHERE i.tenant_id = $2 AND i.product_sku = $1
        ORDER BY array_position(ARRAY['S','M','L','XL','XXL'], size)`,
      [product.sku, tenantId]
    );
    const prices = res.rows.map((row) => Number(row.price));
    return {
      status: "SIZE_UNKNOWN",
      sku: product.sku,
      name: product.name,
      price: prices.length ? Math.min(...prices) : Number(product.price),
      sizes: res.rows.map((r) => ({ size: r.size, available: Number(r.available), price: Number(r.price) })),
    };
  }

  const price = await getVariantBasePrice(tenantId, product.sku, size) ?? Number(product.price);

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

// =============================================================
// ใครจองของอยู่ — อธิบายเลข reserved_stock ให้เป็นรายบิล
// -------------------------------------------------------------
// `bms_inventory.reserved_stock` เป็นยอดรวมที่ถูกบวกสะสม ไม่ได้เก็บว่าแต่ละหน่วย
// เป็นของบิลไหน (ไม่มีตาราง ledger ของการจอง) — ฟังก์ชันนี้จึงประกอบคำอธิบายกลับ
// จากบิลที่ยังถือของอยู่จริง: PENDING/PAID/PACKING (ปล่อยตอน SHIPPED/CANCELLED)
//
// อ่านจาก view `bms_order_stock_lines` (8.8) ไม่ใช่ `bms_order_items` เพราะสินค้าชุด
// จองที่ "ส่วนประกอบ" — บิลที่ขายเป็นเซ็ตต้องโผล่ในหน้าจอของส่วนประกอบ ไม่ใช่ของเซ็ต
//
// `unattributed` = ส่วนที่อธิบายไม่ได้ ต้องแสดงเสมอ ไม่ใช่ปัดทิ้ง: `/api/bms/reserve`
// จองได้โดยไม่ผูกบิล และการจองค้างจากบั๊กเก่าก็โผล่ที่นี่ — ถ้าไม่แสดง คนอ่านจะเชื่อว่า
// รายการที่เห็นครบแล้วทั้งที่ยังมีของถูกล็อกอยู่โดยไม่มีใครเป็นเจ้าของ
// =============================================================

/** สถานะบิลที่ยัง "ถือ" reserved_stock อยู่ — ปล่อยเมื่อ SHIPPED (ตัดของจริง) หรือ CANCELLED */
export const RESERVATION_HOLDING_STATUSES = ["PENDING", "PAID", "PACKING"] as const;

export type VariantReservationOrder = {
  orderId: string;
  status: string;
  channel: string;
  customerRef: string | null;
  customerName: string | null;
  customerPhone: string | null;
  qty: number;
  /** ไม่ null = บิลนี้ซื้อเป็นเซ็ต แล้วของถูกจองผ่านส่วนประกอบ */
  viaBundleSku: string | null;
  locationName: string | null;
  branchCode: string | null;
  /** ไม่ null = ของถูกจองไว้เพราะมัดจำที่ยังไม่ปิด (9.0) */
  depositStatus: string | null;
  createdAt: string;
};

export type VariantReservations = {
  sku: string;
  size: string;
  /** ยอดจองจริงในตาราง (รวมทุกสาขา) — ตัวเลขเดียวกับที่หน้า Products แสดง */
  reservedTotal: number;
  /** ผลรวมที่อธิบายได้จากบิลที่ยังถือของอยู่ */
  attributedTotal: number;
  /** reservedTotal - attributedTotal (ไม่ติดลบ) — ดู comment ด้านบน */
  unattributed: number;
  /** จำนวนบิลที่ถือของอยู่ทั้งหมด — มากกว่า orders.length เมื่อรายการถูกตัดที่ LIST_LIMIT */
  orderCount: number;
  orders: VariantReservationOrder[];
};

/** เพดานจำนวนบิลที่ส่งกลับ — ยอดรวมยังคิดจากทุกบิล ไม่ใช่แค่ 200 แถวแรก */
const RESERVATION_LIST_LIMIT = 200;

export async function listVariantReservations(
  tenantId: string,
  sku: string,
  size: string
): Promise<VariantReservations> {
  const inv = await query<{ reserved_total: number }>(
    `SELECT COALESCE(SUM(reserved_stock), 0)::int AS reserved_total
       FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2 AND size = $3`,
    [tenantId, sku, size]
  );
  const reservedTotal = Number(inv.rows[0]?.reserved_total ?? 0);

  const res = await query<{
    order_id: string;
    status: string;
    channel: string;
    customer_ref: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    qty: number;
    via_bundle_sku: string | null;
    location_name: string | null;
    branch_code: string | null;
    deposit_status: string | null;
    created_at: Date | string;
  }>(
    `SELECT o.id::text AS order_id,
            o.status,
            o.channel,
            o.customer_ref,
            c.name  AS customer_name,
            c.phone AS customer_phone,
            SUM(v.qty)::int AS qty,
            -- บรรทัดที่ขายเป็นเซ็ต: view แตกเป็นส่วนประกอบแล้ว จึงย้อนกลับไปหาชื่อเซ็ต
            -- ที่ bms_order_items เพื่อไม่ให้พนักงานเห็นบิลที่ "ไม่มีสินค้านี้อยู่ในบิล"
            (array_agg(DISTINCT oi.product_sku) FILTER (WHERE oi.product_sku <> $2))[1]
              AS via_bundle_sku,
            l.name AS location_name,
            l.branch_code,
            d.status AS deposit_status,
            MIN(o.created_at) AS created_at
       FROM bms_order_stock_lines v
       JOIN bms_orders o
         ON o.tenant_id = v.tenant_id AND o.id = v.order_id
       JOIN bms_order_items oi
         ON oi.id = v.order_item_id
       LEFT JOIN bms_customers c
         ON c.id = o.customer_id
       LEFT JOIN bms_locations l
         ON l.tenant_id = v.tenant_id AND l.id = v.location_id
       LEFT JOIN bms_pos_deposits d
         ON d.tenant_id = o.tenant_id AND d.order_id = o.id AND d.status = 'OPEN'
      WHERE v.tenant_id = $1
        AND v.product_sku = $2
        AND v.size = $3
        AND o.status = ANY($4::text[])
      GROUP BY o.id, o.status, o.channel, o.customer_ref, c.name, c.phone,
               l.name, l.branch_code, d.status
      ORDER BY MIN(o.created_at) DESC
      LIMIT $5`,
    [tenantId, sku, size, [...RESERVATION_HOLDING_STATUSES], RESERVATION_LIST_LIMIT]
  );

  const orders: VariantReservationOrder[] = res.rows.map((r) => ({
    orderId: r.order_id,
    status: r.status,
    channel: r.channel,
    customerRef: r.customer_ref,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    qty: Number(r.qty),
    viaBundleSku: r.via_bundle_sku,
    locationName: r.location_name,
    branchCode: r.branch_code,
    depositStatus: r.deposit_status,
    // pg คืน timestamptz เป็น Date — field เป็น String! ใน GraphQL ต้องแปลงที่นี่
    // ไม่งั้น serialize ได้ epoch number แล้วหน้าจอโชว์ Invalid Date
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));

  // คิดยอดรวมจากทุกบิล ไม่ใช่จากรายการที่ถูกตัดด้วย LIMIT — ไม่งั้น "อธิบายไม่ได้"
  // จะพุ่งขึ้นเองเมื่อสินค้าตัวนั้นมีบิลค้างเกินเพดาน แล้วชี้ไปที่ปัญหาที่ไม่มีอยู่
  const agg = await query<{ attributed_total: number; order_count: number }>(
    `SELECT COALESCE(SUM(v.qty), 0)::int      AS attributed_total,
            COUNT(DISTINCT v.order_id)::int   AS order_count
       FROM bms_order_stock_lines v
       JOIN bms_orders o
         ON o.tenant_id = v.tenant_id AND o.id = v.order_id
      WHERE v.tenant_id = $1
        AND v.product_sku = $2
        AND v.size = $3
        AND o.status = ANY($4::text[])`,
    [tenantId, sku, size, [...RESERVATION_HOLDING_STATUSES]]
  );
  const attributedTotal = Number(agg.rows[0]?.attributed_total ?? 0);

  return {
    sku,
    size,
    reservedTotal,
    attributedTotal,
    unattributed: Math.max(0, reservedTotal - attributedTotal),
    orderCount: Number(agg.rows[0]?.order_count ?? 0),
    orders,
  };
}
