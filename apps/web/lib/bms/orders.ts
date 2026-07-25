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
import { listConversationHelpers, listSystemEvents } from "./inbox";
import { listShipments, MARKETPLACE_CHANNELS } from "./shipping";
import { notifyOrderStatusEmail } from "./orderNotify";
import { applyCouponInTx, releaseCouponForOrdersInTx, redeemCustomerCouponForOrderInTx, releaseCustomerCouponReservationsInTx, reserveCustomerCouponInTx } from "./coupons";

export type OrderItemInput = { sku: string; size: string; qty: number };

export type CreateOrderInput = {
  tenantId: string;
  channel: Channel;
  customerRef?: string | null;
  items: OrderItemInput[];
  editorId?: string | number | null;
  couponCode?: string | null;
};

export type CreatedLine = {
  sku: string;
  size: string;
  qty: number;
  unitPrice: number;
  availableAfter: number;
};

export type CreateOrderResult =
  | { status: "CREATED"; orderId: string; total: number; subtotal: number; discount: number; couponCode: string | null; items: CreatedLine[] }
  | { status: "INSUFFICIENT"; sku: string; size: string; available: number; requested: number }
  | { status: "NOT_FOUND"; sku: string; size: string }
  | { status: "COUPON_INVALID"; reason: string }
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
    await beginTenantTx(client, tenantId, { editorId: input.editorId });

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

    // โค้ดส่วนลด (ถ้ามี) — ตรวจ + เพิ่ม redemptions_count แบบ atomic ในทรานแซกชันเดียวกัน
    // ก่อน insert order เสมอ เพื่อให้ ROLLBACK คืนสต็อกที่จองไว้ด้วยถ้าโค้ดใช้ไม่ได้
    let discount = 0;
    let appliedCouponCode: string | null = null;
    let appliedCouponId: string | null = null;
    if (input.couponCode) {
      const couponResult = await applyCouponInTx(client, tenantId, input.couponCode, customerId, total);
      if (!couponResult.ok) {
        await client.query("ROLLBACK");
        return { status: "COUPON_INVALID", reason: couponResult.reason };
      }
      discount = couponResult.discount;
      appliedCouponCode = couponResult.code;
      appliedCouponId = couponResult.couponId; // ผูกด้วย id ที่นิ่ง — ประวัติการใช้ join ด้วย id ไม่ใช่ code
    }
    const finalTotal = Math.max(0, total - discount);

    // สร้าง order (เริ่มที่ PENDING = รอชำระเงิน, จองสต็อกไว้แล้ว)
    const ord = await client.query<{ id: string }>(
      `INSERT INTO bms_orders (tenant_id, channel, customer_ref, customer_id, status, total_amount, discount_amount, coupon_code, coupon_id)
       VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8)
       RETURNING id`,
      [tenantId, input.channel, input.customerRef ?? null, customerId, finalTotal, discount, appliedCouponCode, appliedCouponId]
    );
    const orderId = ord.rows[0].id;

    await reserveCustomerCouponInTx(client, tenantId, customerId, appliedCouponId, orderId);

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
    return { status: "CREATED", orderId, total: finalTotal, subtotal: total, discount, couponCode: appliedCouponCode, items: lines };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export type ReorderResult = CreateOrderResult | { status: "SOURCE_NOT_FOUND" };

export type CustomerOrderStatus = {
  orderId: string;
  displayOrderId: string;
  status: string;
  total: number;
  date: string;
};

/** Customer-safe order lookup scoped to the identity established by the channel adapter. */
export async function listCustomerOrderStatuses(
  tenantId: string,
  channel: Channel,
  customerRef: string,
  limit = 10
): Promise<CustomerOrderStatus[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 20);
  const res = await query<{ id: string; status: string; total_amount: string; created_at: Date | string }>(
    `SELECT id, status, total_amount, created_at
       FROM bms_orders
      WHERE tenant_id = $1 AND channel = $2 AND customer_ref = $3
      ORDER BY created_at DESC LIMIT $4`,
    [tenantId, channel, customerRef, boundedLimit]
  );
  return res.rows.map((row) => ({
    orderId: String(row.id),
    displayOrderId: String(row.id).slice(0, 8),
    status: row.status,
    total: Number(row.total_amount),
    date: new Date(row.created_at).toISOString(),
  }));
}

