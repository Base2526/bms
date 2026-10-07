import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { syncSingleCheckoutPayment, type CheckoutPayment } from "../apps/web/components/pos-desktop/checkoutPayment.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/components/pos-desktop/DesktopPosRenderer.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const handler = source.slice(source.indexOf("  const submitSale = async"), source.indexOf("  const newSale ="));
const compiled = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
class PosGraphqlError extends Error {
  constructor(message: string, public code: string | null, public httpStatus: number | null = null) { super(message); }
}
function harness(options: { scan?: () => Promise<boolean>; responses?: unknown[] } = {}) {
  const requests: unknown[] = [], errors: string[] = [], events: string[] = [];
  const attempt = { current: null as any }, submitting = { current: false };
  let sequence = 0;
  const responses = [...(options.responses ?? [{ bmsPosSale: { status: "SOLD", orderId: "FAKE-order" } }])];
  const deps = {
    cashier: { id: "FAKE-cashier" }, busy: false, canConfirmPayment: true, boardGameCheckout: null,
    cart: [{}], token: "FAKE-token", POS_SALE_MUTATION: "sale", saleAttemptRef: attempt, saleSubmittingRef: submitting,
    setBusy: () => {}, setError: (value: string) => { if (value) errors.push(value); }, setNotice: () => {},
    recheckCartPricing: options.scan ?? (async () => true), createIdempotencyKey: () => `key-${++sequence}`,
    buildSalePayload: (key: string) => ({ input: { idempotencyKey: key, couponCode: "FAKE", pointsToRedeem: 100 } }),
    posGraphqlRequest: async (_token: string, _query: string, payload: unknown) => {
      requests.push(payload);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    setReceipt: () => events.push("receipt"), sendFlow: () => events.push("completed"), setConnection: () => {},
    loadReceiptPaper: async () => {}, PosGraphqlError, messageOf: (error: Error) => error.message,
    decidedCodes: new Set(["BAD_USER_INPUT", "FORBIDDEN"]),
  };
  const submit = new Function(...Object.keys(deps), `${compiled}; return submitSale;`)(...Object.values(deps));
  return { submit, requests, errors, events, attempt, submitting };
}

test("two clicks before a render await one pricing check and send one sale", async () => {
  let resolve!: (value: boolean) => void;
  let scans = 0;
  const h = harness({ scan: () => { scans++; return new Promise((done) => { resolve = done; }); } });
  const first = h.submit();
  await h.submit();
  assert.equal(scans, 1);
  assert.equal(h.requests.length, 0);
  resolve(true);
  await first;
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.events, ["receipt", "completed"]);
  assert.equal(h.submitting.current, false);
});

test("timeouts and incomplete success retain the exact coupon/points payload and key", async () => {
  for (const response of [new Error("lost response"), new PosGraphqlError("timeout", null, 408),
    { bmsPosSale: { status: "SOLD" } }, { bmsPosSale: {} }]) {
    const h = harness({ responses: [response, { bmsPosSale: { status: "SOLD", orderId: "FAKE-order" } }] });
    await h.submit();
    assert.ok(h.attempt.current);
    assert.equal(h.submitting.current, false);
    assert.match(h.errors[0], /ยังไม่ทราบผล/);
    await h.submit();
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[0], h.requests[1]);
    assert.equal(h.attempt.current, null);
  }
});

test("an explicit refusal and a failed preflight are known failures, not unknown payments", async () => {
  for (const options of [
    { responses: [{ bmsPosSale: { status: "PAYMENT_MISMATCH", reason: "ยอดไม่ตรง" } }] },
    { responses: [new PosGraphqlError("ไม่มีสิทธิ์", "FORBIDDEN", 403)] },
    { scan: async () => { throw new Error("ราคายังไม่พร้อม"); } },
  ]) {
    const h = harness(options);
    await h.submit();
    assert.equal(h.attempt.current, null);
    assert.equal(h.submitting.current, false);
    assert.equal(h.errors.length, 1);
    assert.doesNotMatch(h.errors[0], /ยังไม่ทราบผล/);
  }
});

test("changed prices release the click lock without submitting", async () => {
  const h = harness({ scan: async () => false });
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.equal(h.submitting.current, false);
});

test("a total changed while submitting resyncs after a decided failure, but not an unknown result", () => {
  const start = source.indexOf("  const paymentCount = payments.length;");
  const end = source.indexOf("  const validation =", start);
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const manualTender of [false, true]) {
    let payments: CheckoutPayment[] = [{ id: "cash", method: "cash", amount: 11017, tendered: 12354, manualTender }];
    let previous: unknown[] | undefined;
    const submitting = { current: false }, attempt = { current: null as unknown };
    const render = (busy: boolean, total: number) => new Function(
      "payments", "busy", "total", "saleSubmittingRef", "saleAttemptRef", "useEffect", "setPayments", "syncSingleCheckoutPayment", js,
    )(payments, busy, total, submitting, attempt, (effect: () => void, deps: unknown[]) => {
      if (!previous || deps.some((value, i) => !Object.is(value, previous![i]))) effect();
      previous = deps;
    }, (update: (value: CheckoutPayment[]) => CheckoutPayment[]) => { payments = update(payments); }, syncSingleCheckoutPayment);
    render(false, 11017);
    submitting.current = true;
    render(true, 11017);
    render(true, 9559);
    assert.equal(payments[0].amount, 11017);
    // Unknown outcome: unlocking controls must NOT rewrite the retry payload's tender.
    submitting.current = false;
    attempt.current = { key: "FAKE-pending" };
    render(false, 9559);
    assert.equal(payments[0].amount, 11017);
    submitting.current = true;
    render(true, 9559);
    // Retry is explicitly refused; the cashier may now review the current due.
    submitting.current = false;
    attempt.current = null;
    render(false, 9559);
    assert.equal(payments[0].amount, 9559);
    assert.equal(payments[0].tendered, manualTender ? 12354 : 9559);
  }
});

test("leaving checkout or changing cashier cannot discard an unresolved payment", () => {
  const start = source.indexOf("  const paymentNavigationBlocked = useCallback(");
  const end = source.indexOf("  const legacy =", start);
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const flags of [[false, false, false], [true, false, false], [false, true, false], [false, false, true]]) {
    const guard = new Function("useCallback", "saleSubmittingRef", "saleAttemptRef", "receiptPrintingRef", "setError",
      `${js};return paymentNavigationBlocked;`)((fn: unknown) => fn, { current: flags[0] }, { current: flags[1] }, { current: flags[2] }, () => {});
    assert.equal(guard(), flags.some(Boolean));
  }
  for (const name of ["legacy", "openModule", "unpair", "signOutCashier", "backFromCheckout"]) {
    const block = source.slice(source.indexOf(`  const ${name} =`));
    assert.match(block.slice(0, block.indexOf("\n  };\n") + 6 || 500), /if \(paymentNavigationBlocked\(\)\) return/);
  }
  assert.match(source, /fieldset className=\{styles.paymentControls\} disabled=\{busy \|\| Boolean\(saleAttemptRef.current\)\}/);
  assert.match(source, /onClick=\{\(\) => removePayment\(payment.id\)\}/);
});
