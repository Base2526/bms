import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { requireBoardGameCafeTenant } from "./boardGameCafe";
import { scanSalesEvidenceInTx } from "./salesEvidence";
import { readReturnFinancialSnapshot } from "./returnFinancialSnapshot";
import {
  allocateEvidenceAmount,
  evidenceCents,
  evidenceDecimal,
  inspectSalesEvidence,
  type SalesEvidenceEvent,
} from "./salesEvidenceMath";
import {
  availabilityIntervals,
  assertAnalyticsDate,
  bucketByWeekdayHour,
  clipIntervals,
  intersectIntervals,
  intervalMinutes,
  reportRangeBounds,
  utilization,
  unionIntervals,
  observedEnd,
  type EffectiveOpeningHour,
  type TimeInterval,
} from "./boardGameAnalyticsMath";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERVAL_LIMIT = 50_000;
export const BOARD_GAME_ANALYTICS_GRANULARITIES = ["DAY", "WEEKDAY_HOUR", "TABLE", "AREA"] as const;
export type BoardGameAnalyticsGranularity = typeof BOARD_GAME_ANALYTICS_GRANULARITIES[number];

export type BoardGameAnalyticsInput = {
  from: string;
  to: string;
  locationId?: string | null;
  areaId?: string | null;
  granularity?: BoardGameAnalyticsGranularity | null;
};

export type BoardGameBranchHourInput = {
  weekday: number;
  opensAt?: string | null;
  closesAt?: string | null;
  closed: boolean;
};

type Issue = { code: string; message: string; count: number };
type TableRow = { id: string; location_id: string; area_id: string; code: string; name: string; seats: number; area_name: string; location_name: string; available: boolean };
type OccupancyRow = { id: string; table_id: string; seating_id: string; started_at: Date; ended_at: Date | null; backfilled: boolean };
type SessionOccupancyRow = { id: string; session_id: string; table_id: string; started_at: Date; ended_at: Date | null; backfilled: boolean };
type SessionRow = { id: string; table_id: string; seating_id: string; started_at: Date; ended_at: Date | null; status: string; guest_count: number };
type ParticipantRow = { session_id: string; joined_at: Date; left_at: Date | null };
type GroupRow = { id: string; session_id: string; status: string; amount_due: string; charge_snapshot: unknown; ended_at: Date | null; current_order_id: string | null };

function normalize(input: BoardGameAnalyticsInput) {
  const date = (value: unknown) => {
    if (typeof value !== "string") {
      throw new Error("BOARD_GAME_ANALYTICS_INVALID_DATE");
    }
    assertAnalyticsDate(value);
    return value;
  };
  const from = date(input?.from), to = date(input?.to);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days < 1 || days > 92) throw new Error("BOARD_GAME_ANALYTICS_RANGE_MAX_92_DAYS");
  const optionalUuid = (value: unknown, code: string) => {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || !UUID.test(value)) throw new Error(code);
    return value.toLowerCase();
  };
  const locationId = optionalUuid(input.locationId, "BOARD_GAME_ANALYTICS_INVALID_LOCATION");
  const areaId = optionalUuid(input.areaId, "BOARD_GAME_ANALYTICS_INVALID_AREA");
  if (areaId && !locationId) throw new Error("BOARD_GAME_ANALYTICS_AREA_REQUIRES_LOCATION");
  const granularity = input.granularity ?? "DAY";
  if (!BOARD_GAME_ANALYTICS_GRANULARITIES.includes(granularity)) throw new Error("BOARD_GAME_ANALYTICS_INVALID_GRANULARITY");
  return { from, to, days, locationId, areaId, granularity };
}

function cents(value: unknown): bigint {
  if (typeof value === "number" && Number.isFinite(value)) return evidenceCents(value.toFixed(2));
  return evidenceCents(String(value));
}
const hours = (minutes: number) => Math.round(minutes * 100) / 6000;

function chargeLines(snapshot: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === "object" && !Array.isArray(line)));
}

function issueCounter() {
  const map = new Map<string, Issue>();
  return {
    add(code: string, message: string, count = 1) {
      const current = map.get(code);
      map.set(code, { code, message, count: (current?.count ?? 0) + count });
    },
    values: () => [...map.values()].sort((a, b) => a.code.localeCompare(b.code)),
  };
}

function allocationForSession(
  session: SessionRow,
  occupancy: readonly SessionOccupancyRow[],
  tableWindows: Map<string, TimeInterval[]>,
  until: Date,
  from: Date = session.started_at,
) {
  const rows = occupancy.filter((row) => row.session_id === session.id);
  return rows.flatMap((row) => {
    const end = row.ended_at && row.ended_at < until ? row.ended_at : until;
    const start = row.started_at > from ? row.started_at : from;
    if (start >= end || from >= until) return [];
    const clipped = clipIntervals([{ start, end }], { start: from, end: until });
    return intersectIntervals(clipped, tableWindows.get(row.table_id) ?? []).map((interval) => ({ tableId: row.table_id, interval }));
  });
}

function distribute(amount: bigint, spans: Array<{ tableId: string; interval: TimeInterval }>) {
  if (!spans.length) return [] as Array<{ tableId: string; interval: TimeInterval; amount: bigint }>;
  const weights = spans.map((span) => BigInt(Math.max(0, Math.round(intervalMinutes([span.interval]) * 1000))));
  if (weights.every((weight) => weight === 0n)) return [];
  return allocateEvidenceAmount(amount < 0n ? -amount : amount, weights).map((part, index) => ({
    tableId: spans[index].tableId,
    interval: spans[index].interval,
    amount: amount < 0n ? -part : part,
  }));
}

