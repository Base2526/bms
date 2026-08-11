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
import { runCarrierCall } from "./carriers/safeCall";
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
      carrierBookingStatus: string;
      carrierWarning: string | null;
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
  | { status: "CARRIER_ERROR" | "STALE_SHIPMENT"; detail: string };

export type BookShipmentLiveResult =
  | {
      status: "BOOKED" | "ALREADY_BOOKED";
      shipmentId: string;
      trackingNo: string | null;
      externalShipmentId: string;
      labelUrl: string | null;
      source: "live" | "mock";
    }
  | { status: "SHIPMENT_NOT_FOUND" }
  | { status: "TRACKING_ALREADY_SET" }
  | { status: "IN_PROGRESS" }
  | { status: "TERMINAL_SHIPMENT" }
  | { status: "MARKETPLACE_MANAGED" }
  | { status: "NO_CARRIER_CLIENT" }
  | { status: "UNCONFIGURED" }
  | { status: "NOT_IMPLEMENTED"; detail: string }
  | { status: "CARRIER_ERROR" | "STALE_SHIPMENT"; detail: string };

function cleanCarrierValue(value: string | null | undefined, maxLength = 200): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export function normalizeCarrierLabelUrl(value: string | null | undefined): string | null {
  const cleaned = cleanCarrierValue(value, 2048);
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function latestCarrierEvent(events: Array<{ status: string; occurredAt: string }>) {
  if (events.length === 0) return null;
  const dated = events
    .map((event) => ({ event, timestamp: Date.parse(event.occurredAt) }))
    .filter((entry) => Number.isFinite(entry.timestamp));
  if (dated.length === 0) return events[events.length - 1];
  return dated.reduce((latest, entry) => entry.timestamp > latest.timestamp ? entry : latest).event;
}

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
  carrier: Carrier,
  idempotencyKey: string
): Promise<CarrierCreateShipmentRequest | null> {
  const order = await client.query<{
    id: string;
    total_amount: string | number;
    customer_id: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    sender_name: string | null;
    sender_phone: string | null;
    sender_address: string | null;
    sender_province: string | null;
    sender_postcode: string | null;
    address: string | null;
    province: string | null;
    postcode: string | null;
  }>(
    `SELECT o.id,
            o.total_amount,
            o.customer_id,
            c.name AS customer_name,
            c.phone AS customer_phone,
            t.name AS sender_name,
            sp.phone AS sender_phone,
            sp.address AS sender_address,
            sp.shipping_origin_province AS sender_province,
            sp.shipping_origin_postcode AS sender_postcode,
            a.address,
            a.province,
            a.postcode
       FROM bms_orders o
       JOIN bms_tenants t ON t.id = o.tenant_id
       LEFT JOIN bms_store_profile sp ON sp.tenant_id = o.tenant_id
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
    idempotencyKey,
    orderId: head.id,
    shipFrom: {
      name: head.sender_name ?? null,
      phone: head.sender_phone ?? null,
      address: head.sender_address ?? null,
      province: head.sender_province ?? null,
      postcode: head.sender_postcode ?? null,
    },
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

async function setCarrierBookingFailure(
  tenantId: string,
  shipmentId: string,
  status: "manual" | "failed" | "unconfigured" | "not_implemented",
  detail: string | null
) {
  await query(
    `UPDATE bms_shipments
        SET carrier_booking_status = $3,
            carrier_booking_error = $4,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND carrier_booking_status = 'booking'`,
    [tenantId, shipmentId, status, cleanCarrierValue(detail, 500)]
  );
}

export async function bookShipmentLive(tenantId: string, shipmentId: string): Promise<BookShipmentLiveResult> {
  const claimed = await query<{ order_id: string; carrier: string }>(
    `UPDATE bms_shipments
        SET carrier_booking_status = 'booking',
            carrier_booking_error = NULL,
            carrier_booking_attempted_at = now(),
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2
        AND external_shipment_id IS NULL
        AND tracking_no IS NULL
        AND status NOT IN ('DELIVERED', 'RETURNED', 'CANCELLED')
        AND (carrier_booking_status <> 'booking'
             OR carrier_booking_attempted_at < now() - interval '2 minutes')
      RETURNING order_id, carrier`,
    [tenantId, shipmentId]
  );

  if (claimed.rowCount === 0) {
    const current = await query<{
      carrier: string;
      tracking_no: string | null;
      status: ShipmentStatus;
      external_shipment_id: string | null;
      label_url: string | null;
      carrier_tracking_source: "live" | "mock" | null;
      carrier_booking_status: string;
    }>(
      `SELECT carrier, tracking_no, status, external_shipment_id, label_url,
              carrier_tracking_source, carrier_booking_status
         FROM bms_shipments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, shipmentId]
    );
    if (current.rowCount === 0) return { status: "SHIPMENT_NOT_FOUND" };
    const row = current.rows[0];
    if (row.external_shipment_id) {
      return {
        status: "ALREADY_BOOKED",
        shipmentId,
        trackingNo: row.tracking_no,
        externalShipmentId: row.external_shipment_id,
        labelUrl: row.label_url,
        source: row.carrier_tracking_source === "mock" ? "mock" : "live",
      };
    }
    if (row.tracking_no) return { status: "TRACKING_ALREADY_SET" };
    if (["DELIVERED", "RETURNED", "CANCELLED"].includes(row.status)) return { status: "TERMINAL_SHIPMENT" };
    if (row.carrier_booking_status === "booking") return { status: "IN_PROGRESS" };
    return { status: "STALE_SHIPMENT", detail: "Shipment changed before carrier booking could start" };
  }

  const claimedRow = claimed.rows[0];
  if (!isCarrier(claimedRow.carrier)) {
    await setCarrierBookingFailure(tenantId, shipmentId, "manual", "Carrier has no registered client");
    return { status: "NO_CARRIER_CLIENT" };
  }
  const carrier = claimedRow.carrier;
  const carrierClient = getCarrierClient(carrier);
  if (!carrierClient?.createShipment) {
    await setCarrierBookingFailure(tenantId, shipmentId, "manual", "Carrier has no shipment creation adapter");
    return { status: "NO_CARRIER_CLIENT" };
  }

  const orderChannel = await query<{ channel: string }>(
    `SELECT channel FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, claimedRow.order_id]
  );
  if (orderChannel.rowCount === 0) {
    await setCarrierBookingFailure(tenantId, shipmentId, "failed", "Order data is unavailable");
    return { status: "CARRIER_ERROR", detail: "Order data is unavailable" };
  }
  if (MARKETPLACE_CHANNELS.has(orderChannel.rows[0].channel)) {
    await setCarrierBookingFailure(tenantId, shipmentId, "manual", "Shipping is managed by the marketplace");
    return { status: "MARKETPLACE_MANAGED" };
  }

  const dbClient = await getClient();
  let request: CarrierCreateShipmentRequest | null;
  try {
    request = await buildCarrierCreateShipmentRequest(dbClient, tenantId, claimedRow.order_id, carrier, shipmentId);
  } finally {
    dbClient.release();
  }
  if (!request) {
    await setCarrierBookingFailure(tenantId, shipmentId, "failed", "Order data is unavailable");
    return { status: "CARRIER_ERROR", detail: "Order data is unavailable" };
  }

  const result = await runCarrierCall(
    () => carrierClient.createShipment!(request!),
    (detail) => ({ ok: false as const, reason: "carrier_error" as const, detail })
  );
  if (!result.ok) {
    if (result.reason === "unconfigured") {
      await setCarrierBookingFailure(tenantId, shipmentId, "unconfigured", "Carrier credentials are not configured");
      return { status: "UNCONFIGURED" };
    }
    if (result.reason === "not_implemented") {
      await setCarrierBookingFailure(tenantId, shipmentId, "not_implemented", result.detail);
      return { status: "NOT_IMPLEMENTED", detail: result.detail };
    }
    await setCarrierBookingFailure(tenantId, shipmentId, "failed", result.detail);
    return { status: "CARRIER_ERROR", detail: result.detail };
  }

  const externalShipmentId = cleanCarrierValue(result.externalShipmentId);
  if (!externalShipmentId) {
    const detail = "Carrier response did not include a valid external shipment id";
    await setCarrierBookingFailure(tenantId, shipmentId, "failed", detail);
    return { status: "CARRIER_ERROR", detail };
  }
  const trackingNo = cleanCarrierValue(result.trackingNo);
  const labelUrl = normalizeCarrierLabelUrl(result.labelUrl);

  try {
    const persisted = await query(
      `UPDATE bms_shipments
          SET external_shipment_id = $4,
              tracking_no = COALESCE(tracking_no, $5),
              label_url = $6,
              carrier_last_synced_at = now(),
              carrier_tracking_source = $7,
              carrier_booking_status = 'booked',
              carrier_booking_error = NULL,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND carrier = $3
          AND external_shipment_id IS NULL
          AND tracking_no IS NULL
          AND status NOT IN ('DELIVERED', 'RETURNED', 'CANCELLED')
          AND carrier_booking_status = 'booking'`,
      [tenantId, shipmentId, carrier, externalShipmentId, trackingNo, labelUrl, result.source]
    );
    if ((persisted.rowCount ?? 0) === 0) {
      return { status: "STALE_SHIPMENT", detail: "Shipment changed while the carrier request was in progress" };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Carrier booking could not be persisted";
    await setCarrierBookingFailure(tenantId, shipmentId, "failed", detail);
    return { status: "CARRIER_ERROR", detail };
  }

  return { status: "BOOKED", shipmentId, trackingNo, externalShipmentId, labelUrl, source: result.source };
}

// ---- create --------------------------------------------------
export async function createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  const { tenantId } = input;
  if (!isCarrier(input.carrier)) return { status: "BAD_CARRIER" };
  const manualTrackingNo = cleanCarrierValue(input.trackingNo);

  const client = await getClient();
  let shipmentId: string;
  let orderShipped = false;
  let marketplaceManaged = false;
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
    marketplaceManaged = MARKETPLACE_CHANNELS.has(ord.rows[0].channel);
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

    const canBookWithCarrier = !marketplaceManaged && !manualTrackingNo && Boolean(getCarrierClient(input.carrier)?.createShipment);

    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_shipments
         (tenant_id, order_id, carrier, tracking_no, status, note,
          carrier_tracking_source, carrier_booking_status)
       VALUES ($1, $2, $3, $4, 'SHIPPED', $5, 'manual', $6)
       RETURNING id`,
      [
        tenantId,
        input.orderId,
        input.carrier,
        manualTrackingNo,
        input.note ?? null,
        canBookWithCarrier ? "ready" : "manual",
      ]
    );
    shipmentId = ins.rows[0].id;

    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }

  if (orderShipped) void notifyOrderStatusEmail(tenantId, input.orderId, "shipped");

  // A supplied tracking number means staff already created the parcel externally.
  // Otherwise book only after the inventory transaction has committed and released its locks.
  if (marketplaceManaged || manualTrackingNo || !getCarrierClient(input.carrier)?.createShipment) {
    return {
      status: "CREATED",
      shipmentId,
      orderShipped,
      trackingNo: manualTrackingNo,
      labelUrl: null,
      externalShipmentId: null,
      carrierIntegration: "manual",
      carrierBookingStatus: "manual",
      carrierWarning: null,
    };
  }

  const booking = await bookShipmentLive(tenantId, shipmentId);
  if (booking.status === "BOOKED" || booking.status === "ALREADY_BOOKED") {
    return {
      status: "CREATED",
      shipmentId,
      orderShipped,
      trackingNo: booking.trackingNo,
      labelUrl: booking.labelUrl,
      externalShipmentId: booking.externalShipmentId,
      carrierIntegration: booking.source,
      carrierBookingStatus: booking.status,
      carrierWarning: null,
    };
  }

  return {
    status: "CREATED",
    shipmentId,
    orderShipped,
    trackingNo: null,
    labelUrl: null,
    externalShipmentId: null,
    carrierIntegration: "manual",
    carrierBookingStatus: booking.status,
    carrierWarning: "detail" in booking ? booking.detail : booking.status,
  };
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
            external_shipment_id = CASE
              WHEN ($3 IS NOT NULL AND tracking_no IS DISTINCT FROM $3)
                OR ($4 IS NOT NULL AND carrier IS DISTINCT FROM $4) THEN NULL
              ELSE external_shipment_id END,
            label_url = CASE
              WHEN ($3 IS NOT NULL AND tracking_no IS DISTINCT FROM $3)
                OR ($4 IS NOT NULL AND carrier IS DISTINCT FROM $4) THEN NULL
              ELSE label_url END,
            carrier_last_synced_at = CASE
              WHEN ($3 IS NOT NULL AND tracking_no IS DISTINCT FROM $3)
                OR ($4 IS NOT NULL AND carrier IS DISTINCT FROM $4) THEN NULL
              ELSE carrier_last_synced_at END,
            carrier_tracking_source = CASE
              WHEN ($3 IS NOT NULL AND tracking_no IS DISTINCT FROM $3)
                OR ($4 IS NOT NULL AND carrier IS DISTINCT FROM $4) THEN 'manual'
              ELSE carrier_tracking_source END,
            carrier_booking_status = CASE
              WHEN ($3 IS NOT NULL AND tracking_no IS DISTINCT FROM $3)
                OR ($4 IS NOT NULL AND carrier IS DISTINCT FROM $4) THEN 'manual'
              ELSE carrier_booking_status END,
            carrier_booking_error = CASE
              WHEN ($3 IS NOT NULL AND tracking_no IS DISTINCT FROM $3)
                OR ($4 IS NOT NULL AND carrier IS DISTINCT FROM $4) THEN NULL
              ELSE carrier_booking_error END,
            updated_at  = now()
      WHERE tenant_id = $1 AND id = $2
        AND status NOT IN ('CANCELLED','RETURNED')
        AND carrier_booking_status <> 'booking'`,
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
      `UPDATE bms_shipments
          SET status = $3,
              carrier_booking_status = CASE
                WHEN $3 IN ('RETURNED', 'CANCELLED') AND external_shipment_id IS NULL THEN 'manual'
                ELSE carrier_booking_status END,
              carrier_booking_error = CASE
                WHEN $3 IN ('RETURNED', 'CANCELLED') AND external_shipment_id IS NULL THEN NULL
                ELSE carrier_booking_error END,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
          AND carrier_booking_status <> 'booking'
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
            carrier_last_synced_at, carrier_tracking_source, carrier_booking_status,
            carrier_booking_error, carrier_booking_attempted_at, created_at, updated_at,
            EXISTS (SELECT 1 FROM bms_orders o
                     WHERE o.tenant_id = bms_shipments.tenant_id AND o.id = bms_shipments.order_id
                       AND o.channel IN ('lazada', 'shopee')) AS marketplace_managed
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
            , carrier_booking_status, carrier_booking_error, carrier_booking_attempted_at
            , EXISTS (SELECT 1 FROM bms_orders o
                       WHERE o.tenant_id = bms_shipments.tenant_id AND o.id = bms_shipments.order_id
                         AND o.channel IN ('lazada', 'shopee')) AS marketplace_managed
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

