import assert from "node:assert/strict";
import test from "node:test";
import {
  createKitchenPrinter,
  kitchenJobKey,
  kitchenPrintDocument,
  normalizeKitchenPrinterConfig,
  normalizeKitchenPrintJob,
} from "../src/kitchen-printer.mjs";

const route = { stationKey: "id:station-1", stationName: "ครัวร้อน", deviceName: "kitchen-thermal", paperWidth: 80, autoPrint: true };
const job = { jobId: "ticket-1", stationId: "station-1", stationName: "ครัวร้อน", label: "คิว A042", roundNo: 2,
  createdAt: "2026-11-08T10:00:00.000Z", items: [{ name: "กะเพรา", size: "L", qty: 2, modifiers: ["ไข่ดาว"], note: "ไม่เผ็ด" }] };

test("kitchen printer config is bounded and only keeps explicit routes", () => {
  const value = normalizeKitchenPrinterConfig({ routes: [route, { stationKey: "bad", deviceName: "x" }] });
  assert.deepEqual(value.routes, [route]);
  assert.equal(normalizeKitchenPrintJob(job).stationKey, route.stationKey);
  assert.throws(() => normalizeKitchenPrintJob({ ...job, items: [] }));
});

test("kitchen print document escapes payload and embeds Thai font", () => {
  const html = kitchenPrintDocument(normalizeKitchenPrintJob({ ...job, label: "<script>x</script>" }), 58);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /width:58mm/);
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /script-src 'none'/);
});

function harness(overrides = {}) {
  const journal = {};
  const calls = [];
  let printOk = true;
  const window = {
    loadURL: async (url) => calls.push(["load", url]),
    isDestroyed: () => false,
    destroy: () => calls.push(["destroy"]),
    webContents: {
      executeJavaScript: async () => 500,
      print: (options, done) => { calls.push(["print", options]); done(printOk); },
    },
  };
  return {
    journal, calls, window,
    failNext: () => { printOk = false; },
    recover: () => { printOk = true; },
    print: createKitchenPrinter({
      createWindow: () => window,
      getPrinters: async () => [{ name: route.deviceName, displayName: "Kitchen", status: process.platform === "win32" ? 0 : 3 }],
      getConfig: () => ({ version: 1, routes: [route] }),
      getJournal: () => journal,
      setJournal: async (key, value) => { journal[key] = value; },
      ...overrides,
    }),
  };
}

test("successful kitchen jobs are idempotent", async () => {
  const h = harness();
  assert.equal((await h.print(job)).ok, true);
  assert.equal(h.journal[kitchenJobKey(normalizeKitchenPrintJob(job))].status, "PRINTED");
  assert.deepEqual(await h.print(job), { ok: true, duplicate: true });
  assert.equal(h.calls.filter(([kind]) => kind === "print").length, 1);
});

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

for (const phase of ["printers", "load", "fonts", "driver"]) {
  test(`kitchen timeout covers ${phase}; late completion never submits or claims success`, async () => {
    const gate = deferred();
    const h = harness({ timeoutMs: 15, ...(phase === "printers" ? { getPrinters: () => gate.promise } : {}) });
    if (phase === "load") h.window.loadURL = () => gate.promise;
    if (phase === "fonts") h.window.webContents.executeJavaScript = () => gate.promise;
    if (phase === "driver") h.window.webContents.print = (options, done) => {
      h.calls.push(["print", options]);
      gate.promise.then(() => done(true));
    };
    const result = await h.print(job);
    assert.equal(result.ok, false);
    assert.equal(result.uncertain, phase === "driver");
    assert.equal(result.retrySafe, phase !== "driver");
    gate.resolve(500);
    await new Promise(done => setImmediate(done));
    assert.equal(h.calls.filter(([kind]) => kind === "print").length, phase === "driver" ? 1 : 0);
    assert.notEqual(h.journal[kitchenJobKey(job)]?.status, "PRINTED");
  });
}

test("missing printer fails before submission and can recover without an uncertain retry", async () => {
  let available = false;
  const h = harness({ getPrinters: async () => available ? [{ name: route.deviceName }] : [] });
  assert.equal((await h.print(job)).retrySafe, true);
  assert.deepEqual(h.journal, {});
  available = true;
  assert.equal((await h.print(job)).ok, true);
});

test("unpair or navigation during preparation prevents kitchen submission", async () => {
  const gate = deferred();
  const h = harness();
  let authorized = true;
  h.window.loadURL = () => gate.promise;
  const operation = h.print(job, {}, () => authorized);
  authorized = false;
  gate.resolve();
  assert.equal((await operation).retrySafe, true);
  assert.equal(h.calls.some(([kind]) => kind === "print"), false);
});

test("journal failures return a visible result and never permit an automatic duplicate", async () => {
  const h = harness({ setJournal: async (key, value) => {
    if (value.status !== "PRINTING") throw new Error("disk full");
    h.journal[key] = value;
  } });
  assert.equal((await h.print(job)).uncertain, true);
  assert.equal((await h.print(job, { auto: true })).uncertain, true);
  assert.equal(h.calls.filter(([kind]) => kind === "print").length, 1);
});

test("uncertain jobs never auto-retry and require explicit retry", async () => {
  const h = harness();
  h.failNext();
  const failed = await h.print(job);
  assert.equal(failed.uncertain, true);
  h.recover();
  const blocked = await h.print(job, { auto: true });
  assert.equal(blocked.uncertain, true);
  assert.equal(h.calls.filter(([kind]) => kind === "print").length, 1);
  assert.equal((await h.print(job, { retry: true })).ok, true);
  assert.equal(h.calls.filter(([kind]) => kind === "print").length, 2);
});
