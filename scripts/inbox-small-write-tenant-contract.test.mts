import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function harness(options: { fail?: boolean; absent?: boolean } = {}) {
  const events: string[] = [];
  const client = {
    release() { events.push("release"); },
    async query(sql: string, args: unknown[] = []) {
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        events.push(sql); return { rows: [], rowCount: 0 };
      }
      if (sql.includes("UPDATE bms_conversations") && sql.includes("ai_consecutive_askbacks")) {
        assert.deepEqual(args, ["FAKE-tenant", "FAKE-chat", false]);
        events.push("counter");
        if (options.fail) throw new Error("FAKE counter failure");
        return { rows: options.absent ? [] : [{ ai_consecutive_askbacks: 2 }], rowCount: options.absent ? 0 : 1 };
      }
      if (sql.includes("UPDATE bms_conversation_note_mentions")) {
        assert.match(sql, /tenant_id = \$1 AND mentioned_user_id = \$2/);
        assert.deepEqual(args.slice(0, 2), ["FAKE-tenant", "FAKE-user"]);
        events.push("mentions");
        if (options.fail) throw new Error("FAKE mention failure");
        return { rows: [], rowCount: options.absent ? 0 : args[2] === null ? 3 : 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { getClient: async () => client },
    "./tenant": { beginTenantTx: async (_client: unknown, tenantId: string) => {
      assert.equal(tenantId, "FAKE-tenant"); events.push("begin");
    } },
    "@/lib/pubsub": { pubsub: { publish: async () => undefined } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "@/lib/notifications/service": {}, "./channels": {}, "./channelHealth": {},
    "./coupons": {}, "./aiQuality": {}, "./customers": {},
    "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
    "./failureAlert": {}, "./inboxMedia": {},
  });
  return { inbox, events };
}

test("AI handoff counter and self mention reads write under the tenant role", async () => {
  const counter = harness();
  assert.equal(await counter.inbox.bumpAiTurnCounter("FAKE-tenant", "FAKE-chat", false), 2);
  assert.deepEqual(counter.events, ["begin", "counter", "COMMIT", "release"]);

  const one = harness();
  assert.equal(await one.inbox.markMentionRead("FAKE-tenant", "FAKE-user", "41"), true);
  assert.deepEqual(one.events, ["begin", "mentions", "COMMIT", "release"]);
  const all = harness();
  assert.equal(await all.inbox.markAllMentionsRead("FAKE-tenant", "FAKE-user"), 3);
  assert.deepEqual(all.events, ["begin", "mentions", "COMMIT", "release"]);
});

test("missing mention or conversation does not report a changed row", async () => {
  const h = harness({ absent: true });
  assert.equal(await h.inbox.bumpAiTurnCounter("FAKE-tenant", "FAKE-chat", false), 0);
  assert.equal(await h.inbox.markMentionRead("FAKE-tenant", "FAKE-user", "41"), false);
});

test("counter and mention update failures roll back", async () => {
  const counter = harness({ fail: true });
  await assert.rejects(counter.inbox.bumpAiTurnCounter("FAKE-tenant", "FAKE-chat", false),
    /FAKE counter failure/);
  assert.deepEqual(counter.events.slice(-2), ["ROLLBACK", "release"]);
  const mention = harness({ fail: true });
  await assert.rejects(mention.inbox.markMentionRead("FAKE-tenant", "FAKE-user", "41"),
    /FAKE mention failure/);
  assert.deepEqual(mention.events.slice(-2), ["ROLLBACK", "release"]);
});
