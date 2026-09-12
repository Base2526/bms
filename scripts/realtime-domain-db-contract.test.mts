// Writes only one throwaway tenant. Run against a local fully migrated test database, never production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getClient, query } from "../apps/web/lib/db";
import { beginTenantTx } from "../apps/web/lib/bms/tenant";

const outboxMigration = readFileSync(new URL("../db/migrations/9.70__bms_realtime_outbox.sql", import.meta.url), "utf8");
const domainMigration = readFileSync(new URL("../db/migrations/9.71__bms_realtime_domain_events.sql", import.meta.url), "utf8");
const posScopeFixMigration = readFileSync(
  new URL("../db/migrations/9.73__bms_realtime_pos_scope_trigger_fix.sql", import.meta.url),
  "utf8",
);
const posTriggerSplitMigration = readFileSync(
  new URL("../db/migrations/9.74__bms_realtime_pos_trigger_split.sql", import.meta.url),
  "utf8",
);

test("order commit emits scoped events while rollback emits none", async (t) => {
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""),
    "local test DB required",
  );
  await query(outboxMigration);
  await query(domainMigration);
  await query(posScopeFixMigration);
  await query(posTriggerSplitMigration);

  const tenantId = (await query<{ id: string }>(
    "INSERT INTO bms_tenants(name, slug) VALUES($1, $2) RETURNING id",
    ["FAKE realtime domain", `fake-realtime-domain-${randomUUID()}`],
  )).rows[0].id;
  const locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations(tenant_id, code, name, branch_code, is_head_office)
     VALUES($1, 'RT', 'Realtime test', '99999', true) RETURNING id`,
    [tenantId],
  )).rows[0].id;
  const actorId = (await query<{ id: string }>(
    `INSERT INTO users(name, email, password_hash, fake_test, tenant_id)
     VALUES('Realtime POS actor', $1, 'not-used', true, $2) RETURNING id`,
    [`realtime-pos-${randomUUID()}@example.invalid`, tenantId],
  )).rows[0].id;
  t.after(async () => {
    await query("DELETE FROM bms_realtime_outbox WHERE tenant_id = $1", [tenantId]);
    await query("DELETE FROM bms_orders WHERE tenant_id = $1", [tenantId]);
    await query("DELETE FROM bms_pos_shifts WHERE tenant_id = $1", [tenantId]);
    await query("DELETE FROM bms_pos_devices WHERE tenant_id = $1", [tenantId]);
    await query("DELETE FROM users WHERE tenant_id = $1", [tenantId]);
    await query("DELETE FROM bms_locations WHERE tenant_id = $1", [tenantId]);
    await query("DELETE FROM bms_tenants WHERE id = $1", [tenantId]);
  });

  const rolledBackOrder = randomUUID();
  const rollbackClient = await getClient();
  try {
    await beginTenantTx(rollbackClient, tenantId);
    await rollbackClient.query(
      `INSERT INTO bms_orders(id, tenant_id, location_id, channel, status, total_amount)
       VALUES($1, $2, $3, 'test', 'PENDING', 100)`,
      [rolledBackOrder, tenantId, locationId],
    );
    await rollbackClient.query("ROLLBACK");
  } finally {
    rollbackClient.release();
  }
  assert.equal(Number((await query(
    "SELECT count(*) AS n FROM bms_realtime_outbox WHERE tenant_id = $1 AND entity_id = $2",
    [tenantId, rolledBackOrder],
  )).rows[0].n), 0);

  const orderId = randomUUID();
  const commitClient = await getClient();
  try {
    await beginTenantTx(commitClient, tenantId);
    await commitClient.query(
      `INSERT INTO bms_orders(id, tenant_id, location_id, channel, status, total_amount)
       VALUES($1, $2, $3, 'test', 'PENDING', 100)`,
      [orderId, tenantId, locationId],
    );
    await commitClient.query(
      "UPDATE bms_orders SET status = 'PAID', updated_at = now() WHERE tenant_id = $1 AND id = $2",
      [tenantId, orderId],
    );
    await commitClient.query("COMMIT");
  } finally {
    commitClient.release();
  }

  const events = await query<{
    event_type: string; location_id: string | null; entity_id: string; safe_payload: Record<string, unknown>;
  }>(
    `SELECT event_type, location_id, entity_id, safe_payload
       FROM bms_realtime_outbox
      WHERE tenant_id = $1 AND (entity_id = $2 OR entity_type = 'dashboard')
      ORDER BY id`,
    [tenantId, orderId],
  );
  assert.ok(events.rows.some((row) => row.event_type === "order.created" && row.location_id === locationId));
  assert.ok(events.rows.some((row) => row.event_type === "order.status_changed"));
  assert.ok(events.rows.some((row) => row.event_type === "order.paid"));
  assert.ok(events.rows.some((row) => row.event_type === "dashboard.invalidated"));
  assert.doesNotMatch(JSON.stringify(events.rows), /customer_ref|address|phone|token|secret|note/i);

  const metrics = (await query<{ pending: string; oldest_unpublished_seconds: number }>(
    "SELECT * FROM public.bms_realtime_outbox_metrics()",
  )).rows[0];
  assert.ok(Number(metrics.pending) >= events.rowCount);
  assert.ok(Number(metrics.oldest_unpublished_seconds) >= 0);

  const deviceId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_devices(tenant_id, location_id, code, name)
     VALUES($1, $2, $3, 'Realtime contract register') RETURNING id`,
    [tenantId, locationId, `RT-${randomUUID()}`],
  )).rows[0].id;
  const deviceEvent = (await query<{
    event_type: string; device_id: string; safe_payload: Record<string, unknown>;
  }>(
    `SELECT event_type, device_id, safe_payload
       FROM bms_realtime_outbox
      WHERE tenant_id = $1 AND entity_type = 'pos_device' AND entity_id = $2
      ORDER BY id DESC LIMIT 1`,
    [tenantId, deviceId],
  )).rows[0];
  assert.deepEqual(deviceEvent, {
    event_type: "device.session.changed",
    device_id: deviceId,
    safe_payload: { status: "ACTIVE" },
  });

  const shiftId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_shifts(tenant_id, location_id, device_id, opened_by)
     VALUES($1, $2, $3, $4) RETURNING id`,
    [tenantId, locationId, deviceId, actorId],
  )).rows[0].id;
  const shiftEvent = (await query<{
    event_type: string; device_id: string; safe_payload: Record<string, unknown>;
  }>(
    `SELECT event_type, device_id, safe_payload
       FROM bms_realtime_outbox
      WHERE tenant_id = $1 AND entity_type = 'pos_shift' AND entity_id = $2
      ORDER BY id DESC LIMIT 1`,
    [tenantId, shiftId],
  )).rows[0];
  assert.deepEqual(shiftEvent, {
    event_type: "shift.changed",
    device_id: deviceId,
    safe_payload: { status: "OPEN" },
  });
});
