// =============================================================
// BMS Orders — สร้าง order + reserve สต็อกแบบ atomic
// -------------------------------------------------------------
// ทุกอย่างอยู่ในทรานแซกชันเดียว (getClient + BEGIN/COMMIT):
//   1) reserve สต็อกทุกรายการ (guard กัน oversell)
//   2) insert order + order_items (snapshot ราคา)
// ถ้ารายการใดของไม่พอ / ไม่พบ → ROLLBACK ทั้งออร์เดอร์
//
// จองแบบเรียงลำดับ (sku,size) เพื่อกัน deadlock ตอนสั่งพร้อมกัน
// =============================================================

import { getClient, query } from "@/lib/db";
import type { Channel } from "./pipeline";
import { recordOrderMovements } from "./movements";
import { resolveOrCreateCustomer } from "./customers";
import { beginTenantTx } from "./tenant";

export type OrderItemInput = { sku: string; size: string; qty: number };

export type CreateOrderInput = {
  tenantId: string;
  channel: Channel;
  customerRef?: string | null;
  items: OrderItemInput[];
};

export type CreatedLine = {
  sku: string;
  size: string;
  qty: number;
  unitPrice: number;
  availableAfter: number;
};

export type CreateOrderResult =
  | { status: "CREATED"; orderId: string; total: number; items: CreatedLine[] }
  | { status: "INSUFFICIENT"; sku: string; size: string; available: number; requested: number }
  | { status: "NOT_FOUND"; sku: string; size: string }
  | { status: "EMPTY" };

/** รวมรายการซ้ำ (sku+size เดียวกัน) แล้วบวก qty */
function mergeItems(items: OrderItemInput[]): OrderItemInput[] {
  const map = new Map<string, OrderItemInput>();
  for (const it of items) {
    const key = `${it.sku}__${it.size}`;
    const cur = map.get(key);
    if (cur) cur.qty += it.qty;
    else map.set(key, { sku: it.sku, size: it.size, qty: it.qty });
  }
  // เรียง deterministic เพื่อกัน deadlock
  return [...map.values()].sort((a, b) =>
    a.sku === b.sku ? a.size.localeCompare(b.size) : a.sku.localeCompare(b.sku)
  );
}

