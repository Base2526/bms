import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as cafeService from "../../apps/web/lib/bms/boardGameCafe.ts";
import { readBoardGameCustomerInfoInTx } from "../../apps/web/lib/bms/boardGameCustomerInfo.ts";
import { listPublicBoardGameCafes, type PublicBoardGameCafe } from "../../apps/web/lib/bms/boardGameCafe.ts";
import { customerTools, ALL_TOOLS } from "../../apps/web/lib/bms/tools/catalog.ts";
import { __toolLoopTest } from "../../apps/web/lib/bms/tools/runtime.ts";
import { BOARD_GAME_CUSTOMER_CORPUS, boardGameReplyChecks } from "./board-game-customer-corpus.mjs";
import { executeBoardGameReservationRequest, boardGameReservationSummary, boardGameReservationReceipt,
  boardGameReservationStatusReply, isBoardGameReservationConfirmation, isLatestBoardGameReservationSummary,
  type BoardGameReservationDraft } from "../../apps/web/lib/bms/boardGameReservationPolicy.ts";
import { hasUnsupportedBoardGameActionClaim } from "../../apps/web/lib/bms/customerReplyPolicy.ts";
import type { ExecCtx } from "../../apps/web/lib/bms/tools/types.ts";

test("customer question corpus references real approved tools and covers unsupported writes", () => {
  const names = new Set(customerTools("board_game_cafe").map((tool) => tool.name));
  for (const item of BOARD_GAME_CUSTOMER_CORPUS.flatMap((item) => [item, ...(item.followUps ?? [])])) {
    for (const tool of [...item.tools, ...(item.anyTools ?? [])]) assert.ok(names.has(tool), `${item.id}: ${tool}`);
  }
  for (const id of ["booking-disabled", "booking-deposit-staff", "lost-id", "membership", "monthly-pass", "pass-balance", "queue", "rules"]) {
    assert.equal(BOARD_GAME_CUSTOMER_CORPUS.find((item) => item.id === id)?.abstain, true);
  }
});

function bookingHarness() {
  const ec = { tenantId: CHAT_TENANT, channel: "web", customerRef: "fake-ref", conversationId: "fake-conversation", surface: "customer" } as ExecCtx;
  const writes: any[] = [];
  const draft: BoardGameReservationDraft = { branch: "FAKE Main", reservedLocal: "2027-01-10T18:00", durationMinutes: 120, partySize: 4 };
  const deps = {
    resolveCustomer: async () => "fake-customer",
    contact: async () => ({ hasRecipientName: true, hasPhone: true }),
    preview: async (d: BoardGameReservationDraft) => ({ ...d, locationId: `fake-${d.branch}`, reservedFor: `${d.reservedLocal}:00+07:00`, timezone: "Asia/Bangkok" }),
    create: async (input: any) => { writes.push(input); return { requestId: "12345678-1234-1234-1234-123456789012", status: "REQUESTED" }; },
  };
  return { ec, writes, draft, deps };
}

test("booking first call previews without a write; consent is server-only and binds every field", async () => {
  const { ec, writes, draft, deps } = bookingHarness();
  const result = await executeBoardGameReservationRequest(draft, ec, deps);
  assert.equal((result as any).data.status, "CONFIRMATION_REQUIRED");
  assert.equal(writes.length, 0);
  const quote = ec.pendingBoardGameReservation!;
  assert.doesNotMatch(JSON.stringify(result), /fake-customer|locationId|fingerprint|expiresAt/);
  for (const change of [{ branch: "Other" }, { partySize: 5 }, { durationMinutes: 60 }, { reservedLocal: "2027-01-11T18:00" }, { note: "quiet corner" }]) {
    ec.confirmedBoardGameReservation = quote;
    assert.equal((await executeBoardGameReservationRequest({ ...draft, ...change }, ec, deps) as any).data.status, "CONFIRMATION_REQUIRED");
    assert.equal(writes.length, 0);
  }
  ec.confirmedBoardGameReservation = { ...quote, expiresAt: Date.now() - 1 };
  await executeBoardGameReservationRequest(draft, ec, deps);
  assert.equal(writes.length, 0, "expired consent cannot write");
  ec.confirmedBoardGameReservation = quote;
  await executeBoardGameReservationRequest(draft, ec, deps);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].customerId, "fake-customer");
  assert.equal(writes[0].expectedFingerprint, quote.fingerprint);
  assert.equal(ec.boardGameReservationRequestId, "12345678-1234-1234-1234-123456789012");
});

