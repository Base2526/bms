import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const tenantId = "FAKE-tenant";
const job = { job_id: "FAKE-job", tenant_id: tenantId, conversation_id: "FAKE-conversation",
  rule_id: "FAKE-rule", retry_count: 0, job_created_at: new Date() };
const rule = { id: "FAKE-rule", tenant_id: tenantId, intent: "ORDER", enabled: true, priority: 0,
  delay_minutes: 30, max_retry: 2, stop_conditions: [], message_goal: "CLOSE_SALE",
  business_hours_only: false, template: "FAKE follow-up", created_at: new Date(), updated_at: new Date() };

function harness(options: { denied?: boolean; auditFails?: boolean; staleOutcome?: boolean;
  uncertain?: boolean; deliveryFails?: boolean; existingJob?: boolean; customerReplied?: boolean;
  candidate?: boolean; globalTenants?: string[] } = {}) {
  const events: string[] = [];
  let sends = 0;
  const client = () => ({ release() { events.push("release"); }, query: async (sql: string, args: any[] = []) => {
    if (sql.includes("UPDATE bms_followup_jobs j")) {
      assert.match(sql, /j\.tenant_id=\$1/);
      assert.match(sql, /tenant_id=\$1 AND status='PENDING'/);
      assert.match(sql, /FOR UPDATE SKIP LOCKED/);
      events.push(`claim:${args[0]}`);
      return { rows: options.denied ? [] : [job], rowCount: options.denied ? 0 : 1 };
    }
    if (sql.includes("UPDATE bms_followup_jobs") && sql.includes("retry_count=$4")) {
      events.push(`outcome:${args[0]}:${args[6]}:${args[4]}`);
      return { rows: options.staleOutcome ? [] : [{ id: job.job_id }], rowCount: options.staleOutcome ? 0 : 1 };
    }
    if (sql.includes("INSERT INTO bms_followup_jobs")) {
      assert.match(sql, /NOT EXISTS \(SELECT 1 FROM bms_followup_jobs/);
      assert.match(sql, /created_at >= \$6::timestamptz/);
      assert.equal(new Date(args[5]).getTime(), new Date(0).getTime());
      events.push(`schedule:${args[0]}`);
      return { rows: options.existingJob ? [] : [{ id: job.job_id }], rowCount: options.existingJob ? 0 : 1 };
    }
    if (sql.includes("INSERT INTO bms_followup_history")) events.push(`history:${args[0]}:${args[6]}`);
    if (sql.includes("INSERT INTO bms_audit_log")) {
      events.push(`audit:${args[0]}`);
      if (options.auditFails) throw new Error("FAKE audit unavailable");
    }
    if (sql === "COMMIT" || sql === "ROLLBACK") events.push(sql);
    return { rows: [], rowCount: 1 };
  } });
  const service = loadWithStubs("apps/web/lib/bms/followups.ts", {
    "@/lib/db": { getClient: async () => client(), query: async (sql: string, args: any[] = []) => {
      if (sql.includes("SELECT c.id, c.tenant_id")) {
        assert.match(sql, /JOIN LATERAL/);
        assert.match(sql, /m\.direction='IN'/);
        assert.match(sql, /NOT EXISTS \(SELECT 1 FROM bms_followup_jobs j/);
        assert.match(sql, /j\.created_at >= inbound\.last_customer_at/);
        return { rows: options.candidate ? [{ id: job.conversation_id, tenant_id: tenantId,
          last_message_at: new Date(0), last_customer_at: new Date(0) }] : [],
          rowCount: options.candidate ? 1 : 0 };
      }
      if (sql.includes("SELECT intent, detected_at FROM bms_conversation_intents"))
        return { rows: [{ intent: "ORDER", detected_at: new Date() }], rowCount: 1 };
      if (sql.includes("SELECT * FROM bms_followup_rules") && sql.includes("intent = $2"))
        return { rows: [rule], rowCount: 1 };
      if (sql.includes("SELECT tenant_id FROM bms_followup_jobs"))
        return { rows: (options.globalTenants ?? []).map(tenant_id => ({ tenant_id })),
          rowCount: options.globalTenants?.length ?? 0 };
      if (sql.includes("SELECT * FROM bms_followup_rules WHERE id")) {
        assert.deepEqual(args, [job.rule_id, tenantId]);
        return { rows: [rule], rowCount: 1 };
      }
      if (sql.includes("FROM bms_conversations") && sql.includes("last_sender_type")) {
        assert.deepEqual(args, [job.conversation_id, tenantId]);
        assert.match(sql, /m\.direction='IN'/);
        return { rows: [{ status: "OPEN", last_sender_type: "ai",
          last_message_at: options.customerReplied ? new Date(Date.now() + 60_000) : new Date(0),
          last_customer_at: options.customerReplied ? new Date(Date.now() + 60_000) : new Date(0),
          customer_id: null }], rowCount: 1 };
      }
      if (sql.includes("FROM bms_followup_history")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected global query: ${sql}`);
    } },
    "./tenant": { beginTenantTx: async (_client: any, scoped: string) => { events.push(`begin:${scoped}`); } },
    "./inbox": { getConversation: async () => ({ customer_id: null }), listMessages: async () => [],
      sendFollowupMessage: async () => { sends++; events.push("provider");
        return { status: "SENT", delivered: !options.uncertain && !options.deliveryFails,
          uncertain: Boolean(options.uncertain), messageBody: "FAKE follow-up" }; } },
    "./storeProfile": { getStoreProfile: async () => ({}) },
    "./ai": { resolveAiCredentials: async () => null },
    "./aiMetering": {}, "./aiUsage": {}, "./aiProvider": {}, "./customer360": {}, "./shopArchetypes": {},
  });
  return { service, events, sends: () => sends };
}

test("manual scheduler claims only its tenant and commits outcome, history and audit together", async () => {
  const h = harness();
  const result = await h.service.runDueFollowups(tenantId);
  assert.deepEqual(result, { scanned: 1, sent: 1, skipped: 0, failed: 0 });
  assert.deepEqual(h.events, ["begin:FAKE-tenant", "claim:FAKE-tenant", "COMMIT", "release",
    "provider", "begin:FAKE-tenant", "outcome:FAKE-tenant:sent:false", "history:FAKE-tenant:FAKE follow-up",
    "audit:FAKE-tenant", "COMMIT", "release"]);
});

test("a stale outcome cannot add history or audit, and a denied claim never sends", async () => {
  const stale = harness({ staleOutcome: true });
  assert.deepEqual(await stale.service.runDueFollowups(tenantId),
    { scanned: 1, sent: 0, skipped: 0, failed: 0 });
  assert.equal(stale.events.some(event => event.startsWith("history:")), false);
  assert.equal(stale.events.some(event => event.startsWith("audit:")), false);
  const denied = harness({ denied: true });
  assert.deepEqual(await denied.service.runDueFollowups(tenantId),
    { scanned: 0, sent: 0, skipped: 0, failed: 0 });
  assert.equal(denied.sends(), 0);
});

test("fleet cron discovers due tenants but claims each in its own tenant transaction", async () => {
  const h = harness({ denied: true, globalTenants: ["FAKE-one", "FAKE-two"] });
  assert.deepEqual(await h.service.runDueFollowups(),
    { scanned: 0, sent: 0, skipped: 0, failed: 0 });
  assert.deepEqual(h.events, ["begin:FAKE-one", "claim:FAKE-one", "COMMIT", "release",
    "begin:FAKE-two", "claim:FAKE-two", "COMMIT", "release"]);
});

test("an audit failure rolls outcome and history back after the send claim", async () => {
  const h = harness({ auditFails: true });
  await assert.rejects(h.service.runDueFollowups(tenantId), /FAKE audit unavailable/);
  assert.equal(h.sends(), 1);
  assert.equal(h.events.filter(event => event === "COMMIT").length, 1);
  assert.ok(h.events.filter(event => event === "ROLLBACK").length >= 1);
});

test("uncertain delivery records review state and stops automatic follow-up retries", async () => {
  const h = harness({ uncertain: true });
  await h.service.runDueFollowups(tenantId);
  assert.ok(h.events.includes("outcome:FAKE-tenant:delivery_unknown:true"));
});

test("confirmed delivery failure is failed work, never a sent retry round", async () => {
  const h = harness({ deliveryFails: true });
  assert.deepEqual(await h.service.runDueFollowups(tenantId),
    { scanned: 1, sent: 0, skipped: 0, failed: 1 });
  assert.ok(h.events.includes("audit:FAKE-tenant"));
  assert.ok(h.events.some(event => event.startsWith("history:FAKE-tenant:")));
  assert.equal(h.events.some(event => event.includes("outcome:FAKE-tenant:sent")), false);
});

test("a finished job is not rescheduled for the same customer message", async () => {
  const h = harness({ candidate: true, existingJob: true, denied: true });
  assert.deepEqual(await h.service.runDueFollowups(tenantId),
    { scanned: 0, sent: 0, skipped: 0, failed: 0 });
  assert.ok(h.events.includes("schedule:FAKE-tenant"));
  assert.equal(h.sends(), 0);
});

test("a new inbound message can open another follow-up round", async () => {
  const h = harness({ candidate: true, denied: true });
  assert.deepEqual(await h.service.runDueFollowups(tenantId),
    { scanned: 0, sent: 0, skipped: 0, failed: 0 });
  assert.ok(h.events.includes("schedule:FAKE-tenant"));
});

test("a new customer message stops the old job even after AI has replied", async () => {
  const h = harness({ customerReplied: true });
  assert.deepEqual(await h.service.runDueFollowups(tenantId),
    { scanned: 1, sent: 0, skipped: 1, failed: 0 });
  assert.equal(h.sends(), 0);
  assert.ok(h.events.includes("audit:FAKE-tenant"));
});
