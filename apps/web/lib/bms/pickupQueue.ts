/**
 * Pickup queue numbers for counter/takeaway POS sales (`10.111`)
 *
 * A number is a label attached to a sale that has **already committed**. It is issued in its
 * own transaction after `recordPosSale()` returns, never inside the money transaction: a queue
 * problem must never block taking money or leave a half-written bill. One number per order, so
 * a replayed sale request gets the same number back.
 *
 * The rows hold no customer identity. The call screen shows only numbers and their status.
 *
 * This module imports only db/tenant on purpose: `kitchen.ts` calls
 * `syncPickupQueueFromKitchenInTx()`, and anything heavier would create an import cycle
 * (kitchen → pickupQueue → … → orders → kitchen).
 */
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type PickupQueueStatus = "PREPARING" | "READY" | "COLLECTED" | "CANCELLED";
export type PickupQueueAction = "call" | "unready" | "collect" | "cancel";

export type PickupQueueEntry = {
  id: string;
  orderId: string;
  queueNo: number;
  queuePrefix: string;
  /** Printed/displayed form, e.g. `042` */
  label: string;
  status: PickupQueueStatus;
  readySource: "KITCHEN" | "STAFF" | null;
  serviceDate: string;
  createdAt: string;
  readyAt: string | null;
  /** Bumped on every (re)call so the screen can highlight and chime again */
  calledAt: string | null;
  closedAt: string | null;
};

/** Public screen shape: number and status only, never the order id. */
export type PickupQueueBoardEntry = Pick<PickupQueueEntry, "label" | "status" | "readyAt" | "calledAt">;

export type PickupQueueBoardSettings = {
  enabled: boolean;
  autoHideMinutes: number;
  showPreparing: boolean;
  boardMessage: string | null;
  branchName: string;
  spotlightSeconds: number;
  voiceMode: "AI_STUDIO" | "VOICE_CHIME" | "CHIME" | "OFF";
  voiceLanguage: "th" | "en";
  voiceRepeat: number;
  voiceVolume: number;
};

export class PickupQueueError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "PickupQueueError";
  }
}

export const PICKUP_QUEUE_ACTIONS: readonly PickupQueueAction[] = ["call", "unready", "collect", "cancel"];

export function formatPickupQueueNo(queueNo: number, prefix = ""): string {
  return `${prefix}${String(Math.trunc(queueNo)).padStart(3, "0")}`;
}

/**
 * Shop service day, not the calendar day. Same expression as the table waitlist (`9.64`,
 * `restaurantWaitlist.ts`): one shop must not have two different day boundaries, and a shop
 * open until 2 a.m. keeps counting instead of restarting at 001 in front of waiting customers.
 */
const SERVICE_DATE_SQL = `(
  (now() AT TIME ZONE COALESCE((SELECT tz.name FROM pg_timezone_names tz WHERE tz.name =
              COALESCE(NULLIF(btrim(to_jsonb(profile)->>'timezone_code'), ''), NULLIF(btrim(profile.timezone), ''))), 'Asia/Bangkok'))
  - COALESCE(profile.menu_availability_reset_time, TIME '04:00')
)::date`;

const SELECT_COLUMNS = `q.id, q.order_id, q.queue_no, q.queue_prefix, q.status, q.ready_source, q.service_date::text AS service_date,
  q.created_at, q.ready_at, q.called_at, q.closed_at`;

function iso(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapEntry(row: any): PickupQueueEntry {
  const queueNo = Number(row.queue_no);
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    queueNo,
    queuePrefix: String(row.queue_prefix ?? ""),
    label: formatPickupQueueNo(queueNo, String(row.queue_prefix ?? "")),
    status: row.status,
    readySource: row.ready_source ?? null,
    serviceDate: String(row.service_date),
    createdAt: iso(row.created_at) ?? "",
    readyAt: iso(row.ready_at),
    calledAt: iso(row.called_at),
    closedAt: iso(row.closed_at),
  };
}

export function toBoardEntry(entry: PickupQueueEntry): PickupQueueBoardEntry {
  return { label: entry.label, status: entry.status, readyAt: entry.readyAt, calledAt: entry.calledAt };
}

