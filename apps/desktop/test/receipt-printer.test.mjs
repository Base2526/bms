import assert from "node:assert/strict";
import test from "node:test";
import { printerHealth, printerReadiness } from "../src/printer-health.mjs";
import {
  createReceiptPrinter, DEFAULT_PRINTER_CONFIG, isReceiptPrinterCaller,
  normalizePrinterConfig, receiptPrintOptions, receiptPrintDocument,
} from "../src/receipt-printer.mjs";

const config = { deviceName: "thermal-system-name", paperWidth: 80 };
const printers = [{ name: config.deviceName, displayName: "Receipt Printer" }];

test("OS health distinguishes unknown, ready and actual blocking problems", () => {
  assert.equal(printerHealth({ status: 0 }, "win32").status, "ready");
  assert.equal(printerHealth({ status: 0x400 }, "win32").status, "ready");
  for (const status of [0x80, 0x10, 0x8, 0x1, 0x400000, 0x2]) {
    assert.equal(printerHealth({ status }, "win32").status, "blocked");
  }
  assert.equal(printerHealth({}, "win32").status, "unknown");
  for (const platform of ["darwin", "linux"]) {
    assert.equal(printerHealth({ status: 3 }, platform).status, "ready");
    assert.equal(printerHealth({ status: 4 }, platform).status, "ready");
    assert.equal(printerHealth({ status: 5 }, platform).status, "blocked");
    assert.equal(printerHealth({ status: 0 }, platform).status, "unknown");
    for (const reason of ["offline-report", "media-empty-error", "media-jam", "door-open", "paused", "other-error"]) {
      assert.equal(printerHealth({ status: 3, options: { "printer-state-reasons": reason } }, platform).status, "blocked");
    }
    assert.equal(printerHealth({ status: 3, options: { "printer-is-accepting-jobs": "false" } }, platform).status, "blocked");
    assert.equal(printerHealth({ status: 3, options: { "printer-state-reasons": "toner-low-warning" } }, platform).status, "ready");
  }
});

test("unknown status needs a paper confirmation; errors/pending tests never enable receipts", () => {
  assert.equal(printerReadiness(config, printers).canPrint, false);
  assert.equal(printerReadiness(config, printers).canTest, true);
  const confirmed = { ...config, tested: true };
  assert.equal(printerReadiness(confirmed, printers).canPrint, true);
  assert.equal(printerReadiness(confirmed, printers, "Print failed").canPrint, false);
  assert.equal(printerReadiness(confirmed, printers, "", true).canPrint, false);
  assert.equal(printerReadiness(confirmed, []).canTest, false);
  assert.equal(printerReadiness(confirmed, [{ ...printers[0], status: 5 }], "", false, "darwin").canPrint, false);
});

