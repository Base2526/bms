import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { DEFAULT_LOCATION_CODE } from "./locations";
import { enqueueKitchenTicketsInTx } from "./kitchen";
import { invalidateCache } from "@/lib/cache";
import { DELIVERY_CAPABILITIES, type DeliveryProvider } from "./deliveryPlatforms";
import { enqueueDeliveryCommandInTx } from "./deliveryPlatforms/commands";

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
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query<any>(
    `SELECT o.id, o.channel, o.customer_ref, o.status, o.fulfillment_type, o.promised_at,
            o.total_amount + o.shipping_fee AS amount_due, o.created_at,
            d.provider, d.provider_display_number, d.local_status AS delivery_status,
            d.provider_status, d.payment_status AS delivery_payment_status,
            d.acceptance_deadline_at, d.scheduled_fulfillment_at, d.rider_eta_at,
            cmd.status AS provider_command_status, cmd.last_error AS provider_command_error,
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
       LEFT JOIN bms_delivery_orders d ON d.tenant_id = o.tenant_id AND d.bms_order_id = o.id
       LEFT JOIN LATERAL (
         SELECT status, last_error FROM bms_delivery_commands c
          WHERE c.tenant_id = d.tenant_id AND c.delivery_order_id = d.id
          ORDER BY c.created_at DESC LIMIT 1
       ) cmd ON TRUE
      WHERE o.tenant_id = $1 AND o.location_id = $2 AND o.fulfillment_type IS NOT NULL
        AND o.status IN ('PAID', 'PACKING')
      GROUP BY o.id, d.id, cmd.status, cmd.last_error
      ORDER BY (o.status = 'PAID') DESC, o.promised_at NULLS LAST, o.created_at
      LIMIT $3`,
    [tenantId, locationId, Math.min(Math.max(limit, 1), 200)]
  );
    await client.query("COMMIT");
    return result.rows.map((row: any) => ({
    id: row.id,
    channel: row.channel,
    customerRef: row.customer_ref,
    status: row.status,
    fulfillmentType: row.fulfillment_type,
    promisedAt: row.promised_at ? new Date(row.promised_at).toISOString() : null,
    amountDue: Number(row.amount_due),
    createdAt: new Date(row.created_at).toISOString(),
    provider: row.provider ?? null,
    providerDisplayNumber: row.provider_display_number ?? null,
    deliveryStatus: row.delivery_status ?? null,
    providerStatus: row.provider_status ?? null,
    deliveryPaymentStatus: row.delivery_payment_status ?? null,
    acceptanceDeadlineAt: row.acceptance_deadline_at ? new Date(row.acceptance_deadline_at).toISOString() : null,
    scheduledFulfillmentAt: row.scheduled_fulfillment_at ? new Date(row.scheduled_fulfillment_at).toISOString() : null,
    riderEtaAt: row.rider_eta_at ? new Date(row.rider_eta_at).toISOString() : null,
    providerCommandStatus: row.provider_command_status ?? null,
    providerCommandError: row.provider_command_error ?? null,
    items: row.items,
    }));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
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
  deviceId?: string | null;
  idempotencyKey?: string | null;
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
    const delivery = await client.query<{
      id: string; integration_id: string; provider: DeliveryProvider; provider_order_id: string;
      location_mapping_id: string;
      start_preparation_at: Date | string | null; acceptance_deadline_at: Date | string | null;
      local_status: string; provider_status: string | null;
      rollout_mode: string; outbound_commands_enabled: boolean;
      accepted_by: string | null; accepted_device_id: string | null;
      acceptance_idempotency_key: string | null; acceptance_request_hash: string | null;
    }>(
      `SELECT d.id, d.integration_id, d.location_mapping_id, d.provider, d.provider_order_id,
              d.start_preparation_at, d.acceptance_deadline_at, d.local_status, d.provider_status,
              d.accepted_by, d.accepted_device_id, d.acceptance_idempotency_key, d.acceptance_request_hash,
              i.rollout_mode, i.outbound_commands_enabled
         FROM bms_delivery_orders d
         JOIN bms_delivery_integrations i ON i.tenant_id=d.tenant_id AND i.id=d.integration_id
        WHERE d.tenant_id = $1 AND d.bms_order_id = $2
        FOR UPDATE OF d`,
      [input.tenantId, input.orderId],
    );
    if (delivery.rows[0]) {
      const key = input.idempotencyKey?.trim() ?? "";
      const deviceId = input.deviceId?.trim() ?? "";
      if (key.length < 8 || key.length > 200 || !deviceId) {
        await client.query("ROLLBACK");
        return { status: "IDEMPOTENCY_REQUIRED" as const };
      }
      const requestHash = createHash("sha256").update(JSON.stringify({
        action: "accept", orderId: input.orderId, locationId: input.locationId,
        actorUserId: input.actorUserId, deviceId,
      })).digest("hex");
      if (delivery.rows[0].acceptance_idempotency_key === key) {
        if (delivery.rows[0].acceptance_request_hash !== requestHash
          || delivery.rows[0].accepted_by !== input.actorUserId
          || delivery.rows[0].accepted_device_id !== deviceId) {
          await client.query("ROLLBACK");
          return { status: "IDEMPOTENCY_CONFLICT" as const };
        }
        await client.query("COMMIT");
        return { status: "ACCEPTED" as const, replayed: true };
      }
      const reusedKey = await client.query<{ id: string }>(
        `SELECT id FROM bms_delivery_orders
          WHERE tenant_id = $1 AND acceptance_idempotency_key = $2 AND id <> $3
          LIMIT 1 FOR SHARE`,
        [input.tenantId, key, delivery.rows[0].id],
      );
      if (reusedKey.rowCount) {
        await client.query("ROLLBACK");
        return { status: "IDEMPOTENCY_CONFLICT" as const };
      }
      const allowed = await client.query<{ allowed: boolean }>(
        `SELECT CASE WHEN r.name = 'Administrator' THEN TRUE ELSE EXISTS (
           SELECT 1 FROM bms_role_permissions rp
            WHERE rp.tenant_id = $1 AND rp.role_id = u.role_id
              AND rp.permission = 'restaurant.delivery.review'
         ) END AS allowed
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
         WHERE u.tenant_id = $1 AND u.id = $2`,
        [input.tenantId, input.actorUserId],
      );
      if (!allowed.rows[0]?.allowed) {
        await client.query("ROLLBACK");
        return { status: "FORBIDDEN" as const };
      }
      const providerTerminal = ["CANCELLED", "REJECTED", "EXPIRED"].includes(String(delivery.rows[0].provider_status ?? "").toUpperCase());
      const acceptanceExpired = delivery.rows[0].acceptance_deadline_at
        && new Date(delivery.rows[0].acceptance_deadline_at).getTime() <= Date.now();
      if (order.rows[0].status !== "PACKING" && (providerTerminal || acceptanceExpired || delivery.rows[0].local_status === "EXPIRED")) {
        await client.query(
          `UPDATE bms_delivery_orders SET local_status='ACTION_REQUIRED',updated_at=now()
            WHERE tenant_id=$1 AND id=$2 AND local_status IN ('RECEIVED','AWAITING_ACCEPTANCE','EXPIRED')`,
          [input.tenantId, delivery.rows[0].id],
        );
        await client.query(
          `INSERT INTO bms_delivery_order_events
             (tenant_id,delivery_order_id,event_kind,actor_type,actor_id,source,safe_detail)
           VALUES ($1,$2,'ACCEPT_BLOCKED_AFTER_DEADLINE','USER',$3,'POS',$4::jsonb)`,
          [input.tenantId, delivery.rows[0].id, input.actorUserId,
            JSON.stringify({ providerTerminal, acceptanceExpired: Boolean(acceptanceExpired), providerStatus: delivery.rows[0].provider_status })],
        );
        await client.query("COMMIT");
        return { status: "ACCEPTANCE_EXPIRED" as const };
      }
    }
    if (order.rows[0].status === "PACKING") {
      await client.query("ROLLBACK");
      return { status: delivery.rows[0] ? "ALREADY_ACCEPTED" as const : "ACCEPTED" as const,
        replayed: !delivery.rows[0] };
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
    const preparationDue = !delivery.rows[0]?.start_preparation_at
      || new Date(delivery.rows[0].start_preparation_at).getTime() <= Date.now();
    const ticketsCreated = preparationDue
      ? await enqueueKitchenTicketsInTx(client, input.tenantId, input.orderId)
      : 0;
    let providerCommandId: string | null = null;
    if (delivery.rows[0]) {
      const row = delivery.rows[0];
      await client.query(
        `UPDATE bms_delivery_orders
            SET local_status = CASE WHEN $3 THEN 'PREPARING' ELSE 'ACCEPTED' END,
                accepted_at = COALESCE(accepted_at, now()),
                accepted_by = $4, accepted_device_id = $5,
                acceptance_idempotency_key = $6, acceptance_request_hash = $7,
                preparing_at = CASE WHEN $3 THEN COALESCE(preparing_at, now()) ELSE preparing_at END,
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, row.id, preparationDue, input.actorUserId, input.deviceId!.trim(),
          input.idempotencyKey!.trim(), createHash("sha256").update(JSON.stringify({
            action: "accept", orderId: input.orderId, locationId: input.locationId,
            actorUserId: input.actorUserId, deviceId: input.deviceId!.trim(),
          })).digest("hex")],
      );
      await client.query(
        `INSERT INTO bms_delivery_order_events
           (tenant_id, delivery_order_id, event_kind, actor_type, actor_id, source, safe_detail)
         VALUES ($1,$2,'ORDER_ACCEPTED','USER',$3,'POS',$4::jsonb)`,
        [input.tenantId, row.id, input.actorUserId, JSON.stringify({ ticketsCreated, scheduledPreparation: !preparationDue })],
      );
      const store = await client.query<{ provider_store_id: string }>(
        `SELECT provider_store_id FROM bms_delivery_location_mappings
          WHERE tenant_id = $1 AND id = $2 AND integration_id = $3
            AND location_id = $4 AND active`,
        [input.tenantId, row.location_mapping_id, row.integration_id, input.locationId],
      );
      if (!store.rows[0]) throw new Error("DELIVERY_LOCATION_MAPPING_MISSING_AFTER_ORDER");
      const providerCommandReady = DELIVERY_CAPABILITIES[row.provider].acceptOrder === "VERIFIED"
        && row.rollout_mode === "LIVE" && row.outbound_commands_enabled;
      const command = await enqueueDeliveryCommandInTx(client, {
        tenantId: input.tenantId,
        integrationId: row.integration_id,
        deliveryOrderId: row.id,
        commandType: "ACCEPT_ORDER",
        aggregateType: "delivery_order",
        aggregateId: row.id,
        desiredState: { providerOrderId: row.provider_order_id, providerStoreId: store.rows[0].provider_store_id },
        idempotencyKey: `accept:${createHash("sha256").update(input.idempotencyKey!).digest("hex")}`,
        initialStatus: providerCommandReady ? "PENDING" : "MANUAL_ACTION_REQUIRED",
      });
      providerCommandId = command.id;
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.online_order_accept',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, input.orderId, JSON.stringify({ locationId: input.locationId, ticketsCreated })]
    );
    await client.query("COMMIT");
    return { status: "ACCEPTED" as const, replayed: false, ticketsCreated, providerCommandId };
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
