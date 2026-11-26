import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzip, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import test from "node:test";
import { safePosDiagnosticErrorCode, safePosDiagnosticReason } from "../packages/pos-client-core/src/diagnosticOperations.ts";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const tenantId = randomUUID();
const deviceId = randomUUID();
const locationId = randomUUID();
const attemptId = randomUUID();

function harness(options: { duplicate?: boolean; insertFails?: boolean; pageRows?: any[];
  bundleRows?: Record<string, any[]> } = {}) {
  const statements: Array<{ sql: string; params: any[] }> = [];
  let released = false;
  const client = {
    async query(sql: string, params: any[] = []) {
      statements.push({ sql, params });
      if (sql.includes("FROM bms_locations")) return { rows: [{ id: locationId }] };
      if (sql.includes("FROM bms_pos_devices")) return { rows: [{ id: deviceId }] };
      if (sql.includes("FROM users")) return { rows: [] };
      if (sql.includes("INSERT INTO bms_support_events")) {
        if (options.insertFails) throw new Error("database writer unavailable");
        return { rowCount: options.duplicate ? 0 : 1, rows: [] };
      }
      if (sql.includes("FROM bms_support_events e")) return { rows: options.pageRows ?? [] };
      if (sql.includes("FROM bms_support_events\n")) return { rows: options.bundleRows?.activity ?? [] };
      if (sql.includes("FROM bms_audit_log\n")) return { rows: options.bundleRows?.audit ?? [] };
      if (sql.includes("FROM bms_failure_incidents\n")) return { rows: options.bundleRows?.incidents ?? [] };
      if (sql.includes("FROM system_logs\n")) return { rows: options.bundleRows?.system ?? [] };
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  const service = loadWithStubs("apps/web/lib/bms/supportDiagnostics.ts", {
    "server-only": {}, crypto: { ...crypto, default: crypto }, zlib: { gzip }, util: { promisify },
    "@/lib/db": { getClient: async () => client, query: async () => ({ rows: [] }) },
    "@/lib/storage": {}, "@/lib/mailer": {},
    "./tenant": { beginTenantTx: async () => statements.push({ sql: "BEGIN TENANT", params: [tenantId] }) },
    "@pos-core/diagnosticOperations": { isAllowedPosDiagnosticAction: (action: string) => action === "health.failed",
      safePosDiagnosticRoute: (route: string) => route === "/api/pos/session" ? route : null,
      safePosDiagnosticErrorCode, safePosDiagnosticReason },
  });
  return { service, statements, get released() { return released; } };
}

function event(overrides: Record<string, unknown> = {}) {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString(), category: "pos",
    action: "health.failed", status: "error", correlationId: attemptId,
    deviceId, locationId, message: "PIN 1234; customer phone 0900000000",
    context: { errorCode: "POS_TIMEOUT", route: "/api/pos/session",
      authorization: "Bearer secret", body: "card 4111", nativeCode: "-106" },
    ...overrides };
}

test("ingest ACKs accepted and duplicate separately, stores only coded metadata", async () => {
  for (const duplicate of [false, true]) {
    const h = harness({ duplicate });
    const value = event();
    const result = await h.service.recordSupportEventsDetailed({ tenantId, actorId: `pos:${deviceId}`, events: [value] });
    assert.equal(result.accepted, duplicate ? 0 : 1);
    assert.equal(result.duplicate, duplicate ? 1 : 0);
    assert.deepEqual(result.results, [{ index: 0, eventId: value.eventId,
      status: duplicate ? "duplicate" : "accepted" }]);
    const insert = h.statements.find(item => item.sql.includes("INSERT INTO bms_support_events"))!;
    assert.equal(insert.params[0], tenantId);
    assert.equal(insert.params[11], null, "client free-text message must not enter the database");
    assert.equal(insert.params[7], attemptId);
    assert.deepEqual(JSON.parse(insert.params[12]), { errorCode: "POS_TIMEOUT", route: "/api/pos/session",
      nativeCode: "-106" });
    assert.ok(h.statements.some(item => item.sql === "COMMIT"));
    assert.equal(h.released, true);
  }
});

test("old, future-skewed and invalid correlation events receive safe explicit rejections", async () => {
  const h = harness();
  const values = [
    event({ occurredAt: new Date(Date.now() - 8 * 86400_000).toISOString() }),
    event({ occurredAt: new Date(Date.now() + 6 * 60_000).toISOString() }),
    event({ correlationId: "Bearer secret" }),
    event({ action: "customer.0900000000" }),
  ];
  const result = await h.service.recordSupportEventsDetailed({ tenantId, actorId: `pos:${deviceId}`, events: values });
  assert.equal(result.rejected, 4);
  assert.deepEqual(result.results.map((item: { reason: string }) => item.reason),
    ["event_too_old", "clock_ahead", "invalid_correlation_id", "invalid_action"]);
  assert.equal(h.statements.filter(item => item.sql.includes("INSERT INTO bms_support_events")).length, 0);
});

test("unrecognized error codes cannot carry customer text into a POS DB event", async () => {
  const h = harness();
  await h.service.recordSupportEventsDetailed({ tenantId, actorId: `pos:${deviceId}`, events: [
    event({ context: { errorCode: "CUSTOMER_0900000000", appVersion: "JohnSmith",
      route: "/api/pos/session?phone=0900000000" } }),
  ] });
  const insert = h.statements.find(item => item.sql.includes("INSERT INTO bms_support_events"))!;
  const context = JSON.parse(insert.params[12]);
  assert.deepEqual(context, { errorCode: "POS_UNKNOWN_ERROR" });
});

test("non-POS activity rejects free-form identifiers and strips client text before DB insertion", async () => {
  const h = harness();
  const result = await h.service.recordSupportEventsDetailed({ tenantId, actorId: randomUUID(), events: [
    event({ category: "navigation", action: "ui.route_view", status: "success",
      sessionId: "customer@example.com", correlationId: null,
      context: { route: "/admin/customers/0890000000?token=secret",
        previousRoute: "/admin", errorName: "John Smith", body: "card 4111" } }),
    event({ category: "navigation", action: "customer.free_text" }),
  ] });
  assert.equal(result.accepted, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.results[1].reason, "invalid_action");
  const insert = h.statements.find(item => item.sql.includes("INSERT INTO bms_support_events"))!;
  assert.equal(insert.params[6], null);
  assert.equal(insert.params[11], null);
  assert.deepEqual(JSON.parse(insert.params[12]), { previousRoute: "/admin" });
  assert.doesNotMatch(JSON.stringify(insert.params), /customer@example|0890000000|John Smith|secret|4111/);
});

test("new support bundles sanitize legacy activity, audit, incident and system log free text", async () => {
  const date = new Date();
  const h = harness({ bundleRows: {
    activity: [{ client_event_id: randomUUID(), occurred_at: date, received_at: date,
      actor_id: "customer@example.com", category: "navigation", action: "customer.free_text",
      status: "error", message: "PIN 1234", context: { route: "/admin/customers/0890000000",
        body: "card 4111", errorName: "John Smith" } }],
    audit: [{ created_at: date, actor: "customer@example.com", action: "customer.secret",
      target: "0890000000", meta: { authorization: "Bearer secret" } }],
    incidents: [{ created_at: date, tier: "A", code: "CUSTOMER_0890000000",
      error_message: "PIN 1234", meta: { card: "4111" } }],
    system: [{ created_at: date, level: "error", status: "error",
      correlation_id: "customer@example.com", route_name: "/api/pos/sale?customer=0890000000",
      message: "PIN 1234", error_message: "Bearer secret" }],
  } });
  const bundle = await h.service.buildSupportBundle({ tenantId, actorId: randomUUID(),
    from: new Date(date.getTime() - 60_000).toISOString(), to: new Date(date.getTime() + 1000).toISOString() });
  const content = gunzipSync(bundle.buffer).toString("utf8");
  assert.doesNotMatch(content, /0890000000|PIN 1234|4111|customer@example|John Smith|Bearer secret|customer\.secret/);
  assert.match(content, /support\.unknown_event/);
  assert.match(content, /"activity":1/);
  assert.match(content, /"tier":"A"/);
});

test("privacy migration scrubs legacy identifiers and preserves every current POS operation", () => {
  const migration = readFileSync(new URL("../db/migrations/10.140__bms_pos_diagnostic_lookup.sql", import.meta.url), "utf8");
  const operations = JSON.parse(readFileSync(new URL("../apps/desktop/src/diagnostic-operations.json", import.meta.url), "utf8")) as string[];
  // 10.140 is an applied historical scrub, not a live allowlist. New kiosk operations
  // cannot be backfilled into an applied migration; current writes use the shared allowlist.
  const introducedAfterScrub = new Set([
    "MobileRestaurantKioskAccept", "MobileRestaurantKioskOrders",
    "MobileRestaurantKioskPreview", "MobileRestaurantKioskReject",
  ]);
  for (const operation of operations) {
    if (!migration.includes(`'${operation}'`)) assert.ok(introducedAfterScrub.has(operation), operation);
  }
  for (const operation of introducedAfterScrub) assert.ok(operations.includes(operation), operation);
  for (const field of ["actor_id", "session_id", "correlation_id", "category", "action", "status", "message", "context"])
    assert.match(migration, new RegExp(`(?:SET|,|\\s)\\s*${field}\\s*=`), field);
});

test("database failure rolls back and never produces a success ACK", async () => {
  const h = harness({ insertFails: true });
  await assert.rejects(h.service.recordSupportEventsDetailed({ tenantId, actorId: `pos:${deviceId}`,
    events: [event()] }), /database writer unavailable/);
  assert.ok(h.statements.some(item => item.sql === "ROLLBACK"));
  assert.equal(h.released, true);
});

test("pagination cursor follows the last returned row, preserving the next record", async () => {
  const rows = [3, 2, 1].map(id => ({ id: String(id), occurred_at: new Date(`2026-01-0${id}T00:00:00Z`),
    received_at: new Date(`2026-01-0${id}T00:00:01Z`), context: {}, actor_kind: "device" }));
  const h = harness({ pageRows: rows });
  const page = await h.service.listPosDeviceDiagnosticPage({ tenantId, limit: 2 });
  assert.deepEqual(page.events.map((item: { id: string }) => item.id), ["3", "2"]);
  assert.deepEqual(Buffer.from(page.nextCursor!, "base64url").toString("utf8").split("|"),
    ["2026-01-02T00:00:00.000Z", "2"]);
  assert.ok(h.statements.some(item => item.sql.includes("WHERE e.tenant_id = $1")));
});

test("invalid history filters fail before opening a database transaction", async () => {
  const h = harness();
  for (const filter of [{ status: "customer data" }, { correlationId: `${attemptId}-extra` },
    { from: "not-a-date" }, { cursor: "bad" }]) {
    await assert.rejects(h.service.listPosDeviceDiagnosticPage({ tenantId, ...filter }),
      (error: Error) => error instanceof h.service.SupportDiagnosticsInputError);
  }
  assert.equal(h.statements.length, 0);
});
