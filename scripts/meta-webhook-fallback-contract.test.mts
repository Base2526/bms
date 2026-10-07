import assert from "node:assert/strict";
import test from "node:test";
import { webhookHarness } from "./testing/webhookHarness.mts";

for (const channel of ["facebook", "instagram"] as const) {
  test(`${channel} sends and logs one fallback after a pipeline failure`, async () => {
    const h = webhookHarness(channel, { pipeline: async () => { throw new Error("FAKE provider failure"); } });
    assert.equal((await h.post()).status, 200);
    assert.equal(h.calls.logs.length, 1);
    assert.equal(h.calls.deliveries.length, 1);
    assert.equal(h.calls.logs[0][4], h.calls.deliveries[0][3]);
    assert.deepEqual(h.calls.incidents.map(x => x.code), ["channel.reply_failed"]);
    assert.equal(h.calls.incidents[0].tenantId, "FAKE-tenant");
  });

  test(`${channel} reports false delivery results for both normal and fallback replies`, async () => {
    for (const failPipeline of [false, true]) {
      const h = webhookHarness(channel, { deliver: async () => false, pipeline: async () => {
        if (failPipeline) throw new Error("FAKE provider failure");
        return { reply: "FAKE reply" };
      } });
      assert.equal((await h.post()).status, 200);
      assert.equal(h.calls.pipeline.length, 1);
      assert.equal(h.calls.logs.length, 1);
      assert.equal(h.calls.deliveries.length, 1);
      assert.deepEqual(h.calls.incidents.map(x => x.code), failPipeline
        ? ["channel.reply_failed", "channel.push_failed"] : ["channel.push_failed"]);
    }
  });

  test(`${channel} invalid signature and missing secret prevent processing`, async () => {
    for (const options of [{ signatureValid: false }, { secret: null }]) {
      const h = webhookHarness(channel, options);
      assert.equal((await h.post()).status, 401);
      assert.equal(h.calls.claims.length, 0);
    }
  });

  test(`${channel} duplicate event does not send again`, async () => {
    const h = webhookHarness(channel, { claim: async () => false });
    assert.equal((await h.post()).status, 200);
    assert.equal(h.calls.pipeline.length, 0);
    assert.equal(h.calls.deliveries.length, 0);
  });
}
