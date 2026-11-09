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

function harness() {
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
    journal, calls,
    failNext: () => { printOk = false; },
    recover: () => { printOk = true; },
    print: createKitchenPrinter({
      createWindow: () => window,
      getPrinters: async () => [{ name: route.deviceName, displayName: "Kitchen", status: 3 }],
      getConfig: () => ({ version: 1, routes: [route] }),
      getJournal: () => journal,
      setJournal: async (key, value) => { journal[key] = value; },
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
