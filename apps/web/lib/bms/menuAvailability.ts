import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type MenuStockPolicy =
  | "DIRECT" | "PACK" | "BUNDLE" | "WEIGHTED" | "RECIPE" | "SERIALIZED" | "NON_STOCK";

export type MenuSellability = {
  sellable: boolean;
  availability: "AVAILABLE" | "SOLD_OUT_TODAY" | "OUT_OF_STOCK";
};

/** One policy function is shared by AI, online ordering and both POS surfaces. */
export function isMenuSellable(input: {
  stockPolicy: MenuStockPolicy | null | undefined;
  temporarilyUnavailable: boolean;
  available: number;
}): MenuSellability {
  if (input.temporarilyUnavailable) {
    return { sellable: false, availability: "SOLD_OUT_TODAY" };
  }
  const policy = input.stockPolicy ?? "DIRECT";
  if (policy === "NON_STOCK" || policy === "RECIPE") {
    return { sellable: true, availability: "AVAILABLE" };
  }
  return input.available > 0
    ? { sellable: true, availability: "AVAILABLE" }
    : { sellable: false, availability: "OUT_OF_STOCK" };
}

function partsAt(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function zonedWallTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, timeZone: string
) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Two passes also handle zones whose UTC offset changes near the requested wall time.
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = partsAt(new Date(guess), timeZone);
    const seenAsUtc = Date.UTC(
      Number(seen.year), Number(seen.month) - 1, Number(seen.day),
      Number(seen.hour), Number(seen.minute), Number(seen.second)
    );
    guess += Date.UTC(year, month - 1, day, hour, minute, 0) - seenAsUtc;
  }
  return new Date(guess);
}

/** Next service-day boundary; unlike midnight, 04:00 keeps late-night service closed. */
export function nextMenuAvailabilityReset(
  now: Date, resetTime = "04:00", timeZone = "Asia/Bangkok"
): Date {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(resetTime);
  if (!match) throw new Error("INVALID_MENU_RESET_TIME");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("INVALID_MENU_RESET_TIME");
  const local = partsAt(now, timeZone);
  let boundary = zonedWallTimeToUtc(
    Number(local.year), Number(local.month), Number(local.day), hour, minute, timeZone
  );
  if (boundary.getTime() <= now.getTime()) {
    const noon = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), 12));
    noon.setUTCDate(noon.getUTCDate() + 1);
    const next = partsAt(noon, timeZone);
    boundary = zonedWallTimeToUtc(
      Number(next.year), Number(next.month), Number(next.day), hour, minute, timeZone
    );
  }
  return boundary;
}

async function resetSettings(tenantId: string) {
  const res = await query<{ reset_time: string; timezone: string }>(
    `SELECT COALESCE(menu_availability_reset_time::text, '04:00:00') AS reset_time,
            COALESCE(NULLIF(timezone, ''), 'Asia/Bangkok') AS timezone
       FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  return res.rows[0] ?? { reset_time: "04:00:00", timezone: "Asia/Bangkok" };
}

export async function setMenuTemporarilyUnavailable(input: {
  tenantId: string;
  locationId: string;
  productSku: string;
  unavailable: boolean;
  actorUserId: string;
  reason?: string | null;
}) {
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 240) throw new Error("MENU_UNAVAILABLE_REASON_TOO_LONG");
  const settings = await resetSettings(input.tenantId);
  const resetsAt = nextMenuAvailabilityReset(new Date(), settings.reset_time, settings.timezone);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    if (input.unavailable) {
      const exists = await client.query(
        `SELECT 1 FROM bms_products p
          JOIN bms_locations l ON l.tenant_id = p.tenant_id
         WHERE p.tenant_id = $1 AND p.sku = $2 AND l.id = $3 AND p.active
         FOR UPDATE OF p`,
        [input.tenantId, input.productSku, input.locationId]
      );
      if (!exists.rowCount) throw new Error("MENU_PRODUCT_OR_LOCATION_NOT_FOUND");
      await client.query(
        `INSERT INTO bms_product_menu_unavailability
           (tenant_id, location_id, product_sku, unavailable_by, reason, resets_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, location_id, product_sku) DO UPDATE SET
           unavailable_at = now(), unavailable_by = EXCLUDED.unavailable_by,
           reason = EXCLUDED.reason, resets_at = EXCLUDED.resets_at`,
        [input.tenantId, input.locationId, input.productSku, input.actorUserId, reason, resetsAt]
      );
    } else {
      await client.query(
        `DELETE FROM bms_product_menu_unavailability
          WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3`,
        [input.tenantId, input.locationId, input.productSku]
      );
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'menu.availability.set',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, input.productSku, JSON.stringify({
        locationId: input.locationId,
        unavailable: input.unavailable,
        reason,
        resetsAt: input.unavailable ? resetsAt.toISOString() : null,
      })]
    );
    await client.query("COMMIT");
    return { productSku: input.productSku, unavailable: input.unavailable,
      availability: input.unavailable ? "SOLD_OUT_TODAY" as const : "AVAILABLE" as const,
      resetsAt: input.unavailable ? resetsAt.toISOString() : null };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function resetMenuAvailabilityForLocationInTx(
  client: PoolClient, tenantId: string, locationId: string
) {
  const result = await client.query(
    `DELETE FROM bms_product_menu_unavailability
      WHERE tenant_id = $1 AND location_id = $2`,
    [tenantId, locationId]
  );
  return result.rowCount ?? 0;
}

export async function resetDueMenuAvailability(now = new Date()) {
  const tenants = await query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM bms_product_menu_unavailability WHERE resets_at <= $1`, [now]
  );
  let resetCount = 0;
  for (const row of tenants.rows) {
    const client = await getClient();
    try {
      await beginTenantTx(client, row.tenant_id);
      const deleted = await client.query(
        `DELETE FROM bms_product_menu_unavailability
          WHERE tenant_id = $1 AND resets_at <= $2 RETURNING location_id, product_sku`,
        [row.tenant_id, now]
      );
      if (deleted.rowCount) {
        await client.query(
          `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
           VALUES ($1,'system:cron','menu.availability.reset','due',$2::jsonb)`,
          [row.tenant_id, JSON.stringify({ count: deleted.rowCount })]
        );
      }
      await client.query("COMMIT");
      resetCount += deleted.rowCount ?? 0;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally { client.release(); }
  }
  return { resetCount };
}