export async function customerOwnsOrder(
  tenantId: string,
  channel: Channel,
  customerRef: string,
  orderId: string
): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM bms_orders
      WHERE tenant_id = $1 AND id::text = $2 AND channel = $3 AND customer_ref = $4 LIMIT 1`,
    [tenantId, orderId, channel, customerRef]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * "ซื้อซ้ำ" — สร้างออร์เดอร์ใหม่จากรายการสินค้าของออร์เดอร์เก่า (channel/customer เดิม)
 * ราคาตัดตามราคาปัจจุบันของสินค้า (snapshot ใหม่) ไม่ใช่ราคาย้อนหลัง · ใช้ createOrder() เดิมทั้งหมด
 * (ระบบนี้ไม่มีสถานะ DRAFT แยก — ออร์เดอร์เริ่มที่ PENDING พร้อมจองสต็อกทันทีเหมือน createOrder ปกติ)
 */
export async function reorderFromOrder(
  tenantId: string,
  orderId: string,
  editorId?: string | number | null
): Promise<ReorderResult> {
  const src = await query<{ channel: Channel; customer_ref: string | null }>(
    `SELECT channel, customer_ref FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );
  if (src.rowCount === 0) return { status: "SOURCE_NOT_FOUND" };

  const itemsRes = await query<{ product_sku: string; size: string; qty: number }>(
    `SELECT product_sku, size, qty FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, orderId]
  );
  if (itemsRes.rowCount === 0) return { status: "EMPTY" };

  return createOrder({
    tenantId,
    channel: src.rows[0].channel,
    customerRef: src.rows[0].customer_ref,
    items: itemsRes.rows.map((r) => ({ sku: r.product_sku, size: r.size, qty: Number(r.qty) })),
    editorId,
  });
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
export async function payOrder(tenantId: string, orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const ord = await client.query(
      `UPDATE bms_orders SET status = 'PAID', updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
      [tenantId, orderId]
    );
    if ((ord.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await redeemCustomerCouponForOrderInTx(client, tenantId, orderId);
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
  const ok = true;
  if (ok) void notifyOrderStatusEmail(tenantId, orderId, "paid");
  return ok;
}
/** แพ็คของ: PAID → PACKING */
export async function packOrder(tenantId: string, orderId: string): Promise<boolean> {
  const ok = await transition(tenantId, orderId, ["PAID"], "PACKING");
  if (ok) void notifyOrderStatusEmail(tenantId, orderId, "packing");
  return ok;
}
/** ปิดงาน: SHIPPED → COMPLETED */
export async function completeOrder(tenantId: string, orderId: string): Promise<boolean> {
  const ok = await transition(tenantId, orderId, ["SHIPPED"], "COMPLETED");
  if (ok) void notifyOrderStatusEmail(tenantId, orderId, "completed");
  return ok;
}

/**
 * จัดส่งจริง: PACKING → SHIPPED → ตัด current+reserved (atomic, tenant-scoped)
 */
export async function shipOrder(tenantId: string, orderId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const info = await client.query<{ channel: string; customer_id: string | null }>(
      `SELECT channel, customer_id FROM bms_orders WHERE tenant_id = $1 AND id = $2 AND status = 'PACKING'`,
      [tenantId, orderId]
    );
    if (info.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // ช่องทางที่ร้านต้องเก็บที่อยู่เอง (ไม่ใช่มาร์เก็ตเพลส) ต้องมีที่อยู่จัดส่งของลูกค้าก่อนถึงจัดส่งได้จริง
    const { channel, customer_id } = info.rows[0];
    if (!MARKETPLACE_CHANNELS.has(channel)) {
      const addr = customer_id
        ? await client.query(
            `SELECT 1 FROM bms_customer_addresses
              WHERE tenant_id = $1 AND customer_id = $2 AND address_type = 'shipping' LIMIT 1`,
            [tenantId, customer_id]
          )
        : null;
      if (!addr || addr.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
    }

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
    void notifyOrderStatusEmail(tenantId, orderId, "shipped");
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
    void notifyOrderStatusEmail(tenantId, orderId, "returned");
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
    await releaseCouponForOrdersInTx(client, [orderId]);
    await releaseCustomerCouponReservationsInTx(client, [orderId]);

    await client.query("COMMIT");
    void notifyOrderStatusEmail(tenantId, orderId, "cancelled");
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
    await releaseCouponForOrdersInTx(client, ids);
    await releaseCustomerCouponReservationsInTx(client, ids);

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

// =============================================================
// Order Journey — เส้นทางออเดอร์ (ต้นทางแชท + stepper + timeline ละเอียด)
// -------------------------------------------------------------
// ไม่มีตาราง log ใหม่: ใช้ bms_audit_log เดิม (order.pay/pack/ship/complete/
// cancel/return) + order.created_at + conversation ต้นทาง (join 1:1 ด้วย
// tenant+channel+customer_ref) + bms_shipments · resolve ชื่อ actor จาก email
// =============================================================

type OrderStep = { status: string; at: string | null; actorName: string | null; reached: boolean; branch: boolean };
type OrderEvent = { kind: string; at: string; text: string; actorName: string | null };
type StaffRefRow = { id: string; name: string | null; avatar: string | null; email: string | null } | null;

export type OrderJourney = {
  orderId: string; channel: string; status: string;
  conversationId: string | null;
  assignedStaff: StaffRefRow;
  helpers: NonNullable<StaffRefRow>[];
  steps: OrderStep[];
  events: OrderEvent[];
};

const MAIN_FLOW = ["PENDING", "PAID", "PACKING", "SHIPPED", "COMPLETED"] as const;
const ACTION_TO_STATUS: Record<string, string> = {
  "order.create": "PENDING", "order.reorder": "PENDING",
  "order.pay": "PAID", "order.pack": "PACKING", "order.ship": "SHIPPED", "order.complete": "COMPLETED",
  "order.cancel": "CANCELLED", "order.return": "RETURNED",
};
const STEP_LABEL: Record<string, string> = {
  PENDING: "สร้างออเดอร์ (รอชำระ)", PAID: "ชำระเงินแล้ว", PACKING: "แพ็คสินค้า",
  SHIPPED: "จัดส่งแล้ว", COMPLETED: "ปิดออเดอร์", CANCELLED: "ยกเลิก", RETURNED: "รับคืนสินค้า",
};

const jIso = (d: any) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));

export async function getOrderJourney(tenantId: string, orderId: string): Promise<OrderJourney | null> {
  const o = await query<{ channel: string; customer_ref: string | null; status: string; created_at: any; updated_at: any }>(
    `SELECT channel, customer_ref, status, created_at, updated_at
       FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId]
  );
  if (o.rowCount === 0) return null;
  const ord = o.rows[0];

  // audit เกี่ยวกับ order นี้ (target = orderId) — resolve ชื่อ actor จาก email
  const auditRows = (await query<{ actor: string | null; action: string; created_at: any }>(
    `SELECT actor, action, created_at FROM bms_audit_log
      WHERE tenant_id = $1 AND target = $2 AND action LIKE 'order.%'
      ORDER BY created_at, id`,
    [tenantId, orderId]
  )).rows;

  const emails = new Set<string>();
  auditRows.forEach((r) => { if (r.actor && !r.actor.startsWith("system:") && r.actor.includes("@")) emails.add(r.actor); });
  const nameByEmail = new Map<string, string>();
  if (emails.size) {
    const u = await query<{ email: string; name: string | null }>(
      `SELECT email, name FROM users WHERE email = ANY($1::text[])`, [[...emails]]
    );
    u.rows.forEach((x) => nameByEmail.set(x.email, x.name || x.email));
  }
  const actorName = (a: string | null) => (!a ? null : a.startsWith("system:") ? "ระบบ" : (nameByEmail.get(a) ?? a));

  // audit ล่าสุดต่อ status (กันกดซ้ำ)
  const lastByStatus = new Map<string, { at: string; actorName: string | null }>();
  for (const r of auditRows) {
    const st = ACTION_TO_STATUS[r.action];
    if (st) lastByStatus.set(st, { at: jIso(r.created_at)!, actorName: actorName(r.actor) });
  }

  // ---- steps (เส้นหลัก + กิ่ง cancel/return) ----
  const steps: OrderStep[] = MAIN_FLOW.map((st) => {
    const hit = lastByStatus.get(st);
    if (st === "PENDING") return { status: st, at: jIso(ord.created_at), actorName: hit?.actorName ?? "ระบบ", reached: true, branch: false };
    // COMPLETED อาจมาจาก auto (จัดส่งถึง) ที่ไม่ได้ audit → fallback updated_at
    if (!hit && st === "COMPLETED" && ord.status === "COMPLETED") {
      return { status: st, at: jIso(ord.updated_at), actorName: "ระบบ", reached: true, branch: false };
    }
    return { status: st, at: hit?.at ?? null, actorName: hit?.actorName ?? null, reached: !!hit, branch: false };
  });
  for (const b of ["CANCELLED", "RETURNED"]) {
    const hit = lastByStatus.get(b);
    if (hit) steps.push({ status: b, at: hit.at, actorName: hit.actorName, reached: true, branch: true });
  }

  // ---- source conversation (join 1:1) + staff + helpers ----
  let conversationId: string | null = null;
  let assignedStaff: StaffRefRow = null;
  let helpers: NonNullable<StaffRefRow>[] = [];
  let convStart: string | null = null;
  const sysEvents: { kind: string; at: string; actorName: string; targetName: string | null }[] = [];
  if (ord.customer_ref) {
    const conv = (await query<{ id: string; created_at: any; assigned_to_user_id: string | null; an: string | null; av: string | null; ae: string | null }>(
      `SELECT c.id, c.created_at, c.assigned_to_user_id,
              u.name AS an, u.avatar AS av, u.email AS ae
         FROM bms_conversations c
         LEFT JOIN users u ON u.id = c.assigned_to_user_id
        WHERE c.tenant_id = $1 AND c.channel = $2 AND c.customer_ref = $3
        LIMIT 1`,
      [tenantId, ord.channel, ord.customer_ref]
    )).rows[0];
    if (conv) {
      conversationId = conv.id;
      convStart = jIso(conv.created_at);
      if (conv.assigned_to_user_id) assignedStaff = { id: conv.assigned_to_user_id, name: conv.an, avatar: conv.av, email: conv.ae };
      const hs = await listConversationHelpers(tenantId, conv.id);
      helpers = hs.map((h: any) => ({ id: h.id, name: h.name ?? null, avatar: h.avatar ?? null, email: h.email ?? null }));
      const se = await listSystemEvents(tenantId, conv.id);
      se.filter((e) => e.kind === "assign" || e.kind === "helper_add" || e.kind === "helper_remove")
        .forEach((e) => sysEvents.push({ kind: e.kind, at: e.at, actorName: e.actorName, targetName: e.targetName }));
    }
  }

  // ---- shipment (tracking) ----
  const shipRows = await listShipments(tenantId, { orderId });

  // ---- รวม timeline ละเอียด ----
  const events: OrderEvent[] = [];
  if (convStart) events.push({ kind: "chat_start", at: convStart, text: `ลูกค้าทักผ่าน ${ord.channel} · เริ่มบทสนทนา`, actorName: null });
  events.push({ kind: "order_status", at: jIso(ord.created_at)!, text: "สร้างออเดอร์ → PENDING", actorName: lastByStatus.get("PENDING")?.actorName ?? "ระบบ" });
  for (const e of sysEvents) {
    const text = e.kind === "assign" ? `มอบหมายแชทให้ ${e.targetName}`
      : e.kind === "helper_add" ? `เพิ่ม ${e.targetName} เป็นผู้ช่วยตอบ`
      : `ถอด ${e.targetName} ออกจากผู้ช่วยตอบ`;
    events.push({ kind: e.kind, at: e.at, text, actorName: e.actorName });
  }
  for (const r of auditRows) {
    if (r.action === "order.create" || r.action === "order.reorder") continue; // แทนด้วย event "สร้างออเดอร์ → PENDING" ด้านบนแล้ว (กันซ้ำ)
    const st = ACTION_TO_STATUS[r.action];
    if (st) events.push({ kind: "order_status", at: jIso(r.created_at)!, text: `${STEP_LABEL[st]} → ${st}`, actorName: actorName(r.actor) });
  }
  for (const s of shipRows as any[]) {
    const track = s.tracking_no ? ` · เลขพัสดุ ${s.tracking_no}` : "";
    events.push({ kind: "shipment", at: jIso(s.created_at)!, text: `สร้างพัสดุ ${s.carrier}${track}`, actorName: null });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return { orderId, channel: ord.channel, status: ord.status, conversationId, assignedStaff, helpers, steps, events };
}