test("offline printer is rejected before native spooling", async () => {
  const h = harness({ getPrinters: async () => [{ ...printers[0], options: { "printer-state-reasons": "offline-report" }, status: 0x80 }] });
  assert.equal((await h.print(h.source)).ok, false);
  assert.equal(h.calls.length, 0);
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function harness(overrides = {}) {
  const calls = [];
  let destroyed = false;
  const window = {
    loadURL: async (url) => { calls.push(["load", url]); },
    isDestroyed: () => destroyed,
    destroy: () => { destroyed = true; },
    webContents: {
      executeJavaScript: async () => 600,
      print: (options, callback) => { calls.push(["print", options]); callback(true); },
    },
  };
  const source = { executeJavaScript: async () => '<div id="pos-receipt">FAKE receipt 123.45</div>' };
  return {
    calls, window, source,
    print: createReceiptPrinter({ createWindow: () => window, getConfig: () => config,
      getPrinters: async () => printers, ...overrides }),
  };
}

test("printer bridge accepts only paired cashier main frames", () => {
  const frame = { url: "https://shop.example/pos/app" };
  const sender = { mainFrame: frame };
  const window = { webContents: sender, isDestroyed: () => false };
  const event = { sender, senderFrame: frame };
  for (const route of ["/pos", "/pos/app", "/pos/restaurant"]) {
    frame.url = `https://shop.example${route}?screen=receipt`;
    assert.equal(isReceiptPrinterCaller(event, window, "https://shop.example"), true);
  }
  for (const url of ["https://other.example/pos", "https://shop.example/pos/display",
    "https://shop.example/pos/manual", "https://shop.example/admin", "file:///setup.html"]) {
    frame.url = url;
    assert.equal(isReceiptPrinterCaller(event, window, "https://shop.example"), false);
  }
  frame.url = "https://shop.example/pos";
  assert.equal(isReceiptPrinterCaller({ ...event, senderFrame: { ...frame } }, window, "https://shop.example"), false);
  assert.equal(isReceiptPrinterCaller({ ...event, sender: {} }, window, "https://shop.example"), false);
  assert.equal(isReceiptPrinterCaller(event, window, null), false);
});

test("saved printer never silently falls back to an OS default", () => {
  assert.deepEqual(normalizePrinterConfig(null), DEFAULT_PRINTER_CONFIG);
  assert.equal(normalizePrinterConfig({ paperWidth: 58 }).paperWidth, 58);
  assert.throws(() => receiptPrintOptions(DEFAULT_PRINTER_CONFIG, printers, 600));
  assert.throws(() => receiptPrintOptions(config, [], 600));
  assert.throws(() => receiptPrintOptions({ ...config, deviceName: "Receipt Printer" }, printers, 600));
  for (const height of [0, NaN, Infinity, 100001]) assert.throws(() => receiptPrintOptions(config, printers, height));
  for (const width of [58, 80]) {
    const options = receiptPrintOptions({ ...config, paperWidth: width }, printers, 600);
    assert.equal(options.deviceName, config.deviceName);
    assert.equal(options.silent, true);
    assert.equal(options.pageSize.width, width * 1000);
    assert.equal(options.copies, 1);
  }
});

test("isolated document is bounded to receipt paper and disallows scripts", () => {
  const html = receiptPrintDocument("<div>FAKE</div>", 58);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /width: 58mm/);
  assert.match(html, /object-fit: contain/);
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /font-src data:/);
});

test("a receipt is printed once, silently, then the hidden window is destroyed", async () => {
  const h = harness();
  assert.deepEqual(await h.print(h.source), { ok: true });
  assert.equal(h.calls.filter(([name]) => name === "print").length, 1);
  assert.equal(h.calls.find(([name]) => name === "print")[1].silent, true);
  assert.equal(h.window.isDestroyed(), true);
});

test("test page does not read the cashier receipt", async () => {
  const h = harness();
  assert.deepEqual(await h.print({ executeJavaScript: () => { throw new Error("must not read"); } }, true), { ok: true });
  assert.match(decodeURIComponent(h.calls[0][1]), /Print test/);
});

test("printer removal after image load cancels before spooling", async () => {
  let reads = 0;
  const h = harness({ getPrinters: async () => ++reads === 1 ? printers : [] });
  assert.equal((await h.print(h.source)).ok, false);
  assert.equal(h.calls.some(([name]) => name === "print"), false);
  assert.equal(h.window.isDestroyed(), true);
});

test("image failure and OS failure remain errors without a dialog or retry", async () => {
  for (const failure of ["image", "driver"]) {
    const h = harness();
    if (failure === "image") h.window.webContents.executeJavaScript = async () => { throw new Error("image load failed"); };
    else h.window.webContents.print = (_, done) => done(false);
    assert.equal((await h.print(h.source)).ok, false);
    assert.equal(h.window.isDestroyed(), true);
  }
});

test("concurrent clicks cannot enqueue duplicate receipts", async () => {
  const gate = deferred();
  const h = harness();
  h.window.loadURL = () => gate.promise;
  const first = h.print(h.source);
  assert.equal((await h.print(h.source)).ok, false);
  gate.resolve();
  assert.equal((await first).ok, true);
  assert.equal(h.calls.filter(([name]) => name === "print").length, 1);
});

test("timeout bounds snapshot capture and late completion cannot print", async () => {
  const gate = deferred();
  const h = harness({ timeoutMs: 10 });
  const result = await h.print({ executeJavaScript: () => gate.promise });
  assert.equal(result.ok, false);
  assert.match(result.error, /คิวพิมพ์/);
  gate.resolve("<div>Late receipt</div>");
  await new Promise((done) => setImmediate(done));
  assert.equal(h.calls.length, 0);
  assert.equal((await h.print(h.source)).ok, true);
});

test("unpair or navigation during preparation cancels the job", async () => {
  let authorized = true;
  const h = harness({ getPrinters: async () => { authorized = false; return printers; } });
  assert.equal((await h.print(h.source, false, () => authorized)).ok, false);
  assert.equal(h.calls.length, 0);
});
