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
import { notifyOrderStatusEmail } from "./orderNotify";
import { getCarrierClient } from "./carriers";
import type {
  CarrierClientStatus,
  CarrierCreateShipmentRequest,
  CarrierTrackResult,
} from "./carriers/types";

// Lazada/Shopee keep the shipping address in Seller Center. All other implemented channels,
// including TikTok Chat, require a shipping address stored in BMS before fulfillment can ship.
export const MARKETPLACE_CHANNELS = new Set(["lazada", "shopee"]);

// Carrier codes/labels live in carriers/constants.ts so client components can import them
// without pulling in @/lib/db. Re-exported here to keep existing `from "./shipping"` imports working.
export { CARRIER_CODES as CARRIERS, CARRIER_LABELS, isCarrier } from "./carriers/constants";
export type { Carrier } from "./carriers/constants";

import { isCarrier } from "./carriers/constants";
import type { Carrier } from "./carriers/constants";

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
  | {
      status: "CREATED";
      shipmentId: string;
      orderShipped: boolean;
      trackingNo: string | null;
      labelUrl: string | null;
      externalShipmentId: string | null;
      carrierIntegration: "manual" | "live" | "mock";
    }
  | { status: "ORDER_NOT_FOUND" }
  | { status: "BAD_CARRIER" }
  | { status: "MISSING_SHIPPING_ADDRESS" }
  | { status: "INVALID_STATE"; current: string };

export type SyncShipmentLiveResult =
  | {
      status: "SYNCED";
      shipmentId: string;
      trackingNo: string | null;
      shipmentStatus: ShipmentStatus;
      source: "live" | "mock";
      eventCount: number;
      completedOrder: boolean;
    }
  | { status: "SHIPMENT_NOT_FOUND" }
  | { status: "TRACKING_REQUIRED" }
  | { status: "NO_CARRIER_CLIENT" }
  | { status: "UNCONFIGURED" }
  | { status: "NOT_IMPLEMENTED"; detail: string }
  | { status: "CARRIER_ERROR"; detail: string };

