import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { editCheckoutPayment, syncSingleCheckoutPayment, type CheckoutPayment } from "../packages/pos-client-core/src/checkoutPayment.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/mobile/src/screens/sell/CheckoutScreen.tsx", import.meta.url), "utf8");
const block = source.slice(source.indexOf("  const updatePayment ="), source.indexOf("  const completeSale ="));
const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("native split cash allocation follows its own default, not edits to another row", () => {
  let payments: CheckoutPayment[] = [
    { id: "cash", method: "cash", amount: 4000, tendered: 4000 },
    { id: "qr", method: "qr", amount: 5559, reference: "" },
  ];
  const update = new Function("setPayments", "setPaymentsTouched", "editCheckoutPayment", "submittedRef", `${js}; return updatePayment;`)(
    (fn: (p: CheckoutPayment[]) => CheckoutPayment[]) => { payments = fn(payments); },
    () => {}, editCheckoutPayment, { current: false },
  );
  update("qr", { reference: "FAKE" });
  update("cash", { amount: 5000 });
  assert.equal(payments[0].tendered, 5000);
  update("cash", { tendered: 10000 });
  update("cash", { amount: 6000 });
  assert.equal(payments[0].tendered, 10000);
  update("qr", { method: "cash", tendered: 5559, reference: undefined });
  update("qr", { amount: 3559 });
  assert.equal(payments[1].tendered, 3559);
  update("cash", { tendered: 6000 }, true);
  update("cash", { amount: 6500 });
  assert.equal(payments[0].tendered, 6500);
  update("cash", { method: "cash", tendered: 6500 });
  update("cash", { amount: 7000 });
  assert.equal(payments[0].tendered, 7000);
});

function effectsHarness(initial: CheckoutPayment[]) {
  let payments = initial;
  const submitting = { current: false };
  let billRef: { current: string } | undefined;
  const previous: unknown[][] = [];
  const sync = source.slice(source.indexOf("  const paymentCount ="), source.indexOf("  const idempotencyRef ="));
  const reset = source.slice(source.indexOf("  const checkoutBillKey ="), source.indexOf("  const paymentTarget ="));
  const compiled = ts.transpileModule(sync + reset, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return {
    payments: () => payments,
    replace: (next: CheckoutPayment[]) => { payments = next; },
    render: (total: number, bill = "FAKE-group", busy = false, saleMode = "SALE") => {
      submitting.current = busy;
      let cursor = 0;
      const effects: (() => void)[] = [];
      new Function("payments", "total", "source", "boardGameParams", "restaurantCheckId", "saleMode", "submitting",
        "submittedRef", "useEffect", "useRef", "setPayments", "setSaleMode", "syncSingleCheckoutPayment", compiled)(
        payments, total, "board_game", { boardGameBillingGroupId: bill }, null, saleMode, busy, submitting,
        (effect: () => void, deps: unknown[]) => {
          const before = previous[cursor];
          if (!before || deps.some((v, i) => !Object.is(v, before[i]))) effects.push(effect);
          previous[cursor++] = deps;
        },
        (value: string) => billRef ??= { current: value },
        (value: CheckoutPayment[] | ((p: CheckoutPayment[]) => CheckoutPayment[])) => {
          payments = typeof value === "function" ? value(payments) : value;
        }, () => {}, syncSingleCheckoutPayment,
      );
      effects.forEach(effect => effect());
    },
  };
}

test("native total refresh preserves explicit cash and split rows; only a new bill resets them", () => {
  const h = effectsHarness([{ id: "cash", method: "cash", amount: 9559, tendered: 12354, manualTender: true }]);
  h.render(9559);
  h.render(9000);
  assert.equal(h.payments()[0].amount, 9000);
  assert.equal(h.payments()[0].tendered, 12354);
  const split: CheckoutPayment[] = [h.payments()[0], { id: "qr", method: "qr", amount: 500, reference: "FAKE" }];
  h.replace(split);
  h.render(9500);
  assert.strictEqual(h.payments(), split);
  h.render(100, "FAKE-new-group");
  assert.equal(h.payments().length, 1);
  assert.equal(h.payments()[0].tendered, 100);
});

test("native split collapse and submit unlock reconcile automatic cash; deposit is not full-bill cash", () => {
  const h = effectsHarness([
    { id: "cash", method: "cash", amount: 4000, tendered: 4000 },
    { id: "qr", method: "qr", amount: 5559, reference: "FAKE" },
  ]);
  h.render(9559);
  h.replace(h.payments().slice(0, 1));
  h.render(9559);
  assert.equal(h.payments()[0].tendered, 9559);
  h.render(10000, "FAKE-group", true);
  assert.equal(h.payments()[0].tendered, 9559);
  h.render(10000);
  assert.equal(h.payments()[0].tendered, 10000);
  h.replace([{ id: "deposit", method: "cash", amount: 100, tendered: 500, manualTender: true }]);
  h.render(11000, "FAKE-group", false, "DEPOSIT");
  assert.equal(h.payments()[0].amount, 100);
  assert.equal(h.payments()[0].tendered, 500);
});