export async function createOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  const tenantId = input.tenantId;
  const items = mergeItems(input.items).filter(
    (it) => it.sku && it.size && Number.isInteger(it.qty) && it.qty > 0
  );
  if (items.length === 0) return { status: "EMPTY" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const lines: CreatedLine[] = [];
    let total = 0;

    for (const it of items) {
      // reserve แบบ atomic บน client ตัวเดียวกับทรานแซกชัน (ล็อกแถว inventory)
      const upd = await client.query<{ available_after: number }>(
        `UPDATE bms_inventory
            SET reserved_stock = reserved_stock + $3, updated_at = now()
          WHERE tenant_id = $4 AND product_sku = $1 AND size = $2
            AND (current_stock - reserved_stock) >= $3
          RETURNING (current_stock - reserved_stock) AS available_after`,
        [it.sku, it.size, it.qty, tenantId]
      );

      if (upd.rowCount === 0) {
        // แยกสาเหตุ: ไม่พบ row หรือ ของไม่พอ
        const cur = await client.query<{ available: number }>(
          `SELECT (current_stock - reserved_stock) AS available
             FROM bms_inventory WHERE tenant_id = $3 AND product_sku = $1 AND size = $2`,
          [it.sku, it.size, tenantId]
        );
        await client.query("ROLLBACK");
        if (cur.rowCount === 0) {
          return { status: "NOT_FOUND", sku: it.sku, size: it.size };
        }
        return {
          status: "INSUFFICIENT",
          sku: it.sku,
          size: it.size,
          available: Number(cur.rows[0].available),
          requested: it.qty,
        };
      }

      // ดึงราคา (สินค้าต้อง active)
      const prod = await client.query<{ price: string }>(
        `SELECT price FROM bms_products WHERE tenant_id = $2 AND sku = $1 AND active`,
        [it.sku, tenantId]
      );
      if (prod.rowCount === 0) {
        await client.query("ROLLBACK");
        return { status: "NOT_FOUND", sku: it.sku, size: it.size };
      }

      const unitPrice = Number(prod.rows[0].price);
      total += unitPrice * it.qty;
      lines.push({
        sku: it.sku,
        size: it.size,
        qty: it.qty,
        unitPrice,
        availableAfter: Number(upd.rows[0].available_after),
      });
    }

    // CRM: หา/สร้างลูกค้าจาก (tenant, channel, customerRef) ในทรานแซกชันเดียวกัน
    const customerId = await resolveOrCreateCustomer(
      client,
      tenantId,
      input.channel,
      input.customerRef ?? null
    );

    // สร้าง order (เริ่มที่ PENDING = รอชำระเงิน, จองสต็อกไว้แล้ว)
    const ord = await client.query<{ id: string }>(
      `INSERT INTO bms_orders (tenant_id, channel, customer_ref, customer_id, status, total_amount)
       VALUES ($1, $2, $3, $4, 'PENDING', $5)
       RETURNING id`,
      [tenantId, input.channel, input.customerRef ?? null, customerId, total]
    );
    const orderId = ord.rows[0].id;

    for (const ln of lines) {
      await client.query(
        `INSERT INTO bms_order_items (tenant_id, order_id, product_sku, size, qty, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, orderId, ln.sku, ln.size, ln.qty, ln.unitPrice]
      );
    }

    // ledger: RESERVE ทุกรายการ
    await recordOrderMovements(
      client,
      [orderId],
      "RESERVE",
      `customer:${input.customerRef ?? input.channel}`
    );

    await client.query("COMMIT");
    return { status: "CREATED", orderId, total, items: lines };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---- transition แบบไม่ขยับสต็อก (pay / pack / complete) — tenant-scoped -----
async function transition(
  tenantId: string,
  orderId: string,
  from: string[],
  to: string
): Promise<boolean> {
  const res = await query(
    `UPDATE bms_orders SET status = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = ANY($3)`,
    [tenantId, orderId, from, to]
  );
  return (res.rowCount ?? 0) > 0;
}

/** จ่ายเงินแล้ว: PENDING → PAID */
export const payOrder = (tenantId: string, orderId: string) => transition(tenantId, orderId, ["PENDING"], "PAID");
/** แพ็คของ: PAID → PACKING */
export const packOrder = (tenantId: string, orderId: string) => transition(tenantId, orderId, ["PAID"], "PACKING");
/** ปิดงาน: SHIPPED → COMPLETED */
export const completeOrder = (tenantId: string, orderId: string) => transition(tenantId, orderId, ["SHIPPED"], "COMPLETED");

/**
 * จัดส่งจริง: PACKING → SHIPPED → ตัด current+reserved (atomic, tenant-scoped)
 */
export async function shipOrder(tenantId: string, orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ord = await client.query(
      `UPDATE bms_orders SET status = 'SHIPPED', updated_at = now()
        WHERE tenant_id = $2 AND id = $1 AND status = 'PACKING'`,
      [orderId, tenantId]
    );
    if (ord.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `UPDATE bms_inventory inv
          SET current_stock  = current_stock  - oi.qty,
              reserved_stock = reserved_stock - oi.qty,
              updated_at = now()
         FROM bms_order_items oi
        WHERE oi.order_id = $1
          AND inv.tenant_id = oi.tenant_id
          AND inv.product_sku = oi.product_sku
          AND inv.size = oi.size`,
      [orderId]
    );

    await recordOrderMovements(client, [orderId], "SHIP", "system");

    await client.query("COMMIT");
    return true;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** คืนสินค้า: (SHIPPED/COMPLETED) → RETURNED → คืนสต็อก (current += qty) */
export async function returnOrder(tenantId: string, orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ord = await client.query(
      `UPDATE bms_orders SET status = 'RETURNED', updated_at = now()
        WHERE tenant_id = $2 AND id = $1 AND status IN ('SHIPPED','COMPLETED')`,
      [orderId, tenantId]
    );
    if (ord.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `UPDATE bms_inventory inv
          SET current_stock = current_stock + oi.qty, updated_at = now()
         FROM bms_order_items oi
        WHERE oi.order_id = $1
          AND inv.tenant_id = oi.tenant_id
          AND inv.product_sku = oi.product_sku
          AND inv.size = oi.size`,
      [orderId]
    );

    await recordOrderMovements(client, [orderId], "RETURN", "system");

    await client.query("COMMIT");
    return true;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ยกเลิก order → คืน reserved_stock (atomic, tenant-scoped)
 * ทำได้เฉพาะก่อนจัดส่ง (PENDING/PAID/PACKING)
 */
export async function cancelOrder(tenantId: string, orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ord = await client.query(
      `UPDATE bms_orders SET status = 'CANCELLED', updated_at = now()
        WHERE tenant_id = $2 AND id = $1 AND status IN ('PENDING','PAID','PACKING')`,
      [orderId, tenantId]
    );
    if (ord.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // คืน reserved ตามรายการใน order
    await client.query(
      `UPDATE bms_inventory inv
          SET reserved_stock = reserved_stock - oi.qty, updated_at = now()
         FROM bms_order_items oi
        WHERE oi.order_id = $1
          AND inv.tenant_id = oi.tenant_id
          AND inv.product_sku = oi.product_sku
          AND inv.size = oi.size`,
      [orderId]
    );

    await recordOrderMovements(client, [orderId], "RELEASE", "system");

    await client.query("COMMIT");
    return true;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Auto-release — ยกเลิก order สถานะ PENDING ที่ค้างเกิน N นาที แล้วคืน reserved_stock
 * ใช้เรียกจาก cron / worker เป็นระยะ (กันลูกค้าจองแล้วไม่จ่าย ค้างสต็อก)
 * ทำทั้งหมดในทรานแซกชันเดียว + FOR UPDATE SKIP LOCKED กันชนกับ cron ที่รันซ้อน
 * หมายเหตุ: ปล่อยเฉพาะ PENDING (ยังไม่จ่าย) — PAID ขึ้นไปไม่แตะ
 */
export async function releaseExpiredOrders(
  minutes: number
): Promise<{ released: number; orderIds: string[] }> {
  const mins = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 30;
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const expired = await client.query<{ id: string }>(
      `SELECT id FROM bms_orders
        WHERE status = 'PENDING'
          AND created_at < now() - make_interval(mins => $1)
        FOR UPDATE SKIP LOCKED`,
      [mins]
    );
    const ids = expired.rows.map((r) => r.id);
    if (ids.length === 0) {
      await client.query("COMMIT");
      return { released: 0, orderIds: [] };
    }

    // คืน reserved_stock ของทุก order ที่หมดอายุ
    await client.query(
      `UPDATE bms_inventory inv
          SET reserved_stock = reserved_stock - oi.qty, updated_at = now()
         FROM bms_order_items oi
        WHERE oi.order_id = ANY($1::uuid[])
          AND inv.tenant_id = oi.tenant_id
          AND inv.product_sku = oi.product_sku
          AND inv.size = oi.size`,
      [ids]
    );

    await recordOrderMovements(client, ids, "RELEASE", "system:auto-release");

    await client.query(
      `UPDATE bms_orders SET status = 'CANCELLED', updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    await client.query("COMMIT");
    return { released: ids.length, orderIds: ids };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}
