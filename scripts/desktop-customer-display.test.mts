import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { displayBrand, displayMemberName, displayPhase, EMPTY_CUSTOMER_DISPLAY } from "../apps/web/lib/pos/customerDisplay.ts";
import { validatePayments } from "../packages/pos-client-core/src/payment.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/components/pos-desktop/DesktopPosRenderer.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const effect = source.slice(source.indexOf("  useEffect(() => {\n    const finished = receipt"), source.indexOf("  const backFromCheckout ="));
assert.ok(effect.includes("customerDisplayPayloadRef.current = payload"));
const compiled = ts.transpileModule(effect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function publish({ ready = true, total = 68, receipt = null, receiptPaper = null }: { ready?: boolean; total?: number; receipt?: any; receiptPaper?: any } = {}) {
  const messages: any[] = [];
  const payments = [{ id: "qr", method: "qr" as const, amount: 68 }];
  const deps = {
    useEffect: (fn: () => void) => fn(),
    desktopOwnsCustomerDisplay: true, token: "FAKE", cashier: {}, shownModule: "mobile_sell",
    boardGameBenefitAmount: 0, boardGameCheckout: null, boardGameTotalDiscountAmount: 0,
    cart: [{ name: "FAKE product", qty: 1, unitName: "piece", unitPrice: 100 }],
    bootstrap: { shift: {}, location: null, store: { name: "FAKE shop", paymentQr: { payload: "FAKE-base", accountName: null, promptpayId: null } } },
    flow: { stage: receipt ? "RECEIPT" : "CHECKOUT" }, itemCount: 1, payments,
    payableBeforeRounding: total, pricingSavings: 0, receipt, receiptPaper, retailListSubtotal: 100, total,
    validation: validatePayments(total, payments),
    benefits: { ready, preview: { totalDiscount: 32, pointsWillEarn: 3 }, member: { name: "FAKE Member", pointsBalance: 100 } },
    customerDisplayPayloadRef: { current: null }, customerDisplayChannelRef: { current: { postMessage: (p: unknown) => messages.push(p) } },
    displayBrand, displayMemberName, EMPTY_CUSTOMER_DISPLAY,
  };
  new Function(...Object.keys(deps), compiled)(...Object.values(deps));
  return messages[0];
}

test("desktop suppresses old QR and expected points while benefits are pending or failed", () => {
  const state = publish({ ready: false });
  assert.equal(state.pendingPricing, true);
  assert.equal(state.paymentQr, null);
  assert.equal(state.pointsWillEarn, null);
  assert.equal(displayPhase(state), "cart");
});

test("desktop waits for tender reconciliation before publishing the new amount", () => {
  assert.equal(publish({ total: 58 }).paymentQr, null);
  const ready = publish();
  assert.equal(ready.paymentQr.amount, 68);
  assert.equal(ready.pointsWillEarn, 3);
  assert.equal(ready.pointsEarned, null);
});

test("member completion is stable before receipt details load, including hidden names", () => {
  const receipt = { orderId: "FAKE-order", total: 68, cashTendered: null, cashChange: null,
    pointsEarned: 3, pointsBalance: 103, displayMember: { attached: true, name: null } };
  for (const receiptPaper of [null, { orderId: "another-order", member: null }, { orderId: "FAKE-order", member: null }]) {
    const state = publish({ receipt, receiptPaper });
    assert.equal(state.memberAttached, true);
    assert.equal(state.memberName, null);
    assert.equal(state.pointsEarned, 3);
    assert.equal(state.pointsWillEarn, null);
    assert.equal(state.paymentQr, null);
  }
});
