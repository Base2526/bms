import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
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

export async function restaurantOrderingStateInTx(client: Pick<PoolClient, "query">, tenantId: string) {
  const result = await client.query<{
    business_archetype: string | null;
    timezone: string | null;
    restaurant_order_hours: unknown;
    restaurant_orders_paused: boolean;
  }>(
    `SELECT business_archetype, timezone, restaurant_order_hours, restaurant_orders_paused
       FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const row = result.rows[0];
  if (row?.business_archetype !== "restaurant") return { accepting: true, reason: null as null };
  return restaurantOrderingState({
    paused: Boolean(row.restaurant_orders_paused),
    hours: row.restaurant_order_hours,
    timezone: row.timezone,
  });
}

export async function listRestaurantOrderLocations(tenantId: string) {
  const result = await query<{ id: string; name: string; branch_code: string | null }>(
    `SELECT id, name, branch_code FROM bms_locations
      WHERE tenant_id = $1 AND active ORDER BY is_default DESC, name LIMIT 20`,
    [tenantId]
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, branchCode: row.branch_code }));
}

export async function listIncomingRestaurantOrders(tenantId: string, locationId: string, limit = 100) {
  const result = await query<any>(
    `SELECT o.id, o.channel, o.customer_ref, o.status, o.fulfillment_type, o.promised_at,
            o.total_amount + o.shipping_fee AS amount_due, o.created_at,
            COALESCE(jsonb_agg(jsonb_build_object(
              'orderItemId', oi.id, 'sku', oi.product_sku, 'name', p.name, 'size', oi.size,
              'qty', oi.qty, 'modifierCodes', oi.stock_modifier_codes
            ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
       FROM bms_orders o
       LEFT JOIN bms_order_items oi ON oi.tenant_id = o.tenant_id AND oi.order_id = o.id
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
