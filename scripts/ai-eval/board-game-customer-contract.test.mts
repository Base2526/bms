import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readBoardGameCustomerInfoInTx } from "../../apps/web/lib/bms/boardGameCustomerInfo.ts";
import { listPublicBoardGameCafes, type PublicBoardGameCafe } from "../../apps/web/lib/bms/boardGameCafe.ts";
import { customerTools, ALL_TOOLS } from "../../apps/web/lib/bms/tools/catalog.ts";
import { __toolLoopTest } from "../../apps/web/lib/bms/tools/runtime.ts";
import { BOARD_GAME_CUSTOMER_CORPUS, boardGameReplyChecks } from "./board-game-customer-corpus.mjs";

test("customer question corpus references real approved tools and covers unsupported writes", () => {
  const names = new Set(customerTools("board_game_cafe").map((tool) => tool.name));
  for (const item of BOARD_GAME_CUSTOMER_CORPUS.flatMap((item) => [item, ...(item.followUps ?? [])])) {
    for (const tool of [...item.tools, ...(item.anyTools ?? [])]) assert.ok(names.has(tool), `${item.id}: ${tool}`);
  }
  for (const id of ["booking", "reschedule", "refund", "lost-id", "pass-balance", "rules"]) {
    assert.equal(BOARD_GAME_CUSTOMER_CORPUS.find((item) => item.id === id)?.abstain, true);
  }
});

const cafe = {
  locationId: "private-branch-id", displayName: "FAKE Main", publicVisible: true,
  summary: "มีที่จอดรถ 5 คัน", openingHours: "10:00-22:00", publicAddress: "FAKE address", publicPhone: null,
  timezone: "Asia/Bangkok", publishRates: true, publishAvailability: true,
  totalTables: 8, availableTables: 2, bookingEnabled: true,
  reservationDepositPolicy: "FIXED", reservationDepositAmount: 100, reservationDepositPercent: 0,
  reservationDepositRefundCutoffHours: 24,
  rates: [{ name: "ทั่วไป", customerType: "GENERAL", pricePerHour: 50, minimumMinutes: 60, roundingMinutes: 30, graceMinutes: 5 }],
} as PublicBoardGameCafe;

function harness(cafes: PublicBoardGameCafe[] = [cafe], archetype = "board_game_cafe", rows: any[] = []) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const client = { query: async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    return { rows: sql.includes("SELECT business_archetype") ? [{ business_archetype: archetype }] : rows } as any;
  } };
  const readCafes = async (_input: unknown, scope: any) => {
    assert.equal(scope.tenantId, "tenant-a");
    assert.equal(scope.client, client);
    return cafes;
  };
  return { client, calls, read: (kind: "rates" | "availability" | "library", input = {}) =>
    readBoardGameCustomerInfoInTx(client, "tenant-a", kind, input, readCafes) };
}

test("only board-game customer models see the three read-only tools", () => {
  for (const name of ["get_board_game_rates", "search_board_game_library", "get_board_game_availability"]) {
    const tool = customerTools("board_game_cafe").find((t) => t.name === name)!;
    assert.ok(tool);
    assert.equal(tool.sensitive, undefined);
    assert.deepEqual(tool.surfaces, ["customer"]);
    assert.equal(tool.inputSchema.properties.tenantId, undefined);
    for (const archetype of [null, "restaurant", "pharmacy", "mini_mart"]) {
      assert.equal(customerTools(archetype).some((t) => t.name === name), false);
    }
  }
});

test("unpublished and ambiguous branches never disclose rates, floor or private branch ids", async () => {
  for (const kind of ["rates", "availability", "library"] as const) {
    assert.equal((await harness([]).read(kind)).status, "NOT_PUBLISHED");
    const result = await harness([cafe, { ...cafe, displayName: "FAKE Other" }]).read(kind);
    assert.equal(result.status, "BRANCH_REQUIRED");
    assert.doesNotMatch(JSON.stringify(result), /private-branch-id|pricePerHour|availableTables/);
    assert.equal((await harness().read(kind, { branch: "some other tenant" })).status, "BRANCH_REQUIRED");
  }
});

