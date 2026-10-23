import { requireAuth } from "@/lib/auth";
import { requirePermission } from "../permissions";
import { getBoardGameAnalytics, listBoardGameAnalyticsBranches } from "../boardGameAnalytics";
import { assertAnalyticsDate } from "../boardGameAnalyticsMath";
import { evidenceCents } from "../salesEvidenceMath";
import { readBoardGameLiveOperations, readBoardGamePassBalances, readBoardGameOwnerLibrary, BOARD_GAME_OWNER_LIBRARY_VIEWS } from "../boardGameOwnerReads";
import { ToolArgError, reqString, enumVal, type BmsTool, type ExecCtx, type ToolResult } from "./types";

// Staff-only projections; no SQL or money mutations. Cost disclosure requires both source permissions.
async function actor(ec: ExecCtx, permission: BmsTool["permission"] = "report.view") {
  if (ec.surface !== "staff" || !ec.ctx) throw new ToolArgError("Staff authentication required");
  await requirePermission(ec.ctx, permission!);
  return String(requireAuth(ec.ctx).author_id);
}

function input(args: Record<string, unknown>, tables: boolean, extra: string[] = []) {
  const allowed = ["from", "to", "locationId", "limit", "offset", ...extra, ...(tables ? ["areaId"] : [])];
  if (!args || Object.keys(args).some((key) => !allowed.includes(key))) {
    throw new ToolArgError("Unknown report argument; tenant and actor cannot be supplied");
  }
  const from = reqString(args, "from"), to = reqString(args, "to");
  try { assertAnalyticsDate(from); assertAnalyticsDate(to); }
  catch { throw new ToolArgError("Use valid calendar dates YYYY-MM-DD"); }
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days < 1 || days > 92) throw new ToolArgError("Choose a date range of 1–92 days");
  return { from, to, ...scopeInput(args, tables) };
}

function scopeInput(args: Record<string, unknown>, tables: boolean) {
  const uuid = (key: string) => {
    if (args[key] === undefined) return undefined;
    if (typeof args[key] !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args[key])) {
      throw new ToolArgError(`${key} must be a verified UUID`);
    }
    return args[key].toLowerCase();
  };
  const locationId = uuid("locationId"), areaId = tables ? uuid("areaId") : undefined;
  if (areaId && !locationId) throw new ToolArgError("areaId requires locationId");
  const limit = args.limit === undefined ? (tables ? 50 : 10) : args.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ToolArgError("limit must be an integer from 1 to 50");
  }
  const offset = args.offset === undefined ? 0 : args.offset;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new ToolArgError("offset must be an integer from 0 to 100000");
  return { locationId, areaId, limit, offset };
}

/** Only the board-game report opts into these new filters; other report semantics are unchanged. */
export function boardGameReportExportArgs(args: Record<string, unknown>) {
  if (args.reportType !== "BOARD_GAME_ANALYTICS") {
    if (args.locationId !== undefined || args.areaId !== undefined) throw new ToolArgError("These assistant branch/area filters require BOARD_GAME_ANALYTICS");
    return {};
  }
  if (args.format !== "XLSX") throw new ToolArgError("BOARD_GAME_ANALYTICS supports XLSX only");
  const { locationId, areaId } = input({ from: args.dateFrom, to: args.dateTo,
    ...(args.locationId !== undefined ? { locationId: args.locationId } : {}), ...(args.areaId !== undefined ? { areaId: args.areaId } : {}) }, true);
  return { locationId, areaId };
}

// Only known domain rejections become explainable results. Unexpected infrastructure failures
// still reach the runtime's normal safe error/audit path (never leak SQL or stack traces).
async function read<T>(operation: () => Promise<T>): Promise<ToolResult> {
  try { return { ok: true, data: await operation() }; }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ฟังก์ชันนี้ใช้ได้เฉพาะร้านที่ตั้ง Shop archetype เป็น board_game_cafe") {
      return { ok: false, error: "BOARD_GAME_CAFE_REQUIRED" };
    }
    if (/^BOARD_GAME_[A-Z0-9_]+$/.test(code) || code === "SALES_EVIDENCE_CURRENCY_REVIEW_REQUIRED") {
      return { ok: false, error: code };
    }
    throw error;
  }
}

export const listBoardGameReportBranchesTool: BmsTool = {
  name: "list_board_game_report_branches",
  description: "Staff board-game report scope discovery. Returns only the actor's permitted branches, allBranchesAllowed, and currentDate in the report timezone. Call before branch-specific reports or resolving today/this month; never invent branch IDs or silently broaden scope. A partial list is not proof a branch is absent.",
  surfaces: ["staff"], permission: "report.view",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  execute: async (args, ec) => {
    const actorId = await actor(ec);
    if (Object.keys(args).length) throw new ToolArgError("This tool accepts no arguments");
    return read(() => listBoardGameAnalyticsBranches(ec.tenantId, actorId));
  },
};

