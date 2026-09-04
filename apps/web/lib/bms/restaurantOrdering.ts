import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { DEFAULT_LOCATION_CODE } from "./locations";
import { enqueueKitchenTicketsInTx } from "./kitchen";
import { invalidateCache } from "@/lib/cache";

export type RestaurantOrderInterval = { day: number; open: string; close: string };

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function normalizeRestaurantOrderHours(value: unknown): RestaurantOrderInterval[] {
  if (!Array.isArray(value)) return [];
  const rows: RestaurantOrderInterval[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new Error("ช่วงเวลารับออร์เดอร์ไม่ถูกต้อง");
    const day = Number((raw as any).day);
    const open = String((raw as any).open ?? "").trim();
    const close = String((raw as any).close ?? "").trim();
    if (!Number.isInteger(day) || day < 0 || day > 6 || !TIME_RE.test(open) || !TIME_RE.test(close) || open === close) {
      throw new Error("ช่วงเวลารับออร์เดอร์ต้องมีวัน 0–6 และเวลา HH:mm ที่ไม่เท่ากัน");
    }
    rows.push({ day, open, close });
  }
  return rows.sort((a, b) => a.day - b.day || a.open.localeCompare(b.open));
}

function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  return { day: weekday, minute: Number(value("hour")) * 60 + Number(value("minute")) };
}

const minuteOf = (text: string) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));

export function restaurantOrderingState(input: {
  paused: boolean;
  hours: unknown;
  timezone?: string | null;
  now?: Date;
}): { accepting: boolean; reason: "PAUSED" | "CLOSED" | null } {
  if (input.paused) return { accepting: false, reason: "PAUSED" };
  const hours = normalizeRestaurantOrderHours(input.hours);
  if (hours.length === 0) return { accepting: true, reason: null };
  const local = localParts(input.now ?? new Date(), input.timezone || "Asia/Bangkok");
  const accepting = hours.some((row) => {
    const open = minuteOf(row.open);
    const close = minuteOf(row.close);
    if (open < close) return row.day === local.day && local.minute >= open && local.minute < close;
    const previousDay = (local.day + 6) % 7;
    return (row.day === local.day && local.minute >= open)
      || (row.day === previousDay && local.minute < close);
  });
  return { accepting, reason: accepting ? null : "CLOSED" };
}

export async function restaurantOrderingStateInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string
): Promise<{ isRestaurant: boolean; accepting: boolean; reason: "PAUSED" | "CLOSED" | null }> {
  // Two statements on purpose. This runs inside every non-POS order of every shop, so the
  // 9.56 columns must never be named until the shop is known to be a restaurant — otherwise a
  // database that has not applied 9.56 yet stops selling for every tenant, not just restaurants.
  const archetype = await client.query<{ business_archetype: string | null; timezone: string | null }>(
    `SELECT business_archetype, timezone FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const profile = archetype.rows[0];
  if (profile?.business_archetype !== "restaurant") {
    return { isRestaurant: false, accepting: true, reason: null };
  }
  const result = await client.query<{
    restaurant_order_hours: unknown;
    restaurant_orders_paused: boolean;
  }>(
    `SELECT restaurant_order_hours, restaurant_orders_paused
       FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const row = result.rows[0];
  return { isRestaurant: true, ...restaurantOrderingState({
    paused: Boolean(row?.restaurant_orders_paused),
    hours: row?.restaurant_order_hours,
    timezone: profile.timezone,
  }) };
}

export async function listRestaurantOrderLocations(tenantId: string) {
  // Same ordering as resolveDefaultLocationIdInTx(): bms_locations has no is_default column,
  // head office is code MAIN plus is_head_office. Ordering by a column that does not exist
  // made this tool fail with 42703 on every call.
  const result = await query<{ id: string; name: string; branch_code: string | null }>(
    `SELECT id, name, branch_code FROM bms_locations
      WHERE tenant_id = $1 AND active
      ORDER BY (code = $2) DESC, is_head_office DESC, created_at
      LIMIT 20`,
    [tenantId, DEFAULT_LOCATION_CODE]
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, branchCode: row.branch_code }));
}