test("rate and availability publication flags fail closed, preserving unknown versus zero", async () => {
  const hidden = harness([{ ...cafe, publishRates: false, publishAvailability: false }]);
  const rates = await hidden.read("rates");
  assert.equal(rates.status, "NOT_PUBLISHED");
  assert.deepEqual(rates.rates, []);
  const floor = await hidden.read("availability");
  assert.equal(floor.availableTables, null);
  assert.equal(floor.totalTables, null);
  assert.equal((await harness([{ ...cafe, availableTables: 0 }]).read("availability")).availableTables, 0);
});

test("published rates preserve charging rules without inventing offers or a final bill", async () => {
  const result = await harness().read("rates");
  assert.deepEqual(result.rates, cafe.rates);
  assert.equal(result.offersStatus, "NOT_EXPOSED");
  assert.doesNotMatch(JSON.stringify(result), /private-branch-id|customerId|sessionId|passId/);
});

test("availability includes published branch hours and booking policy but never claims a booking or wait time", async () => {
  const result = await harness().read("availability");
  assert.equal(result.availableTables, 2);
  assert.equal(result.branch.openingHours, "10:00-22:00");
  assert.equal(result.branch.summary, "มีที่จอดรถ 5 คัน");
  assert.equal(result.booking.depositAmount, 100);
  assert.equal(result.booking.canSubmitViaChat, false);
  assert.equal(result.waitMinutes, null);
  assert.equal(result.waitingParties, null);
  assert.equal(result.partyCapacity, null);
  assert.doesNotMatch(JSON.stringify(result), /private-branch-id|tableId|sessionId|participant|customerId/);
});

test("library search returns aggregate copy counts and filters tenant, branch, publication and players", async () => {
  const h = harness([cafe], "board_game_cafe", [{
    title: "FAKE Catan", min_players: 3, max_players: 4, typical_minutes: 60, difficulty: "MEDIUM",
    language: "th", tags: ["strategy"], total_copies: 3, available_copies: 1,
    copyCode: "SECRET-COPY", customerName: "SECRET-CUSTOMER", conditionNote: "SECRET-NOTE",
  }]);
  const result = await h.read("library", { keyword: "Catan", players: 4, limit: 5 });
  assert.equal(result.games[0].totalCopies, 3);
  assert.equal(result.games[0].availableCopies, 1);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|private-branch-id/);
  const query = h.calls.at(-1)!;
  assert.deepEqual(query.params, ["tenant-a", cafe.locationId, "Catan", 4, 5, true, 4, null]);
  assert.match(query.sql, /title.tenant_id = \$1 AND copy.location_id = \$2/);
  assert.match(query.sql, /profile.public_visible AND location.active AND title.public_visible/);
  assert.match(query.sql, /title.min_players <= \$4 AND title.max_players >= \$7::int/);
  assert.match(query.sql, /LIMIT \$5/);
  assert.doesNotMatch(h.calls.map((call) => call.sql).join("\n"), /INSERT|UPDATE|DELETE/);
});

test("FAQ covers all 20 customer topics and 4 staff-only topics with unique cases", () => {
  const topics = new Set(BOARD_GAME_CUSTOMER_CORPUS.map((item) => item.topic));
  for (let topic = 1; topic <= 24; topic++) assert.ok(topics.has(topic), `missing topic ${topic}`);
  assert.equal(new Set(BOARD_GAME_CUSTOMER_CORPUS.map((item) => item.id)).size, BOARD_GAME_CUSTOMER_CORPUS.length);
  assert.ok(BOARD_GAME_CUSTOMER_CORPUS.filter((item) => item.priority === 1).length >= 10);
  assert.equal(BOARD_GAME_CUSTOMER_CORPUS.find((item) => item.id === "library-followup").followUps.length, 2);
});

test("the live evaluator fails wrong-domain lookup, dropped range and silent write attempts", () => {
  const item = BOARD_GAME_CUSTOMER_CORPUS.find((item) => item.id === "player-range");
  const wrong = boardGameReplyChecks(item, { reply: "มีเกมให้เลือกค่ะ", trace: [
    { tool: "search_board_game_library", ok: true, input: { players: 8 } },
    { tool: "browse_catalog", ok: true, input: {} },
    { tool: "create_order", ok: false, input: {} },
  ] }, ["create_order"]);
  assert.ok(wrong.some((check) => !check.pass && check.desc.includes("ผิดโดเมน")));
  assert.ok(wrong.some((check) => !check.pass && check.desc.includes("เงื่อนไข")));
  assert.ok(wrong.some((check) => !check.pass && check.kind === "safety"));
  const correct = boardGameReplyChecks(item, { reply: "พบเกมที่รองรับ 8–10 คนค่ะ", trace: [
    { tool: "search_board_game_library", ok: true, input: { players: 8, playersTo: 10 } },
  ] }, ["create_order"]);
  assert.ok(correct.every((check) => check.pass));
});

