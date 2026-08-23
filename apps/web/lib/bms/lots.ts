// =============================================================
// BMS Inventory Lots — lot + วันหมดอายุ (migration 7.85)
// -------------------------------------------------------------
// โครงสร้าง 2 ชั้น: bms_inventory เป็นยอดสรุปที่ยังใช้จองสต็อกแบบ atomic
// เหมือนเดิม ส่วนไฟล์นี้ดูแลชั้นรายละเอียดใต้มัน
//
// invariant:  SUM(bms_inventory_lots.qty) = bms_inventory.current_stock
//             ต่อ (tenant, location, sku, size)
// ฐานข้อมูลบังคับให้เองไม่ได้ → ทุก write ต้องผ่านไฟล์นี้ และมี
// reconcileLotTotals() ไว้ให้ job รายวันจับกรณีที่หลุด
//
// เหตุที่ต้องมี: เรียกคืนยาตาม lot ได้, ไม่จ่ายยาหมดอายุ, จ่าย lot เก่าก่อน (FEFO)
// =============================================================

import type { PoolClient } from "pg";
import { query } from "@/lib/db";

export type InventoryLot = {
  id: string;
  locationId: string;
  productSku: string;
  size: string;
  lotNo: string;
  expiryDate: string | null;
  receivedAt: string;
  supplierId: string | null;
  unitCost: number | null;
  qty: number;
  note: string | null;
};