export async function getPickupQueueBoardSettings(
  tenantId: string,
  locationId: string,
): Promise<PickupQueueBoardSettings> {
  const result = await query(
    `SELECT name, pickup_queue_enabled, pickup_queue_auto_hide_minutes,
            pickup_queue_show_preparing, pickup_queue_board_message,
            pickup_queue_spotlight_seconds, pickup_queue_voice_mode,
            pickup_queue_voice_language, pickup_queue_voice_repeat, pickup_queue_voice_volume
       FROM bms_locations
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, locationId],
  );
  const row = result.rows[0];
  if (!row) throw new PickupQueueError("ไม่พบสาขานี้", 404);
  return {
    enabled: row.pickup_queue_enabled === true,
    autoHideMinutes: Number(row.pickup_queue_auto_hide_minutes ?? 30),
    showPreparing: row.pickup_queue_show_preparing !== false,
    boardMessage: row.pickup_queue_board_message ?? null,
    branchName: String(row.name ?? ""),
    spotlightSeconds: Number(row.pickup_queue_spotlight_seconds ?? 12),
    voiceMode: row.pickup_queue_voice_mode ?? "AI_STUDIO",
    voiceLanguage: row.pickup_queue_voice_language ?? "th",
    voiceRepeat: Number(row.pickup_queue_voice_repeat ?? 1),
    voiceVolume: Number(row.pickup_queue_voice_volume ?? 80),
  };
}

async function getEntryByOrderInTx(client: Pick<PoolClient, "query">, tenantId: string, orderId: string) {
  const existing = await client.query(
    `SELECT ${SELECT_COLUMNS} FROM bms_pickup_queue q WHERE q.tenant_id = $1 AND q.order_id = $2`,
    [tenantId, orderId]
  );
  return existing.rows[0] ? mapEntry(existing.rows[0]) : null;
}

/**
 * Give a committed counter sale its pickup number (idempotent per order).
 *
 * The order must be a live POS sale of this device and branch, not a table check settlement:
 * a device must not be able to attach numbers to another device's or another branch's bills by
 * guessing an id.
 */
export async function issuePickupQueueNumber(input: {
  tenantId: string;
  locationId: string;
  deviceId: string;
  orderId: string;
  actorUserId: string;
}): Promise<PickupQueueEntry> {
  // Numbers come from MAX+1 within the service day, so two tills can race. The unique index
  // is the real guard; retry instead of showing a database error at the counter.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const client = await getClient();
    try {
      await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
      const order = await client.query<{
        location_id: string;
        voided_at: Date | null;
        restaurant_check_id: string | null;
        service_mode: string | null;
      }>(
        `SELECT o.location_id, o.voided_at, o.restaurant_check_id, rc.service_mode
           FROM bms_orders o
           LEFT JOIN bms_restaurant_checks rc
             ON rc.tenant_id = o.tenant_id AND rc.id = o.restaurant_check_id
          WHERE o.tenant_id = $1 AND o.id = $2 AND o.pos_device_id = $3
          FOR SHARE OF o`,
        [input.tenantId, input.orderId, input.deviceId]
      );
      const row = order.rows[0];
      if (!row) throw new PickupQueueError("ไม่พบบิลนี้ของเครื่องขายนี้", 404);
      if (String(row.location_id) !== input.locationId) {
        throw new PickupQueueError("บิลนี้ไม่ได้อยู่ในสาขาของเครื่องขายนี้", 403);
      }
      // Dine-in checks already have a table number. A take-away check settled at the
      // restaurant register is exactly the "order at the counter, wait for a number" case.
      if (row.restaurant_check_id && row.service_mode !== "TAKEAWAY") {
        throw new PickupQueueError("บิลโต๊ะใช้เลขโต๊ะ ไม่ออกเลขคิวรับของ", 409);
      }

      const existing = await getEntryByOrderInTx(client, input.tenantId, input.orderId);
      if (existing) {
        await client.query("COMMIT");
        return existing;
      }
      if (row.voided_at) throw new PickupQueueError("บิลนี้ถูกยกเลิกแล้ว", 409);

      const inserted = await client.query(
        `WITH day AS (
           SELECT ${SERVICE_DATE_SQL} AS service_date
             FROM bms_locations location
             LEFT JOIN bms_store_profile profile ON profile.tenant_id = location.tenant_id
            WHERE location.tenant_id = $1 AND location.id = $2
         )
         INSERT INTO bms_pickup_queue AS q
           (tenant_id, location_id, order_id, pos_device_id, service_date, queue_no, queue_prefix, created_by, updated_by)
         SELECT $1, $2, $3, $4, day.service_date,
                COALESCE((
                  SELECT MAX(prior.queue_no) FROM bms_pickup_queue prior
                   WHERE prior.tenant_id = $1 AND prior.location_id = $2
                     AND prior.service_date = day.service_date
                ), location.pickup_queue_start_no - 1) + 1,
                location.pickup_queue_prefix, $5, $5
           FROM day
           JOIN bms_locations location ON location.tenant_id = $1 AND location.id = $2
         ON CONFLICT (tenant_id, order_id) DO NOTHING
         RETURNING ${SELECT_COLUMNS}`,
        [input.tenantId, input.locationId, input.orderId, input.deviceId, input.actorUserId]
      );
      if (inserted.rows[0]) {
        // The kitchen may already have finished before payment (take-away rounds are sent
        // first; a quick counter item can be done in seconds). Start from its real state.
        if (row.restaurant_check_id) {
          await syncPickupQueueFromRestaurantCheckInTx(client, input.tenantId, String(row.restaurant_check_id));
        } else {
          await syncPickupQueueFromKitchenInTx(client, input.tenantId, input.orderId);
        }
      }
      const entry = await getEntryByOrderInTx(client, input.tenantId, input.orderId);
      if (!entry) throw new PickupQueueError("ไม่พบสาขานี้", 404);
      if (inserted.rows[0]) {
        await client.query(
          `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
           VALUES ($1,$2,'pos.pickup_queue.issue',$3,$4::jsonb)`,
          [input.tenantId, `user:${input.actorUserId}`, entry.id,
            JSON.stringify({ orderId: input.orderId, queueNo: entry.queueNo, locationId: input.locationId })]
        );
      }
      await client.query("COMMIT");
      return entry;
    } catch (error: any) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error?.code === "23505" && attempt < 3) continue;
      throw error;
    } finally {
      client.release();
    }
  }
  throw new PickupQueueError("ออกเลขคิวไม่สำเร็จ กรุณาลองใหม่", 503);
}

export type PickupQueueAfterSale = {
  pickupQueue: { id: string; queueNo: number; label: string } | null;
  pickupQueueError: string | null;
};

/**
 * Adapter-side wrapper for every place a sale or settlement has **already committed** (web sale,
 * restaurant settlement, mobile GraphQL). It never throws: the money is in, so a queue failure
 * must not turn a successful sale into an error the till would retry or report as failed.
 */
export async function issuePickupQueueAfterSale(input: {
  tenantId: string;
  locationId: string;
  deviceId: string;
  orderId: string;
  actorUserId: string;
  /** Explicit per-device opt-in. */
  requested?: boolean;
  /** Online sales may inherit the authoritative branch switch; offline replay must pass false. */
  allowBranchDefault?: boolean;
}): Promise<PickupQueueAfterSale> {
  try {
    const settings = await getPickupQueueBoardSettings(input.tenantId, input.locationId);
    if (input.requested !== true && !(input.allowBranchDefault === true && settings.enabled)) {
      return { pickupQueue: null, pickupQueueError: null };
    }
    const entry = await issuePickupQueueNumber(input);
    return { pickupQueue: { id: entry.id, queueNo: entry.queueNo, label: entry.label }, pickupQueueError: null };
  } catch (error) {
    if (!(error instanceof PickupQueueError)) {
      console.error("[pickup-queue] number not issued after a committed sale", { orderId: input.orderId, error });
    }
    return {
      pickupQueue: null,
      pickupQueueError: error instanceof PickupQueueError ? error.message : "ออกเลขคิวไม่สำเร็จ",
    };
  }
}

/** Open numbers of today's service day for one branch, oldest number first. */
export async function listPickupQueue(tenantId: string, locationId: string): Promise<PickupQueueEntry[]> {
  const result = await query(
    `SELECT ${SELECT_COLUMNS}
       FROM bms_pickup_queue q
       LEFT JOIN bms_store_profile profile ON profile.tenant_id = q.tenant_id
      WHERE q.tenant_id = $1 AND q.location_id = $2
        AND q.status IN ('PREPARING', 'READY')
        AND q.service_date = ${SERVICE_DATE_SQL}
      ORDER BY q.queue_no
      LIMIT 200`,
    [tenantId, locationId]
  );
  return result.rows.map(mapEntry);
}

/** Customer board list: branch presentation policy may hide preparing or old ready numbers. */
export async function listPickupQueueBoard(
  tenantId: string,
  locationId: string,
): Promise<{ entries: PickupQueueBoardEntry[]; settings: PickupQueueBoardSettings }> {
  const settings = await getPickupQueueBoardSettings(tenantId, locationId);
  const entries = await listPickupQueue(tenantId, locationId);
  const now = Date.now();
  const visible = entries.filter((entry) => {
    if (entry.status === "PREPARING") return settings.showPreparing;
    if (entry.status !== "READY" || settings.autoHideMinutes === 0) return true;
    const since = Date.parse(entry.calledAt ?? entry.readyAt ?? entry.createdAt);
    return !Number.isFinite(since) || now - since < settings.autoHideMinutes * 60_000;
  });
  return { entries: visible.map(toBoardEntry), settings };
}

/**
 * Every number of today's service day at one branch, including collected and cancelled ones,
 * for the staff queue manager (find a number, see what happened to it). Device-authenticated
 * staff view only; the public call screen never uses this.
 */
export async function listPickupQueueDay(tenantId: string, locationId: string): Promise<PickupQueueEntry[]> {
  const result = await query(
    `SELECT ${SELECT_COLUMNS}
       FROM bms_pickup_queue q
       LEFT JOIN bms_store_profile profile ON profile.tenant_id = q.tenant_id
      WHERE q.tenant_id = $1 AND q.location_id = $2
        AND q.service_date = ${SERVICE_DATE_SQL}
      ORDER BY q.queue_no DESC
      LIMIT 500`,
    [tenantId, locationId]
  );
  return result.rows.map(mapEntry);
}

const NEXT_STATUS: Record<PickupQueueAction, ReadonlySet<PickupQueueStatus>> = {
  // Calling again from READY is a re-call: it re-announces the number.
  call: new Set<PickupQueueStatus>(["PREPARING", "READY"]),
  unready: new Set<PickupQueueStatus>(["READY"]),
  // A customer may collect before anyone pressed "call".
  collect: new Set<PickupQueueStatus>(["PREPARING", "READY"]),
  cancel: new Set<PickupQueueStatus>(["PREPARING", "READY"]),
};

export async function updatePickupQueueEntry(input: {
  tenantId: string;
  locationId: string;
  entryId: string;
  action: PickupQueueAction;
  actorUserId: string;
}): Promise<PickupQueueEntry> {
  const action = input.action;
  if (!PICKUP_QUEUE_ACTIONS.includes(action)) throw new PickupQueueError("คำสั่งคิวไม่ถูกต้อง");
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    // Branch-scoped lock: a device may only move numbers of its own branch.
    const current = await client.query<{ status: PickupQueueStatus }>(
      `SELECT status FROM bms_pickup_queue
        WHERE tenant_id = $1 AND id = $2 AND location_id = $3
        FOR UPDATE`,
      [input.tenantId, input.entryId, input.locationId]
    );
    const previous = current.rows[0]?.status;
    if (!previous) throw new PickupQueueError("ไม่พบคิวนี้ในสาขานี้", 404);
    if (!NEXT_STATUS[action].has(previous)) {
      throw new PickupQueueError(`คิวนี้อยู่ในสถานะ ${previous} แล้ว ทำรายการนี้ไม่ได้`, 409);
    }
    const set = action === "call"
      ? `status = 'READY', ready_source = COALESCE(ready_source, 'STAFF'),
         ready_at = COALESCE(ready_at, now()), called_at = now()`
      : action === "unready"
        ? `status = 'PREPARING', ready_source = NULL, ready_at = NULL, called_at = NULL`
        : action === "collect"
          ? `status = 'COLLECTED', closed_at = now()`
          : `status = 'CANCELLED', closed_at = now()`;
    const updated = await client.query(
      `UPDATE bms_pickup_queue q
          SET ${set}, updated_by = $3, updated_at = now()
        WHERE q.tenant_id = $1 AND q.id = $2
        RETURNING ${SELECT_COLUMNS}`,
      [input.tenantId, input.entryId, input.actorUserId]
    );
    const entry = mapEntry(updated.rows[0]);
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'pos.pickup_queue.status',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, entry.id,
        JSON.stringify({ action, previous, status: entry.status, queueNo: entry.queueNo })]
    );
    await client.query("COMMIT");
    return entry;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Kitchen → pickup screen, inside the kitchen ticket transaction.
 *
 * The number is ready when every live (non-cancelled) kitchen ticket of the order is READY or
 * SERVED. If the kitchen moves a ticket back to NEW/PREPARING, readiness the kitchen itself set
 * is withdrawn; a number a cashier called by hand is left alone.
 */
export async function syncPickupQueueFromKitchenInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  orderId: string
): Promise<void> {
  await client.query(
    `WITH t AS (
       SELECT count(*) FILTER (WHERE status <> 'CANCELLED')::int AS live,
              count(*) FILTER (WHERE status IN ('NEW', 'PREPARING'))::int AS open
         FROM bms_kitchen_tickets
        WHERE tenant_id = $1 AND order_id = $2
     )
     UPDATE bms_pickup_queue q
        SET status = CASE WHEN q.status = 'PREPARING' THEN 'READY' ELSE 'PREPARING' END,
            ready_source = CASE WHEN q.status = 'PREPARING' THEN 'KITCHEN' END,
            ready_at = CASE WHEN q.status = 'PREPARING' THEN now() END,
            called_at = CASE WHEN q.status = 'PREPARING' THEN now() END,
            updated_at = now()
       FROM t
      WHERE q.tenant_id = $1 AND q.order_id = $2
        AND ((q.status = 'PREPARING' AND t.live > 0 AND t.open = 0)
          OR (q.status = 'READY' AND q.ready_source = 'KITCHEN' AND t.open > 0))`,
    [tenantId, orderId]
  );
}

/**
 * Same rule for a take-away restaurant check, whose kitchen tickets hang off the check
 * (`bms_restaurant_kitchen_tickets`) rather than the order. Only the check's live order counts.
 */
export async function syncPickupQueueFromRestaurantCheckInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  checkId: string
): Promise<void> {
  await client.query(
    `WITH t AS (
       SELECT count(*) FILTER (WHERE status <> 'CANCELLED')::int AS live,
              count(*) FILTER (WHERE status IN ('NEW', 'PREPARING'))::int AS open
         FROM bms_restaurant_kitchen_tickets
        WHERE tenant_id = $1 AND check_id = $2
     )
     UPDATE bms_pickup_queue q
        SET status = CASE WHEN q.status = 'PREPARING' THEN 'READY' ELSE 'PREPARING' END,
            ready_source = CASE WHEN q.status = 'PREPARING' THEN 'KITCHEN' END,
            ready_at = CASE WHEN q.status = 'PREPARING' THEN now() END,
            called_at = CASE WHEN q.status = 'PREPARING' THEN now() END,
            updated_at = now()
       FROM t, bms_orders o
      WHERE q.tenant_id = $1
        AND o.tenant_id = q.tenant_id AND o.id = q.order_id
        AND o.restaurant_check_id = $2 AND o.voided_at IS NULL
        AND ((q.status = 'PREPARING' AND t.live > 0 AND t.open = 0)
          OR (q.status = 'READY' AND q.ready_source = 'KITCHEN' AND t.open > 0))`,
    [tenantId, checkId]
  );
}

/** A voided bill's number leaves the screen in the same transaction as the void. */
export async function cancelPickupQueueForOrderInTx(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  orderId: string
): Promise<void> {
  await client.query(
    `UPDATE bms_pickup_queue
        SET status = 'CANCELLED', closed_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND order_id = $2 AND status IN ('PREPARING', 'READY')`,
    [tenantId, orderId]
  );
}
