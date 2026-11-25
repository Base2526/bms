// =============================================================
// system_logs.tenant_id is written from the caller's real tenant id, never from redacted text.
// -------------------------------------------------------------
// writeLogServer() took tenant_id from the *redacted* meta. The log sanitizer masks long digit
// runs, so DEFAULT_TENANT_ID 11111111-1111-1111-1111-111111111111 became
// "11111111-1111-1111-1111-[NUMBER]", the INSERT failed with 22P02, and the log was dropped
// (POST /api/logs answered 503). Every client error from the default shop, and any tenant whose
// UUID has a long all-digit segment, was lost — including the rows the 500-triage runbook reads.
// Found 2026-11-24 on the local dev server (writeLogServer failed: invalid input syntax for type uuid).
// =============================================================
import assert from "node:assert/strict";
import test from "node:test";

import { loadWithStubs } from "./testing/webhookHarness.mts";
import * as sanitize from "../apps/web/lib/log/sanitize.ts";

function load(inserts: unknown[][]) {
  return loadWithStubs("apps/web/lib/log/writeLog.server.ts", {
    "server-only": {},
    "./types": {},
    "./sanitize": sanitize,
    "./alertSlackServer": { maybeAlertSlackForLog: async () => undefined },
    "@/lib/db": {
      query: async (text: string, params: unknown[] = []) => {
        if (/information_schema\.columns/.test(text)) return { rows: [{ exists: true }] };
        if (/INSERT INTO system_logs/.test(text)) inserts.push(params);
        return { rows: [] };
      },
    },
  });
}

test("a digit-heavy tenant UUID reaches tenant_id intact and the log is written", async () => {
  const inserts: unknown[][] = [];
  const { writeLogServer } = load(inserts);
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const ok = await writeLogServer("error", "client", "FAKE probe", { tenantId, routeName: "/admin/x" });
  assert.equal(ok, true);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].at(-1), tenantId, "tenant_id is the last structured column");
});

test("a tenant id that is not a UUID is stored as NULL instead of failing the insert", async () => {
  const inserts: unknown[][] = [];
  const { writeLogServer } = load(inserts);
  assert.equal(await writeLogServer("warn", "client", "FAKE probe", { tenantId: "not-a-uuid" }), true);
  assert.equal(inserts[0].at(-1), null);
});
