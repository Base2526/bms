import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = await readFile(new URL("../apps/web/app/(pos)/pos/restaurant/page.tsx", import.meta.url), "utf8");
// Execute the page's handlers with printer transports stubbed; no sale or device is created.
const handlers = source.slice(source.indexOf("  async function printReceipt("), source.indexOf("  async function loadPricingPreview("));
const compiled = ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(options: { native?: boolean; usb?: boolean; disabled?: boolean; fail?: boolean; drawerFail?: boolean; missingPayload?: boolean } = {}) {
  const receipt = {};
  const events: string[] = [];
  const deps = {
    receiptPrinter: { disabled: options.disabled ?? false },
    settlementReceipt: receipt,
    run: async (action: () => Promise<void>) => { try { await action(); } catch { events.push("error"); } },
    receiptPayload: () => options.missingPayload ? null : {},
    receiptBytes: () => "receipt",
    printDesktopReceipt: async () => {
      if (options.native && options.fail) throw new Error("Printer unavailable");
      return options.native ?? false;
    },
    isWebUsbSupported: () => options.usb ?? false,
    findRememberedPrinter: async () => ({}),
    requestPrinter: async () => ({}),
    sendToPrinter: async (bytes: string) => {
      if ((bytes === "receipt" && options.fail) || (bytes === "drawer" && options.drawerFail)) throw new Error("USB failed");
      events.push(bytes);
    },
    buildDrawerKick: () => "drawer",
    message: { warning: () => events.push("warning"), info: () => {}, success: () => {} },
    t: (key: string) => key,
    printViaBrowser: () => events.push("browser"),
    setSettlementReceipt: () => events.push("close"),
    setSettlementReceiptExpanded: () => events.push("collapse"),
    setScreen: (screen: string) => events.push(screen),
  };
  const print = new Function(...Object.keys(deps), `${compiled}; return printReceipt;`)(...Object.values(deps));
  return { events, receipt, print };
}

test("successful native and USB jobs return to the floor, including drawer-only failure", async () => {
  for (const options of [{ native: true }, { usb: true }, { usb: true, drawerFail: true }]) {
    const h = harness(options);
    await h.print(h.receipt, true);
    assert.deepEqual(h.events.slice(-3), ["close", "collapse", "FLOOR"]);
    assert.ok(!h.events.includes("browser"), "a drawer failure must not print the receipt twice");
    if (options.drawerFail) assert.ok(h.events.includes("warning"));
  }
});

test("browser fallback and failed or disabled printing leave the receipt open", async () => {
  for (const options of [{}, { native: true, fail: true }, { usb: true, fail: true }, { disabled: true }, { missingPayload: true }]) {
    const h = harness(options);
    await h.print(h.receipt);
    assert.ok(!h.events.includes("close"));
    assert.ok(!h.events.includes("FLOOR"));
  }
});

test("reprinting history must not dismiss the current settlement", async () => {
  const h = harness({ usb: true });
  await h.print({});
  assert.ok(!h.events.includes("close"));
  assert.ok(!h.events.includes("drawer"));
});
