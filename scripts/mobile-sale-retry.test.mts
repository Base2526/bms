import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isDecidedRejection, PosConnectionError, posErrorConnectionStatus } from "../packages/pos-client-core/src/operation.ts";
import { PosSaleResultError } from "../packages/pos-client-core/src/saleRetry.ts";

// Execute the shipping screen handler, not a second implementation of retry policy.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/mobile/src/screens/sell/CheckoutScreen.tsx", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("  const completeSale = async"), source.indexOf("  const linesCard ="));
const compiled = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(responses: any[], options: { offlineEligible?: boolean; mode?: string; source?: string; refreshFails?: boolean } = {}) {
  const requests: any[] = [], queued: string[] = [], discarded: string[] = [], completed: string[] = [], stages: any[] = [], alerts: any[] = [];
  const attempt = { current: null as any }, key = { current: null as string | null };
  let sequence = 0, pricingChecks = 0, offlineMarks = 0, navigations = 0, message = "", cartClears = 0;
  const cart = {
    lines: [{ sku: "FAKE-SKU", size: "S", packCode: "BASE", qty: 1, baseQty: 1, unitName: "piece", modifierCodes: [], serials: [] }],
    member: { id: "FAKE-member" }, coupon: { code: "FAKE-coupon" }, pointsUsed: 100,
    manualDiscount: null, extraLines: [], pharmacyReview: null,
    refreshPricing: async () => { pricingChecks++; return { error: null, changed: false }; },
    clear: () => { cartClears++; },
  };
  const deps: Record<string, any> = {
    saleAttemptRef: attempt, idempotencyRef: key, submittedRef: { current: false },
    canConfirmPayment: true, restaurantPaymentsValid: true, restaurantReady: true, boardGameReady: true,
    session: { credentials: { cashierUserId: "FAKE-cashier", pin: "1234" }, cashier: { id: "FAKE-cashier" } },
    setSubmitting: () => {}, setConfirmOpen: () => {}, setSaleRetryMessage: (value: string) => { message = value; },
    serverHealth: { status: "online", checkNow: async () => true, markOffline: () => { offlineMarks++; } },
    offlineEligible: options.offlineEligible ?? false, source: options.source ?? "retail", saleMode: options.mode ?? "SALE",
    offlinePayload: (idempotencyKey: string) => ({ idempotencyKey, mode: "SALE", lines: cart.lines, payments: [{ method: "CASH", amount: 100 }] }),
    offlineSales: {
      stage: async (value: any) => { stages.push(value); },
      discard: async (id: string) => { discarded.push(id); },
      queue: async (id: string) => { queued.push(id); },
      complete: async (id: string) => { completed.push(id); },
    },
    createIdempotencyKey: () => `key-${++sequence}`, cart, total: 100, paymentTarget: 100,
    boardGamePreview: { status: "READY", amountDue: 100, pointsUsed: 0 }, restaurantPreview: null,
    boardGamePricing: { refetch: async () => { pricingChecks++; return { data: { bmsPosMemberPreview: deps.boardGamePreview } }; } },
    boardGameParams: null, paymentInput: [{ method: "CASH", amount: 100, cashTendered: 120, ref: null }],
    creditApproverPin: "", creditApproverId: "", depositNote: "", depositDueAt: "", pharmacistId: "", pharmacistPin: "", pharmacistNote: "",
    runWithOperationTimeout: (work: any) => work(new AbortController().signal),
    sell: async ({ variables }: any) => {
      requests.push(variables.input);
      const response = responses.shift();
      if (response instanceof Error || response?.graphQLErrors || response?.networkError) throw response;
      return { data: { bmsPosSale: response } };
    },
    refreshSales: async () => { if (options.refreshFails) throw new Error("refresh failed after committed sale"); },
    navigation: { reset: () => { navigations++; }, replace: () => { navigations++; } },
    finishCheckout: (navigate: () => void) => { attempt.current = null; message = ""; navigate(); },
    Alert: { alert: (...args: any[]) => alerts.push(args) },
    describeMobileSaleFailure: (result: any) => result?.reason ?? result?.status ?? "missing result",
    PosSaleResultError, posErrorConnectionStatus, isDecidedRejection,
  };
  const submit = new Function(...Object.keys(deps), `${compiled}; return completeSale;`)(...Object.values(deps));
  return { submit, attempt, key, requests, queued, discarded, stages, completed, cart, deps,
    stats: () => ({ pricingChecks, offlineMarks, navigations, message, cartClears }) };
}

