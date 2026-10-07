import assert from "node:assert/strict";
import test from "node:test";
import { webhookHarness } from "./testing/webhookHarness.mts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("LINE does not acknowledge a failed event claim", async () => {
  const h = webhookHarness("line", { claim: async () => { throw new Error("FAKE DB unavailable"); } });
  await assert.rejects(h.post(), /FAKE DB unavailable/);
  assert.equal(h.calls.pipeline.length, 0);
  assert.equal(h.calls.deliveries.length, 0);
});

test("LINE completes each turn before starting the next event and acknowledging", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = webhookHarness("line", { pipeline: async (text: string) => {
    if (text === "first") await gate;
    else assert.equal(h.calls.logs[0][3], "first", "first turn must already be persisted");
    return { reply: text };
  } });
  let acknowledged = false;
  const response = h.post([h.event("first", "FAKE-1"), h.event("second", "FAKE-2")])
    .then((value: any) => { acknowledged = true; return value; });
  try {
    await tick();
    assert.equal(acknowledged, false);
    assert.equal(h.calls.pipeline.length, 1);
  } finally { release(); }
  assert.equal((await response).status, 200);
  assert.deepEqual(h.calls.logs.map(args => args[3]), ["first", "second"]);
  assert.equal(h.calls.deliveries.length, 2);
  assert.equal(h.calls.incidents.length, 0);
});

test("LINE body reset never enters claim or AI processing", async () => {
  const h = webhookHarness("line");
  const error = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
  await assert.rejects(h.post([], async () => { throw error; }), { code: "ECONNRESET" });
  assert.equal(h.calls.claims.length, 0);
  assert.equal(h.calls.pipeline.length, 0);
});

test("LINE rejects invalid signatures and missing secrets before claiming", async () => {
  for (const options of [{ signatureValid: false }, { secret: null }]) {
    const h = webhookHarness("line", options);
    assert.equal((await h.post()).status, 401);
    assert.equal(h.calls.claims.length, 0);
  }
});

test("LINE duplicates do not run AI or send a second reply", async () => {
  const h = webhookHarness("line", { claim: async () => false });
  assert.equal((await h.post()).status, 200);
  assert.equal(h.calls.pipeline.length, 0);
  assert.equal(h.calls.deliveries.length, 0);
});

test("LINE pipeline failure persists and sends one fallback", async () => {
  const h = webhookHarness("line", { pipeline: async () => { throw new Error("FAKE provider failure"); } });
  assert.equal((await h.post()).status, 200);
  assert.equal(h.calls.logs.length, 1);
  assert.equal(h.calls.deliveries.length, 1);
  const sent = JSON.parse(h.calls.deliveries[0][1].body);
  assert.equal(sent.messages[0].text, h.calls.logs[0][4]);
  assert.deepEqual(h.calls.incidents.map(x => x.code), ["channel.reply_failed"]);
});

test("LINE delivery rejection reports push failure without rerunning AI", async () => {
  const h = webhookHarness("line", { fetch: async () => ({ ok: false, status: 400, text: async () => "FAKE rejected" }) });
  assert.equal((await h.post()).status, 200);
  assert.equal(h.calls.pipeline.length, 1);
  assert.equal(h.calls.logs.length, 1);
  assert.equal(h.calls.deliveries.length, 1);
  assert.deepEqual(h.calls.incidents.map(x => x.code), ["channel.push_failed"]);
});
