import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function harness(status: number, error: { code: number; message: string }) {
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const client = {
    release() {},
    async query(sql: string, args: unknown[] = []) {
      if (sql.includes("SELECT status")) return { rows: [{ status: "connected" }] };
      writes.push({ sql, args });
      return { rows: [] };
    },
  };
  const health = loadWithStubs("apps/web/lib/bms/channelHealth.ts", {
    "@/lib/db": { getClient: async () => client, query: async () => ({ rows: [] }) },
    "./tenant": { beginTenantTx: async () => {} },
    "./channels": { getChannel: async () => ({ access_token: "FAKE-page-token", external_account_id: "123456789012345" }) },
  }, async () => ({ ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify({ error }) }));
  return { health, writes };
}

test("a messaging-only Page token's missing read scope does not erase real delivery health", async () => {
  const { health, writes } = harness(400, { code: 100, message: "This endpoint requires the pages_read_engagement permission" });
  const result = await health.testChannelConnection("tenant-1", "facebook");
  assert.equal(result.ok, false);
  assert.match(result.message, /pages_read_engagement/);
  assert.deepEqual(writes, []);
});

test("an actual authorization failure still marks the Meta channel unhealthy", async () => {
  const { health, writes } = harness(401, { code: 190, message: "Invalid OAuth access token" });
  const result = await health.testChannelConnection("tenant-1", "facebook");
  assert.equal(result.ok, false);
  assert.ok(writes.some(({ sql, args }) => sql.includes("UPDATE bms_tenant_channels") && args[2] === "token_expired"));
});