export async function getBoardGameAnalytics(
  tenantId: string,
  actorId: string,
  input: BoardGameAnalyticsInput,
  transaction?: PoolClient,
  options: { includeCosts?: boolean; includeAllOffers?: boolean } = {},
) {
  if (!tenantId || !actorId) throw new Error("BOARD_GAME_ANALYTICS_FORBIDDEN");
  const filter = normalize(input);
  const client = transaction ?? await getClient();
  const owns = !transaction;
  try {
    if (owns) await beginTenantTx(client, tenantId, { serializable: true });
    await requireBoardGameCafeTenant(client, tenantId);
    await client.query("SET LOCAL statement_timeout = '30s'");

    const access = (await client.query<{ scoped: boolean; allowed: string[]; requested_exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2) AS scoped,
              ARRAY(SELECT location_id::text FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2 ORDER BY location_id) AS allowed,
              ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$3)) AS requested_exists`,
      [tenantId, actorId, filter.locationId],
    )).rows[0];
    if (!access?.requested_exists || (filter.locationId && access.scoped && !access.allowed.includes(filter.locationId))) {
      throw new Error("BOARD_GAME_ANALYTICS_FORBIDDEN");
    }
    if (!filter.locationId && access.scoped) throw new Error("BOARD_GAME_ANALYTICS_ALL_BRANCH_ACCESS_REQUIRED");
    const locationIds = filter.locationId ? [filter.locationId] : null;

    const timezone = (await client.query<{ timezone: string }>(
      `SELECT COALESCE(tz.name, 'Asia/Bangkok') AS timezone
         FROM bms_store_profile p
         LEFT JOIN pg_timezone_names tz
           ON tz.name = COALESCE(NULLIF(btrim(to_jsonb(p)->>'timezone_code'), ''), NULLIF(btrim(p.timezone), ''))
        WHERE p.tenant_id = $1`, [tenantId],
    )).rows[0]?.timezone ?? "Asia/Bangkok";
    const bounds = reportRangeBounds(filter, timezone);
    const observedAt = (await client.query<{ now: Date }>("SELECT transaction_timestamp() AS now")).rows[0].now;
    const observedRangeEnd = observedEnd(null, observedAt, bounds.end);

    if (filter.areaId) {
      const area = await client.query(
        `SELECT 1 FROM bms_board_game_areas WHERE tenant_id=$1 AND location_id=$2 AND id=$3`,
        [tenantId, filter.locationId, filter.areaId],
      );
      if (!area.rowCount) throw new Error("BOARD_GAME_ANALYTICS_INVALID_AREA");
    }

    const allTables = (await client.query<TableRow>(
      `SELECT t.id,t.location_id,t.area_id,t.code,t.name,t.seats,a.name AS area_name,l.name AS location_name,
              (t.active AND NOT t.blocked AND a.active) AS available
         FROM bms_board_game_tables t
         JOIN bms_board_game_areas a ON a.tenant_id=t.tenant_id AND a.id=t.area_id
         JOIN bms_locations l ON l.tenant_id=t.tenant_id AND l.id=t.location_id
        WHERE t.tenant_id=$1
          AND ($2::uuid[] IS NULL OR t.location_id=ANY($2::uuid[]))
        ORDER BY l.name,a.sort_order,t.sort_order,t.code`,
      [tenantId, locationIds],
    )).rows;
    const tables = allTables.filter((row) => !filter.areaId || row.area_id === filter.areaId);
    const tableIds = tables.map((row) => row.id);
    const selectedTableIds = new Set(tableIds);
    const branchIds = [...new Set(tables.map((row) => row.location_id))];
    const hourRows = branchIds.length ? (await client.query<{
      location_id: string; weekday: number; opens_at: string | null; closes_at: string | null; closed: boolean; effective_from: string;
    }>(
      `SELECT location_id,weekday,opens_at::text,closes_at::text,closed,effective_from::text
         FROM bms_board_game_branch_hours
        WHERE tenant_id=$1 AND location_id=ANY($2::uuid[]) AND effective_from <= $3::date
        ORDER BY location_id,weekday,effective_from`,
      [tenantId, branchIds, filter.to],
    )).rows : [];

    const issue = issueCounter();
    if (tables.length) issue.add("CURRENT_CAPACITY_BASIS", "Utilization uses current active/unblocked tables and current seat counts with effective opening hours, not historical table availability or seating capacity. Occupied hours include only that configured capacity window.");
    // Scan once, then resolve the originating group even for a return whose sale
    // was in an older period. The shared scanner bounds this buffer to 20k events.
    const salesEvents: SalesEvidenceEvent[] = [];
    const scan = await scanSalesEvidenceInTx(client, tenantId, actorId, {
      from: filter.from, to: filter.to, locationId: filter.locationId, channel: null,
    }, (event) => { salesEvents.push(event); }, options.includeCosts === true, timezone);
    const eventOrderIds = [...new Set(salesEvents.map((event) => event.orderId))];
    if (!options.includeCosts) issue.add("COST_HIDDEN", "Product cost and gross profit require product and tax-document access.");
    const availabilityByLocation = new Map<string, ReturnType<typeof availabilityIntervals>>();
    for (const locationId of branchIds) {
      const rows: EffectiveOpeningHour[] = hourRows.filter((row) => row.location_id === locationId).map((row) => ({
        weekday: Number(row.weekday), opensAt: row.opens_at?.slice(0, 8) ?? null,
        closesAt: row.closes_at?.slice(0, 8) ?? null, closed: row.closed, effectiveFrom: row.effective_from,
      }));
      const availability = availabilityIntervals(rows, filter, timezone);
      availabilityByLocation.set(locationId, availability);
      if (availability.missingDates.length) issue.add("HOURS_NOT_CONFIGURED", "Structured opening hours are missing for part of the selected range.", availability.missingDates.length);
    }
    const tableAvailability = new Map(tables.map((table) => [table.id, table.available ? availabilityByLocation.get(table.location_id)?.intervals ?? [] : []]));
    // Revenue follows the table path even when a visit ran outside configured
    // opening hours. Hours constrain utilization, never recognized money.
    // Allocate over the entire visit FIRST, then select the area. Otherwise each
    // area's report incorrectly claims the whole bill after a table move.
    const tableReportWindows = new Map(allTables.map((table) => [table.id, [{ start: new Date("2000-01-01T00:00:00Z"), end: observedAt }]]));
    const selectedParts = (amount: bigint, spans: Array<{ tableId: string; interval: TimeInterval }>) =>
      distribute(amount, spans).filter((part) => selectedTableIds.has(part.tableId));
    const selectedAmount = (amount: bigint, spans: Array<{ tableId: string; interval: TimeInterval }>) =>
      selectedParts(amount, spans).reduce((sum, part) => sum + part.amount, 0n);

    let occupancy = tableIds.length ? (await client.query<OccupancyRow>(
      `SELECT id,table_id,seating_id,started_at,ended_at,backfilled
         FROM bms_board_game_table_occupancy
        WHERE tenant_id=$1 AND table_id=ANY($2::uuid[])
          AND started_at < $4 AND COALESCE(ended_at,transaction_timestamp()) > $3
        ORDER BY started_at,id LIMIT $5`,
      [tenantId, tableIds, bounds.start, bounds.end, INTERVAL_LIMIT + 1],
    )).rows : [];
    const occupancyTruncated = occupancy.length > INTERVAL_LIMIT;
    if (occupancyTruncated) { occupancy = occupancy.slice(0, INTERVAL_LIMIT); issue.add("INTERVAL_LIMIT", "Occupancy intervals exceeded the report safety limit."); }
    const backfilledBefore = (await client.query<{ date: string | null }>(
      `SELECT min((created_at AT TIME ZONE $3)::date)::text AS date
         FROM bms_board_game_table_occupancy
        WHERE tenant_id=$1 AND backfilled AND ($2::uuid[] IS NULL OR location_id=ANY($2::uuid[]))`,
      [tenantId, locationIds, timezone],
    )).rows[0]?.date ?? null;
    if (backfilledBefore && filter.from <= backfilledBefore) issue.add("BACKFILLED_OCCUPANCY", "Table moves before the occupancy ledger was installed may be approximate.");

    const occupiedByTable = new Map<string, TimeInterval[]>();
    for (const row of occupancy) {
      const raw = clipIntervals([{ start: row.started_at, end: observedEnd(row.ended_at, observedAt, bounds.end) }], bounds);
      const clipped = intersectIntervals(raw, tableAvailability.get(row.table_id) ?? []);
      occupiedByTable.set(row.table_id, unionIntervals([...(occupiedByTable.get(row.table_id) ?? []), ...clipped]));
    }

    let sessions = tableIds.length ? (await client.query<SessionRow>(
      `SELECT s.id,s.table_id,s.seating_id,s.started_at,s.ended_at,s.status,s.guest_count
         FROM bms_board_game_sessions s
        WHERE s.tenant_id=$1 AND EXISTS (
          SELECT 1 FROM bms_board_game_session_table_occupancy o
           WHERE o.tenant_id=$1 AND o.session_id=s.id AND o.table_id=ANY($2::uuid[])
        ) AND ((s.started_at < $4 AND COALESCE(s.ended_at,transaction_timestamp()) > $3)
          OR EXISTS (SELECT 1 FROM bms_board_game_billing_groups g
            WHERE g.tenant_id=$1 AND g.session_id=s.id
              AND ((g.status='PAID' AND g.ended_at >= $3 AND g.ended_at < $4) OR g.current_order_id=ANY($6::uuid[]))))
        ORDER BY s.started_at,s.id LIMIT $5`,
      [tenantId, tableIds, bounds.start, bounds.end, INTERVAL_LIMIT + 1, eventOrderIds],
    )).rows : [];
    let recordsTruncated = sessions.length > INTERVAL_LIMIT;
    if (recordsTruncated) { sessions = sessions.slice(0, INTERVAL_LIMIT); issue.add("INTERVAL_LIMIT", "Analytics records exceeded the report safety limit."); }
    const sessionIds = sessions.map((row) => row.id);
    let sessionOccupancy = sessionIds.length ? (await client.query<SessionOccupancyRow>(
      `SELECT id,session_id,table_id,started_at,ended_at,backfilled
         FROM bms_board_game_session_table_occupancy
        WHERE tenant_id=$1 AND session_id=ANY($2::uuid[])
        ORDER BY started_at,id LIMIT $3`,
      [tenantId, sessionIds, INTERVAL_LIMIT + 1],
    )).rows : [];
    if (sessionOccupancy.length > INTERVAL_LIMIT) { sessionOccupancy = sessionOccupancy.slice(0, INTERVAL_LIMIT); recordsTruncated = true; issue.add("INTERVAL_LIMIT", "Analytics records exceeded the report safety limit."); }
    let groups = sessionIds.length ? (await client.query<GroupRow>(
      `SELECT id,session_id,status,amount_due::text,charge_snapshot,ended_at,current_order_id
         FROM bms_board_game_billing_groups
        WHERE tenant_id=$1 AND session_id=ANY($2::uuid[])
          AND (ended_at IS NULL OR (ended_at >= $3 AND ended_at < $4) OR current_order_id=ANY($6::uuid[]))
        ORDER BY ended_at NULLS LAST,id LIMIT $5`,
      [tenantId, sessionIds, bounds.start, bounds.end, INTERVAL_LIMIT + 1, eventOrderIds],
    )).rows : [];
    if (groups.length > INTERVAL_LIMIT) { groups = groups.slice(0, INTERVAL_LIMIT); recordsTruncated = true; issue.add("INTERVAL_LIMIT", "Analytics records exceeded the report safety limit."); }
    let participants = sessionIds.length ? (await client.query<ParticipantRow>(
      `SELECT p.session_id,p.joined_at,LEAST(p.left_at,g.ended_at) AS left_at
         FROM bms_board_game_session_participants p
         JOIN bms_board_game_billing_groups g ON g.tenant_id=p.tenant_id AND g.id=p.billing_group_id
        WHERE p.tenant_id=$1 AND p.session_id=ANY($2::uuid[])
          AND p.joined_at < $4 AND COALESCE(LEAST(p.left_at,g.ended_at),$4) > $3
        ORDER BY p.joined_at,p.id LIMIT $5`,
      [tenantId, sessionIds, bounds.start, bounds.end, INTERVAL_LIMIT + 1],
    )).rows : [];
    if (participants.length > INTERVAL_LIMIT) { participants = participants.slice(0, INTERVAL_LIMIT); recordsTruncated = true; issue.add("INTERVAL_LIMIT", "Analytics records exceeded the report safety limit."); }
    const sessionById = new Map(sessions.map((row) => [row.id, row]));
    const groupByOrder = new Map(groups.filter((row) => row.current_order_id).map((row) => [row.current_order_id!, row]));

    let grossPlay = 0n, offerDiscount = 0n, passCoverage = 0n, netPlay = 0n, playReturns = 0n;
    const offerMap = new Map<string, { offerId: string; name: string; uses: number; discount: bigint }>();
    const moneyByTable = new Map<string, { grossPlay: bigint; offerDiscount: bigint; passCoverage: bigint; netPlay: bigint; tabRevenue: bigint; tabRevenueExVat: bigint; tabCost: bigint; costComplete: boolean; profitComplete: boolean }>();
    const revenueByWeekdayHour = new Map<string, bigint>();
    const addRevenueBuckets = (part: { interval: TimeInterval; amount: bigint }) => {
      const buckets = bucketByWeekdayHour([part.interval], timezone);
      const weights = buckets.map((bucket) => BigInt(Math.max(0, Math.round(bucket.minutes * 1000))));
      if (!buckets.length || weights.every((weight) => weight === 0n)) return;
      const allocated = allocateEvidenceAmount(part.amount < 0n ? -part.amount : part.amount, weights);
      buckets.forEach((bucket, index) => {
        const key = `${bucket.weekday}:${bucket.hour}`;
        const amount = part.amount < 0n ? -allocated[index] : allocated[index];
        revenueByWeekdayHour.set(key, (revenueByWeekdayHour.get(key) ?? 0n) + amount);
      });
    };
    const moneyRow = (tableId: string) => {
      const row = moneyByTable.get(tableId) ?? { grossPlay: 0n, offerDiscount: 0n, passCoverage: 0n, netPlay: 0n, tabRevenue: 0n, tabRevenueExVat: 0n, tabCost: 0n, costComplete: options.includeCosts === true, profitComplete: options.includeCosts === true };
      moneyByTable.set(tableId, row); return row;
    };
    const paidGroups = groups.filter((row) => row.status === "PAID" && row.ended_at && row.ended_at >= bounds.start && row.ended_at < bounds.end);
    for (const group of paidGroups) {
      const session = sessionById.get(group.session_id); if (!session) continue;
      const spans = allocationForSession(session, sessionOccupancy, tableReportWindows, group.ended_at!);
      if (!spans.length) issue.add("MISSING_ALLOCATION", "A paid visit has no table-history evidence.");
      let groupGross = 0n, groupOffer = 0n, groupPass = 0n;
      for (const line of chargeLines(group.charge_snapshot)) {
        let gross: bigint, offered: bigint, covered: bigint;
        try {
          gross = cents(line.grossAmount ?? line.amount);
          offered = cents(line.offerDiscountAmount ?? 0);
          covered = cents(line.coveredAmount ?? 0);
          if (gross < 0n || offered < 0n || covered < 0n || offered + covered > gross) throw new Error("invalid components");
        } catch {
          issue.add("PLAY_SNAPSHOT_INCOMPLETE", "A frozen play-charge component is invalid."); continue;
        }
        groupGross += gross; groupOffer += offered; groupPass += covered;
        const offerId = typeof line.offerId === "string" ? line.offerId : null;
        if (offerId && offered > 0n) {
          const existing = offerMap.get(offerId) ?? { offerId, name: String(line.offerName ?? line.offerCode ?? offerId), uses: 0, discount: 0n };
          if (spans.some((span) => selectedTableIds.has(span.tableId))) {
            existing.uses += 1; existing.discount += selectedAmount(offered, spans); offerMap.set(offerId, existing);
          }
        }
      }
      const net = cents(group.amount_due);
      if (groupGross - groupOffer - groupPass !== net) issue.add("PLAY_SNAPSHOT_INCOMPLETE", "Frozen play components do not reconcile to the group's amount due.");
      grossPlay += selectedAmount(groupGross, spans); offerDiscount += selectedAmount(groupOffer, spans);
      passCoverage += selectedAmount(groupPass, spans); netPlay += selectedAmount(net, spans);
      for (const part of selectedParts(groupGross, spans)) moneyRow(part.tableId).grossPlay += part.amount;
      for (const part of selectedParts(groupOffer, spans)) moneyRow(part.tableId).offerDiscount += part.amount;
      for (const part of selectedParts(groupPass, spans)) moneyRow(part.tableId).passCoverage += part.amount;
      for (const part of selectedParts(net, spans)) {
        moneyRow(part.tableId).netPlay += part.amount;
        addRevenueBuckets(part);
      }
    }

    let tabRevenue = 0n, tabRevenueExVat = 0n, tabCost = 0n, tabCostComplete = options.includeCosts === true, tabProfitComplete = options.includeCosts === true;
    const missingCostSkus = new Set<string>();
    const addTabEvent = (event: SalesEvidenceEvent) => {
      const group = groupByOrder.get(event.orderId); if (!group) return;
      const session = sessionById.get(group.session_id); if (!session) return;
      if (event.kind === "SALE" && event.payload?.cancelledWithoutReturn === true) {
        issue.add("SALES_RECONCILIATION_REQUIRED", "Cancelled sales require reconciliation."); return;
      }
      if (event.kind !== "SALE" && event.kind !== "RETURN") {
        if (event.kind === "TAX_ADJUSTMENT" && event.payload?.reconciledReturn === true) return;
        if (["BACKOFFICE_RETURN", "PAYMENT_REFUND", "TAX_ADJUSTMENT"].includes(event.kind)) issue.add("SALES_RECONCILIATION_REQUIRED", "An adjustment has no supported product allocation.");
        return;
      }
      let inspected: ReturnType<typeof inspectSalesEvidence>;
      try { inspected = inspectSalesEvidence(event); }
      catch { issue.add("SALES_RECONCILIATION_REQUIRED", "A sales event has malformed evidence."); return; }
      if (inspected.issues.some((code) => ["LINE_LIMIT", "MISSING_LINES", "ORDER_TOTAL_MISMATCH", "RETURN_COMPONENTS_UNALLOCATED", "RETURN_TOTAL_MISMATCH", "RETURN_QUANTITY_MISMATCH"].includes(code))) {
        issue.add("SALES_RECONCILIATION_REQUIRED", "Sales evidence is incomplete or does not reconcile.");
      }
      const sign = event.kind === "SALE" ? 1n : -1n;
      let revenue = 0n, cost = 0n, complete = options.includeCosts === true;
      const lines = Array.isArray(event.payload?.lines) ? event.payload.lines : [];
      for (const line of lines) {
        const amount = event.kind === "SALE"
          ? inspected.attribution.find((row) => row.itemId === line.id)?.netAmount ?? null
          : null;
        if (amount != null) revenue += cents(amount) * sign;
        if (options.includeCosts) {
          if (line.actualCost == null) { complete = false; if (line.sku) missingCostSkus.add(String(line.sku)); }
          else cost += cents(line.actualCost) * sign;
        }
      }
      // A return line's refund can include time/shipping/rounding. Only the
      // frozen component allocation is evidence of product revenue reversed.
      if (event.kind === "RETURN") revenue = -inspected.amounts.returnKnownMerchandiseGross;
      let exVat: bigint | null = null;
      if (options.includeCosts) {
        try {
          let taxable: bigint, vat: bigint, merchandiseTaxable: bigint;
          if (event.kind === "SALE") {
            if (inspected.issues.some((code) => ["VAT_SNAPSHOT_UNRECONCILED", "ORDER_TOTAL_MISMATCH", "LINE_LIMIT", "MISSING_LINES"].includes(code))) throw new Error("unreconciled sale");
            taxable = cents(event.payload.taxable); vat = cents(event.payload.vat);
            merchandiseTaxable = lines.reduce((sum: bigint, line: any) => {
              if (taxable !== 0n && !["V", "N"].includes(line.vatCategory)) throw new Error("unknown VAT category");
              return sum + (line.vatCategory === "V" ? cents(inspected.attribution.find((row) => row.itemId === line.id)?.netAmount) : 0n);
            }, 0n);
          } else {
            const snapshot = readReturnFinancialSnapshot(event.payload.financialSnapshot, event.payload.amount);
            if (!snapshot?.components || !snapshot.tax || inspected.issues.includes("RETURN_COMPONENTS_UNALLOCATED")) throw new Error("missing return tax evidence");
            taxable = cents(snapshot.tax.taxableGross); vat = cents(snapshot.tax.vat);
            const extras = cents(snapshot.source.extras), extraTaxable = cents(snapshot.source.extraTaxable);
            const returnedExtraTaxable = extras === 0n ? 0n : allocateEvidenceAmount(cents(snapshot.components.extrasGross), [extraTaxable, extras - extraTaxable])[0];
            merchandiseTaxable = taxable - cents(snapshot.components.shippingGross) - returnedExtraTaxable;
          }
          if (merchandiseTaxable < 0n || merchandiseTaxable > taxable || vat < 0n || vat > taxable) throw new Error("invalid VAT allocation");
          const merchandiseVat = allocateEvidenceAmount(vat, [merchandiseTaxable, taxable - merchandiseTaxable])[0];
          exVat = revenue - merchandiseVat * sign;
        } catch { issue.add("VAT_EVIDENCE_INCOMPLETE", "Product VAT allocation is unknown; gross profit is not inferred from VAT-inclusive receipts."); }
      }
      const endedAt = group.ended_at ?? observedRangeEnd;
      const spans = allocationForSession(session, sessionOccupancy, tableReportWindows, endedAt);
      if (!spans.length) issue.add("MISSING_ALLOCATION", "A product event has no table-history evidence.");
      if (event.kind === "RETURN") {
        const returnedPlay = inspected.amounts.returnKnownExtrasGross;
        const selectedReturn = selectedAmount(returnedPlay, spans);
        playReturns += selectedReturn; netPlay -= selectedReturn;
        for (const part of selectedParts(-returnedPlay, spans)) {
          moneyRow(part.tableId).netPlay += part.amount;
          addRevenueBuckets(part);
        }
      }
      tabRevenue += selectedAmount(revenue, spans);
      if (exVat != null) tabRevenueExVat += selectedAmount(exVat, spans);
      else if (spans.some((span) => selectedTableIds.has(span.tableId))) tabProfitComplete = false;
      if (options.includeCosts) tabCost += selectedAmount(cost, spans);
      if (!complete && spans.some((span) => selectedTableIds.has(span.tableId))) tabCostComplete = false;
      for (const part of selectedParts(revenue, spans)) {
        moneyRow(part.tableId).tabRevenue += part.amount;
        addRevenueBuckets(part);
      }
      if (options.includeCosts) for (const part of selectedParts(cost, spans)) moneyRow(part.tableId).tabCost += part.amount;
      if (exVat != null) for (const part of selectedParts(exVat, spans)) moneyRow(part.tableId).tabRevenueExVat += part.amount;
      else for (const span of spans) moneyRow(span.tableId).profitComplete = false;
      if (!complete) for (const span of spans) moneyRow(span.tableId).costComplete = false;
    };
    salesEvents.forEach(addTabEvent);
    if (scan.truncated) issue.add("SALES_EVIDENCE_TRUNCATED", "Sales evidence reached its safety limit.");
    if (options.includeCosts && !tabCostComplete) issue.add("MISSING_PRODUCT_COST", "Actual product cost is incomplete; zero was not substituted.", Math.max(1, missingCostSkus.size));

    const waitlist = (await client.query<{
      entries: number; seated: number; wait_minutes: string | null; invalid_wait: number; no_show: number; cancelled: number; deposits_forfeited: string;
    }>(
      `SELECT count(*)::int AS entries,
              count(*) FILTER (WHERE status='SEATED')::int AS seated,
              avg(EXTRACT(EPOCH FROM (seated_at-wait_started_at))/60)
                FILTER (WHERE status='SEATED' AND wait_started_at <= seated_at AND seated_at <= $5)::text AS wait_minutes,
              count(*) FILTER (WHERE status='SEATED' AND (wait_started_at IS NULL OR seated_at IS NULL
                OR wait_started_at > seated_at OR seated_at > $5))::int AS invalid_wait,
              count(*) FILTER (WHERE status='NO_SHOW')::int AS no_show,
              count(*) FILTER (WHERE status='CANCELLED')::int AS cancelled,
              COALESCE(sum(deposit_amount) FILTER (WHERE deposit_status='FORFEITED'),0)::text AS deposits_forfeited
         FROM (SELECT status,seated_at,deposit_status,deposit_amount,
                      CASE WHEN kind='RESERVATION' THEN checked_in_at ELSE created_at END AS wait_started_at
                 FROM bms_board_game_waitlist
                WHERE tenant_id=$1 AND created_at >= $2 AND created_at < LEAST($3,$5)
                  AND ($4::uuid[] IS NULL OR location_id=ANY($4::uuid[]))) cohort`,
      [tenantId, bounds.start, bounds.end, locationIds, observedAt],
    )).rows[0];
    if (Number(waitlist?.invalid_wait ?? 0)) issue.add("WAIT_TIME_INCOMPLETE", "Some seated entries lack valid arrival-to-seating evidence and are excluded from average wait; reservation creation time is not arrival time.", Number(waitlist.invalid_wait));

    const pass = (await client.query<{ revenue: string; minutes: string }>(
      `SELECT COALESCE((SELECT sum(p.amount) FROM bms_payments p
                JOIN bms_board_game_member_passes mp ON mp.tenant_id=p.tenant_id AND mp.id=p.board_game_member_pass_id
               WHERE p.tenant_id=$1 AND p.payable_type='BOARD_GAME_MEMBER_PASS' AND p.status='CONFIRMED'
                 AND p.confirmed_at >= $2 AND p.confirmed_at < $3
                 AND ($4::uuid[] IS NULL OR mp.location_id=ANY($4::uuid[]))),0)::text AS revenue,
              COALESCE((SELECT sum(abs(l.minutes)) FROM bms_board_game_pass_ledger l
                JOIN bms_board_game_billing_groups g ON g.tenant_id=l.tenant_id AND g.id=l.billing_group_id
               WHERE l.tenant_id=$1 AND l.kind='CONSUME' AND l.created_at >= $2 AND l.created_at < $3
                 AND ($4::uuid[] IS NULL OR g.location_id=ANY($4::uuid[]))),0)::text AS minutes`,
      [tenantId, bounds.start, bounds.end, locationIds],
    )).rows[0];

    let libraryRows = (await client.query<{ title_id: string; name: string; plays: number; minutes: string }>(
      `SELECT title.id AS title_id,title.title AS name,count(*)::int AS plays,
              COALESCE(sum(EXTRACT(EPOCH FROM (LEAST(COALESCE(loan.returned_at,$5),$3,$5)-GREATEST(loan.checked_out_at,$2)))/60),0)::text AS minutes
         FROM bms_board_game_session_games loan
         JOIN bms_board_game_sessions session ON session.tenant_id=loan.tenant_id AND session.id=loan.session_id
         JOIN bms_board_game_titles title ON title.tenant_id=loan.tenant_id AND title.id=(
           SELECT copy.title_id FROM bms_board_game_copies copy WHERE copy.tenant_id=loan.tenant_id AND copy.id=loan.copy_id
         )
        WHERE loan.tenant_id=$1 AND loan.checked_out_at < LEAST($3,$5) AND COALESCE(loan.returned_at,$5) > $2
          AND ($4::uuid[] IS NULL OR session.location_id=ANY($4::uuid[]))
        GROUP BY title.id,title.title ORDER BY plays DESC,name LIMIT 101`,
      [tenantId, bounds.start, bounds.end, locationIds, observedAt],
    )).rows;
    const libraryTruncated = libraryRows.length > 100;
    if (libraryTruncated) { libraryRows = libraryRows.slice(0, 100); issue.add("LIBRARY_LIMIT", "Only the top 100 played titles are included."); }
    const libraryTotals = (await client.query<{ attention: number; purchase_cost: string | null }>(
      `SELECT count(*) FILTER (WHERE status IN ('NEEDS_CHECK','DAMAGED','MISSING_PARTS','REPAIRING'))::int AS attention,
              CASE WHEN count(*)=0 THEN '0' WHEN bool_and(purchase_cost IS NOT NULL) THEN sum(purchase_cost)::text ELSE NULL END AS purchase_cost
         FROM bms_board_game_copies
        WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR location_id=ANY($2::uuid[]))`,
      [tenantId, locationIds],
    )).rows[0];

    const availableByTable = new Map(tables.map((table) => [table.id, intervalMinutes(tableAvailability.get(table.id) ?? [])]));
    const occupiedMinutesByTable = new Map(tables.map((table) => [table.id, intervalMinutes(occupiedByTable.get(table.id) ?? [])]));
    const totalAvailable = [...availableByTable.values()].reduce((sum, value) => sum + value, 0);
    const totalOccupied = [...occupiedMinutesByTable.values()].reduce((sum, value) => sum + value, 0);
    const playerMinutes = participants.reduce((sum, participant) => {
      const session = sessionById.get(participant.session_id); if (!session) return sum;
      const start = participant.joined_at > bounds.start ? participant.joined_at : bounds.start;
      const end = observedEnd(participant.left_at ?? session.ended_at, observedAt, bounds.end);
      return sum + intervalMinutes(allocationForSession(session, sessionOccupancy, tableAvailability, end, start).map((row) => row.interval));
    }, 0);
    const seatMinutes = tables.reduce((sum, table) => sum + (availableByTable.get(table.id) ?? 0) * Number(table.seats), 0);
    const paidSessionIds = new Set(paidGroups.map((row) => row.session_id));
    const paidSessions = sessions.filter((row) => paidSessionIds.has(row.id) && row.ended_at);
    const closedMinutes = paidSessions.reduce((sum, session) => sum + Math.max(0, (session.ended_at!.getTime() - session.started_at.getTime()) / 60_000), 0);
    const cancelledSessions = sessions.filter((row) => row.status === "CANCELLED" && row.ended_at && row.ended_at >= bounds.start && row.ended_at < bounds.end).length;
    const waitEntries = Number(waitlist?.entries ?? 0), noShow = Number(waitlist?.no_show ?? 0);
    const hoursCompleteByLocation = new Map(branchIds.map((locationId) => [
      locationId,
      (availabilityByLocation.get(locationId)?.missingDates.length ?? 0) === 0,
    ]));
    const allHoursComplete = [...hoursCompleteByLocation.values()].every(Boolean);
    const activeSessions = sessions.filter((session) => sessionOccupancy.some((row) => row.session_id === session.id && selectedTableIds.has(row.table_id)
      && row.started_at < observedRangeEnd && (row.ended_at ?? observedAt) > bounds.start));
    const guests = participants.filter((participant) => {
      const session = sessionById.get(participant.session_id); if (!session) return false;
      const start = participant.joined_at > bounds.start ? participant.joined_at : bounds.start;
      const end = observedEnd(participant.left_at ?? session.ended_at, observedAt, bounds.end);
      // Presence follows the participant, not everyone who ever shared their visit. Opening-hour
      // configuration must not erase a recorded visit, and future joins cannot count as attendance.
      return allocationForSession(session, sessionOccupancy, tableReportWindows, end, start)
        .some((span) => selectedTableIds.has(span.tableId));
    }).length;

    const buildTableMetric = (table: TableRow) => {
      const available = availableByTable.get(table.id) ?? 0, occupied = occupiedMinutesByTable.get(table.id) ?? 0;
      const money = moneyRow(table.id);
      const revenue = money.netPlay + money.tabRevenue;
      const hoursComplete = hoursCompleteByLocation.get(table.location_id) === true;
      return {
        tableId: table.id, code: table.code, name: table.name, areaName: table.area_name, locationName: table.location_name, seats: Number(table.seats),
        availableTableHours: hours(available), occupiedTableHours: hours(occupied), utilizationPct: hoursComplete ? utilization(occupied, available) : null,
        revenue: evidenceDecimal(revenue), revPATH: !hoursComplete || available === 0 ? null : evidenceDecimal((revenue * 60_000n) / BigInt(Math.round(available * 1000))),
        grossPlay: evidenceDecimal(money.grossPlay), offerDiscount: evidenceDecimal(money.offerDiscount), passCoverage: evidenceDecimal(money.passCoverage), netPlay: evidenceDecimal(money.netPlay),
        tabRevenue: evidenceDecimal(money.tabRevenue), tabCost: options.includeCosts && money.costComplete ? evidenceDecimal(money.tabCost) : null,
        tabRevenueExVat: options.includeCosts && money.profitComplete ? evidenceDecimal(money.tabRevenueExVat) : null,
        tabGrossProfit: options.includeCosts && money.costComplete && money.profitComplete ? evidenceDecimal(money.tabRevenueExVat - money.tabCost) : null,
      };
    };
    const byTable = tables.map(buildTableMetric);
    const areaGroups = new Map<string, typeof byTable>();
    for (const row of byTable) {
      const table = tables.find((item) => item.id === row.tableId)!;
      const key = `${table.location_id}:${table.area_id}`;
      areaGroups.set(key, [...(areaGroups.get(key) ?? []), row]);
    }
    const byArea = [...areaGroups.entries()].map(([key, rows]) => {
      const [locationId, areaId] = key.split(":");
      const availableMinutes = rows.reduce((sum, row) => sum + (availableByTable.get(row.tableId) ?? 0), 0);
      const occupiedMinutes = rows.reduce((sum, row) => sum + (occupiedMinutesByTable.get(row.tableId) ?? 0), 0);
      const revenue = rows.reduce((sum, row) => sum + cents(row.revenue), 0n);
      const hoursComplete = hoursCompleteByLocation.get(locationId) === true;
      return { areaId, locationId, name: tables.find((row) => row.area_id === areaId)?.area_name ?? "", availableTableHours: hours(availableMinutes),
        occupiedTableHours: hours(occupiedMinutes), utilizationPct: hoursComplete ? utilization(occupiedMinutes, availableMinutes) : null,
        revenue: evidenceDecimal(revenue), revPATH: !hoursComplete || availableMinutes === 0 ? null : evidenceDecimal((revenue * 60_000n) / BigInt(Math.round(availableMinutes * 1000))) };
    });

    const availableBuckets = bucketByWeekdayHour([...tableAvailability.values()].flat(), timezone);
    const occupiedBuckets = bucketByWeekdayHour([...occupiedByTable.values()].flat(), timezone);
    const bucketKey = (row: { weekday: number; hour: number }) => `${row.weekday}:${row.hour}`;
    const availableBucketMap = new Map(availableBuckets.map((row) => [bucketKey(row), row.minutes]));
    const occupiedBucketMap = new Map(occupiedBuckets.map((row) => [bucketKey(row), row.minutes]));
    // Capacity is not a revenue filter: preserve paid/returned money even outside configured hours.
    const heatmap = [...new Set([...availableBucketMap.keys(), ...occupiedBucketMap.keys(), ...revenueByWeekdayHour.keys()])].map((key) => {
      const [weekday, hour] = key.split(":").map(Number);
      const available = availableBucketMap.get(key) ?? 0, occupied = occupiedBucketMap.get(key) ?? 0;
      return { weekday, hour, availableTableHours: hours(available), occupiedTableHours: hours(occupied),
        utilizationPct: allHoursComplete ? utilization(occupied, available) : null,
        revenue: evidenceDecimal(revenueByWeekdayHour.get(key) ?? 0n) };
    }).sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);

    const passSalesRevenue = cents(pass?.revenue ?? "0");
    const depositsForfeited = cents(waitlist?.deposits_forfeited ?? "0");
    const totalRevenue = netPlay + tabRevenue;
    const report = {
      range: { from: filter.from, to: filter.to, granularity: filter.granularity }, timezone,
      locationScope: filter.locationId ? branchIds : branchIds.length ? branchIds : null,
      complete: issue.values().every((row) => ["COST_HIDDEN", "BACKFILLED_OCCUPANCY", "CURRENT_CAPACITY_BASIS"].includes(row.code)),
      issues: issue.values(), truncated: occupancyTruncated || recordsTruncated || scan.truncated || libraryTruncated,
      dataQuality: { backfilledBefore, hoursConfigured: !issue.values().some((row) => row.code === "HOURS_NOT_CONFIGURED"), tablesWithoutHours: tables.filter((table) => (availabilityByLocation.get(table.location_id)?.missingDates.length ?? 0) > 0).length },
      totals: {
        availableTableHours: hours(totalAvailable), occupiedTableHours: hours(totalOccupied), utilizationPct: allHoursComplete ? utilization(totalOccupied, totalAvailable) : null,
        seatUtilizationPct: !allHoursComplete || seatMinutes === 0 ? null : Math.round((playerMinutes / seatMinutes) * 10_000) / 100,
        sessions: activeSessions.length, paidSessions: paidSessionIds.size, cancelledSessions, guests,
        avgPlayMinutes: paidSessions.length ? Math.round((closedMinutes / paidSessions.length) * 100) / 100 : null,
        turnoverPerTablePerDay: tables.filter((table) => table.available).length ? Math.round((activeSessions.length / tables.filter((table) => table.available).length / filter.days) * 100) / 100 : null,
        grossPlay: evidenceDecimal(grossPlay), offerDiscount: evidenceDecimal(offerDiscount), passCoverage: evidenceDecimal(passCoverage), netPlay: evidenceDecimal(netPlay),
        playReturns: evidenceDecimal(playReturns),
        tabRevenue: evidenceDecimal(tabRevenue), tabCost: options.includeCosts && tabCostComplete ? evidenceDecimal(tabCost) : null,
        tabRevenueExVat: options.includeCosts && tabProfitComplete ? evidenceDecimal(tabRevenueExVat) : null,
        tabGrossProfit: options.includeCosts && tabCostComplete && tabProfitComplete ? evidenceDecimal(tabRevenueExVat - tabCost) : null,
        passSalesRevenue: evidenceDecimal(passSalesRevenue), passMinutesUsed: Number(pass?.minutes ?? 0),
        revPATH: !allHoursComplete || totalAvailable === 0 ? null : evidenceDecimal((totalRevenue * 60_000n) / BigInt(Math.round(totalAvailable * 1000))),
        waitlist: { entries: waitEntries, seated: Number(waitlist?.seated ?? 0), avgWaitMinutes: waitlist?.wait_minutes == null ? null : Math.round(Number(waitlist.wait_minutes) * 100) / 100,
          noShow, cancelled: Number(waitlist?.cancelled ?? 0), noShowRatePct: waitEntries === 0 ? null : Math.round((noShow / waitEntries) * 10_000) / 100 },
        depositsForfeited: evidenceDecimal(depositsForfeited),
      },
      byTable, byArea, heatmap,
      // Existing UI/export keeps top 20; the staff tool pages the full bounded-source aggregation.
      topOffers: [...offerMap.values()].sort((a, b) => Number(b.discount - a.discount))
        .slice(0, options.includeAllOffers ? undefined : 20).map((row) => ({ ...row, discount: evidenceDecimal(row.discount) })),
      library: { titlesPlayed: libraryRows.map((row) => ({ titleId: row.title_id, name: row.name, plays: Number(row.plays), minutes: Math.round(Number(row.minutes)) })),
        copiesNeedingAttention: Number(libraryTotals?.attention ?? 0), purchaseCostTotal: options.includeCosts && libraryTotals?.purchase_cost != null ? evidenceDecimal(cents(libraryTotals.purchase_cost)) : null },
    };
    if (owns) await client.query("COMMIT");
    return report;
  } catch (error) {
    if (owns) { try { await client.query("ROLLBACK"); } catch {} }
    throw error;
  } finally { if (owns) client.release(); }
}

/** Bounded staff scope discovery; includes closed branches for historical reports. */
export async function listBoardGameAnalyticsBranches(tenantId: string, actorId: string) {
  if (!tenantId || !actorId) throw new Error("BOARD_GAME_ANALYTICS_FORBIDDEN");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { serializable: true });
    await requireBoardGameCafeTenant(client, tenantId);
    await client.query("SET LOCAL statement_timeout = '30s'");
    const scoped = (await client.query<{ scoped: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$2) AS scoped`,
      [tenantId, actorId],
    )).rows[0]?.scoped;
    // Match the report's validated store timezone; never use the model's clock.
    const timezone = (await client.query<{ timezone: string }>(
      `SELECT COALESCE(tz.name, 'Asia/Bangkok') AS timezone FROM bms_store_profile p
       LEFT JOIN pg_timezone_names tz
         ON tz.name=COALESCE(NULLIF(btrim(to_jsonb(p)->>'timezone_code'), ''), NULLIF(btrim(p.timezone), ''))
       WHERE p.tenant_id=$1`, [tenantId],
    )).rows[0]?.timezone ?? "Asia/Bangkok";
    const currentDate = (await client.query<{ date: string }>(
      `SELECT to_char(transaction_timestamp() AT TIME ZONE $1, 'YYYY-MM-DD') AS date`, [timezone],
    )).rows[0].date;
    const branches = (await client.query<{ id: string; name: string; active: boolean }>(
      `SELECT l.id,l.name,l.active FROM bms_locations l
       WHERE l.tenant_id=$1 AND (NOT $3::boolean OR EXISTS (
         SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.location_id=l.id
       )) ORDER BY l.name,l.id LIMIT 101`, [tenantId, actorId, scoped !== false],
    )).rows;
    await client.query("COMMIT");
    return { allBranchesAllowed: scoped === false, timezone, currentDate, truncated: branches.length > 100,
      branches: branches.slice(0, 100).map((branch) => ({ ...branch, name: branch.name.slice(0, 200) })) };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function listBoardGameBranchHours(tenantId: string, actorId: string, locationIdInput: string) {
  const locationId = String(locationIdInput).toLowerCase();
  if (!UUID.test(locationId)) throw new Error("BOARD_GAME_ANALYTICS_INVALID_LOCATION");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { serializable: true });
    await requireBoardGameCafeTenant(client, tenantId);
    const access = await client.query(
      `SELECT 1 FROM bms_locations l WHERE l.tenant_id=$1 AND l.id=$2 AND (
        NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$3)
        OR EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$3 AND location_id=$2))`,
      [tenantId, locationId, actorId],
    );
    if (!access.rowCount) throw new Error("BOARD_GAME_ANALYTICS_FORBIDDEN");
    const rows = (await client.query(
      `SELECT weekday,opens_at::text AS "opensAt",closes_at::text AS "closesAt",closed,effective_from::text AS "effectiveFrom"
         FROM bms_board_game_branch_hours WHERE tenant_id=$1 AND location_id=$2
        ORDER BY effective_from DESC,weekday`, [tenantId, locationId],
    )).rows;
    await client.query("COMMIT"); return rows;
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}