test("mobile pending VAT bill retries the exact input once after correction, without another reservation identity", async () => {
  const h = harness([
    { status: "PAYMENT_FAILED", reason: "VAT category missing" },
    { status: "PAYMENT_FAILED", reason: "VAT category missing" },
    { status: "SOLD", orderId: "original-order" },
  ], { offlineEligible: true });
  await h.submit();
  assert.ok(h.attempt.current);
  assert.equal(h.stats().offlineMarks, 0);
  // Background membership/price updates cannot rewrite a pending bill's tender or benefits.
  h.cart.pointsUsed = 0;
  h.deps.paymentInput[0].amount = 999;
  await h.submit();
  await h.submit();
  assert.equal(h.stats().pricingChecks, 1);
  assert.equal(new Set(h.requests.map(request => request.idempotencyKey)).size, 1);
  assert.ok(h.requests.every(request => request === h.requests[0]));
  assert.equal(h.requests[2].pointsToRedeem, 100);
  assert.equal(h.requests[2].payments[0].amount, 100);
  assert.equal(h.requests[2].payments[0].cashTendered, 120);
  assert.deepEqual(h.queued, []);
  assert.deepEqual(h.discarded, []);
  assert.deepEqual(h.completed, ["key-1"]);
  assert.equal(h.stats().navigations, 1);
  assert.equal(h.attempt.current, null);
});

test("mobile pending attempt survives denied retry, lost connection and a new unavailable pricing preview", async () => {
  const h = harness([
    { status: "PAYMENT_FAILED" },
    { graphQLErrors: [{ extensions: { code: "FORBIDDEN" } }] },
    new PosConnectionError("timeout"),
    { status: "SOLD", orderId: "original" },
  ], { source: "board_game" });
  await h.submit();
  h.deps.boardGameReady = false;
  await h.submit();
  assert.ok(h.attempt.current);
  assert.equal(h.stats().offlineMarks, 0);
  await h.submit();
  assert.ok(h.attempt.current);
  assert.equal(h.stats().offlineMarks, 1);
  h.deps.serverHealth.status = "offline";
  await h.submit();
  assert.equal(h.stats().pricingChecks, 1);
  assert.equal(h.stats().navigations, 1);
  assert.ok(h.requests.every(request => request === h.requests[0]));
});

test("mobile fresh business refusals release inputs, keep health online and permit correction", async () => {
  for (const response of [{ status: "PAYMENT_MISMATCH" }, { status: "COUPON_INVALID" }, { graphQLErrors: [{ extensions: { code: "FORBIDDEN" } }] }]) {
    const h = harness([response, { status: "SOLD", orderId: "new-order" }], { offlineEligible: true });
    await h.submit();
    assert.equal(h.key.current, null);
    assert.equal(h.attempt.current, null);
    assert.equal(h.stats().offlineMarks, 0);
    assert.deepEqual(h.queued, []);
    await h.submit();
    assert.notEqual(h.requests[0].idempotencyKey, h.requests[1].idempotencyKey);
  }
});

test("mobile unknown cash outcomes remain in the existing durable recovery queue", async () => {
  for (const response of [new PosConnectionError("timeout"), { status: "SOLD" }, null]) {
    const h = harness([response], { offlineEligible: true });
    await h.submit();
    assert.deepEqual(h.queued, ["key-1"]);
    assert.deepEqual(h.discarded, []);
    assert.equal(h.stats().offlineMarks, response instanceof PosConnectionError ? 1 : 0);
    assert.equal(h.stats().navigations, 1);
  }
});

test("mobile non-offline sale retains unknown results; completed sale/deposit survives refresh failure", async () => {
  const uncertain = harness([new PosConnectionError("timeout"), { status: "SOLD", orderId: "same" }]);
  await uncertain.submit();
  assert.ok(uncertain.attempt.current);
  await uncertain.submit();
  assert.equal(uncertain.requests[0], uncertain.requests[1]);
  for (const mode of ["SALE", "DEPOSIT"]) {
    const h = harness([{ status: mode === "SALE" ? "SOLD" : "DEPOSIT_TAKEN", orderId: "committed" }], { mode, refreshFails: true });
    await h.submit();
    assert.equal(h.attempt.current, null);
    assert.equal(h.key.current, null);
    assert.equal(h.stats().navigations, 1);
    assert.equal(h.stats().offlineMarks, 0);
  }
});

test("mobile disables leaving and editing a retained bill while exposing a manual retry", () => {
  assert.match(source, /usePreventRemove\(submitting \|\| Boolean\(saleAttemptRef.current\)/);
  const recovery = source.slice(source.indexOf("  if (saleRetryMessage && saleAttemptRef.current)"));
  assert.match(recovery.slice(0, recovery.indexOf("\n  return (")), /onPress=\{\(\) => void completeSale\(\)\}/);
  assert.match(source, /syncSingleCheckoutPayment\(\s*current,\s*total,\s*submittedRef.current \|\| Boolean\(saleAttemptRef.current\),?\s*\)/);
});

test("mobile double confirmation sends one request; pricing change submits nothing", async () => {
  const h = harness([{ status: "SOLD", orderId: "single" }]);
  let release!: (value: boolean) => void;
  h.deps.serverHealth.checkNow = () => new Promise<boolean>(resolve => { release = resolve; });
  const first = h.submit();
  await h.submit();
  release(true);
  await first;
  assert.equal(h.requests.length, 1);
  const changed = harness([]);
  changed.cart.refreshPricing = async () => ({ error: null, changed: true });
  await changed.submit();
  assert.equal(changed.requests.length, 0);
  assert.equal(changed.attempt.current, null);
});