function reportTool(tables: boolean): BmsTool {
  return {
    name: tables ? "get_board_game_table_revenue" : "get_board_game_top_games",
    description: (tables
      ? "Board-game ยอดขายแยกตามโต๊ะ / revenue by table, ranked by attributed revenue. Reads paid play snapshots and product sale/return evidence, allocated over historical table occupancy; NOT cash collected at a table or net profit. Pass sales and forfeited deposits are not table revenue."
      : "Board-game เกมไหนถูกเล่นมากสุด / most-played library games, ranked by recorded game loans overlapping the period. plays counts loans, not distinct players or completed games; minutes is clipped loan duration, not verified active play time. NOT best-selling products or current library availability.") +
      " Staff read only for board_game_cafe shops. Require explicit from/to (1–92 inclusive days in the report timezone); clarify missing/ambiguous dates. Use list_board_game_report_branches for verified branch IDs and today's date. Omit locationId only for an explicitly requested all-branch scope with allBranchesAllowed. State period/scope, basis and warnings; never treat partial/unknown data as zero or a complete ledger. No cost data is returned.",
    surfaces: ["staff"], permission: "report.view",
    inputSchema: { type: "object", additionalProperties: false, required: ["from", "to"], properties: {
      from: { type: "string", description: "YYYY-MM-DD, inclusive" },
      to: { type: "string", description: "YYYY-MM-DD, inclusive; at most 92 days" },
      locationId: { type: "string", description: "Verified branch UUID from list_board_game_report_branches" },
      ...(tables ? { areaId: { type: "string", description: "Optional verified area UUID in the selected branch; omit if unknown" } } : {}),
      limit: { type: "integer", minimum: 1, maximum: 50, description: tables ? "Default 50 tables" : "Default 10 titles" },
      ...(tables ? { offset: { type: "integer", minimum: 0, maximum: 100000, description: "Use returned nextOffset for remaining tables; live pages may change." } } : {}),
    } },
    execute: async (args, ec) => {
      const actorId = await actor(ec);
      if (!tables && args.offset !== undefined) throw new ToolArgError("Use get_board_game_library_report view=USAGE for paged branch loan rankings");
      const { limit, offset, ...filter } = input(args, tables);
      return read(async () => {
        const report = await getBoardGameAnalytics(ec.tenantId, actorId, { ...filter, granularity: "TABLE" }, undefined, { includeCosts: false });
        const scope = { locationId: filter.locationId ?? null, areaId: filter.areaId ?? null, allBranches: !filter.locationId };
        if (!tables) {
          const issues = report.issues.filter((issue) => issue.code === "LIBRARY_LIMIT");
          return {
            range: report.range, timezone: report.timezone, scope,
            basis: "Recorded loans overlapping the period; duration clipped to period and observation time. Not distinct players, completed games, or product sales.",
            complete: issues.length === 0, sourceTruncated: issues.length > 0,
            outputTruncated: report.library.titlesPlayed.length > limit, issues,
            titles: report.library.titlesPlayed.slice(0, limit).map(({ titleId, name, plays, minutes }) => ({ titleId, name: name.slice(0, 200), plays, minutes })),
          };
        }
        const ranked = [...report.byTable].sort((a, b) => {
          const difference = evidenceCents(b.revenue) - evidenceCents(a.revenue);
          return difference > 0n ? 1 : difference < 0n ? -1 : a.tableId.localeCompare(b.tableId);
        });
        return {
          range: report.range, timezone: report.timezone, scope,
          basis: "Tax-inclusive attributed play plus product revenue net of recorded returns. Play recognized at paid group close; products/returns by evidence date. Allocated over the full historical table path before area filtering. Not table cash receipts or net profit; excludes pass sales and forfeited deposits.",
          complete: report.complete, sourceTruncated: report.truncated,
          outputTruncated: ranked.length > offset + limit, nextOffset: ranked.length > offset + limit && offset + limit <= 100_000 ? offset + limit : null,
          issues: report.issues, dataQuality: report.dataQuality,
          tables: ranked.slice(offset, offset + limit).map(({ tableId, code, name, areaName, locationName, revenue, grossPlay, offerDiscount, passCoverage, netPlay, tabRevenue, occupiedTableHours, availableTableHours, utilizationPct, revPATH }) => ({
            tableId, code: code.slice(0, 100), name: name.slice(0, 200), areaName: areaName.slice(0, 200), locationName: locationName.slice(0, 200),
            revenue, grossPlay, offerDiscount, passCoverage, netPlay, tabRevenue, occupiedTableHours, availableTableHours, utilizationPct, revPATH,
          })),
        };
      });
    },
  };
}

export const getBoardGameTopGamesTool = reportTool(false);
export const getBoardGameTableRevenueTool = reportTool(true);

