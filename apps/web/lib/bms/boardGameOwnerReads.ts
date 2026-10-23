import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { requireBoardGameCafeTenant, listBoardGameFloor, boardGamePassOutstanding } from "./boardGameCafe";
import { listBoardGameWaitlist } from "./boardGameWaitlist";
import { assertAnalyticsDate, reportRangeBounds } from "./boardGameAnalyticsMath";

export type OwnerReadInput = { locationId: string; offset?: number; limit?: number };
export const BOARD_GAME_OWNER_LIBRARY_VIEWS = ["COPIES", "ATTENTION", "UNPLAYED", "USAGE"] as const;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function page(input: OwnerReadInput) {
  const limit = input.limit ?? 25, offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error("BOARD_GAME_OWNER_INVALID_PAGE");
  }
  return { limit, offset };
}
function paged<T>(rows: T[], offset: number, limit: number) {
  const more = rows.length > limit;
  return { rows: rows.slice(0, limit), outputTruncated: more, nextOffset: more && offset + limit <= 100_000 ? offset + limit : null,
    paginationLimitReached: more && offset + limit > 100_000 };
}
const label = (value: string) => value.slice(0, 200);

async function inScope<T>(tenantId: string, actorId: string, input: OwnerReadInput,
  operation: (client: PoolClient, context: { timezone: string; observedAt: Date }) => Promise<T>) {
  if (!tenantId || !actorId || !UUID.test(input.locationId)) throw new Error("BOARD_GAME_OWNER_INVALID_SCOPE");
  page(input);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { serializable: true });
    await requireBoardGameCafeTenant(client, tenantId);
    await client.query("SET LOCAL statement_timeout = '30s'");
    const access = await client.query(
      `SELECT l.id FROM bms_locations l WHERE l.tenant_id=$1 AND l.id=$3
       AND (NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2)
         OR EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 AND location_id=l.id))`,
      [tenantId, actorId, input.locationId],
    );
    if (!access.rowCount) throw new Error("BOARD_GAME_OWNER_FORBIDDEN");
    const timezone = (await client.query<{ timezone: string }>(
      `SELECT COALESCE(tz.name,'Asia/Bangkok') AS timezone FROM bms_store_profile p
       LEFT JOIN pg_timezone_names tz ON tz.name=COALESCE(NULLIF(btrim(to_jsonb(p)->>'timezone_code'),''),NULLIF(btrim(p.timezone),''))
       WHERE p.tenant_id=$1`, [tenantId],
    )).rows[0]?.timezone ?? "Asia/Bangkok";
    const observedAt = (await client.query<{ now: Date }>("SELECT transaction_timestamp() AS now")).rows[0].now;
    const result = await operation(client, { timezone, observedAt });
    await client.query("COMMIT");
    return { locationId: input.locationId, timezone, observedAt: observedAt.toISOString(), ...result };
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}

/** Reuse operational state derivation. Never expose guest contacts, notes, collateral or raw bills. */
export async function readBoardGameLiveOperations(tenantId: string, actorId: string, input: OwnerReadInput) {
  return inScope(tenantId, actorId, input, async () => {
    const { offset, limit } = page(input);
    const [floor, queue] = await Promise.all([listBoardGameFloor(tenantId, input.locationId), listBoardGameWaitlist(tenantId, input.locationId)]);
    const tables = floor.tables.map((t) => ({ tableId: t.id, code: label(t.code), name: label(t.name), areaId: t.areaId,
      seats: t.seats, blocked: t.blocked, occupied: t.occupied, sessionCount: t.openSession?.sessionCount ?? 0,
      status: t.openSession?.status ?? null, alertStatus: t.openSession?.alertStatus ?? null,
      awaitingPaymentCount: t.openSession?.awaitingPaymentCount ?? 0 }));
    const entries = queue.entries.filter((e) => ["WAITING", "CALLED", "REQUESTED", "CONFIRMED"].includes(e.status))
      .map((e) => ({ id: e.id, kind: e.kind, status: e.status, queueNo: e.queueNo, partySize: e.partySize,
        reservedFor: e.reservedFor, tableCode: e.reservedTableCode }));
    return { basis: "Current operational reads, not an atomic snapshot. Reservations include future dates; REQUESTED is not confirmed. waitingGuests includes WAITING and CALLED parties. No promised wait or table-free time. Unsettled groups are not paid revenue.",
      areas: paged(floor.areas.slice(offset).map(a => ({ id: a.id, name: label(a.name) })), offset, limit),
      tables: paged(tables.slice(offset), offset, limit), entries: paged(entries.slice(offset), offset, limit),
      totals: { tables: tables.length, occupied: tables.filter(t => t.occupied).length, blocked: tables.filter(t => t.blocked).length,
        available: tables.filter(t => !t.occupied && !t.blocked).length, waiting: queue.waitingCount, called: queue.calledCount,
        confirmedReservations: queue.confirmedReservationCount, requestedReservations: queue.requestedReservationCount,
        waitingGuests: queue.waitingGuests },
    };
  });
}

