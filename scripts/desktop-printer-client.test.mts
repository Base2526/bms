import assert from "node:assert/strict";
import test from "node:test";
import {
  canPrintDesktopReceipt, getPrinterSnapshot, printDesktopReceipt,
  refreshPrinterState, subscribePrinter, testDesktopPrinter, confirmDesktopPrinterTest,
  canTestDesktopPrinter,
} from "../apps/web/lib/pos/desktopPrinterClient.ts";

test("cashier print guard covers failures, unknown status, testing and duplicate clicks", async () => {
  let state = { deviceName: "FAKE", paperWidth: 80, available: true, canPrint: false,
    canTest: false, awaitingConfirmation: false, message: "Offline", printers: [] };
  let printCalls = 0;
  let testCalls = 0;
  let failedRead = false;
  let release: (() => void) | undefined;
  let delayed = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    addEventListener() {}, removeEventListener() {},
    bmsDesktop: {
      getPrinterState: async () => { if (failedRead) throw new Error("Driver failed"); return state; },
      printReceipt: async () => { printCalls++; if (delayed) await new Promise<void>(done => { release = done; }); return { ok: true }; },
      testReceiptPrinter: async () => { testCalls++; state = { ...state, canPrint: false, awaitingConfirmation: true }; return { ok: true }; },
      confirmPrinterTest: async (printed: boolean) => { state = { ...state, canPrint: printed, awaitingConfirmation: false }; return { ok: true }; },
    },
  } });
  const unsubscribe = subscribePrinter(() => {});
  try {
    await refreshPrinterState();
    assert.equal(canPrintDesktopReceipt(), false);
    await assert.rejects(printDesktopReceipt(), /Offline/);
    assert.equal(printCalls, 0);
    await assert.rejects(testDesktopPrinter(), /Offline/);

    state = { ...state, canTest: true, message: "Unknown driver" };
    await refreshPrinterState();
    assert.equal(canPrintDesktopReceipt(), false);
    await testDesktopPrinter();
    assert.equal(getPrinterSnapshot().state?.awaitingConfirmation, true);
    assert.equal(canPrintDesktopReceipt(), false);
    await confirmDesktopPrinterTest(false);
    assert.equal(canPrintDesktopReceipt(), false);
    await testDesktopPrinter();
    await confirmDesktopPrinterTest(true);
    assert.equal(canPrintDesktopReceipt(), true);

    delayed = true;
    const first = printDesktopReceipt();
    while (!release) await new Promise(done => setImmediate(done));
    assert.equal(canPrintDesktopReceipt(), false);
    await assert.rejects(printDesktopReceipt(), /กรุณารอ/);
    release();
    assert.equal(await first, true);
    assert.equal(printCalls, 1);

    failedRead = true;
    await refreshPrinterState();
    assert.equal(canPrintDesktopReceipt(), false);
    assert.equal(canTestDesktopPrinter(), false);
    const testsBeforeFailure = testCalls;
    await assert.rejects(testDesktopPrinter(), /Driver failed/);
    assert.equal(testCalls, testsBeforeFailure, "stale canTest must never send a job after failed health check");
    await assert.rejects(printDesktopReceipt(), /Driver failed/);
    assert.equal(printCalls, 1);
    failedRead = false;
    await refreshPrinterState();
    assert.equal(canPrintDesktopReceipt(), true);
  } finally {
    unsubscribe();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
