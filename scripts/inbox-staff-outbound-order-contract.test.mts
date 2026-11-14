import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function harness(options: { deny?: boolean; insertFails?: boolean; finalFails?: boolean; providerThrows?: boolean;
  existingFollowup?: boolean; existingFollowupStatus?: string } = {}) {
  const events: string[] = [];
  const initial = { release() {}, query: async (sql: string, args: any[] = []) => {
    if (sql.includes("FROM bms_conversations") && sql.includes("FOR UPDATE")) {
      events.push(sql.includes("FROM bms_conversations c") ? `scope:${args[2]}` : "conversation");
      return { rows: options.deny ? [] : [{ channel: "line", customer_ref: "real-customer", customer_id: null }], rowCount: options.deny ? 0 : 1 };
    }
    if (sql.includes("FROM bms_messages") && sql.includes("meta->>'jobId'")) {
      events.push(`followup-claim:${args[2]}:${args[3]}`);
      return { rows: options.existingFollowup ? [{ id: "41", body: "FAKE original text",
        meta: { status: options.existingFollowupStatus ?? "PENDING", delivered: false } }] : [],
        rowCount: options.existingFollowup ? 1 : 0 };
    }
    if (sql.includes("INSERT INTO bms_messages")) {
      events.push(`draft:${JSON.parse(args[sql.includes("'ai'") ? 3 : 4]).status}`);
      if (options.insertFails) throw new Error("FAKE insert failed");
      return { rows: [{ id: "42" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO bms_audit_log")) events.push("audit");
    if (sql === "COMMIT") events.push("commit-draft");
    if (sql === "ROLLBACK") events.push("rollback-draft");
    return { rows: [], rowCount: 1 };
  } };
  const final = { release() {}, query: async (sql: string, args: any[] = []) => {
    if (sql.includes("UPDATE bms_messages SET meta")) {
      events.push(`final:${JSON.parse(args[2]).status}`);
      if (options.finalFails) throw new Error("FAKE final update failed");
    }
    if (sql === "COMMIT") events.push("commit-final");
    if (sql === "ROLLBACK") events.push("rollback-final");
    return { rows: [], rowCount: 1 };
  } };
  let clients = 0;
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { getClient: async () => clients++ === 0 ? initial : final },
    "@/lib/pubsub": { pubsub: { publish: async () => {} } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "./channels": { getChannel: async () => ({ active: true, access_token: "FAKE-token" }) },
    "./channelHealth": { recordOutboundSuccess: async () => {} },
    "@/lib/notifications/service": {},
    "./coupons": { couponCodeFromShareText: () => null },
    "./tenant": { beginTenantTx: async () => { events.push("begin"); } },
    "./aiQuality": {}, "./customers": {}, "./customerAnswerEvidence": {},
    "./answerEvidenceStore": {}, "./failureAlert": {},
    "./inboxMedia": { outboundInboxMediaUrl: async (_tenant: string, url: string) => { events.push("media"); return url; } },
  }, async () => { events.push("provider"); if (options.providerThrows) throw new Error("FAKE provider timeout");
    return { ok: true }; });
  return { inbox, events };
}

test("staff reply commits tenant-scoped draft and audit before any provider call", async () => {
  const h = harness();
  const result = await h.inbox.sendStaffMessage("FAKE-tenant", "FAKE-conversation", "hello", "FAKE-actor", null,
    { restrictedUserId: "FAKE-sales" });
  assert.deepEqual(result, { status: "SENT", delivered: true, messageId: "42" });
  assert.deepEqual(h.events, ["begin", "scope:FAKE-sales", "draft:PENDING", "audit", "commit-draft",
    "provider", "begin", "final:SENT", "commit-final"]);
});

test("denial or draft persistence failure cannot call provider", async () => {
  const denied = harness({ deny: true });
  assert.deepEqual(await denied.inbox.sendStaffMessage("FAKE-tenant", "FAKE-conversation", "hello", "FAKE-actor",
    { url: "https://example.invalid/FAKE-secret.png", mimeType: "image/png" },
    { restrictedUserId: "FAKE-sales" }), { status: "NOT_FOUND" });
  assert.equal(denied.events.includes("provider"), false);
  assert.equal(denied.events.includes("media"), false);
  const failed = harness({ insertFails: true });
  await assert.rejects(failed.inbox.sendStaffMessage("FAKE-tenant", "FAKE-conversation", "hello", "FAKE-actor"),
    /FAKE insert failed/);
  assert.ok(failed.events.includes("rollback-draft"));
  assert.equal(failed.events.includes("provider"), false);
});

test("provider acceptance with a failed final status write keeps the committed draft", async () => {
  const h = harness({ finalFails: true });
  assert.deepEqual(await h.inbox.sendStaffMessage("FAKE-tenant", "FAKE-conversation", "hello", "FAKE-actor"),
    { status: "SENT", delivered: true, messageId: "42" });
  assert.ok(h.events.indexOf("commit-draft") < h.events.indexOf("provider"));
  assert.ok(h.events.includes("rollback-final"));
  assert.equal(h.events.includes("commit-final"), false);
});

test("transport timeout keeps the committed draft PENDING instead of enabling resend", async () => {
  const h = harness({ providerThrows: true });
  assert.deepEqual(await h.inbox.sendStaffMessage("FAKE-tenant", "FAKE-conversation", "hello", "FAKE-actor"),
    { status: "SENT", delivered: false, uncertain: true, messageId: "42" });
  assert.ok(h.events.indexOf("commit-draft") < h.events.indexOf("provider"));
  assert.ok(h.events.includes("final:PENDING"));
  assert.equal(h.events.includes("final:FAILED"), false);
});

test("follow-up and pharmacy intake also persist before channel delivery", async () => {
  for (const kind of ["followup", "pharmacy"] as const) {
    const h = harness();
    const result = kind === "followup"
      ? await h.inbox.sendFollowupMessage("FAKE-tenant", "FAKE-conversation", "hello",
        { ruleId: "FAKE-rule", jobId: "FAKE-job", retryIndex: 0, goal: "FAKE-goal" })
      : await h.inbox.sendPharmacyIntakeMessage("FAKE-tenant", "FAKE-conversation", "hello",
        { kind: "QUESTION", caseId: "FAKE-case" });
    assert.deepEqual(result, { status: "SENT", delivered: true, messageId: "42",
      ...(kind === "followup" || kind === "pharmacy" ? { messageBody: "hello" } : {}) });
    assert.deepEqual(h.events, ["begin", "conversation", ...(kind === "followup" ? ["followup-claim:FAKE-job:0"] : []), "draft:PENDING", "commit-draft",
      "provider", "begin", "final:SENT", "commit-final"]);
  }
});

test("reclaimed follow-up round reuses its durable message and never sends twice", async () => {
  const h = harness({ existingFollowup: true });
  assert.deepEqual(await h.inbox.sendFollowupMessage("FAKE-tenant", "FAKE-conversation", "hello",
    { ruleId: "FAKE-rule", jobId: "FAKE-job", retryIndex: 0, goal: "FAKE-goal" }),
    { status: "SENT", delivered: false, uncertain: true, messageId: "41", messageBody: "FAKE original text" });
  assert.deepEqual(h.events, ["begin", "conversation", "followup-claim:FAKE-job:0", "commit-draft"]);
});

test("reclaimed partial follow-up stays non-retryable and keeps its original body", async () => {
  const h = harness({ existingFollowup: true, existingFollowupStatus: "PARTIAL" });
  assert.deepEqual(await h.inbox.sendFollowupMessage("FAKE-tenant", "FAKE-conversation", "new draft",
    { ruleId: "FAKE-rule", jobId: "FAKE-job", retryIndex: 0, goal: "FAKE-goal" }),
    { status: "SENT", delivered: false, partial: true, messageId: "41", messageBody: "FAKE original text" });
  assert.equal(h.events.includes("provider"), false);
});