function mapCarrierEventStatus(status: string): ShipmentStatus | null {
  const normalized = String(status || "").trim().toUpperCase();
  if (!normalized) return null;
  if (["PICKED_UP", "SHIPPED"].includes(normalized)) return "SHIPPED";
  if (["IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(normalized)) return "IN_TRANSIT";
  if (normalized === "DELIVERED") return "DELIVERED";
  if (["RETURNED", "RETURN_TO_SENDER"].includes(normalized)) return "RETURNED";
  if (["CANCELLED", "CANCELED"].includes(normalized)) return "CANCELLED";
  return null;
}

function resolveCarrierStatus(current: ShipmentStatus, next: ShipmentStatus): ShipmentStatus {
  if (["DELIVERED", "RETURNED", "CANCELLED"].includes(current)) return current;
  if (["RETURNED", "CANCELLED"].includes(next)) return next;
  const rank: Partial<Record<ShipmentStatus, number>> = { PENDING: 0, SHIPPED: 1, IN_TRANSIT: 2, DELIVERED: 3 };
  return (rank[next] ?? -1) >= (rank[current] ?? -1) ? next : current;
}

async function buildCarrierCreateShipmentRequest(
  client: Awaited<ReturnType<typeof getClient>>,
  tenantId: string,
  orderId: string,
  carrier: Carrier
): Promise<CarrierCreateShipmentRequest | null> {
  const order = await client.query<{
    id: string;
    total_amount: string | number;
    customer_id: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    address: string | null;
    province: string | null;
    postcode: string | null;
  }>(
    `SELECT o.id,
            o.total_amount,
            o.customer_id,
            c.name AS customer_name,
            c.phone AS customer_phone,
            a.address,
            a.province,
            a.postcode
       FROM bms_orders o
       LEFT JOIN bms_customers c ON c.id = o.customer_id
       LEFT JOIN LATERAL (
         SELECT address, province, postcode
           FROM bms_customer_addresses
          WHERE tenant_id = o.tenant_id
            AND customer_id = o.customer_id
            AND address_type = 'shipping'
          ORDER BY is_default DESC, id
          LIMIT 1
       ) a ON TRUE
      WHERE o.tenant_id = $1 AND o.id = $2`,
    [tenantId, orderId]
  );
  if (order.rowCount === 0) return null;

  const items = await client.query<{
    product_sku: string;
    qty: number;
    weight_grams: number | null;
  }>(
    `SELECT oi.product_sku, oi.qty, p.weight_grams
       FROM bms_order_items oi
       LEFT JOIN bms_products p
         ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
      WHERE oi.tenant_id = $1 AND oi.order_id = $2
      ORDER BY oi.product_sku, oi.size`,
    [tenantId, orderId]
  );

  const totalGrams = items.rows.reduce((sum, row) => {
    const perItem = row.weight_grams == null ? 0 : Number(row.weight_grams);
    return sum + perItem * Number(row.qty ?? 0);
  }, 0);

  const head = order.rows[0];
  return {
    orderId: head.id,
    carrier,
    shipTo: {
      name: head.customer_name ?? null,
      phone: head.customer_phone ?? null,
      address: head.address ?? null,
      province: head.province ?? null,
      postcode: head.postcode ?? null,
    },
    subtotal: Number(head.total_amount ?? 0),
    totalGrams: totalGrams > 0 ? totalGrams : null,
    items: items.rows.map((row) => ({
      sku: row.product_sku,
      qty: Number(row.qty ?? 0),
      weightGrams: row.weight_grams == null ? null : Number(row.weight_grams),
    })),
  };
}

async function createCarrierShipmentLive(
  client: Awaited<ReturnType<typeof getClient>>,
  tenantId: string,
  orderId: string,
  carrier: Carrier
) {
  const carrierClient = getCarrierClient(carrier);
  if (!carrierClient?.createShipment) {
    return { mode: "manual" as const, externalShipmentId: null, trackingNo: null, labelUrl: null };
  }
  const req = await buildCarrierCreateShipmentRequest(client, tenantId, orderId, carrier);
  if (!req) {
    return { mode: "manual" as const, externalShipmentId: null, trackingNo: null, labelUrl: null };
  }
  const result = await carrierClient.createShipment(req);
  if (!result.ok) {
    return { mode: "manual" as const, externalShipmentId: null, trackingNo: null, labelUrl: null };
  }
  return {
    mode: result.source,
    externalShipmentId: result.externalShipmentId,
    trackingNo: result.trackingNo,
    labelUrl: result.labelUrl,
  };
}

// ---- create --------------------------------------------------
export async function createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  const { tenantId } = input;
  if (!isCarrier(input.carrier)) return { status: "BAD_CARRIER" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);

    const ord = await client.query<{ status: string; channel: string; customer_id: string | null }>(
      `SELECT status, channel, customer_id
         FROM bms_orders
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
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

    if (cur === "PACKING" && !MARKETPLACE_CHANNELS.has(ord.rows[0].channel)) {
      const customerId = ord.rows[0].customer_id;
      const address = customerId
        ? await client.query(
            `SELECT 1 FROM bms_customer_addresses
              WHERE tenant_id = $1 AND customer_id = $2 AND address_type = 'shipping'
              LIMIT 1`,
            [tenantId, customerId]
          )
        : null;
      if (!address || address.rowCount === 0) {
        await client.query("ROLLBACK");
        return { status: "MISSING_SHIPPING_ADDRESS" };
      }
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

    // A supplied tracking number means staff already created the parcel externally.
    // Do not create a second carrier shipment behind their back.
    const carrierLive = input.trackingNo
      ? { mode: "manual" as const, externalShipmentId: null, trackingNo: null, labelUrl: null }
      : await createCarrierShipmentLive(client, tenantId, input.orderId, input.carrier);
    const trackingNo = input.trackingNo ?? carrierLive.trackingNo ?? null;

    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_shipments
         (tenant_id, order_id, carrier, tracking_no, status, label_url, note, external_shipment_id, carrier_last_synced_at, carrier_tracking_source)
       VALUES ($1, $2, $3, $4, 'SHIPPED', $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        tenantId,
        input.orderId,
        input.carrier,
        trackingNo,
        carrierLive.labelUrl ?? null,
        input.note ?? null,
        carrierLive.externalShipmentId ?? null,
        carrierLive.mode === "manual" ? null : new Date(),
        carrierLive.mode,
      ]
    );

    await client.query("COMMIT");
    if (orderShipped) void notifyOrderStatusEmail(tenantId, input.orderId, "shipped");
    return {
      status: "CREATED",
      shipmentId: ins.rows[0].id,
      orderShipped,
      trackingNo,
      labelUrl: carrierLive.labelUrl ?? null,
      externalShipmentId: carrierLive.externalShipmentId ?? null,
      carrierIntegration: carrierLive.mode,
    };
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
  if (patch.carrier != null && !isCarrier(patch.carrier)) return false;
  const res = await query(
    `UPDATE bms_shipments
        SET tracking_no = COALESCE($3, tracking_no),
            carrier     = COALESCE($4, carrier),
            note        = COALESCE($5, note),
            carrier_tracking_source = CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL THEN 'manual' ELSE carrier_tracking_source END,
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
    let orderCompleted = false;
    if (status === "DELIVERED") {
      const ord = await client.query(
        `UPDATE bms_orders SET status = 'COMPLETED', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'SHIPPED'`,
        [tenantId, ship.rows[0].order_id]
      );
      orderCompleted = (ord.rowCount ?? 0) > 0;
    }

    await client.query("COMMIT");
    if (orderCompleted) void notifyOrderStatusEmail(tenantId, ship.rows[0].order_id, "completed");
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
    `SELECT id, order_id, carrier, tracking_no, status, label_url, note, external_shipment_id,
            carrier_last_synced_at, carrier_tracking_source, created_at, updated_at
       FROM bms_shipments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return res.rows[0] ?? null;
}

export async function listShipments(
  tenantId: string,
  opts: { search?: string | null; orderId?: string | null; status?: string | null; limit?: number; offset?: number } = {}
) {
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 200);
  const offset = Math.max(Number(opts.offset ?? 0), 0);
  const search = opts.search?.trim() || null;
  const res = await query(
    `SELECT id, order_id, carrier, tracking_no, status, label_url, note, created_at, updated_at
            , external_shipment_id, carrier_last_synced_at, carrier_tracking_source
       FROM bms_shipments
      WHERE tenant_id = $1
        AND ($2::uuid IS NULL OR order_id = $2)
        AND ($3::text IS NULL OR status = $3)
        AND (
          $6::text IS NULL
          OR id::text ILIKE '%' || $6 || '%'
          OR order_id::text ILIKE '%' || $6 || '%'
          OR carrier ILIKE '%' || $6 || '%'
          OR COALESCE(tracking_no, '') ILIKE '%' || $6 || '%'
          OR COALESCE(note, '') ILIKE '%' || $6 || '%'
        )
      ORDER BY created_at DESC
      LIMIT $4 OFFSET $5`,
    [tenantId, opts.orderId ?? null, opts.status ?? null, limit, offset, search]
  );
  return res.rows;
}

// ---- carrier API status (scaffold — FLASH/KERRY have no key yet) ----
// Returns "unconfigured" for FLASH/KERRY until FLASH_API_KEY/KERRY_API_KEY
// (see lib/bms/carriers/{flash,kerry}.ts) are set, and null for carriers
// with no client at all (DHL/AUSPOST/NZPOST/OTHER stay fully manual).
export function getCarrierApiStatus(carrier: Carrier): CarrierClientStatus | null {
  return getCarrierClient(carrier)?.getStatus() ?? null;
}

/** Live tracking lookup, if that carrier is configured — otherwise a typed "unconfigured" result. */
export async function trackShipmentLive(carrier: Carrier, trackingNo: string): Promise<CarrierTrackResult | null> {
  const client = getCarrierClient(carrier);
  if (!client) return null;
  return client.trackShipment(trackingNo);
}

export async function syncShipmentLive(tenantId: string, shipmentId: string): Promise<SyncShipmentLiveResult> {
  const shipment = await query<{
    id: string;
    order_id: string;
    carrier: string;
    tracking_no: string | null;
    status: string;
  }>(
    `SELECT id, order_id, carrier, tracking_no, status
       FROM bms_shipments
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, shipmentId]
  );
  if (shipment.rowCount === 0) return { status: "SHIPMENT_NOT_FOUND" };

  const row = shipment.rows[0];
  if (!row.tracking_no) return { status: "TRACKING_REQUIRED" };
  if (!isCarrier(row.carrier)) return { status: "NO_CARRIER_CLIENT" };

  const client = getCarrierClient(row.carrier);
  if (!client) return { status: "NO_CARRIER_CLIENT" };

  const result = await client.trackShipment(row.tracking_no);
  if (!result.ok) {
    if (result.reason === "unconfigured") return { status: "UNCONFIGURED" };
    if (result.reason === "not_implemented") return { status: "NOT_IMPLEMENTED", detail: result.detail };
    return { status: "CARRIER_ERROR", detail: result.detail };
  }

  const currentStatus = row.status as ShipmentStatus;
  const latest = result.events[result.events.length - 1];
  const mappedStatus = latest ? mapCarrierEventStatus(latest.status) : null;
  const shipmentStatus = mappedStatus ? resolveCarrierStatus(currentStatus, mappedStatus) : currentStatus;
  const statusUpdated = shipmentStatus !== currentStatus
    ? await setShipmentStatus(tenantId, shipmentId, shipmentStatus)
    : false;
  const completedOrder = shipmentStatus === "DELIVERED" && statusUpdated;

  await query(
    `UPDATE bms_shipments
        SET tracking_no = $3,
            carrier_last_synced_at = now(),
            carrier_tracking_source = $4,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, shipmentId, result.trackingNo, result.source]
  );

  return {
    status: "SYNCED",
    shipmentId,
    trackingNo: result.trackingNo,
    shipmentStatus,
    source: result.source,
    eventCount: result.events.length,
    completedOrder,
  };
}

// ---- label (carrier URL when available, printable fallback otherwise) ----
export type ShipmentLabel = {
  shipmentId: string;
  orderId: string;
  carrier: string;
  trackingNo: string | null;
  labelUrl: string | null;
  shipTo: { name: string | null; phone: string | null; address: string | null };
  items: { sku: string; size: string; qty: number }[];
  createdAt: string;
};

export async function getShipmentLabel(tenantId: string, shipmentId: string): Promise<ShipmentLabel | null> {
  const head = await query<{
    id: string; order_id: string; carrier: string; tracking_no: string | null; label_url: string | null; created_at: any;
    name: string | null; phone: string | null; address: string | null;
  }>(
    `SELECT s.id, s.order_id, s.carrier, s.tracking_no, s.label_url, s.created_at,
            c.name, c.phone,
            (SELECT a.address FROM bms_customer_addresses a
              WHERE a.tenant_id = s.tenant_id AND a.customer_id = o.customer_id
                AND a.address_type = 'shipping'
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
    labelUrl: h.label_url,
    shipTo: { name: h.name, phone: h.phone, address: h.address },
    items: items.rows.map((r) => ({ sku: r.product_sku, size: r.size, qty: r.qty })),
    createdAt: h.created_at instanceof Date ? h.created_at.toISOString() : String(h.created_at),
  };
}
