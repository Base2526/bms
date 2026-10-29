import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";
import * as identity from "../apps/web/lib/bms/lineBotIdentity.ts";

const token = "FAKE-token";
const cache = (basicId = "@fake-shop") => ({ botBasicId: basicId, botInfoSyncedAt: new Date().toISOString(), botIdentityTokenHash: identity.lineBotTokenHash(token) });

test("identity is bound to the current credential, not just a writable label or timestamp", () => {
  const verified = cache();
  assert.equal(identity.hasVerifiedLineBotIdentity(verified, token), true);
  for (const extra of [null, [], {}, { ...verified, botInfoSyncedAt: "invalid" },
    { ...verified, botInfoSyncedAt: "2999-01-01T00:00:00Z" }, { ...verified, botBasicId: "not a LINE ID" },
    { ...verified, botIdentityTokenHash: undefined }]) assert.equal(identity.hasVerifiedLineBotIdentity(extra, token), false);
  assert.equal(identity.hasVerifiedLineBotIdentity(verified, "FAKE-replacement"), false);
  assert.equal(identity.hasVerifiedLineBotIdentity(verified, null), false);
});

test("channel extra-only writes cannot forge or remove provider identity; token changes invalidate it", async () => {
  for (const supplied of [{ botBasicId: "@168tnlzi", botInfoSyncedAt: "2999-01-01T00:00:00Z", botIdentityTokenHash: "forged", custom: "kept" }, [], "invalid", {}]) {
    const previous = { ...cache(), custom: "old" };
    const result = identity.lineChannelExtra(previous, supplied, false);
    assert.equal(result.botBasicId, "@fake-shop");
    assert.equal(result.botIdentityTokenHash, previous.botIdentityTokenHash);
    assert.equal(identity.lineChannelExtra(previous, supplied, true).botBasicId, undefined);
    assert.equal(identity.lineChannelExtra({}, supplied, false).botBasicId, undefined);
  }
  const previous = cache();
  assert.deepEqual(identity.lineChannelExtra(previous, undefined, false), previous);
});

test("real channel service protects metadata for extra-only saves, same-token saves and replacements", async () => {
  for (const replacement of [undefined, " FAKE-token ", "FAKE-new"]) {
    const calls: any[] = [];
    const prior = cache();
    const client = { release() {}, query: async (sql: string, args: any[] = []) => {
      calls.push({ sql, args });
      return { rows: sql.includes("SELECT access_token") ? [{ access_token: token, channel_secret: "FAKE-secret", active: true, extra: prior }] : [] };
    } };
    const channels = loadWithStubs("apps/web/lib/bms/channels.ts", {
      "@/lib/db": { getClient: async () => client },
      "./tenant": { beginTenantTx: async (_client: any, tenant: string) => { calls.push({ tx: tenant }); } },
      "./entitlements": { requireCapacityForUpsert: async () => {} },
      "./crypto": { encryptSecret: (v: string) => v, decryptSecret: (v: string) => v },
      "./lineBotIdentity": identity,
    });
    await channels.upsertChannel("FAKE-tenant", "line", { accessToken: replacement, extra: { botBasicId: "@168tnlzi", custom: "kept" } }, "FAKE-actor");
    const saved = calls.find(c => c.sql?.includes("INSERT INTO bms_tenant_channels")).args[7];
    assert.equal(saved.custom, "kept");
    assert.equal(saved.botBasicId, replacement === "FAKE-new" ? undefined : "@fake-shop");
    assert.ok(calls.find(c => c.tx === "FAKE-tenant"));
    assert.ok(calls.find(c => c.sql?.includes("INSERT INTO bms_audit_log")));
  }
});