export async function readBoardGamePassBalances(tenantId: string, actorId: string, input: OwnerReadInput) {
  return inScope(tenantId, actorId, input, async (client) => {
    const { offset, limit } = page(input);
    const outstanding = await boardGamePassOutstanding(tenantId, [input.locationId]);
    // Count the whole expiry cohort, not the current page. The legacy expiringIn30Days is MINUTES.
    const expiringPassesIn30Days = (await client.query<{ expiring_passes: number }>(
      `SELECT count(*)::int AS expiring_passes FROM bms_board_game_member_passes p
       WHERE p.tenant_id=$1 AND (p.location_id=$2 OR p.location_id IS NULL)
       AND p.status='ACTIVE' AND p.expires_at>now() AND p.expires_at<=now()+interval '30 days'`,
      [tenantId, input.locationId],
    )).rows[0]?.expiring_passes;
    if (typeof expiringPassesIn30Days !== "number" || !Number.isSafeInteger(expiringPassesIn30Days) || expiringPassesIn30Days < 0) throw new Error("BOARD_GAME_OWNER_INVALID_RESULT");
    const rows = (await client.query<{ id: string; plan_code: string; plan_name: string; kind: string; remaining_minutes: number | null; expires_at: Date; location_id: string | null }>(
      `SELECT p.id,p.plan_code,p.plan_name,p.kind,p.remaining_minutes,p.expires_at,p.location_id
       FROM bms_board_game_member_passes p WHERE p.tenant_id=$1 AND (p.location_id=$2 OR p.location_id IS NULL)
       AND p.status='ACTIVE' AND p.expires_at>now() AND p.expires_at<=now()+interval '30 days'
       ORDER BY p.expires_at,p.id LIMIT $3 OFFSET $4`, [tenantId, input.locationId, limit + 1, offset],
    )).rows.map(r => ({ passId: r.id, planCode: label(r.plan_code), planName: label(r.plan_name), kind: r.kind,
      remainingMinutes: r.remaining_minutes, expiresAt: r.expires_at.toISOString(), allBranchPass: r.location_id === null }));
    return { basis: "Current ACTIVE unexpired contracts, including shared all-branch passes and contracts starting later; not proof of redemption eligibility now. Do not sum branch reports (shared passes repeat). Minutes are not money; unlimited balance is null. expiringPassesIn30Days counts all contracts (including unlimited) in the next 30 days, not page length; expiringMinutesIn30Days counts minutes. No customer identities. Reads may observe concurrent changes.",
      complete: outstanding.balanceMismatchCount === 0,
      outstanding: { activeMinutePasses: outstanding.activeMinutePasses, activeUnlimitedPasses: outstanding.activeUnlimitedPasses,
        outstandingMinutes: outstanding.outstandingMinutes, expiringMinutesIn30Days: outstanding.expiringIn30Days, expiringPassesIn30Days,
        balanceMismatchCount: outstanding.balanceMismatchCount }, expiring: paged(rows, offset, limit) };
  });
}

