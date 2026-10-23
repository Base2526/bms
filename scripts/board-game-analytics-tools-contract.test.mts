import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { requireAuth } from "../apps/web/lib/auth.ts";
import { requirePermission } from "../apps/web/lib/bms/permissions.ts";
import { requireBoardGameCafeTenant } from "../apps/web/lib/bms/boardGameCafe.ts";
import { ALL_TOOLS, customerTools, staffTools } from "../apps/web/lib/bms/tools/catalog.ts";
import * as types from "../apps/web/lib/bms/tools/types.ts";
import * as math from "../apps/web/lib/bms/boardGameAnalyticsMath.ts";
import * as money from "../apps/web/lib/bms/salesEvidenceMath.ts";
import { __toolLoopTest } from "../apps/web/lib/bms/tools/runtime.ts";
import { boardGameUnsupportedOwnerReply } from "../apps/web/lib/bms/boardGameOwnerPolicy.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function load(path: string, deps: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", compiled)((name: string) => {
    if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`);
    return deps[name];
  }, module, module.exports);
  return module.exports;
}
const tenant = "10000000-1111-4111-8111-111111111111";
const location = "20000000-1111-4111-8111-111111111111";
const area = "30000000-1111-4111-8111-111111111111";
const actorId = "41";
const args = { from: "2026-10-01", to: "2026-10-23", locationId: location };
const ec = (permissions = ["report.view"]): types.ExecCtx => ({
  tenantId: tenant, surface: "staff", actor: "staff@example.invalid",
  ctx: { scope: "admin", admin: { id: actorId }, __bmsPerms: new Set(permissions) },
});
const table = (id: string, revenue: string) => ({ tableId: id, code: id, name: "Table", areaName: "Room", locationName: "Branch", revenue,
  grossPlay: "90.00", offerDiscount: "0.00", passCoverage: "0.00", netPlay: "90.00", tabRevenue: "10.00",
  occupiedTableHours: 2, availableTableHours: 10, utilizationPct: 20, revPATH: "10.00",
  tabCost: "secret-cost", tabGrossProfit: "secret-profit", customerName: "secret-person" });
function harness(overrides: Record<string, any> = {}, failure?: string) {
  const calls: any[][] = [];
  const report = { range: { from: args.from, to: args.to }, timezone: "Asia/Bangkok", complete: true, truncated: false,
    totals: { sessions: 3, guests: 10, avgPlayMinutes: 90, tabRevenue: "107.00", tabRevenueExVat: "100.00", tabCost: "40.00", tabGrossProfit: "60.00", waitlist: { entries: 4, noShow: 1 }, passSalesRevenue: "500.00", passMinutesUsed: 60 },
    heatmap: [{ weekday: 0, hour: 10, utilizationPct: null, availableTableHours: 0, occupiedTableHours: 0, revenue: "0.00" }],
    topOffers: [{ offerId: "offer", name: "Offer", uses: 2, discount: "100.00" }],
    issues: [], dataQuality: { hoursConfigured: true, backfilledBefore: null },
    byTable: [table("A", "100.00"), table("B", "200.00"), table("C", "-20.00")],
    library: { titlesPlayed: [{ titleId: "t1", name: "Game A", plays: 12, minutes: 60, borrower: "secret" }, { titleId: "t2", name: "Game B", plays: 4, minutes: 90 }], purchaseCostTotal: "secret-cost" },
    ...overrides };
  const services = { getBoardGameAnalytics: async (...values: any[]) => { calls.push(values); if (failure) throw new Error(failure); return report; },
    listBoardGameAnalyticsBranches: async (...values: any[]) => { calls.push(values); return { branches: [{ id: location, name: "Branch" }], allBranchesAllowed: false, currentDate: "2026-10-23" }; } };
  const tools = load("../apps/web/lib/bms/tools/boardGameAnalytics.ts", {
    "@/lib/auth": { requireAuth }, "../permissions": { requirePermission }, "../boardGameAnalytics": services,
    "../boardGameAnalyticsMath": math, "../salesEvidenceMath": money, "./types": types,
    "../boardGameOwnerReads": {
      BOARD_GAME_OWNER_LIBRARY_VIEWS: ["COPIES", "ATTENTION", "UNPLAYED", "USAGE"],
      readBoardGameLiveOperations: async (...values: any[]) => { calls.push(values); return { kind: "live" }; },
      readBoardGamePassBalances: async (...values: any[]) => { calls.push(values); return { kind: "passes" }; },
      readBoardGameOwnerLibrary: async (...values: any[]) => { calls.push(values); return { kind: "library" }; },
    },
  });
  return { ...tools, calls };
}

test("real registry exposes the three analytics reads only to report staff, never customers", () => {
  for (const name of ["list_board_game_report_branches", "get_board_game_top_games", "get_board_game_table_revenue"]) {
    const tool = ALL_TOOLS.find((entry) => entry.name === name)!;
    assert.ok(tool);
    assert.deepEqual(tool.surfaces, ["staff"]);
    assert.equal(tool.permission, "report.view");
    assert.notEqual(tool.sensitive, true);
    assert.ok(staffTools(new Set(["report.view"])).includes(tool));
    assert.ok(!staffTools(new Set()).includes(tool));
    for (const archetype of [undefined, "board_game_cafe", "retail", "restaurant", "pharmacy"]) {
      assert.ok(!customerTools(archetype).includes(tool));
    }
  }
  // Existing non-board-game sales tools remain registered with their original read permission.
  for (const name of ["get_sales_summary", "get_top_products"]) {
    const tool = staffTools(new Set(["report.view"])).find((entry) => entry.name === name)!;
    assert.ok(tool.inputSchema.properties.scope);
    assert.deepEqual(tool.surfaces, ["staff"]);
  }
});

test("top games use the authenticated actor and tenant, keep loan semantics, omit all private fields", async () => {
  const h = harness();
  const result = await h.getBoardGameTopGamesTool.execute({ ...args, limit: 1 }, ec());
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls[0], [tenant, actorId, { ...args, areaId: undefined, granularity: "TABLE" }, undefined, { includeCosts: false }]);
  assert.deepEqual(result.data.titles, [{ titleId: "t1", name: "Game A", plays: 12, minutes: 60 }]);
  assert.equal(result.data.outputTruncated, true);
  assert.equal(result.data.sourceTruncated, false);
  assert.match(result.data.basis, /loans overlapping/);
  assert.doesNotMatch(JSON.stringify(result.data), /secret|Cost|Profit|borrower/);
});

test("table ranking uses exact signed money, preserves nulls and report warnings, no cost fields", async () => {
  const h = harness({ complete: false, truncated: true, issues: [{ code: "BACKFILLED_OCCUPANCY" }, { code: "HOURS_NOT_CONFIGURED" }],
    byTable: [{ ...table("negative", "-0.01"), utilizationPct: null, revPATH: null }, table("large", "90071992547409.92"), table("larger", "90071992547409.93")] });
  const result = await h.getBoardGameTableRevenueTool.execute({ ...args, areaId: area }, ec(["report.view", "product.view", "tax.document.view"]));
  assert.deepEqual(result.data.tables.map((t: any) => t.tableId), ["larger", "large", "negative"]);
  assert.equal(result.data.tables[2].utilizationPct, null);
  assert.equal(result.data.tables[2].revPATH, null);
  assert.equal(result.data.complete, false);
  assert.equal(result.data.sourceTruncated, true);
  assert.equal(result.data.outputTruncated, false);
  assert.equal(result.data.scope.areaId, area);
  assert.equal(result.data.issues.length, 2);
  assert.doesNotMatch(JSON.stringify(result.data.tables), /secret|Cost|Profit|customer/);
  assert.deepEqual(h.calls[0][4], { includeCosts: false });
});

test("library source completeness is independent of financial/hour warnings; empty is not an error", async () => {
  for (const limited of [false, true]) {
    const h = harness({ complete: false, truncated: true, issues: [{ code: "HOURS_NOT_CONFIGURED" }, ...(limited ? [{ code: "LIBRARY_LIMIT" }] : [])],
      library: { titlesPlayed: [] } });
    const result = await h.getBoardGameTopGamesTool.execute(args, ec());
    assert.deepEqual(result.data.titles, []);
    assert.equal(result.data.complete, !limited);
    assert.equal(result.data.sourceTruncated, limited);
    assert.equal(result.data.outputTruncated, false);
    assert.equal(result.data.issues.length, limited ? 1 : 0);
  }
});

test("strict report input rejects forged authority, bad dates/ranges/IDs and malformed limits before service I/O", async () => {
  const bad = [ {}, { ...args, tenantId: "other" }, { ...args, actorId: "admin" }, { ...args, includeCosts: true },
    { ...args, from: "2026-02-30" }, { ...args, from: "2026-10-24" }, { ...args, from: "2026-01-01" },
    { ...args, to: null }, { ...args, locationId: "Branch name" }, { ...args, locationId: undefined, areaId: area },
    { ...args, limit: 0 }, { ...args, limit: 51 }, { ...args, limit: 1.1 }, { ...args, limit: "10" }, { ...args, limit: null },
    { ...args, scope: "all_time" }, { ...args, from: "2026-10-01T00:00:00Z" } ];
  const h = harness();
  for (const input of bad) await assert.rejects(() => h.getBoardGameTableRevenueTool.execute(input, ec()), types.ToolArgError);
  await assert.rejects(() => h.getBoardGameTopGamesTool.execute({ ...args, areaId: area }, ec()), types.ToolArgError);
  assert.equal(h.calls.length, 0);
  await h.getBoardGameTableRevenueTool.execute({ from: "2026-07-01", to: "2026-09-30", limit: 50 }, ec());
  assert.equal(h.calls.length, 1, "92 inclusive days is accepted");
});

test("direct execution still denies missing staff identity/permission, regardless of actor label", async () => {
  const h = harness();
  for (const tool of [h.getBoardGameTopGamesTool, h.getBoardGameTableRevenueTool, h.listBoardGameReportBranchesTool]) {
    await assert.rejects(() => tool.execute(args, ec([])));
    await assert.rejects(() => tool.execute(args, { ...ec(), ctx: undefined }));
    await assert.rejects(() => tool.execute(args, { ...ec(), surface: "customer" }));
    await assert.rejects(() => tool.execute(args, { ...ec(), ctx: { ...ec().ctx, admin: undefined } }));
  }
  assert.equal(h.calls.length, 0);
});

test("domain refusals stay failures, never a successful empty report; other shops cannot use analytics", async () => {
  for (const failure of ["BOARD_GAME_ANALYTICS_FORBIDDEN", "BOARD_GAME_ANALYTICS_ALL_BRANCH_ACCESS_REQUIRED", "SALES_EVIDENCE_CURRENCY_REVIEW_REQUIRED",
    "ฟังก์ชันนี้ใช้ได้เฉพาะร้านที่ตั้ง Shop archetype เป็น board_game_cafe"]) {
    const h = harness({}, failure);
    const result = await h.getBoardGameTopGamesTool.execute(args, ec());
    assert.equal(result.ok, false);
    assert.equal(result.data, undefined);
    assert.match(result.error, /^(BOARD_GAME_|SALES_EVIDENCE_)/);
  }
});

test("actual runtime audits successful/denied/malformed calls and redacts unexpected service errors", async () => {
  const audits: any[] = [], failures: any[] = [];
  const deps = { auditAttempt: async (...values: any[]) => { audits.push(values); }, reportFailure: async (...values: any[]) => { failures.push(values); } };
  const h = harness();
  for (const [context, input, outcome] of [[ec(), args, "ok"], [ec([]), args, "denied"], [{ ...ec(), surface: "customer" }, args, "denied"], [ec(), { ...args, tenantId: "other" }, "error"]] as const) {
    await __toolLoopTest.runApproved({ tool: h.getBoardGameTopGamesTool, execCtx: context as types.ExecCtx, input }, deps);
    assert.equal(audits.at(-1)[2], outcome);
    assert.equal(audits.at(-1).length, 4, "audit receives context, name, outcome and tool, not raw args");
  }
  assert.equal(h.calls.length, 1);
  const broken = harness({}, "SQL secret connection failure");
  const result = await __toolLoopTest.runApproved({ tool: broken.getBoardGameTableRevenueTool, execCtx: ec(), input: args }, deps);
  assert.equal(result.result.ok, false);
  assert.doesNotMatch(JSON.stringify(result.result), /SQL|secret|connection/);
  assert.equal(failures.length, 1);
});

test("branch discovery wrapper has no caller scope and uses authenticated identity", async () => {
  const h = harness();
  const result = await h.listBoardGameReportBranchesTool.execute({}, ec());
  assert.equal(result.data.allBranchesAllowed, false);
  assert.deepEqual(h.calls, [[tenant, actorId]]);
  await assert.rejects(() => h.listBoardGameReportBranchesTool.execute({ tenantId: "other" }, ec()), types.ToolArgError);
});

test("actual branch service uses tenant transaction, scope filtering, bounded choices and backend timezone", async () => {
  for (const scoped of [true, false]) {
    const calls: string[] = [];
    let released = false;
    const client = { release() { released = true; }, async query(sql: string, values: any[]) {
      calls.push(sql);
      if (/^(COMMIT|ROLLBACK|SET LOCAL)/.test(sql)) return { rows: [] };
      if (sql.includes("AT TIME ZONE")) { assert.deepEqual(values, ["Asia/Bangkok"]); return { rows: [{ date: "2026-10-23" }] }; }
      assert.equal(values[0], tenant);
      if (sql.includes("business_archetype")) return { rows: [{ business_archetype: "board_game_cafe" }] };
      if (sql.includes("AS scoped")) { assert.equal(values[1], actorId); return { rows: [{ scoped }] }; }
      if (sql.includes("pg_timezone_names")) return { rows: [{ timezone: "Asia/Bangkok" }] };
      assert.match(sql, /l\.tenant_id=\$1/);
      assert.match(sql, /a\.tenant_id=\$1 AND a\.user_id=\$2 AND a\.location_id=l\.id/);
      assert.match(sql, /LIMIT 101/);
      assert.deepEqual(values, [tenant, actorId, scoped]);
      return { rows: Array.from({ length: 101 }, (_, i) => ({ id: `${i}`, name: "x".repeat(250), active: i > 0 })) };
    } };
    const service = load("../apps/web/lib/bms/boardGameAnalytics.ts", {
      "@/lib/db": { getClient: async () => client }, "./tenant": { beginTenantTx: async (c: unknown, t: string) => { assert.equal(c, client); assert.equal(t, tenant); calls.push("BEGIN"); } },
      "./boardGameCafe": { requireBoardGameCafeTenant }, "./salesEvidence": {}, "./returnFinancialSnapshot": {}, "./salesEvidenceMath": money, "./boardGameAnalyticsMath": math,
    });
    const result = await service.listBoardGameAnalyticsBranches(tenant, actorId);
    assert.equal(result.allBranchesAllowed, !scoped);
    assert.equal(result.currentDate, "2026-10-23");
    assert.equal(result.truncated, true);
    assert.equal(result.branches.length, 100);
    assert.equal(result.branches[0].name.length, 200);
    assert.equal(result.branches[0].active, false, "historical inactive branches remain available");
    assert.equal(calls[0], "BEGIN");
    assert.equal(calls.at(-1), "COMMIT");
    assert.equal(released, true);
    assert.ok(calls.every((sql) => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
  }
});

test("branch discovery rejects other archetypes before scope reads and rolls back/releases", async () => {
  const calls: string[] = [];
  const client = { release() { calls.push("RELEASE"); }, async query(sql: string, values: any[]) {
    calls.push(sql);
    if (sql === "ROLLBACK") return { rows: [] };
    assert.match(sql, /business_archetype/);
    assert.deepEqual(values, [tenant]);
    return { rows: [{ business_archetype: "retail" }] };
  } };
  const service = load("../apps/web/lib/bms/boardGameAnalytics.ts", {
    "@/lib/db": { getClient: async () => client }, "./tenant": { beginTenantTx: async () => { calls.push("BEGIN"); } },
    "./boardGameCafe": { requireBoardGameCafeTenant }, "./salesEvidence": {}, "./returnFinancialSnapshot": {}, "./salesEvidenceMath": money, "./boardGameAnalyticsMath": math,
  });
  await assert.rejects(() => service.listBoardGameAnalyticsBranches(tenant, actorId), /board_game_cafe/);
  assert.equal(calls[0], "BEGIN");
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "RELEASE"]);
  assert.ok(!calls.some((sql) => sql.includes("bms_locations")));
});

test("provider failure after a board-game read neither invents figures nor retries the service", async () => {
  const h = harness();
  let rounds = 0;
  const audits: string[] = [];
  const result = await __toolLoopTest.run({ tenantId: tenant, system: "test", messages: [{ role: "user", content: "เกมไหนถูกเล่นมากสุด" }],
    tools: [h.getBoardGameTopGamesTool], execCtx: ec() }, {
    resolveCredentials: async () => ({ apiKey: "test-key-not-sent", model: "test-model", provider: "anthropic", baseUrl: "https://example.invalid", source: "byok", usageEventId: "test-usage" }),
    recordProviderAttempt: async () => undefined, finalizeUsage: async () => undefined,
    auditAttempt: async (_context: unknown, _name: string, outcome: string) => { audits.push(outcome); },
    reportFailure: async () => undefined,
    callProvider: async () => {
      rounds += 1;
      if (rounds > 1) throw new Error("synthetic provider outage");
      return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "read-1", name: "get_board_game_top_games", input: args }], usage: { input_tokens: 1, output_tokens: 1 } };
    },
  });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(audits, ["ok"]);
  assert.equal(result.usedAi, true);
  assert.match(result.reply, /ขัดข้อง|ไม่พร้อม|ไม่สำเร็จ/);
  assert.doesNotMatch(result.reply, /Game A|12|60|secret/);
});

test("new owner tools have matching domain permissions and are never customer tools", () => {
  for (const [name, permission] of [["get_board_game_report", "report.view"], ["get_board_game_live_operations", "board_game.session.manage"],
    ["get_board_game_pass_balances", "board_game.session.manage"], ["get_board_game_library_report", "board_game.library.view"]]) {
    const tool = ALL_TOOLS.find(t => t.name === name)!;
    assert.deepEqual(tool.surfaces, ["staff"]);
    assert.equal(tool.permission, permission);
    assert.ok(staffTools(new Set([permission])).includes(tool));
    assert.ok(!staffTools(new Set()).includes(tool));
    assert.ok(!customerTools("board_game_cafe").includes(tool));
  }
});

test("summary, heatmap and offers expose recorded facts, keep unknowns and omit product cost", async () => {
  const h = harness();
  const summary = await h.getBoardGameReportTool.execute({ ...args, view: "SUMMARY" }, ec());
  assert.equal(summary.data.totals.sessions, 3);
  assert.equal(summary.data.totals.guests, 10);
  assert.equal(summary.data.totals.passSalesRevenue, "500.00");
  assert.doesNotMatch(JSON.stringify(summary.data.totals), /tabCost|tabGrossProfit|tabRevenueExVat/);
  assert.match(summary.data.limitations, /Not net profit/);
  const heat = await h.getBoardGameReportTool.execute({ ...args, view: "HEATMAP" }, ec());
  assert.equal(heat.data.rows[0].utilizationPct, null);
  const offers = await h.getBoardGameReportTool.execute({ ...args, view: "OFFERS" }, ec());
  assert.equal(offers.data.rows[0].uses, 2);
  assert.equal(offers.data.rankingLimit, null);
  assert.equal(h.calls.at(-1)[4].includeAllOffers, true);
  assert.match(offers.data.basis, /not an exhaustive/i);
  assert.ok(h.calls.every(c => c[4].includeCosts === false));
});

test("offer usage ranking is distinct from discount ranking and pages beyond twenty", async () => {
  const offers = Array.from({ length: 25 }, (_, i) => ({ offerId: String(i), name: "Offer " + i, uses: i + 1, discount: String(100 - i) + ".00" }));
  const h = harness({ topOffers: offers });
  const usage = await h.getBoardGameReportTool.execute({ ...args, view: "OFFERS", rankBy: "USES", limit: 1 }, ec());
  assert.equal(usage.data.rows[0].offerId, "24");
  assert.equal(usage.data.nextOffset, 1);
  const discount = await h.getBoardGameReportTool.execute({ ...args, view: "OFFERS", rankBy: "DISCOUNT", offset: 20, limit: 2 }, ec());
  assert.deepEqual(discount.data.rows.map((r: any) => r.offerId), ["20", "21"]);
  for (const invalid of [{ view: "SUMMARY", rankBy: "USES" }, { view: "OFFERS", rankBy: "ROI" }]) {
    await assert.rejects(() => h.getBoardGameReportTool.execute({ ...args, ...invalid }, ec()), types.ToolArgError);
  }
});

test("product gross profit requires BOTH source permissions and preserves unknown evidence", async () => {
  const h = harness();
  for (const permissions of [["report.view"], ["report.view", "product.view"], ["report.view", "tax.document.view"]]) {
    await assert.rejects(() => h.getBoardGameReportTool.execute({ ...args, view: "PROFIT" }, ec(permissions)));
  }
  assert.equal(h.calls.length, 0);
  const result = await h.getBoardGameReportTool.execute({ ...args, view: "PROFIT" }, ec(["report.view", "product.view", "tax.document.view"]));
  assert.deepEqual(result.data.product, { revenue: "107.00", revenueExVat: "100.00", cost: "40.00", grossProfit: "60.00" });
  assert.equal(h.calls[0][4].includeCosts, true);
  const unknown = harness({ complete: false, totals: { tabCost: null, tabGrossProfit: null, tabRevenueExVat: null, tabRevenue: "100.00" } });
  const missing = await unknown.getBoardGameReportTool.execute({ ...args, view: "PROFIT" }, ec(["report.view", "product.view", "tax.document.view"]));
  assert.equal(missing.data.product.grossProfit, null);
  assert.equal(missing.data.complete, false);
});

test("table pagination does not duplicate or drop ordered results", async () => {
  const h = harness();
  const first = await h.getBoardGameTableRevenueTool.execute({ ...args, limit: 2 }, ec());
  assert.equal(first.data.nextOffset, 2);
  const second = await h.getBoardGameTableRevenueTool.execute({ ...args, limit: 2, offset: first.data.nextOffset }, ec());
  assert.deepEqual([...first.data.tables, ...second.data.tables].map(t => t.tableId), ["B", "A", "C"]);
  assert.equal(second.data.nextOffset, null);
  assert.equal(second.data.outputTruncated, false);
});

test("operations enforce their own permissions and strict arguments before calling business readers", async () => {
  const h = harness();
  for (const tool of [h.getBoardGameLiveOperationsTool, h.getBoardGamePassBalancesTool]) {
    await assert.rejects(() => tool.execute({ locationId: location }, ec()));
    await assert.rejects(() => tool.execute({ locationId: location, tenantId: "other" }, ec(["board_game.session.manage"])));
    await assert.rejects(() => tool.execute({ locationId: location, offset: -1 }, ec(["board_game.session.manage"])));
    await assert.rejects(() => tool.execute({ locationId: null }, ec(["board_game.session.manage"])));
    const choices = await tool.execute({}, ec(["board_game.session.manage"]));
    assert.equal(choices.data.needsBranchSelection, true);
    await tool.execute({ locationId: location, limit: 5, offset: 5 }, ec(["board_game.session.manage"]));
    assert.deepEqual(h.calls.at(-1), [tenant, actorId, { locationId: location, limit: 5, offset: 5 }]);
  }
  const library = h.getBoardGameLibraryReportTool;
  await assert.rejects(() => library.execute({ locationId: location, view: "ATTENTION" }, ec()));
  await assert.rejects(() => library.execute({ locationId: location, view: "FAKE" }, ec(["board_game.library.view"])));
  await assert.rejects(() => library.execute({ ...args, view: "UNPLAYED" }, ec(["board_game.library.view"])));
  await assert.rejects(() => library.execute({ locationId: location, view: "USAGE" }, ec(["board_game.library.view"])));
  await library.execute({ ...args, view: "USAGE", offset: 150 }, ec(["board_game.library.view"]));
  assert.equal(h.calls.at(-1)[2].offset, 150);
});

test("real export adapters forward board-game filters, leave generic exports unchanged and keep email propose-only", async () => {
  const h = harness();
  const source = readFileSync(new URL("../apps/web/lib/bms/tools/catalog.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("catalog.ts", source, ts.ScriptTarget.Latest, true);
  const calls: any[] = [];
  for (const name of ["generateReportTool", "emailReportTool"]) {
    const statement = ast.statements.find((s: any) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d: any) => d.name.getText(ast) === name));
    const js = ts.transpileModule(`export ${statement.getText(ast)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports: any = {};
    new Function("generateReport", "boardGameReportExportArgs", "REPORT_TYPES", "REPORT_FORMATS", "enumVal", "optString", "reqString", "ToolArgError", "isKnownReportRecipient", "exports", js)(
      async (...values: any[]) => { calls.push(values); return { fileId: 1, reportType: values[2].reportType, format: values[2].format }; },
      h.boardGameReportExportArgs, ["SALES", "BOARD_GAME_ANALYTICS"], ["XLSX", "CSV", "PDF"], types.enumVal, types.optString, types.reqString, types.ToolArgError, async () => false, exports);
    const tool = exports[name];
    const valid = { reportType: "BOARD_GAME_ANALYTICS", format: "XLSX", dateFrom: args.from, dateTo: args.to, locationId: location, areaId: area, to: "owner@example.invalid" };
    const result = await tool.execute(valid, ec());
    assert.equal(calls.at(-1)[0], tenant);
    assert.equal(calls.at(-1)[2].locationId, location);
    assert.equal(calls.at(-1)[2].areaId, area);
    if (name === "emailReportTool") { assert.equal(tool.sensitive, true); assert.equal(result.proposal.mutation, "bmsEmailReport"); }
    for (const invalid of [{ ...valid, format: "PDF" }, { ...valid, locationId: undefined }, { ...valid, dateFrom: "2026-02-30" }, { ...valid, reportType: "SALES" }]) {
      const count = calls.length;
      await assert.rejects(() => tool.execute(invalid, ec()), types.ToolArgError);
      assert.equal(calls.length, count);
    }
    await tool.execute({ reportType: "SALES", format: "PDF", to: "owner@example.invalid" }, ec());
    assert.ok(!("locationId" in calls.at(-1)[2]));
    assert.ok(!("areaId" in calls.at(-1)[2]));
  }
});

