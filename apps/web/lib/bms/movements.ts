// =============================================================
// BMS Stock movements — ledger (tenant-scoped)
// =============================================================

import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { valueMovementInTx } from "./inventoryValuation";
import { resolveDefaultLocationIdInTx } from "./locations";

export type MovementType =
  | "STOCK_IN"
  | "STOCK_OUT"
  | "RESERVE"
  | "RELEASE"
  | "SHIP"
  | "RETURN"
  // 7.98 — แยกจาก STOCK_IN/OUT เพราะการโอนย้ายไม่ได้ทำให้ของหายจากบริษัท
  // และของที่ขาดจากการนับเป็นตัวเลขที่บัญชีต้องเห็นแยกจากการตัดขายตามปกติ
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "COUNT_ADJUST"
  | "QUARANTINE_IN"
  | "TRANSFER_LOST"
  | "WASTAGE";

/**
 * ทิศทางของ COUNT_ADJUST (10.10) — qty เป็นบวกเสมอ ชนิดอื่นบอกทิศทางด้วยตัว type เอง
 * แต่การปรับจากการนับเป็นได้ทั้งเพิ่มและลด ถ้าไม่เก็บ รายงานรับเข้า/จ่ายออกสร้างจาก ledger ไม่ได้
 */
export type MovementDirection = "IN" | "OUT";

export type MovementRow = {
  id: string;
  product_sku: string;
  size: string;
  type: MovementType;
  qty: number;
  location_id: string;
  location_name: string | null;
  branch_code: string | null;
  ref_order_id: string | null;
  note: string | null;
  actor: string | null;
  created_at: string;
};

/**
 * บันทึก 1 movement ในทรานแซกชันเดียวกับการขยับสต็อก
 * locationId ไม่ระบุ → สาขาเริ่มต้นของร้าน (ดู lib/bms/locations.ts)
 */
export async function recordMovement(
  client: PoolClient,
  m: {
    tenantId: string;
    locationId?: string | null;
    sku: string;
    size: string;
    type: MovementType;
    qty: number;
    refOrderId?: string | null;
    note?: string | null;
    actor?: string | null;
    /** บังคับสำหรับ COUNT_ADJUST ห้ามใส่กับชนิดอื่น */
    direction?: MovementDirection | null;
    orderItemId?: string | number | null;
    returnId?: string | null;
    transferItemId?: string | number | null;
    purchaseItemId?: string | number | null;
    initialQty?: string;
  }
): Promise<void> {
  if (m.type === "COUNT_ADJUST" && !m.direction) {
    throw new Error("COUNT_ADJUST ต้องระบุทิศทาง (IN/OUT)");
  }
  if (m.type !== "COUNT_ADJUST" && m.direction) {
    throw new Error(`${m.type} บอกทิศทางด้วยตัวเองแล้ว ห้ามระบุ direction`);
  }
  const locationId = m.locationId ?? (await resolveDefaultLocationIdInTx(client, m.tenantId));
  // เขียนคอลัมน์ direction เฉพาะแถวที่มีค่า — การขาย/รับของ/โอนเรียกฟังก์ชันนี้ทุกบิล
  // ฐานที่ยังไม่ apply 10.10 ต้องไม่ทำให้การขายทั้งระบบล้ม
  if (m.direction) {
    const inserted = await client.query<{id:string}>(
      `INSERT INTO bms_stock_movements
         (tenant_id, location_id, product_sku, size, type, qty, ref_order_id, note, actor, direction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text`,
      [m.tenantId, locationId, m.sku, m.size, m.type, m.qty, m.refOrderId ?? null, m.note ?? null, m.actor ?? null,
        m.direction]
    );
    await valueMovementInTx(client, inserted.rows[0].id, { ...m, locationId });
    return;
  }
  const inserted = await client.query<{id:string}>(
    `INSERT INTO bms_stock_movements
       (tenant_id, location_id, product_sku, size, type, qty, ref_order_id, note, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text`,
    [m.tenantId, locationId, m.sku, m.size, m.type, m.qty, m.refOrderId ?? null, m.note ?? null, m.actor ?? null]
  );
  await valueMovementInTx(client, inserted.rows[0].id, { ...m, locationId });
}

/**
 * bulk movements ของทุกรายการใน order — ดึง tenant_id/location_id/sku/size/qty
 * จาก order_items เอง (order_items ถือสาขาที่ตัดของจริงตั้งแต่ 7.84)
 */
export async function recordOrderMovements(
  client: PoolClient,
  orderIds: string[],
  type: MovementType,
  actor: string | null
): Promise<void> {
  if (orderIds.length === 0) return;
  const lines = (await client.query<{
    tenant_id:string;location_id:string;product_sku:string;size:string;qty:number;order_id:string;order_item_id:string;initial_qty:string;
  }>(`SELECT l.*, (i.current_stock + CASE WHEN $2='SHIP' THEN 1 ELSE -1 END *
       SUM(l.qty) OVER(PARTITION BY l.tenant_id,l.location_id,l.product_sku,l.size))::text AS initial_qty
     FROM bms_order_stock_lines l JOIN bms_inventory i USING(tenant_id,location_id,product_sku,size)
     WHERE l.order_id=ANY($1::uuid[]) ORDER BY l.tenant_id,l.location_id,l.product_sku,l.size,l.order_item_id`,[orderIds,type])).rows;
  for (const line of lines) await recordMovement(client, {
    tenantId:line.tenant_id,locationId:line.location_id,sku:line.product_sku,size:line.size,
    type,qty:Number(line.qty),refOrderId:line.order_id,orderItemId:line.order_item_id,actor,
    initialQty:line.initial_qty,
  });
}

/** อ่านประวัติ (ล่าสุดก่อน) ต่อสินค้าในร้าน */
export async function listMovements(
  tenantId: string,
  sku: string,
  size: string | null,
  limit = 50
): Promise<MovementRow[]> {
  const lim = Math.min(Math.max(limit, 1), 200);
  const res = await query<MovementRow>(
    `SELECT m.id, m.product_sku, m.size, m.type, m.qty, m.location_id,
            loc.name AS location_name, loc.branch_code,
            m.ref_order_id, m.note, m.actor, m.created_at
       FROM bms_stock_movements m
       LEFT JOIN bms_locations loc ON loc.tenant_id = m.tenant_id AND loc.id = m.location_id
      WHERE m.tenant_id = $1 AND m.product_sku = $2
        AND ($3::text IS NULL OR m.size = $3)
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $4`,
    [tenantId, sku, size, lim]
  );
  return res.rows.map((r) => ({
    ...r,
    created_at: (r.created_at as unknown) instanceof Date ? (r.created_at as unknown as Date).toISOString() : String(r.created_at),
  }));
}
