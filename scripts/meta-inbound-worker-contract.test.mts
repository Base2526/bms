import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const job = { id: "job-1", tenantId: "tenant-1", channel: "facebook", eventId: "mid-1",
  externalAccountId: "123456", customerRef: "998877", messageText: "hello", attachments: [], attempts: 2 };

function harness(options: { claimed?: number; active?: boolean; account?: string; expired?: boolean } = {}) {
  const calls = { pipeline: 0, sends: 0, incidents: [] as any[], sql: [] as string[] };
  const client = { release() {}, query: async (sql: string, args: any[]) => {
    calls.sql.push(sql);
    if (sql.includes("SET effects_started_at=now()")) {
      assert.equal(args[2], job.attempts);
      assert.match(sql, /attempts=\$3/);
      assert.match(sql, /lease_until>now\(\)/);
      assert.match(sql, /effects_started_at IS NULL/);
      return { rows: [], rowCount: options.claimed ?? 1 };
    }
    return { rows: [], rowCount: options.expired && sql.includes("RETURNING id") ? 1 : 0 };
  } };
  const noop = async () => {};
  const worker = loadWithStubs("apps/web/lib/bms/metaInboundJobs.ts", {
    "@/lib/db": { getClient: async () => client, query: async (sql: string) => {
      calls.sql.push(sql);
      assert.doesNotMatch(sql, /effects_started_at IS NULL/,
        "fleet discovery must include expired jobs whose effects already started");
      return { rows: [{ tenant_id: job.tenantId }] };
    } },
    "./tenant": { beginTenantTx: noop },
    "./channels": { getChannel: async () => ({ active: options.active ?? true, external_account_id: options.account ?? job.externalAccountId }) },
    "./pipeline": { runPipeline: async () => { calls.pipeline++; return { reply: "hello" }; } },
    "./inbox": { logConversation: noop, logInboundMessage: noop, deliverToChannel: async () => { calls.sends++; return true; } },
    "./customerAnswerEvidence": { fallbackEvidenceQuality: () => ({}) },
    "./channelHealth": { recordInboundEvent: noop },
    "./failureAlert": { reportBmsFailure: async (incident: any) => { calls.incidents.push(incident); } },
  });
  return { worker, calls };
}

test("stale or already-spent worker lease cannot run AI or send", async () => {
  const { worker, calls } = harness({ claimed: 0 });
  await assert.rejects(worker.processMetaInboundJob(job), /META_INBOUND_LEASE_LOST/);
  assert.equal(calls.pipeline, 0);
  assert.equal(calls.sends, 0);
  assert.ok(calls.sql.includes("ROLLBACK"));
});

test("disabled or rebound account blocks queued customer actions", async () => {
  for (const options of [{ active: false }, { account: "654321" }]) {
    const { worker, calls } = harness(options);
    await assert.rejects(worker.processMetaInboundJob(job), /META_CHANNEL_DISABLED_OR_REBOUND/);
    assert.equal(calls.pipeline, 0);
    assert.equal(calls.sends, 0);
  }
});

test("valid lease processes one customer turn and reply", async () => {
  const { worker, calls } = harness();
  await worker.processMetaInboundJob(job);
  assert.equal(calls.pipeline, 1);
  assert.equal(calls.sends, 1);
});

test("cron finds and reports expired uncertain jobs even with no pending work", async () => {
  const { worker, calls } = harness({ expired: true });
  await worker.runMetaInboundBatch(10);
  assert.equal(calls.pipeline, 0);
  assert.equal(calls.incidents.length, 1);
  assert.equal(calls.incidents[0].tenantId, job.tenantId);
});