export async function upsertBoardGameBranchHours(
  tenantId: string,
  actorId: string,
  input: { locationId: string; effectiveFrom: string; hours: BoardGameBranchHourInput[] },
) {
  const locationId = String(input.locationId ?? "").toLowerCase();
  if (!UUID.test(locationId)) throw new Error("BOARD_GAME_ANALYTICS_INVALID_LOCATION");
  assertAnalyticsDate(input.effectiveFrom);
  if (!Array.isArray(input.hours) || input.hours.length !== 7 || input.hours.some((row) => !row || typeof row !== "object") || new Set(input.hours.map((row) => row.weekday)).size !== 7) throw new Error("BOARD_GAME_HOURS_REQUIRE_SEVEN_DAYS");
  const rows = [...input.hours].sort((a, b) => a.weekday - b.weekday);
  for (const row of rows) {
    if (typeof row.closed !== "boolean") throw new Error("BOARD_GAME_HOURS_INVALID_CLOSED");
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) throw new Error("BOARD_GAME_HOURS_INVALID_WEEKDAY");
    if (row.closed) { if (row.opensAt || row.closesAt) throw new Error("BOARD_GAME_HOURS_CLOSED_HAS_TIME"); }
    else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.opensAt ?? "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.closesAt ?? "") || row.opensAt === row.closesAt) throw new Error("BOARD_GAME_HOURS_INVALID_TIME");
  }
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { serializable: true, editorId: actorId });
    await requireBoardGameCafeTenant(client, tenantId);
    const access = await client.query(
      `SELECT 1 FROM bms_locations l WHERE l.tenant_id=$1 AND l.id=$2 AND (
        NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$3)
        OR EXISTS (SELECT 1 FROM bms_user_allowed_locations WHERE tenant_id=$1 AND user_id=$3 AND location_id=$2)) FOR UPDATE`,
      [tenantId, locationId, actorId],
    );
    if (!access.rowCount) throw new Error("BOARD_GAME_ANALYTICS_FORBIDDEN");
    for (const row of rows) await client.query(
      `INSERT INTO bms_board_game_branch_hours
         (tenant_id,location_id,weekday,opens_at,closes_at,closed,effective_from,created_by)
       VALUES ($1,$2,$3,$4::time,$5::time,$6,$7,$8)
       ON CONFLICT (tenant_id,location_id,weekday,effective_from) DO UPDATE
         SET opens_at=EXCLUDED.opens_at,closes_at=EXCLUDED.closes_at,closed=EXCLUDED.closed,updated_at=now()`,
      [tenantId, locationId, row.weekday, row.closed ? null : row.opensAt, row.closed ? null : row.closesAt, row.closed, input.effectiveFrom, actorId],
    );
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'board_game.branch_hours_upsert',$3,$4::jsonb)`,
      [tenantId, actorId, locationId, JSON.stringify({ effectiveFrom: input.effectiveFrom, weekdays: rows.map((row) => row.weekday) })],
    );
    await client.query("COMMIT"); return { locationId, effectiveFrom: input.effectiveFrom, hours: rows.map((row) => ({ ...row, effectiveFrom: input.effectiveFrom })) };
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}