function toISO(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toDate(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function mapLot(r: any): InventoryLot {
  return {
    id: r.id,
    locationId: r.location_id,
    productSku: r.product_sku,
    size: r.size,
    lotNo: r.lot_no,
    expiryDate: toDate(r.expiry_date),
    receivedAt: toISO(r.received_at),
    supplierId: r.supplier_id ?? null,
    unitCost: r.unit_cost == null ? null : Number(r.unit_cost),
    qty: Number(r.qty),
    note: r.note ?? null,
  };
}

/**
 * รับของเข้า lot — lot_no เดิมของสินค้าเดียวกันในสาขาเดียวกันจะบวกจำนวนเข้าไป
 * ต้องเรียกในทรานแซกชันเดียวกับที่บวก bms_inventory.current_stock เสมอ
 * ไม่งั้น invariant พังทันที
 *
 * วันหมดอายุที่ส่งมาใหม่จะทับของเดิมเฉพาะเมื่อของเดิมยังว่าง — ซัพพลายเออร์
 * ส่ง lot เดิมมาพร้อมวันหมดอายุคนละวันแปลว่ามีอะไรผิด ไม่ควรเขียนทับเงียบ ๆ
 */
export async function receiveLotInTx(
  client: PoolClient,
  input: {
    tenantId: string;
    locationId: string;
    productSku: string;
    size: string;
    lotNo: string;
    qty: number;
    expiryDate?: string | null;
    supplierId?: string | null;
    unitCost?: number | null;
    note?: string | null;
  }
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO bms_inventory_lots
       (tenant_id, location_id, product_sku, size, lot_no, expiry_date, supplier_id, unit_cost, qty, note)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, location_id, product_sku, size, lot_no)
     DO UPDATE SET qty         = bms_inventory_lots.qty + EXCLUDED.qty,
                   expiry_date = COALESCE(bms_inventory_lots.expiry_date, EXCLUDED.expiry_date),
                   supplier_id = COALESCE(bms_inventory_lots.supplier_id, EXCLUDED.supplier_id),
                   unit_cost   = COALESCE(EXCLUDED.unit_cost, bms_inventory_lots.unit_cost),
                   updated_at  = now()
     RETURNING id`,
    [input.tenantId, input.locationId, input.productSku, input.size, input.lotNo,
      input.expiryDate ?? null, input.supplierId ?? null, input.unitCost ?? null,
      input.qty, input.note ?? null]
  );
  return res.rows[0].id;
}

export async function listLots(
  tenantId: string,
  opts: { productSku?: string | null; size?: string | null; locationId?: string | null; includeEmpty?: boolean } = {}
): Promise<InventoryLot[]> {
  const res = await query(
    `SELECT * FROM bms_inventory_lots
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR product_sku = $2)
        AND ($3::text IS NULL OR size = $3)
        AND ($4::uuid IS NULL OR location_id = $4)
        AND ($5::boolean OR qty > 0)
      ORDER BY expiry_date NULLS LAST, received_at`,
    [tenantId, opts.productSku ?? null, opts.size ?? null, opts.locationId ?? null, opts.includeEmpty ?? false]
  );
  return res.rows.map(mapLot);
}

/** ของที่หมดอายุแล้ว หรือจะหมดภายใน N วัน — ยังมีของค้างอยู่เท่านั้น */
export async function listExpiringLots(tenantId: string, withinDays = 90): Promise<InventoryLot[]> {
  const days = Math.min(Math.max(Math.floor(withinDays), 0), 3650);
  const res = await query(
    `SELECT * FROM bms_inventory_lots
      WHERE tenant_id = $1 AND qty > 0
        AND expiry_date IS NOT NULL
        AND expiry_date <= (now() AT TIME ZONE 'Asia/Bangkok')::date + ($2::int * INTERVAL '1 day')
      ORDER BY expiry_date`,
    [tenantId, days]
  );
  return res.rows.map(mapLot);
}

export type LotRecallHit = {
  orderId: string;
  orderCreatedAt: string;
  channel: string;
  productSku: string;
  qty: number;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
};

/**
 * เรียกคืน: lot นี้ถูกจ่ายออกไปในบิลไหนบ้าง
 *
 * ⚠️ ลูกค้าเดินเข้าที่ไม่ได้ผูกตัวตนจะได้ customerId = null — รู้ว่าขายไปกี่ชิ้น
 * วันไหน แต่ตามตัวคนไม่ได้ นี่คือข้อจำกัดของการไม่บังคับผูกเบอร์ตอนขาย
 */
export async function listOrdersForLot(tenantId: string, lotId: string): Promise<LotRecallHit[]> {
  const res = await query<any>(
    `SELECT o.id            AS order_id,
            o.created_at    AS order_created_at,
            o.channel,
            oi.product_sku,
            oil.qty,
            c.id            AS customer_id,
            c.name          AS customer_name,
            c.phone         AS customer_phone
       FROM bms_order_item_lots oil
       JOIN bms_order_items oi ON oi.id = oil.order_item_id
       JOIN bms_orders o       ON o.id = oi.order_id
       LEFT JOIN bms_customers c ON c.id = o.customer_id
      WHERE oil.tenant_id = $1 AND oil.lot_id = $2
      ORDER BY o.created_at DESC`,
    [tenantId, lotId]
  );
  return res.rows.map((r) => ({
    orderId: r.order_id,
    orderCreatedAt: toISO(r.order_created_at),
    channel: r.channel,
    productSku: r.product_sku,
    qty: Number(r.qty),
    customerId: r.customer_id ?? null,
    customerName: r.customer_name ?? null,
    customerPhone: r.customer_phone ?? null,
  }));
}

export type LotMismatch = {
  locationId: string;
  productSku: string;
  size: string;
  currentStock: number;
  lotTotal: number;
};

/**
 * ตรวจ invariant — ควรได้ผลว่าง
 * ทันทีหลัง apply 7.85 จะฟ้องทุกแถวที่มีของ เพราะยังไม่มี lot สักตัว
 * เปิด job ตรวจรายวันได้หลัง backfill lot ครบแล้วเท่านั้น
 */
export async function reconcileLotTotals(tenantId: string, limit = 100): Promise<LotMismatch[]> {
  const res = await query<any>(
    `SELECT i.location_id, i.product_sku, i.size, i.current_stock,
            COALESCE(SUM(l.qty), 0) AS lot_total
       FROM bms_inventory i
       LEFT JOIN bms_inventory_lots l
         ON  l.tenant_id   = i.tenant_id
         AND l.location_id = i.location_id
         AND l.product_sku = i.product_sku
         AND l.size        = i.size
      WHERE i.tenant_id = $1
      GROUP BY i.location_id, i.product_sku, i.size, i.current_stock
     HAVING i.current_stock <> COALESCE(SUM(l.qty), 0)
      ORDER BY i.product_sku, i.size
      LIMIT $2`,
    [tenantId, Math.min(Math.max(limit, 1), 500)]
  );
  return res.rows.map((r) => ({
    locationId: r.location_id,
    productSku: r.product_sku,
    size: r.size,
    currentStock: Number(r.current_stock),
    lotTotal: Number(r.lot_total),
  }));
}