export async function listIncomingRestaurantOrders(tenantId: string, locationId: string, limit = 100) {
  // qty is the REMAINING pack quantity, for two reasons:
  //   * a line already cancelled must leave the card, otherwise the counter keeps seeing a dish
  //     whose kitchen ticket is cancelled and whose money is already on the refund queue;
  //   * cancelRestaurantOrderLines() reads packQty as a pack count (pack_qty, not base qty), so
  //     handing the screen oi.qty made every pack-sold line fail with RETURN_QTY_EXCEEDED.
  // Same returned-quantity expression as the POS return path in pos.ts.
  const result = await query<any>(
    `SELECT o.id, o.channel, o.customer_ref, o.status, o.fulfillment_type, o.promised_at,
            o.total_amount + o.shipping_fee AS amount_due, o.created_at,
            COALESCE(jsonb_agg(jsonb_build_object(
              'orderItemId', oi.id, 'sku', oi.product_sku, 'name', p.name, 'size', oi.size,
              'qty', remaining.pack_qty, 'unitName', oi.pack_unit_name,
              'modifierCodes', oi.stock_modifier_codes
            ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL AND remaining.pack_qty > 0), '[]'::jsonb) AS items
       FROM bms_orders o
       LEFT JOIN bms_order_items oi ON oi.tenant_id = o.tenant_id AND oi.order_id = o.id
       LEFT JOIN LATERAL (
         SELECT GREATEST(COALESCE(oi.pack_qty, oi.qty) - COALESCE((
           SELECT SUM(pri.pack_qty)
             FROM bms_pos_return_items pri
             JOIN bms_pos_returns pr ON pr.id = pri.pos_return_id
            WHERE pri.tenant_id = oi.tenant_id
              AND pri.order_item_id = oi.id
              AND pr.order_id = oi.order_id
         ), 0), 0) AS pack_qty
       ) remaining ON TRUE
       LEFT JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
      WHERE o.tenant_id = $1 AND o.location_id = $2 AND o.fulfillment_type IS NOT NULL
        AND o.status IN ('PAID', 'PACKING')
      GROUP BY o.id
      ORDER BY (o.status = 'PAID') DESC, o.promised_at NULLS LAST, o.created_at
      LIMIT $3`,
    [tenantId, locationId, Math.min(Math.max(limit, 1), 200)]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    channel: row.channel,
    customerRef: row.customer_ref,
    status: row.status,
    fulfillmentType: row.fulfillment_type,
    promisedAt: row.promised_at ? new Date(row.promised_at).toISOString() : null,
    amountDue: Number(row.amount_due),
    createdAt: new Date(row.created_at).toISOString(),
    items: row.items,
  }));
}