test("booking tools are board-game only and accept neither identity nor a confirmation flag", () => {
  for (const name of ["request_board_game_reservation", "get_board_game_reservation_status"]) {
    assert.ok(customerTools("board_game_cafe").some(t => t.name === name));
    for (const archetype of ["retail", "restaurant", "pharmacy"] as const) assert.ok(!customerTools(archetype).some(t => t.name === name));
    const tool = ALL_TOOLS.find(t => t.name === name)!;
    assert.deepEqual(tool.surfaces, ["customer"]);
    assert.doesNotMatch(JSON.stringify(Object.keys(tool.inputSchema.properties ?? {})), /tenantId|customerId|recipientName|phone|email|confirmed|tableId/i);
  }
  assert.ok(customerTools("board_game_cafe").some(t => t.name === "save_customer_checkout_details"));
});

test("booking missing identity/contact asks only for missing fields and never writes", async () => {
  const h = bookingHarness();
  h.ec.customerRef = undefined;
  assert.equal((await executeBoardGameReservationRequest(h.draft, h.ec, h.deps) as any).error, "CUSTOMER_IDENTITY_REQUIRED");
  h.ec.customerRef = "fake-ref";
  h.deps.contact = async () => ({ hasRecipientName: true, hasPhone: false });
  const result = await executeBoardGameReservationRequest(h.draft, h.ec, h.deps);
  assert.match((result as any).error, /phone/);
  assert.doesNotMatch((result as any).error, /recipientName/);
  assert.equal(h.writes.length, 0);
});

for (const english of [false, true]) test(`booking verified flow ${english ? "EN" : "TH"}: preview -> consent -> receipt -> status`, async () => {
  const h = bookingHarness();
  await executeBoardGameReservationRequest(h.draft, h.ec, h.deps);
  const quote = h.ec.pendingBoardGameReservation!;
  const summary = boardGameReservationSummary(quote, english);
  assert.equal(hasUnsupportedBoardGameActionClaim(summary), false, summary);
  assert.equal(isLatestBoardGameReservationSummary(quote, summary), true);
  assert.equal(isLatestBoardGameReservationSummary(quote, "Please contact emergency services"), false);
  assert.equal(isLatestBoardGameReservationSummary(quote, ""), false);
  assert.equal(isBoardGameReservationConfirmation(english ? "yes please" : "ตกลงค่ะ"), true);
  for (const changed of ["yes but 5 people", "ตกลง แต่เปลี่ยนเป็น 5 คน", "confirm booking now", "ยืนยันการจองให้เลย"]) assert.equal(isBoardGameReservationConfirmation(changed), false);
  h.ec.confirmedBoardGameReservation = quote;
  await executeBoardGameReservationRequest(h.draft, h.ec, h.deps);
  const receipt = boardGameReservationReceipt(h.ec.boardGameReservationRequestId!, english);
  assert.equal(hasUnsupportedBoardGameActionClaim(receipt), false, receipt);
  assert.match(receipt, /ยังไม่ได้ยืนยันโต๊ะ|No table is confirmed/);
  const status = boardGameReservationStatusReply([{ reference: "12345678", branch: h.draft.branch, status: "REQUESTED",
    reservedFor: quote.preview.reservedFor, timezone: quote.preview.timezone, durationMinutes: 120,
    partySize: 4, rejectionReason: null }], english);
  assert.match(status, /รอร้านตรวจ|Awaiting staff review/);
  assert.equal(hasUnsupportedBoardGameActionClaim(status), false);
  assert.equal(h.writes.length, 1);
});

