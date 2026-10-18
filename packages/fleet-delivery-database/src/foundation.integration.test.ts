import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  claimOutbox,
  completeOutbox,
  createDatabasePool,
  runMigrations,
  storeInboxEnvelope,
} from "./index.js";

const databaseUrl = process.env.FLEET_DELIVERY_TEST_DATABASE_URL?.trim();

test("foundation migration reruns and tenant RLS/inbox identity/worker lease hold", { skip: !databaseUrl }, async () => {
  const pool = createDatabasePool(databaseUrl!, 3);
  const tenantA = `tenant:test-${randomUUID()}`;
  const tenantB = `tenant:test-${randomUUID()}`;
  const messageId = randomUUID();
  const migrationsDir = path.resolve(process.cwd(), "packages/fleet-delivery-database/migrations");
  try {
    await runMigrations(pool, migrationsDir);
    assert.deepEqual(await runMigrations(pool, migrationsDir), []);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE fleet_delivery_app");
      await client.query("SELECT set_config('fleet_delivery.tenant_ref', $1, true)", [tenantA]);
      const envelope = {
        messageId,
        messageType: "bms.order-context-changed.v1",
        schemaVersion: 1 as const,
        producer: "synthetic-test" as const,
        tenantRef: tenantA,
        branchRef: "branch:main",
        aggregateType: "bms-order",
        aggregateRef: "order:test-1",
        aggregateVersion: 1,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        causationId: null,
        payload: { status: "PAID" },
      };
      assert.equal(await storeInboxEnvelope(client as PoolClient, envelope), "STORED");
      assert.equal(await storeInboxEnvelope(client as PoolClient, envelope), "DUPLICATE");
      assert.equal(
        await storeInboxEnvelope(client as PoolClient, { ...envelope, payload: { status: "PACKING" } }),
        "BODY_MISMATCH",
      );
      await client.query("SAVEPOINT rls_denial");
      await assert.rejects(() => client.query(
        `INSERT INTO fleet_delivery.inbox_events (
          tenant_ref, branch_ref, producer, message_id, message_type, aggregate_type,
          aggregate_ref, aggregate_version, body_sha256, envelope
        ) VALUES ($1, 'branch:main', 'synthetic-test', $2, 'bms.test.v1', 'bms-order', 'order:test-2', 1, $3, '{}'::jsonb)`,
        [tenantB, randomUUID(), "0".repeat(64)],
      ));
      await client.query("ROLLBACK TO SAVEPOINT rls_denial");
      const invisible = await client.query("SELECT count(*)::int AS count FROM fleet_delivery.inbox_events WHERE tenant_ref = $1", [tenantB]);
      assert.equal(invisible.rows[0]?.count, 0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const outboxId = randomUUID();
    await pool.query(
      `INSERT INTO fleet_delivery.outbox_events (
        id, tenant_ref, branch_ref, message_type, aggregate_type, aggregate_ref,
        aggregate_version, destination, envelope
      ) VALUES ($1,$2,'branch:main','fleet-delivery.synthetic.v1','synthetic','aggregate:1',1,'synthetic://ack','{}'::jsonb)`,
      [outboxId, tenantA],
    );
    const appClient = await pool.connect();
    try {
      await appClient.query("BEGIN");
      await appClient.query("SET LOCAL ROLE fleet_delivery_app");
      await appClient.query("SELECT set_config('fleet_delivery.tenant_ref', $1, true)", [tenantA]);
      await appClient.query("SAVEPOINT direct_publish_denial");
      await assert.rejects(() => appClient.query(
        "UPDATE fleet_delivery.outbox_events SET status = 'PUBLISHED' WHERE id = $1",
        [outboxId],
      ));
      await appClient.query("ROLLBACK TO SAVEPOINT direct_publish_denial");
      await appClient.query("ROLLBACK");
    } finally {
      appClient.release();
    }
    const workerClient = await pool.connect();
    try {
      await workerClient.query("SET ROLE fleet_delivery_worker");
      const workerPoolFacade = {
        query: workerClient.query.bind(workerClient),
      } as unknown as typeof pool;
      const claimed = await claimOutbox(workerPoolFacade, "worker:test", 10, 30);
      assert.equal(claimed.some((row) => row.id === outboxId), true);
      assert.equal(await completeOutbox(workerPoolFacade, outboxId, "worker:test"), true);
      await workerClient.query("RESET ROLE");
    } finally {
      workerClient.release();
    }
    const published = await pool.query("SELECT status FROM fleet_delivery.outbox_events WHERE id = $1", [outboxId]);
    assert.equal(published.rows[0]?.status, "PUBLISHED");
  } finally {
    await pool.query("DELETE FROM fleet_delivery.inbox_events WHERE tenant_ref IN ($1, $2)", [tenantA, tenantB]).catch(() => undefined);
    await pool.query("DELETE FROM fleet_delivery.outbox_events WHERE tenant_ref IN ($1, $2)", [tenantA, tenantB]).catch(() => undefined);
    await pool.end();
  }
});