export async function listPendingRestaurantRefunds(tenantId: string, locationId: string) {
  const result = await query<any>(
    `SELECT a.id, a.amount, a.method, a.created_at, o.id AS order_id, o.channel, o.customer_ref,
            COALESCE(u.name, u.email, pr.returned_by::text) AS cancelled_by
       FROM bms_pos_refund_allocations a
       JOIN bms_pos_returns pr ON pr.tenant_id = a.tenant_id AND pr.id = a.pos_return_id
       JOIN bms_orders o ON o.tenant_id = pr.tenant_id AND o.id = pr.order_id
       LEFT JOIN users u ON u.tenant_id = pr.tenant_id AND u.id = pr.returned_by
      WHERE a.tenant_id = $1 AND o.location_id = $2 AND o.fulfillment_type IS NOT NULL
        AND a.status = 'PENDING'
      ORDER BY a.created_at`,
    [tenantId, locationId]
  );
  return result.rows.map((row: any) => ({
    id: row.id, orderId: row.order_id, amount: Number(row.amount), method: row.method,
    channel: row.channel, customerRef: row.customer_ref, cancelledBy: row.cancelled_by,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function restaurantCancellationLossReport(tenantId: string) {
  const result = await query<any>(
    `SELECT oi.product_sku AS sku, COALESCE(oi.product_name, oi.product_sku) AS name,
            SUM(pri.pack_qty)::int AS quantity,
            SUM(pr.merchant_absorbed_amount * (pri.pack_qty * oi.receipt_unit_price) /
              NULLIF((SELECT SUM(pri2.pack_qty * oi2.receipt_unit_price)
                        FROM bms_pos_return_items pri2
                        JOIN bms_order_items oi2 ON oi2.tenant_id = pri2.tenant_id AND oi2.id = pri2.order_item_id
                       WHERE pri2.tenant_id = pr.tenant_id AND pri2.pos_return_id = pr.id), 0)) AS absorbed_amount
       FROM bms_pos_returns pr
       JOIN bms_pos_return_items pri ON pri.tenant_id = pr.tenant_id AND pri.pos_return_id = pr.id
       JOIN bms_order_items oi ON oi.tenant_id = pri.tenant_id AND oi.id = pri.order_item_id
      WHERE pr.tenant_id = $1 AND pr.pos_device_id IS NULL
        AND pr.merchant_absorbed_amount > 0
        AND pr.created_at >= date_trunc('month', now())
      GROUP BY oi.product_sku, oi.product_name
      ORDER BY absorbed_amount DESC NULLS LAST`,
    [tenantId]
  );
  return result.rows.map((row: any) => ({
    sku: row.sku, name: row.name, quantity: Number(row.quantity), absorbedAmount: Number(row.absorbed_amount ?? 0),
  }));
}

export async function getRestaurantOrderingConfig(tenantId: string) {
  const result = await query<{
    timezone: string | null; restaurant_order_hours: unknown; restaurant_orders_paused: boolean;
  }>(
    `SELECT timezone, restaurant_order_hours, restaurant_orders_paused
       FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const row = result.rows[0];
  const hours = normalizeRestaurantOrderHours(row?.restaurant_order_hours);
  const state = restaurantOrderingState({
    paused: Boolean(row?.restaurant_orders_paused), hours, timezone: row?.timezone,
  });
  return { paused: Boolean(row?.restaurant_orders_paused), hours, ...state };
}

export async function acceptIncomingRestaurantOrder(input: {
  tenantId: string;
  locationId: string;
  orderId: string;
  actorUserId: string;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const order = await client.query<{ status: string }>(
      `SELECT status FROM bms_orders
        WHERE tenant_id = $1 AND id = $2 AND location_id = $3 AND fulfillment_type IS NOT NULL
        FOR UPDATE`,
      [input.tenantId, input.orderId, input.locationId]
    );
    if (!order.rowCount) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" as const };
    }
    if (order.rows[0].status === "PACKING") {
      await client.query("COMMIT");
      return { status: "ACCEPTED" as const, replayed: true };
    }
    if (order.rows[0].status !== "PAID") {
      await client.query("ROLLBACK");
      return { status: "INVALID_STATUS" as const, current: order.rows[0].status };
    }
    await client.query(
      `UPDATE bms_orders SET status = 'PACKING', updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.orderId]
    );
    const ticketsCreated = await enqueueKitchenTicketsInTx(client, input.tenantId, input.orderId);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.online_order_accept',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, input.orderId, JSON.stringify({ locationId: input.locationId, ticketsCreated })]
    );
    await client.query("COMMIT");
    return { status: "ACCEPTED" as const, replayed: false, ticketsCreated };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function setRestaurantOrderingPaused(input: {
  tenantId: string;
  paused: boolean;
  actorUserId: string;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await client.query(
      `INSERT INTO bms_store_profile (tenant_id, restaurant_orders_paused, restaurant_orders_paused_at, restaurant_orders_paused_by)
       VALUES ($1,$2,CASE WHEN $2 THEN now() ELSE NULL END,CASE WHEN $2 THEN $3::uuid ELSE NULL END)
       ON CONFLICT (tenant_id) DO UPDATE SET
         restaurant_orders_paused = EXCLUDED.restaurant_orders_paused,
         restaurant_orders_paused_at = EXCLUDED.restaurant_orders_paused_at,
         restaurant_orders_paused_by = EXCLUDED.restaurant_orders_paused_by,
         updated_at = now()`,
      [input.tenantId, input.paused, input.actorUserId]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.order_intake_pause','store_profile',$3::jsonb)`,
      [input.tenantId, input.actorUserId, JSON.stringify({ paused: input.paused })]
    );
    await client.query("COMMIT");
    await invalidateCache(`store-profile:${input.tenantId}`);
    return { paused: input.paused };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
