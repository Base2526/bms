import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { boardGameReceiptNotes } from "../apps/web/lib/bms/boardGameReceiptNotes.ts";

test("receipt details retain frozen rates, rounded minutes and separate participant amounts", () => {
  const snapshot = [
    { displayName: "dee", rateName: "ทั่วไป", hourlyRate: 50, actualMinutes: 511, billableMinutes: 510, amount: 425 },
    { displayName: "นน", rateName: "เด็ก", hourlyRate: 30, actualMinutes: 506, billableMinutes: 510, amount: 255 },
  ];
  const before = JSON.stringify(snapshot);
  const notes = boardGameReceiptNotes(snapshot).join("\n");
  assert.match(notes, /dee = 425\.00/);
  assert.match(notes, /นน = 255\.00/);
  assert.match(notes, /ทั่วไป · 50\.00 บาท\/ชม\./);
  assert.match(notes, /เด็ก · 30\.00 บาท\/ชม\./);
  assert.match(notes, /Billed before benefits 510/);
  assert.match(notes, /Actual 511/);
  assert.equal(JSON.stringify(snapshot), before);
});

test("buy/get receipt distinguishes rounded time from frozen paid/free minutes", () => {
  const notes = boardGameReceiptNotes([{ hourlyRate: 50, billableMinutes: 180, amount: 100,
    offerPaidMinutes: 120, offerFreeMinutes: 60, offerDiscountAmount: 50, offerName: "FAKE 2+1" }]).join("\n");
  assert.match(notes, /Billed before benefits 180/);
  assert.match(notes, /Paid 120/);
  assert.match(notes, /Free 60/);
  assert.match(notes, /Offer: FAKE 2\+1 -50\.00/);
  assert.doesNotMatch(boardGameReceiptNotes([{ billableMinutes: 180, amount: 100 }]).join("\n"), /Time offer/);
});

test("pass and promotional benefits do not recalculate or double-count the frozen net fee", () => {
  const notes = boardGameReceiptNotes([
    { hourlyRate: 50, billableMinutes: 120, coveredAmount: 100, amount: 0 },
    { hourlyRate: 50, billableMinutes: 120, offerName: "FAKE Offer", offerDiscountAmount: 50, amount: 50 },
  ]).join("\n");
  assert.match(notes, /Player 1 = 0\.00/);
  assert.match(notes, /Pass coverage 100\.00/);
  assert.match(notes, /Offer: FAKE Offer -50\.00/);
  assert.match(notes, /Player 2 = 50\.00/);
});

test("legacy and missing evidence never fabricate a rate or time", () => {
  for (const value of [null, undefined, {}, [null, {}, { amount: -1 }, { amount: "bad" }]]) {
    assert.deepEqual(boardGameReceiptNotes(value), []);
  }
  assert.deepEqual(boardGameReceiptNotes([{ amount: 100 }]), ["ค่าเวลา / Play time: ผู้เล่น / Player 1 = 100.00"]);
});

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/components/pos-desktop/DesktopPosRenderer.tsx", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("  const printReceiptPaper = async"), source.indexOf("  const submitSale = async"));
const compiled = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(options: { native?: boolean; fail?: boolean; boardGame?: boolean; disabled?: boolean; busy?: boolean; missing?: boolean; delayedFrame?: boolean; dialogError?: boolean; synchronousAfterPrint?: boolean } = {}) {
  const events: string[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let frame: (() => void) | null = null;
  let afterPrint: (() => void) | null = null;
  const deps = {
    receiptPaper: options.missing ? null : {},
    receiptPrinting: false,
    receiptPrintingRef: { current: Boolean(options.busy) },
    receiptPrinter: { disabled: options.disabled },
    boardGameCheckout: options.boardGame === false ? null : {},
    setError: (error: string) => { if (error) events.push("error"); },
    setReceiptPrinting: () => {},
    printDesktopReceipt: async () => {
      events.push("print");
      if (options.fail) throw new Error("Printer failed");
      return options.native ?? true;
    },
    newSale: () => events.push("boardgame"),
    document: { body: { setAttribute: () => {}, removeAttribute: () => {} } },
    window: {
      addEventListener: (_type: string, fn: () => void) => { afterPrint = fn; },
      removeEventListener: () => { afterPrint = null; },
      clearTimeout: (id: number) => { timers.delete(id); },
      setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
      requestAnimationFrame: (fn: () => void) => { if (options.delayedFrame) frame = fn; else fn(); },
      print: () => {
        events.push("dialog");
        if (options.dialogError) throw new Error("dialog unavailable");
        if (options.synchronousAfterPrint) afterPrint?.();
      },
    },
  };
  const print = new Function(...Object.keys(deps), `${compiled}; return printReceiptPaper;`)(...Object.values(deps));
  return { print, events, locked: () => deps.receiptPrintingRef.current,
    frame: () => frame?.(), afterPrint: () => afterPrint?.(),
    timers: () => { const queued = [...timers.values()]; timers.clear(); queued.forEach((fn) => fn()); } };
}

test("desktop returns to the board-game floor only after native print success", async () => {
  const h = harness();
  await h.print();
  assert.deepEqual(h.events, ["print", "boardgame"]);
});

test("printer failure, browser cancellation and retail receipts never auto-close", async () => {
  for (const options of [{ fail: true }, { native: false }, { boardGame: false }]) {
    const h = harness(options);
    await h.print();
    assert.ok(!h.events.includes("boardgame"));
    if (options.fail) assert.deepEqual(h.events, ["print", "error"]);
    if (options.native === false) assert.deepEqual(h.events, ["print", "dialog"]);
  }
});

test("unready, missing receipt and concurrent clicks never send another print", async () => {
  for (const options of [{ disabled: true }, { busy: true }, { missing: true }]) {
    const h = harness(options);
    await h.print();
    assert.deepEqual(h.events, []);
  }
  const h = harness();
  await Promise.all([h.print(), h.print()]);
  assert.deepEqual(h.events, ["print", "boardgame"]);
  assert.match(source, /disabled=\{receiptPrinting\} onClick=\{newSale\}/);
});

test("browser printing stays locked before the frame and until the print dialog ends", async () => {
  const h = harness({ native: false, delayedFrame: true });
  await h.print();
  await h.print();
  assert.deepEqual(h.events, ["print"]);
  assert.equal(h.locked(), true);
  h.frame();
  await h.print();
  assert.deepEqual(h.events, ["print", "dialog"]);
  h.afterPrint();
  assert.equal(h.locked(), false);
  h.timers();
  assert.deepEqual(h.events, ["print", "dialog"]);
});

test("browser print exceptions release the lock and report failure", async () => {
  const h = harness({ native: false, dialogError: true });
  await h.print();
  assert.equal(h.locked(), false);
  assert.deepEqual(h.events, ["print", "dialog", "error"]);
});

test("a completed dialog's fallback cannot unlock a subsequent print", async () => {
  const h = harness({ native: false, delayedFrame: true });
  await h.print(); h.frame(); h.afterPrint();
  await h.print();
  h.timers();
  assert.equal(h.locked(), true);
  h.afterPrint();
  assert.equal(h.locked(), false);
});
