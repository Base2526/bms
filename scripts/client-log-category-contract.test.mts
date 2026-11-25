// =============================================================
// Client log ingestion cannot write into the reserved "log-admin" category.
// -------------------------------------------------------------
// "log-admin" holds the "System logs deleted" audit trail and is excluded from every purge. POST
// /api/logs took `category` from the caller, so any admin session or verified user bearer could
// write rows that look like deletion audit events and that platform admins can never delete.
// Found 2026-11-24 (REST sweep).
// =============================================================
import assert from "node:assert/strict";
import test from "node:test";

import { loadWithStubs } from "./testing/webhookHarness.mts";
import * as webhookBody from "../apps/web/lib/bms/webhookBody.ts";

function load(writes: string[]) {
  return loadWithStubs("apps/web/app/api/logs/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) } },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: true, tenantId: "FAKE-tenant", adminId: "FAKE-admin", admin: { id: "FAKE-admin" } }) },
    "@/lib/auth/server": { verifyUserFromRequest: () => null },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/bms/webhookBody": webhookBody,
    "@/lib/db": { query: async () => ({ rows: [], rowCount: 0 }) },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    "@/lib/log/writeLog.server": { writeLogServer: async (_level: string, category: string) => { writes.push(category); return true; } },
  });
}

const post = (route: any, body: unknown) => route.POST(new Request("http://localhost/api/logs", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

test("a client log in the reserved log-admin category is refused before any write", async () => {
  const writes: string[] = [];
  const route = load(writes);
  for (const category of ["log-admin", " LOG-ADMIN "]) {
    const res = await post(route, { logs: [{ level: "error", category, message: "FAKE spoof" }] });
    assert.equal(res.status, 400, category);
  }
  const mixed = await post(route, { logs: [{ level: "info", category: "client", message: "FAKE ok" },
    { level: "warn", category: "log-admin", message: "FAKE spoof" }] });
  assert.equal(mixed.status, 400, "one reserved entry refuses the whole batch");
  assert.deepEqual(writes, []);
});

test("ordinary client categories are still accepted", async () => {
  const writes: string[] = [];
  const route = load(writes);
  const res = await post(route, { logs: [{ level: "error", category: "client", message: "FAKE ok" }] });
  assert.equal(res.status, 201);
  assert.deepEqual(writes, ["client"]);
});