// ---- carrier API status --------------------------------------
// Flash/Kerry distinguish mock, missing credentials, and credentials present
// without a verified live adapter. Other carriers remain fully manual.
export function getCarrierApiStatus(carrier: Carrier): CarrierClientStatus | null {
  return getCarrierClient(carrier)?.getStatus() ?? null;
}

/** Live tracking lookup, if that carrier is configured — otherwise a typed "unconfigured" result. */
export async function trackShipmentLive(carrier: Carrier, trackingNo: string): Promise<CarrierTrackResult | null> {
  const client = getCarrierClient(carrier);
  if (!client) return null;
  return runCarrierCall(
    () => client.trackShipment(trackingNo),
    (detail) => ({ ok: false as const, reason: "carrier_error" as const, detail })
  );
}

export async function syncShipmentLive(tenantId: string, shipmentId: string): Promise<SyncShipmentLiveResult> {
  const shipment = await query<{
    id: string;
    carrier: string;
    tracking_no: string | null;
  }>(
    `SELECT id, carrier, tracking_no
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

  const expectedTrackingNo = row.tracking_no;
  const expectedCarrier = row.carrier;
  const result = await runCarrierCall(
    () => client.trackShipment(expectedTrackingNo),
    (detail) => ({ ok: false as const, reason: "carrier_error" as const, detail })
  );
  if (!result.ok) {
    if (result.reason === "unconfigured") return { status: "UNCONFIGURED" };
    if (result.reason === "not_implemented") return { status: "NOT_IMPLEMENTED", detail: result.detail };
    return { status: "CARRIER_ERROR", detail: result.detail };
  }

  const normalizedTrackingNo = cleanCarrierValue(result.trackingNo);
  if (!normalizedTrackingNo) return { status: "CARRIER_ERROR", detail: "Carrier returned an invalid tracking number" };
  const events = Array.isArray(result.events) ? result.events.slice(0, 1000) : [];
  const latest = latestCarrierEvent(events);
  const historyEvents = events.slice(0, 100).flatMap((event) => {
    const occurredAt = new Date(event.occurredAt);
    const status = cleanCarrierValue(event.status, 100);
    if (!status || Number.isNaN(occurredAt.getTime())) return [];
    return [{
      status,
      description: cleanCarrierValue(event.description, 500) ?? status,
      occurredAt: occurredAt.toISOString(),
    }];
  });

  const dbClient = await getClient();
  let shipmentStatus: ShipmentStatus;
  let completedOrder = false;
  let completedOrderId: string | null = null;
  try {
    await beginTenantTx(dbClient, tenantId);
    const locked = await dbClient.query<{
      order_id: string;
      carrier: string;
      tracking_no: string | null;
      status: ShipmentStatus;
    }>(
      `SELECT order_id, carrier, tracking_no, status
         FROM bms_shipments
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, shipmentId]
    );
    if (locked.rowCount === 0) {
      await dbClient.query("ROLLBACK");
      return { status: "SHIPMENT_NOT_FOUND" };
    }
    const current = locked.rows[0];
    if (current.carrier !== expectedCarrier || current.tracking_no !== expectedTrackingNo) {
      await dbClient.query("ROLLBACK");
      return { status: "STALE_SHIPMENT", detail: "Carrier or tracking number changed during sync" };
    }

    const mappedStatus = latest ? mapCarrierEventStatus(latest.status) : null;
    shipmentStatus = mappedStatus ? resolveCarrierStatus(current.status, mappedStatus) : current.status;
    await dbClient.query(
      `UPDATE bms_shipments
          SET status = $3,
              tracking_no = $4,
              carrier_last_synced_at = now(),
              carrier_tracking_source = $5,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, shipmentId, shipmentStatus, normalizedTrackingNo, result.source]
    );

    if (historyEvents.length > 0) {
      await dbClient.query(
        `INSERT INTO bms_shipment_tracking_events
           (tenant_id, shipment_id, carrier_status, description, occurred_at, source)
         SELECT $1, $2, event.status, event.description, event.occurred_at::timestamptz, $4
           FROM jsonb_to_recordset($3::jsonb)
             AS event(status text, description text, occurred_at text)
         ON CONFLICT (shipment_id, carrier_status, occurred_at) DO NOTHING`,
        [tenantId, shipmentId, JSON.stringify(historyEvents), result.source]
      );
    }

    if (shipmentStatus === "DELIVERED" && current.status !== "DELIVERED") {
      const order = await dbClient.query(
        `UPDATE bms_orders SET status = 'COMPLETED', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'SHIPPED'`,
        [tenantId, current.order_id]
      );
      completedOrder = (order.rowCount ?? 0) > 0;
      if (completedOrder) completedOrderId = current.order_id;
    }
    await dbClient.query("COMMIT");
  } catch (error) {
    try { await dbClient.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    dbClient.release();
  }

  if (completedOrderId) void notifyOrderStatusEmail(tenantId, completedOrderId, "completed");

  return {
    status: "SYNCED",
    shipmentId,
    trackingNo: normalizedTrackingNo,
    shipmentStatus,
    source: result.source,
    eventCount: events.length,
    completedOrder,
  };
}

export async function runCarrierTrackingSync(tenantId?: string): Promise<{
  scanned: number;
  synced: number;
  skipped: number;
  failed: number;
}> {
  const due = await query<{ id: string; tenant_id: string; carrier: Carrier }>(
    `SELECT id, tenant_id, carrier
       FROM bms_shipments
      WHERE ($1::uuid IS NULL OR tenant_id = $1)
        AND carrier IN ('FLASH', 'KERRY')
        AND tracking_no IS NOT NULL
        AND status IN ('SHIPPED', 'IN_TRANSIT')
        AND (carrier_last_synced_at IS NULL OR carrier_last_synced_at < now() - interval '15 minutes')
      ORDER BY carrier_last_synced_at ASC NULLS FIRST, created_at ASC
      LIMIT 100`,
    [tenantId ?? null]
  );

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const concurrency = 5;
  for (let index = 0; index < due.rows.length; index += concurrency) {
    const batch = due.rows.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (shipment) => {
      const apiStatus = getCarrierApiStatus(shipment.carrier);
      if (apiStatus !== "configured" && apiStatus !== "mock") return "skipped" as const;
      try {
        const result = await syncShipmentLive(shipment.tenant_id, shipment.id);
        return result.status === "SYNCED" ? "synced" as const : "failed" as const;
      } catch {
        return "failed" as const;
      }
    }));
    for (const result of results) {
      if (result === "synced") synced += 1;
      else if (result === "skipped") skipped += 1;
      else failed += 1;
    }
  }

  return { scanned: due.rows.length, synced, skipped, failed };
}

export async function listShipmentTrackingEvents(tenantId: string, shipmentId: string, limit = 100) {
  const result = await query(
    `SELECT id, carrier_status, description, occurred_at, source
       FROM bms_shipment_tracking_events
      WHERE tenant_id = $1 AND shipment_id = $2
      ORDER BY occurred_at DESC, id DESC
      LIMIT $3`,
    [tenantId, shipmentId, Math.min(Math.max(limit, 1), 200)]
  );
  return result.rows;
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
    labelUrl: normalizeCarrierLabelUrl(h.label_url),
    shipTo: { name: h.name, phone: h.phone, address: h.address },
    items: items.rows.map((r) => ({ sku: r.product_sku, size: r.size, qty: r.qty })),
    createdAt: h.created_at instanceof Date ? h.created_at.toISOString() : String(h.created_at),
  };
}