const LIMITATIONS = "Not net profit, game ROI/payback, causal promotion lift, price elasticity, future attendance/staffing or game purchase quantities. Do not infer any of these from historical revenue/loan counts. Missing data is unknown. Never add pass receipts to play revenue a second time. Compare verified periods descriptively only, never assert a cause.";
const pageSchema = { limit: { type: "integer", minimum: 1, maximum: 50 }, offset: { type: "integer", minimum: 0, maximum: 100000 } };

export const getBoardGameReportTool: BmsTool = {
  name: "get_board_game_report", surfaces: ["staff"], permission: "report.view",
  description: "Board-game historical management facts: SUMMARY (sessions, participant entries, average paid-visit time, revenue, queue/no-shows, pass receipts/use), HEATMAP (weekday/hour utilization and attributed revenue), OFFERS (paged frozen applied offers; rankBy=USES for most-used or DISCOUNT for discount amount, not causal lift), PROFIT (product ex-VAT gross profit/cost, requires product.view AND tax.document.view). Not live floor status. Choose explicit dates and branch; at most 92 days. Discover branch/area IDs via list_board_game_report_branches/get_board_game_live_operations; never guess. HEATMAP is weekday/hour aggregate, not calendar-date attendance. Queue is created-in-period cohort, not just reservations; counts are not unique customers. Pass/queue/library figures remain branch-wide despite areaId. " + LIMITATIONS,
  inputSchema: { type: "object", additionalProperties: false, required: ["view", "from", "to"], properties: {
    view: { type: "string", enum: ["SUMMARY", "HEATMAP", "OFFERS", "PROFIT"] }, from: { type: "string" }, to: { type: "string" },
    locationId: { type: "string" }, areaId: { type: "string" }, ...pageSchema,
    rankBy: { type: "string", enum: ["USES", "DISCOUNT"], description: "OFFERS only; default DISCOUNT. Use USES for most-used offers." },
  } },
  execute: async (args, ec) => {
    const actorId = await actor(ec);
    const view = enumVal(args, "view", ["SUMMARY", "HEATMAP", "OFFERS", "PROFIT"] as const)!;
    const { limit, offset, ...filter } = input(args, true, ["view", "rankBy"]);
    if (view !== "OFFERS" && args.rankBy !== undefined) throw new ToolArgError("rankBy applies only to OFFERS");
    const rankBy = args.rankBy === undefined ? "DISCOUNT" : enumVal(args, "rankBy", ["USES", "DISCOUNT"] as const)!;
    if (view === "PROFIT") { await requirePermission(ec.ctx, "product.view"); await requirePermission(ec.ctx, "tax.document.view"); }
    return read(async () => {
      const report = await getBoardGameAnalytics(ec.tenantId, actorId, filter, undefined, { includeCosts: view === "PROFIT", includeAllOffers: view === "OFFERS" });
      const meta = { view, range: report.range, timezone: report.timezone, scope: { locationId: filter.locationId ?? null, areaId: filter.areaId ?? null },
        complete: report.complete, sourceTruncated: report.truncated, issues: report.issues, dataQuality: report.dataQuality, limitations: LIMITATIONS };
      if (view === "SUMMARY") {
        const t = report.totals;
        const totals = { sessions: t.sessions, paidSessions: t.paidSessions, cancelledSessions: t.cancelledSessions, guests: t.guests,
          avgPlayMinutes: t.avgPlayMinutes, turnoverPerTablePerDay: t.turnoverPerTablePerDay,
          availableTableHours: t.availableTableHours, occupiedTableHours: t.occupiedTableHours, utilizationPct: t.utilizationPct, seatUtilizationPct: t.seatUtilizationPct,
          grossPlay: t.grossPlay, offerDiscount: t.offerDiscount, passCoverage: t.passCoverage, netPlay: t.netPlay, playReturns: t.playReturns, tabRevenue: t.tabRevenue,
          passSalesRevenue: t.passSalesRevenue, passMinutesUsed: t.passMinutesUsed, revPATH: t.revPATH, waitlist: t.waitlist, depositsForfeited: t.depositsForfeited };
        return { ...meta, basis: "Paid-group close date for play; sale/return evidence dates for products. Guests are participant entries with actual area/time overlap, not unique customers. Queue created-in-period cohort: wait starts at walk-in creation or reservation check-in, with invalid/missing arrival evidence excluded and flagged. Averages are not future promises. Pass/queue figures branch-wide. Area totals are not whole-branch totals.", totals };
      }
      if (view === "PROFIT") return { ...meta, basis: "Product gross profit = merchandise ex-VAT revenue minus recorded cost. Excludes play overhead, payroll, rent, utilities and depreciation. Not net profit.",
        product: { revenue: report.totals.tabRevenue, revenueExVat: report.totals.tabRevenueExVat, cost: report.totals.tabCost, grossProfit: report.totals.tabGrossProfit } };
      const rows = view === "HEATMAP" ? report.heatmap : [...report.topOffers].sort((a, b) => {
        if (rankBy === "USES" && a.uses !== b.uses) return b.uses - a.uses;
        const delta = evidenceCents(b.discount) - evidenceCents(a.discount);
        return delta > 0n ? 1 : delta < 0n ? -1 : a.offerId.localeCompare(b.offerId);
      }).map(r => ({ ...r, name: r.name.slice(0, 200) }));
      return { ...meta, basis: view === "HEATMAP" ? "Weekday/hour historical utilization, not attendance forecast; revenue attributed across visits, not hourly cash receipts. Missing opening hours gives null, not zero."
        : "Recorded applied offers ranked by " + rankBy + ". Uses counts discounted charge-snapshot lines, not unique customers or bills. Not an exhaustive offer catalog or proof of incremental profit; source quality limits still apply.",
        rows: rows.slice(offset, offset + limit), outputTruncated: rows.length > offset + limit,
        nextOffset: rows.length > offset + limit && offset + limit <= 100_000 ? offset + limit : null,
        rankBy: view === "OFFERS" ? rankBy : null, rankingLimit: null };
    });
  },
};

