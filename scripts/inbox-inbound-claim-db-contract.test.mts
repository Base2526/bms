/** Run only on the restored, disposable local Inbox database. No customer rows are changed. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { loadWithStubs } from "./testing/webhookHarness.mts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = require("pg");

test("disposable DB: Inbox event claims and releases stay within one tenant", {
  skip: process.env.BMS_INBOX_DISPOSABLE_DB !== "1",
}, async () => {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_PORT, "5433");
  assert.equal(process.env.POSTGRES_DB, "bms_realtime_test");
  const pool = new Pool({ host: "127.0.0.1", port: 5433, database: "bms_realtime_test",
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, max: 3 });
  const eventId = `FAKE-inbox-${randomUUID()}`;
  try {
    const tenants = (await pool.query("SELECT id FROM bms_tenants ORDER BY id LIMIT 2")).rows;
    assert.equal(tenants.length, 2, "restored test baseline needs two tenants");
    const [a, b] = tenants.map((row: { id: string }) => row.id);
    const claims = loadWithStubs("apps/web/lib/bms/inboundEvents.ts", {
      "@/lib/db": { getClient: () => pool.connect() },
      "./tenant": { beginTenantTx },
    });
    assert.equal(await claims.claimInboundEvent(a, "line", eventId), true);
    assert.equal(await claims.claimInboundEvent(a, "line", eventId), false);
    assert.equal(await claims.claimInboundEvent(b, "line", eventId), true);
    await claims.releaseUnprocessedInboundEvent(a, "line", eventId);
    const remaining = (await pool.query(
      "SELECT tenant_id FROM bms_inbound_events WHERE channel='line' AND external_event_id=$1", [eventId],
    )).rows.map((row: { tenant_id: string }) => row.tenant_id);
    assert.deepEqual(remaining, [b], "releasing tenant A must not remove tenant B's claim");
    await claims.releaseUnprocessedInboundEvent(b, "line", eventId);
    assert.equal((await pool.query(
      "SELECT count(*)::int AS n FROM bms_inbound_events WHERE channel='line' AND external_event_id=$1", [eventId],
    )).rows[0].n, 0);
  } finally {
    await pool.query("DELETE FROM bms_inbound_events WHERE channel='line' AND external_event_id=$1", [eventId]);
    await pool.end();
  }
});
