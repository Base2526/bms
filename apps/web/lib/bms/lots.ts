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
import { usableLotSql, inheritQualityHold } from "./lotQuality";

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

export type TransferLotAllocationResult =
  | { status: "UNTRACKED" }
  | { status: "UNRECONCILED"; lotTotal: number; stock: number }
  | { status: "INSUFFICIENT"; available: number }
  | {
      status: "ALLOCATED";
      allocations: Array<{
        lotId: string;
        lotNo: string;
        expiryDate: string | null;
        unitCost: number | null;
        supplierId: string | null;
        qty: number;
      }>;
    };

/**
 * Allocate and deduct transferable lots FEFO while the inventory summary row is locked.
 * The caller must lower bms_inventory.current_stock in the same transaction.
 */
export async function allocateLotsForTransferInTx(
  client: PoolClient,
  input: {
    tenantId: string;
    locationId: string;
    productSku: string;
    size: string;
    qty: number;
    currentStock: number;
    reservedStock: number;
  },
): Promise<TransferLotAllocationResult> {
  const lots = await client.query<{
    id: string;
    lot_no: string;
    expiry_date: string | null;
    unit_cost: string | number | null;
    supplier_id: string | null;
    qty: number;
    transferable: boolean;
  }>(
    `SELECT l.id, l.lot_no, l.expiry_date::text AS expiry_date, l.unit_cost,
            l.supplier_id, l.qty,
            (${usableLotSql("l")} AND
             (l.expiry_date IS NULL OR l.expiry_date >=
               (now() AT TIME ZONE 'Asia/Bangkok')::date)) AS transferable
       FROM bms_inventory_lots l
      WHERE l.tenant_id = $1 AND l.location_id = $2
        AND l.product_sku = $3 AND l.size = $4
      ORDER BY l.expiry_date NULLS LAST, l.received_at, l.id
      FOR UPDATE OF l`,
    [input.tenantId, input.locationId, input.productSku, input.size],
  );
  if (!lots.rowCount) return { status: "UNTRACKED" };

  const lotTotal = lots.rows.reduce((sum, lot) => sum + Number(lot.qty), 0);
  if (lotTotal !== input.currentStock) {
    return { status: "UNRECONCILED", lotTotal, stock: input.currentStock };
  }
  const transferable = lots.rows.filter((lot) => lot.transferable && Number(lot.qty) > 0);
  const usableTotal = transferable.reduce((sum, lot) => sum + Number(lot.qty), 0);
  const available = Math.max(0, usableTotal - input.reservedStock);
  if (available < input.qty) return { status: "INSUFFICIENT", available };

  let remaining = input.qty;
  const allocations: Extract<TransferLotAllocationResult, { status: "ALLOCATED" }>["allocations"] = [];
  for (const lot of transferable) {
    if (remaining === 0) break;
    const take = Math.min(remaining, Number(lot.qty));
    const updated = await client.query(
      `UPDATE bms_inventory_lots
          SET qty = qty - $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND qty >= $3`,
      [input.tenantId, lot.id, take],
    );
    if (updated.rowCount !== 1) throw new Error("TRANSFER_LOT_ALLOCATION_RACE");
    allocations.push({
      lotId: lot.id,
      lotNo: lot.lot_no,
      expiryDate: toDate(lot.expiry_date),
      unitCost: lot.unit_cost == null ? null : Number(lot.unit_cost),
      supplierId: lot.supplier_id ?? null,
      qty: take,
    });
    remaining -= take;
  }
  if (remaining !== 0) throw new Error("TRANSFER_LOT_ALLOCATION_INCOMPLETE");
  return { status: "ALLOCATED", allocations };
}

/** Allocate good units first and damaged units second across the sent FEFO lots. */
export function splitTransferReceiptAcrossLots(
  lots: ReadonlyArray<{ qty: number }>,
  receivedQty: number,
  damagedQty: number,
): Array<{ received: number; damaged: number; missing: number }> {
  if (lots.some((lot) => !Number.isSafeInteger(lot.qty) || lot.qty <= 0)) {
    throw new Error("INVALID_TRANSFER_LOT_RECEIPT");
  }
  const sent = lots.reduce((sum, lot) => sum + lot.qty, 0);
  if (
    !Number.isInteger(receivedQty) || receivedQty < 0 ||
    !Number.isInteger(damagedQty) || damagedQty < 0 ||
    receivedQty + damagedQty > sent
  ) {
    throw new Error("INVALID_TRANSFER_LOT_RECEIPT");
  }
  let goodRemaining = receivedQty;
  let damagedRemaining = damagedQty;
  return lots.map((lot) => {
    const qty = Number(lot.qty);
    const received = Math.min(qty, goodRemaining);
    goodRemaining -= received;
    const damaged = Math.min(qty - received, damagedRemaining);
    damagedRemaining -= damaged;
    return { received, damaged, missing: qty - received - damaged };
  });
}

/** Called after the destination summary increment, under its row lock, before lot writes.
 * Shared by transfer, purchase and POS return receipts.
 * Returning a reason requires the caller to roll back the entire receipt transaction.
 */
