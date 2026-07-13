// =============================================================
// BMS Shipping — shipments, carrier/tracking, status, label
// -------------------------------------------------------------
// createShipment    : ผูก carrier/tracking + ship จริง (order PACKING → SHIPPED
//                     + ตัดสต็อก + SHIP movement) atomic; ถ้า order SHIPPED แล้ว
//                     แค่แนบ shipment ไม่ตัดสต็อกซ้ำ
// updateTracking    : แก้เลขพัสดุ / carrier
// setShipmentStatus : เปลี่ยนสถานะ shipment; DELIVERED → order → COMPLETED
// getShipmentLabel  : ข้อมูลสำหรับพิมพ์ label (จาก order + customer + address)
//
// สต็อกถูกตัดครั้งเดียวตอน PACKING → SHIPPED (ห้ามตัดซ้ำ) — ทุกการตัดมี movement
// =============================================================

import { getClient, query } from "@/lib/db";
import { recordOrderMovements } from "./movements";
import { beginTenantTx } from "./tenant";

export const CARRIERS = ["FLASH", "KERRY", "DHL", "AUSPOST", "NZPOST", "OTHER"] as const;
export type Carrier = (typeof CARRIERS)[number];

export const SHIPMENT_STATUSES = [
  "PENDING", "SHIPPED", "IN_TRANSIT", "DELIVERED", "RETURNED", "CANCELLED",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export type CreateShipmentInput = {
  tenantId: string;
  orderId: string;
  carrier: Carrier;
  trackingNo?: string | null;
  note?: string | null;
  actor?: string | null;
};

export type CreateShipmentResult =
  | { status: "CREATED"; shipmentId: string; orderShipped: boolean }
  | { status: "ORDER_NOT_FOUND" }
  | { status: "BAD_CARRIER" }
  | { status: "INVALID_STATE"; current: string };

// ---- create --------------------------------------------------
export async function createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  const { tenantId } = input;
  if (!CARRIERS.includes(input.carrier)) return { status: "BAD_CARRIER" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ord = await client.query<{ status: string }>(
      `SELECT status FROM bms_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, input.orderId]
    );
    if (ord.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "ORDER_NOT_FOUND" };
    }
    const cur = ord.rows[0].status;
    if (cur !== "PACKING" && cur !== "SHIPPED") {
      await client.query("ROLLBACK");
      return { status: "INVALID_STATE", current: cur };
    }

    let orderShipped = false;
    if (cur === "PACKING") {
      // ship จริง: PACKING → SHIPPED + ตัด current+reserved (เหมือน orders.shipOrder)
      await client.query(
        `UPDATE bms_orders SET status = 'SHIPPED', updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, input.orderId]
      );
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
        [input.orderId]
      );
      await recordOrderMovements(client, [input.orderId], "SHIP", input.actor ?? "system");
      orderShipped = true;
    }

    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_shipments (tenant_id, order_id, carrier, tracking_no, status, note)
       VALUES ($1, $2, $3, $4, 'SHIPPED', $5)
       RETURNING id`,
      [tenantId, input.orderId, input.carrier, input.trackingNo ?? null, input.note ?? null]
    );

    await client.query("COMMIT");
    return { status: "CREATED", shipmentId: ins.rows[0].id, orderShipped };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---- update tracking / carrier -------------------------------
export async function updateTracking(
  tenantId: string,
  shipmentId: string,
  patch: { trackingNo?: string | null; carrier?: Carrier | null },
  actor?: string | null
): Promise<boolean> {
  if (patch.carrier != null && !CARRIERS.includes(patch.carrier)) return false;
  const res = await query(
    `UPDATE bms_shipments
        SET tracking_no = COALESCE($3, tracking_no),
            carrier     = COALESCE($4, carrier),
            note        = COALESCE($5, note),
            updated_at  = now()
      WHERE tenant_id = $1 AND id = $2
        AND status NOT IN ('CANCELLED','RETURNED')`,
    [tenantId, shipmentId, patch.trackingNo ?? null, patch.carrier ?? null, actor ? `updated by ${actor}` : null]
  );
  return (res.rowCount ?? 0) > 0;
}

// ---- set status (DELIVERED → order COMPLETED) ----------------
export async function setShipmentStatus(
  tenantId: string,
  shipmentId: string,
  status: ShipmentStatus
): Promise<boolean> {
  if (!SHIPMENT_STATUSES.includes(status)) return false;
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ship = await client.query<{ order_id: string }>(
      `UPDATE bms_shipments SET status = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING order_id`,
      [tenantId, shipmentId, status]
    );
    if (ship.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // จัดส่งถึงแล้ว → ปิดออร์เดอร์ (SHIPPED → COMPLETED) แบบ best-effort
    if (status === "DELIVERED") {
      await client.query(
        `UPDATE bms_orders SET status = 'COMPLETED', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'SHIPPED'`,
        [tenantId, ship.rows[0].order_id]
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** ยกเลิก shipment (ไม่คืนสต็อก — ใช้ order return แทนถ้าต้องคืนของ) */
export function cancelShipment(tenantId: string, shipmentId: string) {
  return setShipmentStatus(tenantId, shipmentId, "CANCELLED");
}

// ---- read ----------------------------------------------------
export async function getShipment(tenantId: string, id: string) {
  const res = await query(
    `SELECT id, order_id, carrier, tracking_no, status, label_url, note, created_at, updated_at
       FROM bms_shipments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return res.rows[0] ?? null;
}

