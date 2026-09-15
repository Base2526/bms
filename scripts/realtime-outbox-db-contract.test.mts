// Writes only one throwaway tenant. Run against a local migrated test database, never production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getClient, query } from "../apps/web/lib/db";
import { beginTenantTx } from "../apps/web/lib/bms/tenant";
import { enqueueRealtimeEventInTx, realtimeEvent } from "../apps/web/lib/bms/realtimeOutbox";

const migration = readFileSync(
  new URL("../db/migrations/9.70__bms_realtime_outbox.sql", import.meta.url),
  "utf8",
);

test("outbox commit/rollback, tenant isolation, claims, retry, and acknowledgement", async (t) => {
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""),
    "local test DB required",
  );
  await query(migration);
  await query("DELETE FROM bms_realtime_outbox");
  const tenantId = (await query<{ id: string }>(
    "INSERT INTO bms_tenants(name, slug) VALUES($1, $2) RETURNING id",
    ["FAKE realtime outbox", `fake-realtime-${randomUUID()}`],
  )).rows[0].id;
  const foreignTenantId = (await query<{ id: string }>(
    "INSERT INTO bms_tenants(name, slug) VALUES($1, $2) RETURNING id",
    ["FAKE realtime foreign", `fake-realtime-foreign-${randomUUID()}`],
  )).rows[0].id;
  t.after(async () => {
    await query("DELETE FROM bms_realtime_outbox WHERE tenant_id = ANY($1::uuid[])", [[tenantId, foreignTenantId]]);
    await query("DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])", [[tenantId, foreignTenantId]]);
  });

  const candidate = (eventId: string) => realtimeEvent({
    eventId,
    eventType: "dashboard.invalidated",
    tenantId,
    actorType: "SYSTEM",
    entityType: "dashboard",
    entityId: tenantId,
    aggregateVersion: 1,
    occurredAt: new Date().toISOString(),
  });

  const rolledBackId = randomUUID();
  const rollbackClient = await getClient();
  try {
    await beginTenantTx(rollbackClient, tenantId);
    await enqueueRealtimeEventInTx(rollbackClient, candidate(rolledBackId));
    await rollbackClient.query("ROLLBACK");
  } finally {
    rollbackClient.release();
  }
  assert.equal(
    Number((await query("SELECT count(*) AS n FROM bms_realtime_outbox WHERE event_id = $1", [rolledBackId])).rows[0].n),
    0,
  );

  const committedIds = [randomUUID(), randomUUID(), randomUUID()];
  const commitClient = await getClient();
  try {
    await beginTenantTx(commitClient, tenantId);
    for (const eventId of committedIds) await enqueueRealtimeEventInTx(commitClient, candidate(eventId));
    await commitClient.query("COMMIT");
  } finally {
    commitClient.release();
  }

  const foreignClient = await getClient();
  try {
    await beginTenantTx(foreignClient, foreignTenantId);
    assert.equal((await foreignClient.query("SELECT id FROM bms_realtime_outbox WHERE tenant_id = $1", [tenantId])).rowCount, 0);
    await foreignClient.query("ROLLBACK");
  } finally {
    foreignClient.release();
  }

  const [claimA, claimB] = await Promise.all([
    query("SELECT event_id, claim_token, attempts FROM bms_claim_realtime_outbox(2, 30000)"),
    query("SELECT event_id, claim_token, attempts FROM bms_claim_realtime_outbox(2, 30000)"),
  ]);
  const claimed = [...claimA.rows, ...claimB.rows];
  assert.equal(claimed.length, 3);
  assert.equal(new Set(claimed.map((row) => row.event_id)).size, 3);

  const publish = claimed[0];
  assert.equal((await query<{ ok: boolean }>(
    "SELECT bms_ack_realtime_outbox($1, $2) AS ok",
    [publish.event_id, publish.claim_token],
  )).rows[0].ok, true);
  assert.equal((await query<{ ok: boolean }>(
    "SELECT bms_ack_realtime_outbox($1, $2) AS ok",
    [publish.event_id, publish.claim_token],
  )).rows[0].ok, false);

  const retry = claimed[1];
  assert.equal((await query<{ status: string }>(
    "SELECT bms_nack_realtime_outbox($1, $2, 'REDIS_PUBLISH_FAILED', 2, 100) AS status",
    [retry.event_id, retry.claim_token],
  )).rows[0].status, "PENDING");
  await query("UPDATE bms_realtime_outbox SET available_at = now() WHERE event_id = $1", [retry.event_id]);
  const retried = (await query(
    "SELECT event_id, claim_token, attempts FROM bms_claim_realtime_outbox(1, 30000)",
  )).rows[0];
  assert.equal(retried.event_id, retry.event_id);
  assert.equal(Number(retried.attempts), 2);
  assert.equal((await query<{ status: string }>(
    "SELECT bms_nack_realtime_outbox($1, $2, 'REDIS_PUBLISH_FAILED', 2, 100) AS status",
    [retried.event_id, retried.claim_token],
  )).rows[0].status, "FAILED");

  await query(migration);
  assert.equal(
    Number((await query("SELECT count(*) AS n FROM bms_realtime_outbox WHERE tenant_id = $1", [tenantId])).rows[0].n),
    3,
  );
});