test("unsupported owner questions have deterministic bilingual boundaries without breaking ordinary shop questions", () => {
  for (const q of ["กำไรสุทธิของร้านเท่าไร", "เกมกล่องนี้คืนทุนหรือยัง", "ควรซื้อเกมไหนเพิ่มกี่กล่อง", "เสาร์หน้าควรจัดพนักงานกี่คน", "ถ้าขึ้นราคาแล้วรายได้เพิ่มไหม", "โปรนี้คุ้มไหม", "ลูกค้าคนไหนไม่กลับมาเล่น"]) {
    assert.match(boardGameUnsupportedOwnerReply(q, "/admin/board-game")!, /ยังไม่รองรับ/);
  }
  for (const q of ["game box ROI", "net profit", "which games to buy", "staffing next week", "price elasticity", "promotion incremental lift", "player churn"]) {
    assert.match(boardGameUnsupportedOwnerReply(q, "/admin/board-game", "en")!, /does not yet support/);
  }
  for (const q of ["กำไรขั้นต้นสินค้าเท่าไร", "โปรไหนใช้มากที่สุด", "เกมไหนถูกเล่นมากสุด", "เหลือสิทธิ์กี่นาที", "ยอดขายวันนี้", "พนักงานคนนี้มีสิทธิ์อะไร"]) {
    assert.equal(boardGameUnsupportedOwnerReply(q, "/admin/board-game"), null);
  }
  assert.equal(boardGameUnsupportedOwnerReply("กำไรสุทธิ", "/admin/products"), null);
  assert.match(boardGameUnsupportedOwnerReply("แล้วคืนทุนหรือยัง", "/admin/assistant", "th", ["เกมบอร์ดเกมนี้ราคาเท่าไร"])!, /ยังไม่รองรับ/);
  const source = readFileSync(new URL("../apps/web/graphql/bmsAssistant.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("if (unsupportedBoardGame)") < source.indexOf("const loop = await runToolLoop"));
  assert.match(source, /BOARD_GAME_OWNER_LIMITS/);
});

test("owner guard does not block library setup and recognizes explicit future/year reports", () => {
  for (const q of ["ต้องเพิ่มเกมในคลังยังไง", "ต้องเพิ่มกล่องเกมในระบบอย่างไร", "เพิ่มเกมใหม่ในคลัง", "แพ็กเกจรายปีมีไหม", "how to add board games to the library"]) {
    assert.equal(boardGameUnsupportedOwnerReply(q, "/admin/board-game"), null, q);
  }
  for (const q of ["พรุ่งนี้จะมีลูกค้ากี่คน", "สัปดาห์หน้ามีผู้เล่นกี่คน", "รายงานบอร์ดเกมทั้งปี", "ยอดขายบอร์ดเกมรายปี"]) {
    assert.match(boardGameUnsupportedOwnerReply(q, "/admin/board-game")!, /ยังไม่รองรับ/, q);
  }
  for (const q of ["how many visitors tomorrow", "annual board game report", "board game revenue for the full year"]) {
    assert.match(boardGameUnsupportedOwnerReply(q, "/admin/board-game", "en")!, /does not yet support/, q);
  }
  assert.equal(boardGameUnsupportedOwnerReply("annual sales report", "/admin/reports", "en"), null);
});
