import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";
import crypto from "node:crypto";
import { sanitizeLogText } from "../apps/web/lib/log/sanitize.ts";
import { safePosAttemptId } from "../packages/pos-client-core/src/connectionFailure.ts";
import { safePosDiagnosticErrorCode, safePosDiagnosticOperation } from "../packages/pos-client-core/src/diagnosticOperations.ts";

test("received POS GraphQL failures keep a valid attempt ID but no client operation, message or stack", async () => {
  const writes: any[][] = [];
  const metrics: any[] = [];
  const plugin = loadWithStubs("apps/web/graphql/metricsPlugin.ts", {
    "@/lib/bms/requestMetrics": { recordRequestMetric: (value: unknown) => metrics.push(value) },
    "@/lib/log/writeLog.server": { writeLogServer: (...args: unknown[]) => writes.push(args) },
    "@/lib/log/logThrottle": { ERROR_WINDOW_MS: 1000, EXPECTED_WINDOW_MS: 1000, shouldLog: () => true },
    "./expectedErrorCodes": { isExpectedGraphqlCode: () => false },
    "@pos-core/connectionFailure": { safePosAttemptId },
    "@pos-core/diagnosticOperations": { safePosDiagnosticErrorCode, safePosDiagnosticOperation },
  });
  const listener = await plugin.metricsPlugin().requestDidStart();
  const attemptId = "53d0faad-81a4-473c-99c0-28c775abcf27";
  const context = { scope: "pos", posDevice: { tenantId: "tenant" },
    req: { headers: { get: () => attemptId } } };
  const request = { operationName: "PIN1234CustomerSecret", contextValue: context,
    errors: [{ message: "Customer 0890000000 PIN 1234", stack: "Bearer secret", extensions: { code: "customer@example.com" } }] };
  await listener.didEncounterErrors(request);
  await listener.willSendResponse(request);
  assert.equal(writes.length, 1);
  const [level, category, message, meta] = writes[0];
  assert.equal(level, "error");
  assert.equal(category, "graphql");
  assert.equal(message, "POS GraphQL Unknown: POS_UNKNOWN_ERROR");
  assert.equal(meta.routeName, "gql:Unknown");
  assert.equal(meta.correlationId, attemptId);
  assert.equal(meta.errorMessage, null);
  assert.equal(meta.stack, null);
  assert.equal(meta.path, null);
  assert.equal(metrics[0].name, "gql:Unknown");
  assert.doesNotMatch(JSON.stringify({ writes, metrics }), /0890000000|1234|Bearer secret|customer@example.com/);
});

test("received POS REST faults correlate without persisting exception text or stack", async () => {
  const writes: any[][] = [];
  const module = loadWithStubs("apps/web/lib/log/routeError.ts", {
    "server-only": {}, crypto,
    "next/server": { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
    "@/lib/auth/server": { verifyAdminSession: async () => null },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: false }) },
    "./writeLog.server": { writeLogServer: (...args: unknown[]) => { writes.push(args); } },
    "./logThrottle": { ERROR_WINDOW_MS: 1000, shouldLog: () => true },
    "@/lib/bms/restaurantPosErrors": { isRestaurantCheckError: () => false },
    "@/lib/bms/scheduledJobTrace": { withScheduledJobTrace: (_req: unknown, run: () => unknown) => run() },
    "@/lib/bms/requestMetrics": { recordRequestMetric: () => {} },
    "./sanitize": { sanitizeLogText },
    "@pos-core/connectionFailure": { safePosAttemptId },
  });
  const attemptId = "53d0faad-81a4-473c-99c0-28c775abcf27";
  const fault = Object.assign(new Error("PIN 1234 customer@example.com"),
    { code: "secret error code", constraint: "Bearer secret" });
  const wrapped = module.withRouteErrorLog("POST /api/pos/sale", () => { throw fault; });
  const response = await wrapped({ headers: new Headers({ "x-pos-attempt-id": attemptId }) });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("x-pos-attempt-id"), attemptId);
  assert.doesNotMatch(JSON.stringify(await response.json()), /1234|customer@example.com|Bearer secret/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  const meta = writes[0][3];
  assert.equal(meta.correlationId, attemptId);
  assert.equal(meta.errorMessage, null);
  assert.equal(meta.stack, null);
  assert.equal(meta.sqlstate, null);
  assert.equal(meta.constraint, null);
  assert.doesNotMatch(JSON.stringify(writes), /1234|customer@example.com|Bearer secret|secret error code/);
});

test("privacy migration erases historical POS server-log free text", () => {
  const migration = readFileSync(new URL("../db/migrations/10.140__bms_pos_diagnostic_lookup.sql", import.meta.url), "utf8");
  assert.match(migration, /UPDATE system_logs[\s\S]*?stack = NULL/);
  assert.match(migration, /category = 'api' AND route_name/);
  assert.match(migration, /category = 'graphql' AND route_name LIKE 'gql:%'/);
  assert.match(migration, /Mobile\|DesktopPos\|PosBootstrap\|VerifyPosCashier/);
});