export async function listShipments(
  tenantId: string,
  opts: { orderId?: string | null; status?: string | null; limit?: number; offset?: number } = {}
) {
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const res = await query(
    `SELECT id, order_id, carrier, tracking_no, status, label_url, note, created_at, updated_at
       FROM bms_shipments
      WHERE tenant_id = $1
        AND ($2::uuid IS NULL OR order_id = $2)
        AND ($3::text IS NULL OR status = $3)
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5`,
    [tenantId, opts.orderId ?? null, opts.status ?? null, limit, offset]
  );
  return res.rows;
}

// ---- label (ข้อมูลสำหรับพิมพ์ — ยังไม่ผูก carrier API จริง) --------
export type ShipmentLabel = {
  shipmentId: string;
  orderId: string;
  carrier: string;
  trackingNo: string | null;
  shipTo: { name: string | null; phone: string | null; address: string | null };
  items: { sku: string; size: string; qty: number }[];
  createdAt: string;
};

export async function getShipmentLabel(tenantId: string, shipmentId: string): Promise<ShipmentLabel | null> {
  const head = await query<{
    id: string; order_id: string; carrier: string; tracking_no: string | null; created_at: any;
    name: string | null; phone: string | null; address: string | null;
  }>(
    `SELECT s.id, s.order_id, s.carrier, s.tracking_no, s.created_at,
            c.name, c.phone,
            (SELECT a.address FROM bms_customer_addresses a
              WHERE a.tenant_id = s.tenant_id AND a.customer_id = o.customer_id
              ORDER BY a.is_default DESC, a.id LIMIT 1) AS address
       FROM bms_shipments s
       JOIN bms_orders o ON o.id = s.order_id
       LEFT JOIN bms_customers c ON c.id = o.customer_id
      WHERE s.tenant_id = $1 AND s.id = $2`,
    [tenantId, shipmentId]
  );
  if (head.rowCount === 0) return null;
  const h = head.rows[0];

  const items = await query<{ product_sku: string; size: string; qty: number }>(
    `SELECT product_sku, size, qty FROM bms_order_items
      WHERE tenant_id = $1 AND order_id = $2 ORDER BY product_sku, size`,
    [tenantId, h.order_id]
  );

  return {
    shipmentId: h.id,
    orderId: h.order_id,
    carrier: h.carrier,
    trackingNo: h.tracking_no,
    shipTo: { name: h.name, phone: h.phone, address: h.address },
    items: items.rows.map((r) => ({ sku: r.product_sku, size: r.size, qty: r.qty })),
    createdAt: h.created_at instanceof Date ? h.created_at.toISOString() : String(h.created_at),
  };
}