function profileHarness(options: { extra?: any; changed?: boolean; wrongToken?: boolean; badInfo?: boolean; failFetch?: boolean; failWrite?: boolean } = {}) {
  const calls = { sql: [] as any[], fetches: 0, tx: [] as any[], release: 0 };
  const stored = "FAKE-encrypted-token";
  const client = { release() { calls.release++; }, query: async (sql: string, args: any[] = []) => {
    calls.sql.push({ sql, args });
    if (sql.startsWith("UPDATE")) {
      if (options.failWrite) throw new Error("FAKE-write failure");
      assert.match(sql, /tenant_id = \$1 AND channel = \$2 AND access_token = \$4/);
      assert.equal(args[3], stored);
      return { rows: options.changed ? [] : [{ extra: { custom: "kept", ...JSON.parse(args[2]) } }] };
    }
    return { rows: [] };
  } };
  const profile = loadWithStubs("apps/web/lib/bms/lineProfile.ts", {
    "@/lib/db": { getClient: async () => client, query: async (sql: string, args: any[]) => {
      calls.sql.push({ sql, args }); return { rows: [{ access_token: stored, extra: options.extra ?? {} }] };
    } },
    "./tenant": { beginTenantTx: async (_client: any, tenant: string) => { calls.tx.push(tenant); } },
    "./crypto": { decryptSecret: () => options.wrongToken ? "FAKE-other" : token },
    "./lineBotIdentity": identity,
  }, async (url: string) => {
    assert.equal(url, "https://api.line.me/v2/bot/info"); calls.fetches++;
    return { ok: !options.failFetch, status: options.failFetch ? 503 : 200,
      text: async () => options.failFetch ? "FAKE-unavailable" : JSON.stringify(options.badInfo ? {} : { basicId: "@168tnlzi", displayName: "FAKE-BMS" }) };
  });
  return { ...profile, calls };
}

test("bot verification migrates an unbound cache, preserves custom fields and writes within tenant transaction", async () => {
  const h = profileHarness({ extra: { botBasicId: "@fake-shop", botInfoSyncedAt: new Date().toISOString() } });
  const result = await h.syncLineBotInfo("FAKE-tenant", token);
  assert.equal(result.ok, true);
  assert.equal(result.extra.botBasicId, "@168tnlzi");
  assert.equal(result.extra.custom, "kept");
  assert.equal(identity.hasVerifiedLineBotIdentity(result.extra, token), true);
  assert.equal(h.calls.fetches, 1);
  assert.deepEqual(h.calls.tx, ["FAKE-tenant"]);
  assert.equal(h.calls.sql.at(-1).sql, "COMMIT");
  assert.equal(h.calls.release, 1);
});

test("fresh token-bound cache skips network; stale input and token rotation cannot attach the wrong OA", async () => {
  const fresh = profileHarness({ extra: cache() });
  assert.equal((await fresh.syncLineBotInfo("FAKE-tenant", token)).skipped, "fresh");
  assert.equal(fresh.calls.fetches, 0);
  const mismatch = profileHarness({ wrongToken: true });
  assert.equal((await mismatch.syncLineBotInfo("FAKE-tenant", token)).skipped, "credential-changed");
  assert.equal(mismatch.calls.fetches, 0);
  const race = profileHarness({ changed: true });
  assert.equal((await race.syncLineBotInfo("FAKE-tenant", token)).skipped, "credential-changed");
  assert.equal(race.calls.fetches, 1);
});

test("invalid provider identity is never saved; failures retain diagnostics and rollback safely", async () => {
  const invalid = profileHarness({ badInfo: true });
  assert.equal((await invalid.syncLineBotInfo("FAKE-tenant", token)).ok, false);
  assert.equal(invalid.calls.tx.length, 0);
  const unavailable = profileHarness({ failFetch: true });
  assert.equal((await unavailable.syncLineBotInfo("FAKE-tenant", token)).ok, false);
  const errorPatch = JSON.parse(unavailable.calls.sql.find(c => c.sql.startsWith("UPDATE")).args[2]);
  assert.equal(errorPatch.botInfoError, "FAKE-unavailable");
  assert.equal(errorPatch.botIdentityTokenHash, undefined);
  const failed = profileHarness({ failWrite: true });
  await assert.rejects(failed.syncLineBotInfo("FAKE-tenant", token), /FAKE-write/);
  assert.equal(failed.calls.sql.at(-1).sql, "ROLLBACK");
  assert.equal(failed.calls.release, 1);
});