export async function readBoardGameOwnerLibrary(tenantId: string, actorId: string,
  input: OwnerReadInput & { view: typeof BOARD_GAME_OWNER_LIBRARY_VIEWS[number]; from?: string; to?: string }) {
  if (!BOARD_GAME_OWNER_LIBRARY_VIEWS.includes(input.view)) throw new Error("BOARD_GAME_OWNER_INVALID_VIEW");
  if (input.view === "USAGE") {
    assertAnalyticsDate(input.from ?? ""); assertAnalyticsDate(input.to ?? "");
    const days = (Date.parse(input.to!) - Date.parse(input.from!)) / 86_400_000 + 1;
    if (days < 1 || days > 92) throw new Error("BOARD_GAME_ANALYTICS_RANGE_MAX_92_DAYS");
  } else if (input.from !== undefined || input.to !== undefined) throw new Error("BOARD_GAME_OWNER_UNEXPECTED_DATE");
  return inScope(tenantId, actorId, input, async (client, context) => {
    const { offset, limit } = page(input);
    if (input.view === "USAGE") {
      const bounds = reportRangeBounds({ from: input.from!, to: input.to! }, context.timezone);
      const rows = (await client.query<{ title_id: string; name: string; plays: number; minutes: string }>(
        `SELECT t.id AS title_id,t.title AS name,count(*)::int AS plays,
          sum(EXTRACT(EPOCH FROM (LEAST(COALESCE(g.returned_at,$5),$3,$5)-GREATEST(g.checked_out_at,$2)))/60)::text AS minutes
         FROM bms_board_game_session_games g JOIN bms_board_game_sessions s ON s.tenant_id=g.tenant_id AND s.id=g.session_id
         JOIN bms_board_game_copies c ON c.tenant_id=g.tenant_id AND c.id=g.copy_id
         JOIN bms_board_game_titles t ON t.tenant_id=c.tenant_id AND t.id=c.title_id
         WHERE g.tenant_id=$1 AND s.location_id=$4 AND g.checked_out_at<LEAST($3,$5) AND COALESCE(g.returned_at,$5)>$2
         GROUP BY t.id,t.title ORDER BY plays DESC,t.title,t.id LIMIT $6 OFFSET $7`,
        [tenantId, bounds.start, bounds.end, input.locationId, context.observedAt, limit + 1, offset],
      )).rows.map(r => ({ titleId: r.title_id, name: label(r.name), plays: Number(r.plays), minutes: Math.round(Number(r.minutes)) }));
      return { view: input.view, range: { from: input.from, to: input.to }, basis: "Recorded overlapping loans, not unique players/completed games. Minutes clipped to range and observation. Pages are live reads, not a frozen export.", ...paged(rows, offset, limit) };
    }
    if (input.view === "UNPLAYED") {
      const rows = (await client.query<{ id: string; title: string }>(
        `SELECT t.id,t.title FROM bms_board_game_titles t WHERE t.tenant_id=$1
         AND EXISTS (SELECT 1 FROM bms_board_game_copies c WHERE c.tenant_id=$1 AND c.title_id=t.id AND c.location_id=$2)
         AND NOT EXISTS (SELECT 1 FROM bms_board_game_session_games g
           JOIN bms_board_game_copies c ON c.tenant_id=g.tenant_id AND c.id=g.copy_id
           JOIN bms_board_game_sessions s ON s.tenant_id=g.tenant_id AND s.id=g.session_id
           WHERE g.tenant_id=$1 AND c.title_id=t.id AND s.location_id=$2)
         ORDER BY t.title,t.id LIMIT $3 OFFSET $4`, [tenantId, input.locationId, limit + 1, offset],
      )).rows.map(r => ({ titleId: r.id, name: label(r.title) }));
      return { view: input.view, basis: "Titles with copies currently in this branch and no recorded loan at this branch in retained history. NOT proof never physically played; missing/unrecorded/deleted history is unknown. Not an ROI or purchase recommendation.", ...paged(rows, offset, limit) };
    }
    const rows = (await client.query<{ id: string; copy_code: string; title: string; status: string }>(
      `SELECT c.id,c.copy_code,t.title,c.status FROM bms_board_game_copies c
       JOIN bms_board_game_titles t ON t.tenant_id=c.tenant_id AND t.id=c.title_id
       WHERE c.tenant_id=$1 AND c.location_id=$2
       AND (NOT $3::boolean OR c.status IN ('NEEDS_CHECK','DAMAGED','MISSING_PARTS','REPAIRING'))
       ORDER BY t.title,c.copy_code,c.id LIMIT $4 OFFSET $5`, [tenantId, input.locationId, input.view === "ATTENTION", limit + 1, offset],
    )).rows.map(r => ({ copyId: r.id, copyCode: label(r.copy_code), title: label(r.title), status: r.status }));
    return { view: input.view, basis: "Recorded copy status only, no condition notes, borrowers, costs, repair estimate or stock movement.", ...paged(rows, offset, limit) };
  });
}
