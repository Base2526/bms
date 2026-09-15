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
const posDeviceHeartbeatFilterMigration = readFileSync(
  new URL("../db/migrations/9.84__bms_realtime_pos_device_heartbeat_filter.sql", import.meta.url),
  "utf8",
);
const remainingBusinessEventsMigration = readFileSync(
  new URL("../db/migrations/9.85__bms_realtime_remaining_business_events.sql", import.meta.url),
  "utf8",
);
const parkedSaleDeleteMigration = readFileSync(
  new URL("../db/migrations/9.86__bms_realtime_parked_sale_delete.sql", import.meta.url),
  "utf8",
);

const REMAINING_REALTIME_TABLES = [
  "bms_ar_accounts", "bms_ar_invoices", "bms_ar_ledger", "bms_ar_receipts",
  "bms_inventory_wastage", "bms_loyalty_ledger", "bms_pos_blind_return_items",
  "bms_pos_blind_returns", "bms_pos_deposits", "bms_pos_expenses", "bms_pos_no_sales",
  "bms_pos_parked_sales", "bms_pos_petty_cash_ledger", "bms_pos_petty_cash_wallets",
  "bms_pos_pharmacist_authorizations", "bms_pos_returns", "bms_purchase_orders",
  "bms_store_credit_ledger", "bms_store_credits", "bms_tax_documents",
] as const;

test("order commit emits scoped events while rollback emits none", async (t) => {
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""),
    "local test DB required",
  );
  await query(outboxMigration);
  await query(domainMigration);
  await query(posScopeFixMigration);
  await query(posTriggerSplitMigration);
  await query(posDeviceHeartbeatFilterMigration);
  await query(remainingBusinessEventsMigration);
  await query(parkedSaleDeleteMigration);

  const posTriggerOwners = await query<{
    proname: string;
    rolname: string;
    rolbypassrls: boolean;
  }>(
    `SELECT p.proname, r.rolname, r.rolbypassrls
       FROM pg_proc p
       JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = ANY($1::text[])
      ORDER BY p.proname`,
    [[
      "bms_realtime_business_change_trigger",
      "bms_realtime_pos_device_trigger",
      "bms_realtime_pos_shift_trigger",
    ]],
  );
  assert.deepEqual(posTriggerOwners.rows, [
    {
      proname: "bms_realtime_business_change_trigger",
      rolname: "bms_realtime_dispatcher",
      rolbypassrls: true,
    },
    {
      proname: "bms_realtime_pos_device_trigger",
      rolname: "bms_realtime_dispatcher",
      rolbypassrls: true,
    },
    {
      proname: "bms_realtime_pos_shift_trigger",
      rolname: "bms_realtime_dispatcher",
      rolbypassrls: true,
    },
  ]);

  const coveredTables = await query<{ relname: string }>(
    `SELECT DISTINCT c.relname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal
        AND p.proname = 'bms_realtime_business_change_trigger'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname`,
    [REMAINING_REALTIME_TABLES],
  );
  assert.deepEqual(
    coveredTables.rows.map((row) => row.relname),
    [...REMAINING_REALTIME_TABLES].sort(),
  );

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
    await query("DELETE FROM bms_pos_no_sales WHERE tenant_id = $1", [tenantId]);
    await query("DELETE FROM bms_pos_petty_cash_wallets WHERE tenant_id = $1", [tenantId]);
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

  const deviceEventCount = async () => Number((await query<{ count: string }>(
    `SELECT count(*) AS count
       FROM bms_realtime_outbox
      WHERE tenant_id = $1 AND entity_type = 'pos_device' AND entity_id = $2`,
    [tenantId, deviceId],
  )).rows[0].count);
  assert.equal(await deviceEventCount(), 1);

  await query(
    "UPDATE bms_pos_devices SET last_seen_at = now() WHERE tenant_id = $1 AND id = $2",
    [tenantId, deviceId],
  );
  assert.equal(await deviceEventCount(), 1, "device heartbeat must not enqueue an invalidation");

  await query(
    `UPDATE bms_pos_devices
        SET scanner_max_gap_ms = scanner_max_gap_ms + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, deviceId],
  );
  assert.equal(await deviceEventCount(), 2, "device configuration changes must still invalidate");

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

  const parkedId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_parked_sales
       (tenant_id, location_id, device_id, shift_id, parked_by, label, cart, item_count, subtotal_hint)
     VALUES($1, $2, $3, $4, $5, 'Realtime delete contract', '{}'::jsonb, 0, 0)
     RETURNING id`,
    [tenantId, locationId, deviceId, shiftId, actorId],
  )).rows[0].id;
  await query(
    `DELETE FROM bms_pos_parked_sales
      WHERE tenant_id = $1 AND shift_id = $2 AND id = $3`,
    [tenantId, shiftId, parkedId],
  );
  const parkedEvents = await query<{
    event_type: string;
    location_id: string;
    device_id: string;
    safe_payload: Record<string, unknown>;
  }>(
    `SELECT event_type, location_id, device_id, safe_payload
       FROM bms_realtime_outbox
      WHERE tenant_id = $1 AND entity_type = 'pos_parked_sale' AND entity_id = $2
      ORDER BY id`,
    [tenantId, parkedId],
  );
  assert.deepEqual(parkedEvents.rows, [
    {
      event_type: "pos.parked_sale.changed",
      location_id: locationId,
      device_id: deviceId,
      safe_payload: { change: "INSERT", status: "INSERT" },
    },
    {
      event_type: "pos.parked_sale.changed",
      location_id: locationId,
      device_id: deviceId,
      safe_payload: { change: "DELETE", status: "DELETE" },
    },
  ]);

  const noSaleId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_no_sales(tenant_id, shift_id, device_id, actor_user_id, reason)
     VALUES($1, $2, $3, $4, 'realtime contract') RETURNING id`,
    [tenantId, shiftId, deviceId, actorId],
  )).rows[0].id;
  const noSaleEvent = (await query<{
    event_type: string; location_id: string; device_id: string; safe_payload: Record<string, unknown>;
  }>(
    `SELECT event_type, location_id, device_id, safe_payload
       FROM bms_realtime_outbox
      WHERE tenant_id = $1 AND entity_type = 'pos_no_sale' AND entity_id = $2
      ORDER BY id DESC LIMIT 1`,
    [tenantId, noSaleId],
  )).rows[0];
  assert.deepEqual(noSaleEvent, {
    event_type: "pos.no_sale.recorded",
    location_id: locationId,
    device_id: deviceId,
    safe_payload: { change: "INSERT", status: "INSERT" },
  });

  await query(
    `INSERT INTO bms_pos_petty_cash_wallets(tenant_id, location_id, balance)
     VALUES($1, $2, 0)`,
    [tenantId, locationId],
  );
  const walletEvent = (await query<{
    event_type: string; location_id: string; safe_payload: Record<string, unknown>;
  }>(
    `SELECT event_type, location_id, safe_payload
       FROM bms_realtime_outbox
      WHERE tenant_id = $1 AND entity_type = 'pos_petty_cash' AND entity_id = $2
      ORDER BY id DESC LIMIT 1`,
    [tenantId, locationId],
  )).rows[0];
  assert.deepEqual(walletEvent, {
    event_type: "pos.petty_cash.changed",
    location_id: locationId,
    safe_payload: { change: "INSERT", status: "INSERT" },
  });
});
