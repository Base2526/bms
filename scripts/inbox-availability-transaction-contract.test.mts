import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function serviceHarness(options: { failed?: boolean; missing?: boolean } = {}) {
  const events: string[] = [];
  const client = {
    release() { events.push("release"); },
    async query(sql: string, args: unknown[] = []) {
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        events.push(sql); return { rows: [], rowCount: 0 };
      }
      assert.match(sql, /bms_set_own_inbox_availability/);
      assert.deepEqual(args, ["FAKE-tenant", "FAKE-user", true]);
      events.push("set-own-availability");
      if (options.failed) throw new Error("FAKE function failure");
      return { rows: [{ changed: !options.missing }], rowCount: 1 };
    },
  };
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { getClient: async () => client },
    "./tenant": { beginTenantTx: async (_client: unknown, tenantId: string,
      opts: { editorId: string }) => {
      assert.equal(tenantId, "FAKE-tenant");
      assert.equal(opts.editorId, "FAKE-user");
      events.push("begin");
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

test("availability updates only the authenticated tenant user in a tenant transaction", async () => {
  const h = serviceHarness();
  assert.equal(await h.inbox.setUserAvailability("FAKE-tenant", "FAKE-user", true), true);
  assert.deepEqual(h.events, ["begin", "set-own-availability", "COMMIT", "release"]);
  const missing = serviceHarness({ missing: true });
  assert.equal(await missing.inbox.setUserAvailability("FAKE-tenant", "FAKE-user", true), false);
});

test("availability function failure rolls back", async () => {
  const h = serviceHarness({ failed: true });
  await assert.rejects(h.inbox.setUserAvailability("FAKE-tenant", "FAKE-user", true),
    /FAKE function failure/);
  assert.deepEqual(h.events, ["begin", "set-own-availability", "ROLLBACK", "release"]);
});

test("GraphQL availability mutation requires Inbox permission and derives actor and tenant", async () => {
  for (const allowed of [false, true]) {
    const calls: unknown[][] = [];
    const resolvers = loadWithStubs("apps/web/graphql/bmsInbox.ts", {
      "@/lib/bms/inboxMedia": { safeInboxAttachmentUrl: (url: unknown) => typeof url === "string" ? url : null },
      "@/lib/bms/inbox": { setUserAvailability: async (...args: unknown[]) => {
        calls.push(args); return true;
      } },
      "@/lib/bms/permissions": { requirePermission: async (_ctx: unknown, permission: string) => {
        assert.equal(permission, "inbox.view");
        if (!allowed) throw new Error("FORBIDDEN");
      } },
      "@/lib/bms/tenant": { getTenantId: () => "FAKE-tenant" },
      "@/lib/auth": { requireAuth: () => ({ author_id: "FAKE-user", scope: "admin" }) },
      "@/lib/bms/platform": { isPlatformAdmin: async () => false },
      "graphql/error": { GraphQLError: Error },
    }).bmsInboxResolvers;
    if (allowed) {
      assert.equal(await resolvers.Mutation.bmsSetMyAvailability(null, { available: true }, {}), true);
      assert.deepEqual(calls, [["FAKE-tenant", "FAKE-user", true]]);
    } else {
      await assert.rejects(resolvers.Mutation.bmsSetMyAvailability(null, { available: true }, {}), /FORBIDDEN/);
      assert.deepEqual(calls, []);
    }
  }
});

test("auto-assignment chooses only an available tenant staff account that can view and reply", async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { query: async (sql: string, args: unknown[]) => {
      calls.push({ sql, args });
      return args[1] === "Manager"
        ? { rows: [{ id: "FAKE-manager" }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    } },
    "./tenant": {},
    "@/lib/pubsub": { pubsub: { publish: async () => undefined } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "@/lib/notifications/service": {}, "./channels": {}, "./channelHealth": {},
    "./coupons": {}, "./aiQuality": {}, "./customers": {},
    "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
    "./failureAlert": {}, "./inboxMedia": {},
  });
  assert.equal(await inbox.pickAutoAssignee("FAKE-tenant"), "FAKE-manager");
  assert.deepEqual(calls.map(c => c.args[1]), ["Sales", "Manager"]);
  for (const call of calls) {
    assert.deepEqual(call.args, ["FAKE-tenant", call.args[1], [], ["inbox.view", "inbox.reply"]]);
    assert.match(call.sql, /u\.tenant_id = \$1/);
    assert.match(call.sql, /u\.pos_only = FALSE AND u\.is_platform_admin = FALSE/);
    assert.match(call.sql, /bms_role_permissions/);
  }
});