export async function validateTransferLotReceiptInTx(
  client: PoolClient,
  input: { tenantId: string; locationId: string; productSku: string; size: string;
    receivedQty: number; lots: ReadonlyArray<{ lot_no: string; expiry_date: string | null; qty: number }> },
): Promise<string | null> {
  if (input.receivedQty === 0) return null;
  const key = [input.tenantId, input.locationId, input.productSku, input.size];
  const inventory = await client.query<{ current_stock: number }>(
    `SELECT current_stock FROM bms_inventory
      WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE`, key);
  if (!inventory.rows.length || Number(inventory.rows[0].current_stock) < input.receivedQty) {
    return "ไม่พบยอดสต็อกที่รองรับสินค้ารับคืน กรุณาตรวจสอบสต็อกก่อนทำรายการ";
  }
  const existing = await client.query<{ lot_no: string; expiry_date: string | null; qty: number }>(
    `SELECT lot_no, expiry_date::text AS expiry_date, qty FROM bms_inventory_lots
      WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4
      ORDER BY id FOR UPDATE`, key);
  const before = Number(inventory.rows[0]?.current_stock) - input.receivedQty;
  const total = existing.rows.reduce((sum, lot) => sum + Number(lot.qty), 0);
  if ((input.lots.length || existing.rows.length) &&
      (total !== before || !input.lots.length)) {
    return "ยอดล็อตปลายทางไม่ตรงกับสต็อก หรือสินค้าที่รับไม่มีข้อมูลล็อต กรุณาตรวจสอบก่อนรับสินค้า";
  }
  if (!input.lots.length) return null;
  const shares = splitTransferReceiptAcrossLots(input.lots, input.receivedQty, 0);
  for (const [index, lot] of input.lots.entries()) {
    if (!shares[index].received) continue;
    const target = existing.rows.find((row) => row.lot_no === lot.lot_no);
    if (target && toDate(target.expiry_date) !== toDate(lot.expiry_date)) {
      return "เลขล็อตเดียวกันมีวันหมดอายุต่างกันที่สาขาปลายทาง กรุณาตรวจสอบก่อนรับสินค้า";
    }
  }
  return null;
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
  await inheritQualityHold(client,input.tenantId,res.rows[0].id,res.rows[0].id,"system:lot-receipt","RECEIPT");
  return res.rows[0].id;
}

/**
 * ตัดล็อตออกตามจำนวนของเสีย — ต้องเรียกในทรานแซกชันเดียวกับที่ลด `bms_inventory`
 *
 * ของเสียคือเส้นทางหลักที่ของหมดอายุออกจากชั้น การลดแต่ยอดรวมโดยไม่แตะล็อตทำให้
 * invariant `SUM(lots.qty) = current_stock` พังทันที ผลจริงคือ **ล็อตที่หมดอายุยังค้าง
 * จำนวนอยู่** แล้ว FEFO เอาไปจ่ายรอบถัดไป (หรือชน "lot ที่ขายได้ไม่พอ" กลางบิลของลูกค้า)
 * และ `reconcileLotTotals()` ขึ้นแดงโดยหาต้นเหตุไม่เจอ
 *
 * ต่างจากเส้นทางขายตรงที่ **ตัดล็อตที่หมดอายุก่อน ไม่ข้าม** — ของที่ทิ้งคือของหมดอายุ
 * ถ้าข้ามไปตัดล็อตดี ของหมดอายุจะอยู่ในระบบตลอดไปและของดีหายแทน
 *
 * สินค้าที่ไม่ได้ตามล็อตเลย (ไม่มีแถวใน `bms_inventory_lots`) ผ่านไปเฉย ๆ เหมือนเส้นทางขาย
 */
export async function consumeLotsForWastageInTx(
  client: PoolClient,
  input: { tenantId: string; locationId: string; productSku: string; size: string; qty: number; lotId?: string; forProduction?: boolean; qualityDisposal?: boolean }
): Promise<Array<{id:string; qty:number}>> {
  const key = [input.tenantId, input.locationId, input.productSku, input.size];
  const tracked = await client.query(
    `SELECT 1 FROM bms_inventory_lots
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4
      LIMIT 1`,
    key
  );
  if (!tracked.rowCount) {
    if(input.lotId) throw new Error('LOT_NOT_FOUND');
    return [];
  }
  const lots = await client.query<{ id: string; qty: number }>(
    `SELECT id, qty FROM bms_inventory_lots
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4
        AND qty > 0
        AND ($5::uuid IS NULL OR id=$5)
        AND ($7::boolean OR ${usableLotSql('bms_inventory_lots')})
        AND (NOT $6::boolean OR expiry_date IS NULL OR expiry_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
      ORDER BY expiry_date NULLS LAST, received_at, id
      FOR UPDATE`,
    [...key,input.lotId??null,input.forProduction===true,input.qualityDisposal===true&&!input.forProduction]
  );
  let remaining = input.qty;
  const allocations: Array<{id:string;qty:number}> = [];
  for (const lot of lots.rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(lot.qty));
    await client.query(
      `UPDATE bms_inventory_lots SET qty = qty - $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, lot.id, take]
    );
    remaining -= take;
    allocations.push({id:lot.id,qty:take});
  }
  if (remaining > 0) {
    if (input.forProduction) throw new Error('PRODUCTION_INSUFFICIENT_USABLE_LOTS');
    throw new Error(
      `lot ของ ${input.productSku}/${input.size} มีไม่พอสำหรับตัดของเสีย (ขาด ${remaining}) — ตรวจยอดล็อตก่อน`
    );
  }
  return allocations;
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
