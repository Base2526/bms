import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const tenantId = "FAKE-tenant";
const psid = "28157839197224188";
const token = "FAKE-page-token";

function harness(options: {
  fresh?: boolean;
  recentError?: boolean;
  response?: { ok: boolean; status: number; body: string };
  pageResponse?: { ok: boolean; status: number; body: string };
  resolveFailure?: boolean;
  backfillCandidates?: Array<{ tenant_id: string; external_ref: string }>;
} = {}) {
  const calls = { sql: [] as Array<{ sql: string; args: any[] }>, fetches: [] as any[],
    transactions: [] as string[], resolved: [] as any[], notifications: [] as any[], releases: 0 };
  const client = {
    release() { calls.releases++; },
    query: async (sql: string, args: any[] = []) => {
      calls.sql.push({ sql, args });
      if (sql.includes("UPDATE bms_conversations")) return { rows: [{ id: "conversation-1" }], rowCount: 1 };
      if (sql.includes("profile_error_at=now()")) return { rows: [{ id: "conversation-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const profile = loadWithStubs("apps/web/lib/bms/facebookProfile.ts", {
    "@/lib/db": {
      getClient: async () => client,
      query: async (sql: string, args: any[] = []) => {
        calls.sql.push({ sql, args });
        if (sql.includes("FROM bms_tenant_channels")) return { rows: [{ extra: {} }] };
        if (sql.includes("FROM bms_customer_identities ci")) return { rows: options.backfillCandidates ?? [] };
        return { rows: [{
          profile_synced_at: options.fresh ? new Date() : null,
          profile_error_at: options.recentError ? new Date() : null,
        }] };
      },
    },
    "./tenant": { beginTenantTx: async (_client: any, scopedTenantId: string) => {
      calls.transactions.push(scopedTenantId);
    } },
    "./channels": { getChannel: async () => ({ active: true, access_token: token, external_account_id: "1349769281552640" }) },
    "./inbox": { notifyInboxConversationChanged: (...args: any[]) => calls.notifications.push(args) },
    "./customers": { resolveOrCreateCustomer: async (...args: any[]) => {
      calls.resolved.push(args);
      if (options.resolveFailure) throw new Error("FAKE-resolve-failed");
      return "customer-1";
    } },
  }, async (url: string, init: any) => {
    calls.fetches.push({ url, init });
    const response = url.includes("1349769281552640") && options.pageResponse ? options.pageResponse : options.response ?? {
      ok: true,
      status: 200,
      body: JSON.stringify({ id: psid, first_name: "สมชาย", last_name: "ใจดี", profile_pic: "https://example.test/profile.jpg" }),
    };
    return { ok: response.ok, status: response.status, text: async () => response.body };
  });
  return { profile, calls };
}

test("Facebook PSID profile is fetched without putting the Page token in the URL and cached tenant-scoped", async () => {
  const { profile, calls } = harness();
  const result = await profile.syncFacebookUserProfile(tenantId, psid, token);

  assert.deepEqual(result, { ok: true, conversationIds: ["conversation-1"] });
  assert.equal(calls.fetches.length, 1);
  assert.match(calls.fetches[0].url, new RegExp(`/[^/]+/${psid}\\?fields=`));
  assert.match(decodeURIComponent(calls.fetches[0].url), /fields=id,name,first_name,last_name,profile_pic/);
  assert.doesNotMatch(calls.fetches[0].url, /FAKE-page-token/);
  assert.equal(calls.fetches[0].init.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(calls.transactions, [tenantId]);
  assert.equal(calls.resolved[0][1], tenantId);
  assert.equal(calls.resolved[0][2], "facebook");
  assert.equal(calls.resolved[0][3], psid);

  const identityUpdate = calls.sql.find((call) => call.sql.includes("profile_synced_at=now()"));
  assert.ok(identityUpdate);
  assert.deepEqual(identityUpdate.args, [tenantId, psid, "สมชาย ใจดี", "https://example.test/profile.jpg"]);
  assert.match(identityUpdate.sql, /display_name=COALESCE\(\$3,display_name\)/);
  assert.match(identityUpdate.sql, /picture_url=COALESCE\(\$4,picture_url\)/);
  assert.equal(calls.sql.at(-1)?.sql, "COMMIT");
  assert.equal(calls.releases, 1);
});

test("fresh profile cache skips Meta and missing credentials fail closed without writes", async () => {
  const fresh = harness({ fresh: true });
  assert.deepEqual(await fresh.profile.syncFacebookUserProfile(tenantId, psid, token), {
    ok: true, skipped: "fresh", conversationIds: [],
  });
  assert.equal(fresh.calls.fetches.length, 0);
  assert.equal(fresh.calls.transactions.length, 0);

  const recentError = harness({ recentError: true });
  assert.deepEqual(await recentError.profile.syncFacebookUserProfile(tenantId, psid, token), {
    ok: false, skipped: "recent-error", conversationIds: [],
  });
  assert.equal(recentError.calls.fetches.length, 0);

  const missing = harness();
  assert.equal((await missing.profile.syncFacebookUserProfile(tenantId, psid, null)).skipped, "missing-token");
  assert.equal((await missing.profile.syncFacebookUserProfile(tenantId, null, token)).skipped, "missing-user");
  assert.equal(missing.calls.fetches.length, 0);
});

test("Meta permission errors are recorded on the identity without exposing the token", async () => {
  const { profile, calls } = harness({ response: {
    ok: false,
    status: 403,
    body: JSON.stringify({ error: { code: 2018247, message: "Insufficient permission to access user profile" } }),
  } });
  const result = await profile.syncFacebookUserProfile(tenantId, psid, token);

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.match(result.error, /^META_PROFILE_HTTP_403_2018247/);
  assert.doesNotMatch(result.error, /FAKE-page-token/);
  const errorUpdate = calls.sql.find((call) => call.sql.includes("profile_error_at=now()"));
  assert.ok(errorUpdate);
  assert.equal(errorUpdate.args[0], tenantId);
  assert.equal(errorUpdate.args[1], psid);
  assert.equal(calls.sql.at(-1)?.sql, "COMMIT");
});

test("a mismatched provider identity is rejected and a cache write failure rolls back", async () => {
  const mismatch = harness({ response: {
    ok: true,
    status: 200,
    body: JSON.stringify({ id: "999999", first_name: "Wrong", profile_pic: "https://example.test/wrong.jpg" }),
  } });
  const mismatchResult = await mismatch.profile.syncFacebookUserProfile(tenantId, psid, token);
  assert.equal(mismatchResult.ok, false);
  assert.equal(mismatchResult.error, "META_PROFILE_ID_MISMATCH");
  assert.equal(mismatch.calls.resolved.length, 0);

  const failed = harness({ resolveFailure: true });
  await assert.rejects(failed.profile.syncFacebookUserProfile(tenantId, psid, token), /FAKE-resolve-failed/);
  assert.equal(failed.calls.sql.at(-1)?.sql, "ROLLBACK");
  assert.equal(failed.calls.releases, 1);
});

test("an empty provider profile is recorded as an error instead of a successful refresh", async () => {
  const empty = harness({ response: {
    ok: true,
    status: 200,
    body: JSON.stringify({ id: psid }),
  } });
  const result = await empty.profile.syncFacebookUserProfile(tenantId, psid, token);

  assert.deepEqual(result, {
    ok: false,
    status: 200,
    error: "META_PROFILE_EMPTY",
    conversationIds: ["conversation-1"],
  });
  assert.equal(empty.calls.resolved.length, 0);
  assert.ok(empty.calls.sql.some((call) => call.sql.includes("profile_error_at=now()")));
  assert.ok(!empty.calls.sql.some((call) => call.sql.includes("profile_synced_at=now()")));
});

test("Facebook Page identity is cached for the Inbox source header", async () => {
  const pageId = "1349769281552640";
  const { profile, calls } = harness({ pageResponse: {
    ok: true,
    status: 200,
    body: JSON.stringify({ id: pageId, name: "Business Management System - BMS", username: "bms.page",
      picture: { data: { url: "https://example.test/page.jpg" } } }),
  } });
  assert.deepEqual(await profile.syncFacebookPageProfile(tenantId, pageId, token), { ok: true });
  const update = calls.sql.find((call) => call.sql.includes("UPDATE bms_tenant_channels"));
  assert.ok(update);
  const extra = JSON.parse(update.args[2]);
  assert.equal(extra.botDisplayName, "Business Management System - BMS");
  assert.equal(extra.botBasicId, "bms.page");
  assert.equal(extra.botPictureUrl, "https://example.test/page.jpg");
  assert.deepEqual(calls.transactions, [tenantId]);
});

test("scheduled backfill refreshes existing Facebook identities and publishes Inbox changes", async () => {
  const { profile, calls } = harness({
    backfillCandidates: [{ tenant_id: tenantId, external_ref: psid }],
    pageResponse: { ok: true, status: 200, body: JSON.stringify({ id: "1349769281552640", name: "BMS Page" }) },
  });
  const result = await profile.runFacebookProfileBackfill(20);
  assert.deepEqual(result, { attempted: 1, updated: 1, failed: 0, pageProfiles: 1 });
  assert.deepEqual(calls.notifications, [[tenantId, "conversation-1", "CONVERSATION_CHANGED"]]);
});
