import assert from "node:assert/strict";
import test from "node:test";

import { loadWithStubs } from "./testing/webhookHarness.mts";
import * as identity from "../apps/web/lib/bms/lineBotIdentity.ts";

const tenantId = "FAKE-tenant";
const userId = "U0123456789abcdef0123456789abcdef";
const token = "FAKE-line-token";

function harness(options: {
  fresh?: boolean;
  recentError?: boolean;
  response?: { ok: boolean; status: number; body: string };
  candidates?: Array<{ tenant_id: string; external_ref: string }>;
} = {}) {
  const calls = {
    sql: [] as Array<{ sql: string; args: any[] }>,
    fetches: [] as Array<{ url: string; init: any }>,
    transactions: [] as string[],
    resolved: [] as any[],
    notifications: [] as any[],
    releases: 0,
  };
  const storedToken = "FAKE-encrypted-line-token";
  const client = {
    release() { calls.releases += 1; },
    query: async (sql: string, args: any[] = []) => {
      calls.sql.push({ sql, args });
      if (sql.includes("UPDATE bms_conversations")) return { rows: [{ id: "conversation-1" }], rowCount: 1 };
      if (sql.includes("profile_error_at = now()")) return { rows: [{ id: "conversation-1" }], rowCount: 1 };
      if (sql.includes("UPDATE bms_tenant_channels")) {
        return { rows: [{ extra: JSON.parse(args[2]) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const profile = loadWithStubs("apps/web/lib/bms/lineProfile.ts", {
    "@/lib/db": {
      getClient: async () => client,
      query: async (sql: string, args: any[] = []) => {
        calls.sql.push({ sql, args });
        if (sql.includes("FROM bms_customer_identities ci")) return { rows: options.candidates ?? [] };
        if (sql.includes("SELECT extra, access_token")) return { rows: [{ extra: {}, access_token: storedToken }] };
        return { rows: [{
          profile_synced_at: options.fresh ? new Date() : null,
          profile_error_at: options.recentError ? new Date() : null,
        }] };
      },
    },
    "./tenant": { beginTenantTx: async (_client: any, scopedTenant: string) => calls.transactions.push(scopedTenant) },
    "./crypto": { decryptSecret: () => token },
    "./lineBotIdentity": identity,
    "./channels": { getChannel: async () => ({ active: true, access_token: token }) },
    "./customers": { resolveOrCreateCustomer: async (...args: any[]) => {
      calls.resolved.push(args);
      return "customer-1";
    } },
    "./inbox": { notifyInboxConversationChanged: (...args: any[]) => calls.notifications.push(args) },
  }, async (url: string, init: any) => {
    calls.fetches.push({ url, init });
    if (url.endsWith("/v2/bot/info")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({
        basicId: "@fake-shop", displayName: "FAKE Shop", pictureUrl: "https://example.test/bot.jpg",
      }) };
    }
    const response = options.response ?? {
      ok: true,
      status: 200,
      body: JSON.stringify({
        userId,
        displayName: "สมหญิง ใจดี",
        pictureUrl: "https://example.test/line.jpg",
        statusMessage: "สวัสดี",
        language: "th",
      }),
    };
    return { ok: response.ok, status: response.status, text: async () => response.body };
  });
  return { profile, calls };
}

test("LINE user profile uses a Bearer header and writes only cached identity metadata in a tenant transaction", async () => {
  const { profile, calls } = harness();
  assert.deepEqual(await profile.syncLineUserProfile(tenantId, userId, token), {
    ok: true, conversationIds: ["conversation-1"],
  });
  assert.equal(calls.fetches.length, 1);
  assert.equal(calls.fetches[0].url, `https://api.line.me/v2/bot/profile/${userId}`);
  assert.equal(calls.fetches[0].init.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(calls.transactions, [tenantId]);
  assert.equal(calls.resolved[0][1], tenantId);
  assert.equal(calls.resolved[0][2], "line");
  assert.equal(calls.resolved[0][3], userId);
  const update = calls.sql.find((call) => call.sql.includes("profile_synced_at = now()"));
  assert.ok(update);
  assert.deepEqual(update.args, [tenantId, userId, "สมหญิง ใจดี", "https://example.test/line.jpg", "สวัสดี", "th"]);
  assert.match(update.sql, /display_name = COALESCE\(\$3, display_name\)/);
  assert.equal(calls.sql.at(-1)?.sql, "COMMIT");
});

test("LINE profile refresh backs off after errors and rejects mismatched or empty provider identities", async () => {
  const recent = harness({ recentError: true });
  assert.deepEqual(await recent.profile.syncLineUserProfile(tenantId, userId, token), {
    ok: false, skipped: "recent-error", conversationIds: [],
  });
  assert.equal(recent.calls.fetches.length, 0);

  const invalidUser = harness();
  assert.equal((await invalidUser.profile.syncLineUserProfile(tenantId, "diagnostic:line", token)).skipped, "invalid-user");
  assert.equal(invalidUser.calls.fetches.length, 0);

  for (const [body, error] of [
    [JSON.stringify({ userId: "Uffffffffffffffffffffffffffffffff", displayName: "Wrong" }), "LINE_PROFILE_ID_MISMATCH"],
    [JSON.stringify({ userId, pictureUrl: "http://example.test/not-https.jpg" }), "LINE_PROFILE_EMPTY"],
  ]) {
    const invalid = harness({ response: { ok: true, status: 200, body } });
    const result = await invalid.profile.syncLineUserProfile(tenantId, userId, token);
    assert.equal(result.ok, false);
    assert.equal(result.error, error);
    assert.ok(invalid.calls.sql.some((call) => call.sql.includes("profile_error_at = now()")));
    assert.deepEqual(invalid.calls.transactions, [tenantId]);
    assert.equal(invalid.calls.sql.at(-1)?.sql, "COMMIT");
  }
});

test("scheduled LINE backfill refreshes stale customer and OA profiles and publishes Inbox changes", async () => {
  const { profile, calls } = harness({ candidates: [{ tenant_id: tenantId, external_ref: userId }] });
  assert.deepEqual(await profile.runLineProfileBackfill(20), {
    attempted: 1, updated: 1, failed: 0, botProfiles: 1,
  });
  assert.deepEqual(calls.notifications, [[tenantId, "conversation-1", "CONVERSATION_CHANGED"]]);
  assert.equal(calls.fetches.filter((call) => call.url.endsWith("/v2/bot/info")).length, 1);
});
