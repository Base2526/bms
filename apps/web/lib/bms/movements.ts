// =============================================================
// BMS Stock movements — ledger (tenant-scoped)
// =============================================================

import type { PoolClient } from "pg";
import { query } from "@/lib/db";
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
  | "COUNT_ADJUST";

export type MovementRow = {
  id: string;
  product_sku: string;
  size: string;
  type: MovementType;
  qty: number;
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
  }
): Promise<void> {
  const locationId = m.locationId ?? (await resolveDefaultLocationIdInTx(client, m.tenantId));
  await client.query(
    `INSERT INTO bms_stock_movements
       (tenant_id, location_id, product_sku, size, type, qty, ref_order_id, note, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [m.tenantId, locationId, m.sku, m.size, m.type, m.qty, m.refOrderId ?? null, m.note ?? null, m.actor ?? null]
  );
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
  await client.query(
    `INSERT INTO bms_stock_movements
       (tenant_id, location_id, product_sku, size, type, qty, ref_order_id, actor)
     SELECT tenant_id, location_id, product_sku, size, $2, qty, order_id, $3
       FROM bms_order_items
      WHERE order_id = ANY($1::uuid[])`,
    [orderIds, type, actor]
  );
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
    `SELECT id, product_sku, size, type, qty, ref_order_id, note, actor, created_at
       FROM bms_stock_movements
      WHERE tenant_id = $1 AND product_sku = $2
        AND ($3::text IS NULL OR size = $3)
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [tenantId, sku, size, lim]
  );
  return res.rows.map((r) => ({
    ...r,
    created_at: (r.created_at as unknown) instanceof Date ? (r.created_at as unknown as Date).toISOString() : String(r.created_at),
  }));
}