test("range and beginner requests reach SQL without treating unknown metadata as a match", async () => {
  const h = harness();
  await h.read("library", { players: 8, playersTo: 10, difficulty: "LIGHT" });
  assert.deepEqual(h.calls.at(-1).params, ["tenant-a", cafe.locationId, null, 8, 8, true, 10, "LIGHT"]);
  assert.match(h.calls.at(-1).sql, /title.difficulty = \$8/);
  assert.doesNotMatch(h.calls.at(-1).sql, /COALESCE\(title.(?:min_players|max_players|difficulty)/);
  await assert.rejects(h.read("library", { players: 10, playersTo: 8 }), /Invalid player range/);
  await assert.rejects(h.read("library", { playersTo: 10 }), /Invalid player range/);
  await assert.rejects(h.read("library", { difficulty: "EASY" }), /Invalid difficulty/);
});

test("board-game discovery and followups reach the model instead of retail shortcuts", () => {
  const pipeline = readFileSync(new URL("../../apps/web/lib/bms/pipeline.ts", import.meta.url), "utf8");
  assert.match(pipeline, /profile.businessArchetype !== "board_game_cafe" && isAlternativeCatalogRequest/);
  assert.match(pipeline, /profile.businessArchetype !== "board_game_cafe" && !basicStoreQuestion && isCatalogDiscoveryMessage/);
  assert.match(pipeline, /isCouponQuestion\(aiInputMessage\) &&[\s\S]{0,180}profile.businessArchetype !== "board_game_cafe"/);
});

test("library availability stays unknown when unpublished; no arbitrary branch id or SQL is accepted", async () => {
  const h = harness([{ ...cafe, publishAvailability: false }], "board_game_cafe", [{ title: "FAKE Game", total_copies: 2, available_copies: null }]);
  const result = await h.read("library", { keyword: "'; DROP TABLE games; --" });
  assert.equal(result.games[0].availableCopies, null);
  assert.equal(h.calls.at(-1)!.params[5], false);
  assert.doesNotMatch(h.calls.at(-1)!.sql, /DROP TABLE/);
  await assert.rejects(h.read("library", { players: 101 }), /Invalid player count/);
  await assert.rejects(h.read("library", { keyword: "x".repeat(121) }), /Invalid board-game search text/);
  await assert.rejects(harness([cafe], "restaurant").read("rates"), /board_game_cafe/);
});

test("scoped public discovery uses the supplied RLS client and server tenant before limiting results", async () => {
  let sql = ""; let values: any[] = [];
  const client = { query: async (text: string, params: any[] = []) => {
    sql = text; values = params; return { rows: [] } as any;
  } };
  assert.deepEqual(await listPublicBoardGameCafes({}, { tenantId: "tenant-a", client }), []);
  assert.deepEqual(values, ["tenant-a"]);
  assert.match(sql, /profile.tenant_id = \$1::uuid/);
  assert.match(sql, /profile.public_visible AND location.active/);
  assert.match(sql, /seating.status = 'ACTIVE'/);
  const service = readFileSync(new URL("../../apps/web/lib/bms/boardGameCustomerInfo.ts", import.meta.url), "utf8");
  assert.match(service, /await beginTenantTx\(client, tenantId\)/);
  assert.match(service, /client.release\(\)/);
});

test("runtime rejects caller-supplied tenant and operational identifiers before executing a real read tool", async () => {
  const tool = ALL_TOOLS.find((t) => t.name === "get_board_game_availability")!;
  let executed = false;
  const result = await __toolLoopTest.runApproved({
    tool: { ...tool, execute: async () => { executed = true; return { ok: true }; } },
    input: { tenantId: "tenant-b", tableId: "private" },
    execCtx: { tenantId: "tenant-a", surface: "customer", actor: "ai:test" },
  }, { auditAttempt: async () => undefined, reportFailure: async () => undefined });
  assert.equal(result.result.ok, false);
  assert.equal(executed, false);
});