test("pipeline consumes consent before early guards and replaces all model reservation responses", () => {
  const pipeline = sourceWithoutComments("../../apps/web/lib/bms/pipeline.ts").split("export async function runPipeline")[1];
  assert.ok(pipeline.indexOf("board_game_confirmation_consume") < pipeline.indexOf("boardGameCustomerGuard(rawSafetyMessage"));
  assert.match(pipeline, /isLatestBoardGameReservationSummary\(quote, lastAssistantMessage\)/);
  assert.ok(pipeline.indexOf("execCtx.boardGameReservationRequestId || execCtx.pendingBoardGameReservation") < pipeline.indexOf("if (loop.usedAi)"));
  assert.match(pipeline, /boardGameReservationReceipt\(execCtx.boardGameReservationRequestId/);
  assert.match(pipeline, /boardGameReservationStatusMenu\(execCtx.boardGameReservationStatuses/);
});

const cafe = {
  locationId: "private-branch-id", displayName: "FAKE Main", publicVisible: true,
  summary: "มีที่จอดรถ 5 คัน", openingHours: "10:00-22:00", publicAddress: "FAKE address", publicPhone: null,
  timezone: "Asia/Bangkok", publishRates: true, publishAvailability: true,
  publishTableDetails: true,
  totalTables: 8, availableTables: 2, bookingEnabled: true,
  tableDetails: [
    { area: "FAKE ชั้น 1", seats: 4, totalTables: 5, availableTables: 1 },
    { area: "FAKE ชั้น 2", seats: 8, totalTables: 3, availableTables: 1 },
  ],
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
  const readCafes = async (scope: { tenantId: string; client: typeof client }) => {
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

test("rate, availability and table-detail publication flags fail closed, preserving unknown versus zero", async () => {
  const hidden = harness([{ ...cafe, publishRates: false, publishAvailability: false, publishTableDetails: false }]);
  const rates = await hidden.read("rates");
  assert.equal(rates.status, "NOT_PUBLISHED");
  assert.deepEqual(rates.rates, []);
  const floor = await hidden.read("availability");
  assert.equal(floor.availableTables, null);
  assert.equal(floor.totalTables, null);
  assert.equal(floor.tableDetails, null);
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
  assert.deepEqual(result.tableDetails, cafe.tableDetails);
  assert.doesNotMatch(JSON.stringify(result), /private-branch-id|tableId|sessionId|participant|customerId/);
});

test("table details expose only opt-in area and capacity groups, independently of live availability", async () => {
  const detailsOnly = await harness([{ ...cafe, publishAvailability: false }]).read("availability");
  assert.equal(detailsOnly.status, "OK");
  assert.equal(detailsOnly.totalTables, null);
  assert.equal(detailsOnly.availableTables, null);
  assert.ok(detailsOnly.tableDetails.every((detail: any) => detail.availableTables === null));
  assert.deepEqual(detailsOnly.tableDetails.map((detail: any) => [detail.area, detail.seats]), [
    ["FAKE ชั้น 1", 4], ["FAKE ชั้น 2", 8],
  ]);
  const aggregateOnly = await harness([{ ...cafe, publishTableDetails: false }]).read("availability");
  assert.equal(aggregateOnly.status, "OK");
  assert.equal(aggregateOnly.tableDetails, null);
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
  assert.match(query.sql, /location.active AND title.public_visible/);
  assert.doesNotMatch(query.sql, /profile\.public_visible/);
  assert.match(query.sql, /copy.status NOT IN \('RETIRED', 'LOST'\)/);
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

test("runtime rejects model consent and identity injection into the booking write tool", async () => {
  const tool = ALL_TOOLS.find(t => t.name === "request_board_game_reservation")!;
  for (const field of ["tenantId", "customerId", "phone", "confirmedBoardGameReservation", "customerConfirmedQuote", "reservedTableId"]) {
    let executed = false;
    const result = await __toolLoopTest.runApproved({
      tool: { ...tool, execute: async () => { executed = true; return { ok: true }; } },
      input: { ...bookingHarness().draft, [field]: "injected" },
      execCtx: { tenantId: CHAT_TENANT, surface: "customer", actor: "ai:test" },
    }, { auditAttempt: async () => undefined, reportFailure: async () => undefined });
    assert.equal(result.result.ok, false, field); assert.equal(executed, false, field);
  }
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


const CHAT_TENANT = "11111111-1111-4111-8111-111111111111";
const hiddenChatRow = {
  location_id: "22222222-2222-4222-8222-222222222222",
  display_name: "FAKE Hidden directory branch", public_visible: false,
  publish_rates: true, publish_availability: true, publish_table_details: true, booking_enabled: false,
  rates: Array.from({ length: 4 }, (_, i) => ({ ...cafe.rates[0], name: `FAKE Rate ${i}` })),
  total_tables: 4, available_tables: 3, games: [], latitude: 13.75, longitude: 100.5,
  table_details: [{ area: "FAKE Floor", seats: 4, totalTables: 4, availableTables: 3 }],
};

test("hidden directory branch still answers rates through the DEFAULT chat reader", async () => {
  const client = { query: async (sql: string) => {
    if (sql.includes("SELECT business_archetype")) return { rows: [{ business_archetype: "board_game_cafe" }] } as any;
    // Deliberately model the original directory predicate, not the SELECT projection.
    return { rows: /WHERE profile\.public_visible/.test(sql) ? [] : [hiddenChatRow] } as any;
  } };
  const result = await readBoardGameCustomerInfoInTx(client, CHAT_TENANT, "rates");
  assert.equal(result.status, "OK");
  assert.equal(result.rates.length, 4);
  assert.doesNotMatch(JSON.stringify(result), /22222222|locationId|tableId|copyId/);
});

function sourceWithoutComments(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function readerSource(name: string) {
  const source = sourceWithoutComments("../../apps/web/lib/bms/boardGameCafe.ts");
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf("\nexport ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("public reader alone owns directory visibility and optional tenant filtering", () => {
  const source = readerSource("listPublicBoardGameCafes");
  assert.match(source, /WHERE profile\.public_visible AND location\.active/);
  assert.match(source, /\$1::uuid IS NULL OR profile\.tenant_id = \$1::uuid/);
});

test("chat reader requires tenant in type and SQL without optional tenant escape", async () => {
  const source = readerSource("listBoardGameChatBranches");
  assert.match(source, /scope:\s*\{\s*tenantId:\s*string;\s*client:\s*QueryClient\s*\}/);
  assert.match(source, /WHERE profile\.tenant_id = \$1::uuid AND location\.active/);
  assert.doesNotMatch(source, /IS NULL OR|profile\.public_visible|includeHidden|scope\?/);
  let calls = 0;
  const client = { query: async (sql: string, params: any[]) => {
    calls++;
    assert.deepEqual(params, [CHAT_TENANT]);
    assert.match(sql, /tenant\.active/);
    assert.match(sql, /store\.business_archetype = 'board_game_cafe'/);
    assert.match(sql, /ORDER BY COALESCE\(profile.display_name, location.name\), profile.location_id/);
    assert.match(sql, /CASE WHEN profile.publish_rates/);
    assert.match(sql, /CASE WHEN profile.publish_availability/);
    assert.match(sql, /CASE WHEN profile.publish_table_details/);
    assert.match(sql, /GROUP BY area.id, area.name, area.sort_order, table_row.seats/);
    assert.match(sql, /ORDER BY area.sort_order, area.name, table_row.seats\s+LIMIT 100/);
    assert.match(sql, /title.public_visible/);
    assert.match(sql, /copy.status NOT IN \('RETIRED', 'LOST'\)/);
    return { rows: [hiddenChatRow] } as any;
  } };
  const read = (cafeService as any).listBoardGameChatBranches;
  assert.equal(typeof read, "function");
  for (const tenantId of [undefined, null, "", " ", "not-a-uuid"]) {
    await assert.rejects(read({ tenantId, client }));
  }
  assert.equal(calls, 0, "invalid tenant must fail before SQL");
  const result = await read({ tenantId: CHAT_TENANT, client });
  assert.equal(result[0].distanceKm, null);
  assert.equal(result[0].rates.length, 4);
  assert.equal(calls, 1);
});

test("chat and public entry points cannot swap readers", () => {
  const chat = sourceWithoutComments("../../apps/web/lib/bms/boardGameCustomerInfo.ts");
  assert.doesNotMatch(chat, /listPublicBoardGameCafes/);
  assert.match(chat, /readCafes = listBoardGameChatBranches/);
  for (const path of [
    "../../apps/web/app/(main)/board-game/page.tsx",
    "../../apps/web/app/api/board-game/nearby/route.ts",
  ]) {
    const source = sourceWithoutComments(path);
    assert.match(source, /listPublicBoardGameCafes\(/);
    assert.doesNotMatch(source, /listBoardGameChatBranches/);
  }
});

test("public SQL pins the shared discovery projection including opt-in table details", async () => {
  const client = { query: async (sql: string, values: any[]) => {
    assert.deepEqual(values, [CHAT_TENANT]);
    // Captured from the original query before the shared projection extraction.
    assert.equal(createHash("sha256").update(sql.replace(", profile.chat_auto_confirm", "").replace(/\s+/g, " ").trim()).digest("hex"),
      "2cf9771ea34bb179a63c846645ea60a3e83ec55ad71f4b5ddbb9c494d159fe80");
    return { rows: [] } as any;
  } };
  for (const input of [{}, { latitude: 13.75, longitude: 100.5 }]) {
    assert.deepEqual(await listPublicBoardGameCafes(input, { tenantId: CHAT_TENANT, client }), []);
  }
});

test("hidden directory profile obeys the separate chat publication flags", async () => {
  const hidden = { ...cafe, publicVisible: false, rates: hiddenChatRow.rates };
  const result = await harness([hidden]).read("rates");
  assert.equal(result.status, "OK");
  assert.equal(result.rates.length, 4);
  assert.equal((await harness([{ ...hidden, publishRates: false }]).read("rates")).status, "NOT_PUBLISHED");
  const floor = await harness([{ ...hidden, publishAvailability: false, publishTableDetails: false }]).read("availability");
  assert.equal(floor.status, "NOT_PUBLISHED");
  assert.equal(floor.totalTables, null);
  assert.equal(floor.availableTables, null);
  assert.equal(floor.tableDetails, null);
});

test("chat booking submission depends on booking opt-in AND no deposit", async () => {
  for (const bookingEnabled of [false, true]) for (const reservationDepositPolicy of ["NONE", "FIXED", "PERCENT"] as const) {
    const result = await harness([{ ...cafe, bookingEnabled, reservationDepositPolicy }]).read("availability");
    assert.equal(result.booking.canSubmitViaChat, bookingEnabled && reservationDepositPolicy === "NONE");
  }
});


test("public result mapping, distance, sorting and limit preserve the existing directory contract", async () => {
  const row = { ...hiddenChatRow, public_visible: true, tenant_slug: "fake-public", shop_name: "FAKE public shop",
    rates: [{ name: "Hourly", customerType: "GENERAL", pricePerHour: "50", minimumMinutes: "60", roundingMinutes: "30", graceMinutes: "5" }],
    games: [{ title: "FAKE Game", minPlayers: "2", maxPlayers: "6", typicalMinutes: "30" }],
    total_tables: "4", available_tables: "3",
  };
  const client = { query: async () => ({ rows: [
    { ...row, display_name: "Z near" }, { ...row, display_name: "A far", latitude: 18.79, longitude: 98.98 },
  ] } as any) };
  const scope = { tenantId: CHAT_TENANT, client };
  const all = await listPublicBoardGameCafes({}, scope);
  assert.deepEqual(all.map((c) => [c.displayName, c.distanceKm]), [["A far", null], ["Z near", null]]);
  assert.equal((await listPublicBoardGameCafes({ limit: 1 }, scope))[0].displayName, "A far");
  const near = await listPublicBoardGameCafes({ latitude: 13.75, longitude: 100.5, radiusKm: 1 }, scope);
  assert.equal(near.length, 1);
  assert.equal(near[0].displayName, "Z near");
  assert.equal(near[0].distanceKm, 0);
  assert.equal(near[0].publicVisible, true);
  assert.equal(near[0].totalTables, 4);
  assert.equal(near[0].availableTables, 3);
  assert.deepEqual(near[0].tableDetails, [{ area: "FAKE Floor", seats: 4, totalTables: 4, availableTables: 3 }]);
  assert.equal(near[0].tenantSlug, "fake-public");
  assert.equal(near[0].shopName, "FAKE public shop");
  assert.equal(near[0].logoUrl, null);
  assert.deepEqual(near[0].rates, [{ name: "Hourly", customerType: "GENERAL", pricePerHour: 50, minimumMinutes: 60, roundingMinutes: 30, graceMinutes: 5 }]);
  assert.deepEqual(near[0].games, [{ title: "FAKE Game", minPlayers: 2, maxPlayers: 6, typicalMinutes: 30 }]);
  await assert.rejects(listPublicBoardGameCafes({ latitude: 91, longitude: 100 }, scope));
  await assert.rejects(listPublicBoardGameCafes({ radiusKm: Number.NaN }, scope));
  await assert.rejects(listPublicBoardGameCafes({ limit: Number.NaN }, scope));
});
