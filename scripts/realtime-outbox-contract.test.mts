import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { makeRealtimeEventFixture, topicForEvent } from "../packages/realtime/src/index.ts";
import {
  runRealtimeOutboxDispatcher,
  type ClaimedRealtimeEvent,
  type RealtimeOutboxRepository,
} from "../apps/web/lib/bms/realtimeDispatcher.ts";

const migration = readFileSync(
  new URL("../db/migrations/9.70__bms_realtime_outbox.sql", import.meta.url),
  "utf8",
);
const outboxService = readFileSync(
  new URL("../apps/web/lib/bms/realtimeOutbox.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../apps/web/app/api/bms/realtime/dispatch/route.ts", import.meta.url),
  "utf8",
);

test("migration installs a fail-closed tenant outbox and narrow dispatcher functions", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_realtime_outbox/);
  assert.match(migration, /ALTER TABLE bms_realtime_outbox FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_id = NULLIF\(current_setting\('bms\.tenant_id', true\), ''\)::uuid/);
  assert.doesNotMatch(migration, /COALESCE\(NULLIF\(current_setting\('bms\.tenant_id'/);
  assert.match(migration, /GRANT SELECT, INSERT ON bms_realtime_outbox TO bms_app/);
  assert.match(migration, /CREATE ROLE bms_realtime_dispatcher NOLOGIN BYPASSRLS/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /SET search_path = pg_catalog, public/g);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.bms_claim_realtime_outbox[\s\S]*FROM PUBLIC/);
  assert.match(migration, /CHECK \([\s\S]*pg_column_size\(safe_payload\) <= 16384/);
  assert.match(migration, /status IN \('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'\)/);
});

test("business helper inserts with its caller-owned PoolClient and never publishes", () => {
  assert.match(outboxService, /enqueueRealtimeEventInTx\(\s*client: PoolClient/);
  assert.match(outboxService, /await client\.query/);
  assert.match(outboxService, /INSERT INTO bms_realtime_outbox/);
  assert.match(outboxService, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.doesNotMatch(outboxService, /pubsub|publishRealtimeEvent/);
});

test("dispatcher acknowledges success and schedules a bounded retry without leaking error text", async () => {
  const first: ClaimedRealtimeEvent = {
    claimToken: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    attempts: 1,
    event: makeRealtimeEventFixture("order.status_changed", {
      locationId: "44444444-4444-4444-8444-444444444444",
    }),
  };
  const second: ClaimedRealtimeEvent = {
    claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    attempts: 2,
    event: makeRealtimeEventFixture("payment.confirmed", {
      eventId: "77777777-7777-4777-8777-777777777777",
      entityType: "payment",
      locationId: "44444444-4444-4444-8444-444444444444",
    }),
  };
  const acked: string[] = [];
  const nacked: Array<[string, string]> = [];
  const repository: RealtimeOutboxRepository = {
    async claim() { return [first, second]; },
    async ack(eventId) { acked.push(eventId); return true; },
    async nack(eventId, _claimToken, errorCode) { nacked.push([eventId, errorCode]); return "PENDING"; },
    async cleanup() { return 0; },
  };
  const topics: string[] = [];
  const publisher = {
    async publish(topic: string) {
      topics.push(topic);
      if (topics.length === 2) throw new Error("redis://user:password@example.invalid secret detail");
      return 1;
    },
  };
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const result = await runRealtimeOutboxDispatcher({
      repository,
      publisher,
      batchSize: 10,
      leaseMs: 30_000,
      maxAttempts: 12,
      baseRetryMs: 500,
    });
    assert.deepEqual(result, { claimed: 2, published: 1, retried: 1, failed: 0, leaseLost: 0 });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(acked, [first.event.eventId]);
  assert.deepEqual(nacked, [[second.event.eventId, "REDIS_PUBLISH_FAILED"]]);
  assert.deepEqual(topics, [topicForEvent(first.event), topicForEvent(second.event)]);
  assert.doesNotMatch(JSON.stringify(logged), /password|example\.invalid|secret detail/);
});

test("dispatcher reports an acknowledgement race as lease loss", async () => {
  const claimed: ClaimedRealtimeEvent = {
    claimToken: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    attempts: 1,
    event: makeRealtimeEventFixture(),
  };
  const repository: RealtimeOutboxRepository = {
    async claim() { return [claimed]; },
    async ack() { return false; },
    async nack() { return null; },
    async cleanup() { return 0; },
  };
  const result = await runRealtimeOutboxDispatcher({
    repository,
    publisher: { async publish() { return 1; } },
    batchSize: 1,
    leaseMs: 30_000,
    maxAttempts: 12,
    baseRetryMs: 500,
  });
  assert.deepEqual(result, { claimed: 1, published: 0, retried: 0, failed: 0, leaseLost: 1 });
});

test("dispatch endpoint fails closed through the shared cron guard and records the run", () => {
  assert.match(route, /authorizeCronRequest\(req\)/);
  assert.match(route, /recordJobRun\("realtime-outbox-dispatch", "cron"/);
  assert.match(route, /dispatchRealtimeOutboxBatch\(\)/);
});