function operationTool(kind: "live" | "passes" | "library"): BmsTool {
  const library = kind === "library";
  const permission = library ? "board_game.library.view" : "board_game.session.manage";
  return {
    name: library ? "get_board_game_library_report" : kind === "live" ? "get_board_game_live_operations" : "get_board_game_pass_balances",
    surfaces: ["staff"], permission,
    description: (library ? "Read current board-game copy status (COPIES), repair/condition statuses (ATTENTION), titles with NO RECORDED loan in retained branch history (UNPLAYED, not proof never physically played), or paginated overlapping-loan ranking (USAGE requires from/to up to 92 days). Never use this to claim game ROI, future demand or how many copies to buy."
      : kind === "live" ? "Read current board-game floor, open session state, queue and future reservations, no contacts/notes/bill amounts. REQUESTED is not confirmed. No promised wait/free-table time. Each areas/tables/entries list has its own nextOffset; totals cover the full read, not just the page."
      : "Read current board-game member-pass outstanding minutes/contract counts, balance drift and contracts expiring in 30 days. Includes shared all-branch passes; never sum branches. Minutes are not money, unlimited balance is null. No names/contacts. Does not renew/cancel/consume entitlements.") +
      " Staff read only. Omit locationId to discover permitted branch choices only, then select the user's branch. Use verified branch ID, never guess. Pass returned nextOffset for more; paginated live data can change. No business writes.",
    inputSchema: { type: "object", additionalProperties: false, required: library ? ["view"] : [], properties: {
      locationId: { type: "string" }, ...pageSchema,
      ...(library ? { view: { type: "string", enum: [...BOARD_GAME_OWNER_LIBRARY_VIEWS] }, from: { type: "string" }, to: { type: "string" } } : {}),
    } },
    execute: async (args, ec) => {
      const actorId = await actor(ec, permission);
      const allowed = ["locationId", "limit", "offset", ...(library ? ["view", "from", "to"] : [])];
      if (Object.keys(args).some(k => !allowed.includes(k))) throw new ToolArgError("Unknown operation argument");
      if (library) enumVal(args, "view", BOARD_GAME_OWNER_LIBRARY_VIEWS);
      const normalized = scopeInput(args, false);
      if (args.locationId === undefined) return read(async () => ({ needsBranchSelection: true, ...await listBoardGameAnalyticsBranches(ec.tenantId, actorId) }));
      const locationId = normalized.locationId!;
      const scope = { locationId: normalized.locationId!, limit: normalized.limit, offset: normalized.offset };
      if (library) {
        const view = enumVal(args, "view", BOARD_GAME_OWNER_LIBRARY_VIEWS)!;
        if (view === "USAGE") {
          const dates = input({ from: args.from, to: args.to, locationId }, false);
          return read(() => readBoardGameOwnerLibrary(ec.tenantId, actorId, { ...scope, view, from: dates.from, to: dates.to }));
        }
        if (args.from !== undefined || args.to !== undefined) throw new ToolArgError("Dates apply only to USAGE; UNPLAYED means retained branch history");
        return read(() => readBoardGameOwnerLibrary(ec.tenantId, actorId, { ...scope, view }));
      }
      if (kind === "live") return read(() => readBoardGameLiveOperations(ec.tenantId, actorId, scope));
      return read(() => readBoardGamePassBalances(ec.tenantId, actorId, scope));
    },
  };
}
export const getBoardGameLiveOperationsTool = operationTool("live");
export const getBoardGamePassBalancesTool = operationTool("passes");
export const getBoardGameLibraryReportTool = operationTool("library");
