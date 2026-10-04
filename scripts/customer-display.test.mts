import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDisplayReceiver, displayBrand, displayMemberName, displayPhase, displayUrl, EMPTY_CUSTOMER_DISPLAY, isDisplayPayload } from "../apps/web/lib/pos/customerDisplay.ts";

const cart = { ...EMPTY_CUSTOMER_DISPLAY, lines: [{ name: "FAKE item", qty: 1, size: null, unitName: "piece", amount: 178 }], total: 178, amountDue: 178, itemCount: 1 };
const finished = { ...cart, finished: { id: "FAKE-order-1", total: 178, tendered: 200, change: 22 } };

test("four display phases reflect real sale state, with no inferred payment success", () => {
  assert.equal(displayPhase(EMPTY_CUSTOMER_DISPLAY), "idle");
  assert.equal(displayPhase(cart), "cart");
  assert.equal(displayPhase({ ...cart, checkout: true }), "payment");
  assert.equal(displayPhase({ ...cart, paymentQr: { payload: "FAKE-provider-payload", amount: 78, accountName: null, promptpayId: null } }), "payment");
  assert.equal(displayPhase(finished), "finished");
  assert.equal(displayPhase({ ...cart, checkout: true, pendingApproval: true }), "cart");
});

test("heartbeats do not renew a completed bill; another bill with identical totals still appears", () => {
  const receiver = createDisplayReceiver();
  receiver.receive(finished, 0);
  receiver.receive(finished, 9000);
  assert.equal(displayPhase(receiver.read(9999).state), "finished");
  assert.equal(displayPhase(receiver.read(10000).state), "idle");
  receiver.receive(finished, 11000);
  assert.equal(displayPhase(receiver.read(11000).state), "idle");
  receiver.receive({ ...finished, finished: { ...finished.finished, id: "FAKE-order-2" } }, 12000);
  assert.equal(displayPhase(receiver.read(12000).state), "finished");
  receiver.receive(cart, 12500);
  assert.equal(displayPhase(receiver.read(12500).state), "cart");
});

test("lost register hides money, QR, member and receipt link while preserving shop branding", () => {
  const receiver = createDisplayReceiver();
  const brand = { name: "FAKE shop", branch: null, logoUrl: "/api/files/1" };
  receiver.receive({ ...cart, brand, memberName: "FAK***", paymentQr: { payload: "FAKE-QR", amount: 178, accountName: null, promptpayId: null } }, 0);
  const stale = receiver.read(8000);
  assert.equal(stale.linked, false);
  assert.deepEqual(stale.state, { ...EMPTY_CUSTOMER_DISPLAY, brand });
  receiver.receive(cart, 10000);
  assert.equal(receiver.read(10000).linked, true);
  assert.equal(receiver.read(10000).state.amountDue, 178);
});

test("an expired receipt cannot reappear after an idle or another workspace's receipt", () => {
  const receiver = createDisplayReceiver();
  receiver.receive(finished, 0);
  receiver.receive(EMPTY_CUSTOMER_DISPLAY, 5000);
  receiver.receive(finished, 11000);
  assert.equal(displayPhase(receiver.read(11000).state), "idle");
  receiver.receive({ ...finished, finished: { ...finished.finished, id: "FAKE-order-2" } }, 12000);
  assert.equal(displayPhase(receiver.read(12000).state), "finished");
  receiver.receive(finished, 12500);
  assert.equal(displayPhase(receiver.read(12500).state), "idle");
});

test("pending pricing suppresses payment mode even if an old QR exists", () => {
  assert.equal(displayPhase({ ...cart, pendingPricing: true, checkout: true,
    paymentQr: { payload: "FAKE-old-QR", amount: 178, accountName: null, promptpayId: null } }), "cart");
  assert.equal(isDisplayPayload({ ...cart, pendingPricing: "false" }), false);
});

test("opening a new display cannot revive a receipt completed more than ten seconds ago", () => {
  const receiver = createDisplayReceiver();
  receiver.receive({ ...finished, finished: { ...finished.finished, completedAt: 1000 } }, 11000);
  assert.equal(displayPhase(receiver.read(11000).state), "idle");
  receiver.receive({ ...finished, finished: { ...finished.finished, completedAt: 11000 } }, 12000);
  assert.equal(displayPhase(receiver.read(12000).state), "idle", "same receipt cannot renew its completion timestamp");
});

test("all publishers clear customer state when the cashier is locked or working elsewhere", () => {
  const read = (file: string) => readFileSync(new URL(`../apps/web/${file}`, import.meta.url), "utf8");
  const retail = read("app/(pos)/pos/page.tsx");
  const restaurant = read("app/(pos)/pos/restaurant/page.tsx");
  const desktop = read("components/pos-desktop/DesktopPosRenderer.tsx");
  assert.match(retail, /!token \|\| tokenRejected \|\| !session\?\.shift \|\| !cashierId \|\| !pin \|\| tab !== "sell"/);
  assert.match(retail, /cart\.length === 0 && extraTotal === 0 && !boardGameCheckout \? justSold : null/);
  assert.match(retail, /memberPreviewAppliedKey !== memberPreviewRequestKey/);
  assert.match(retail, /return !pendingPricing && !approvedDiscount\?\.amount && configuredQr/);
  assert.match(restaurant, /!token \|\| tokenRejected \|\| !session\?\.shift \|\| !actorUserId \|\| !actorPin/);
  assert.match(restaurant, /!check && settlementReceipt/);
  assert.match(restaurant, /screen !== "ORDER" && !checkoutOpen/);
  assert.match(restaurant, /amountDue: checkoutOpen \? checkoutDue : check.amountDue/);
  assert.match(restaurant, /pricingDisplayKey !== pricingDisplayRequestKey/);
  assert.match(restaurant, /setPricingDisplayKey\(pricingDisplayRequestKey\)/);
  assert.match(desktop, /Boolean\(token && cashier && bootstrap\?\.shift/);
  assert.match(desktop, /flow.stage === "CATALOG" && shownModule === "mobile_sell"/);
  assert.match(desktop, /!displayActive\s*\? \{ \.\.\.EMPTY_CUSTOMER_DISPLAY/);
});

test("control and malformed messages cannot mark the display connected or replace good data", () => {
  const receiver = createDisplayReceiver();
  for (const payload of [null, {}, { type: "hello" }, { type: "ping" }, { ...cart, total: NaN }, { ...cart, lines: [null] }, { ...cart, finished: {} }, { ...cart, brand: { name: {} } }]) {
    assert.equal(isDisplayPayload(payload), false);
    assert.equal(receiver.receive(payload, 0), false);
  }
  assert.equal(receiver.read(0).linked, false);
  receiver.receive(cart, 1000);
  receiver.receive({ type: "hello" }, 7000);
  assert.equal(receiver.read(9000).linked, false);
});

test("customer identity is masked and image/link URLs refuse script and credential schemes", () => {
  assert.equal(displayMemberName("Somchai PrivateSurname"), "Som***");
  assert.equal(displayMemberName("Som***"), "Som***");
  assert.equal(displayMemberName("Bo***"), "Bo***");
  assert.equal(displayMemberName("0812345678"), null);
  assert.equal(displayMemberName("customer@example.com"), null);
  assert.equal(displayUrl("javascript:alert(1)"), null);
  assert.equal(displayUrl("https://user:password@example.com"), null);
  assert.equal(displayUrl("//example.com"), null);
  assert.equal(displayUrl("/api/files/7721"), "/api/files/7721");
  assert.equal(displayUrl("https://example.com/tax?token=FAKE"), "https://example.com/tax?token=FAKE");
});

test("brand uses shop name separately from branch and never invents public links or hours", () => {
  assert.equal(displayBrand(null), null);
  assert.deepEqual(displayBrand({ store: { name: "FAKE shop", logoUrl: "/api/files/1" }, location: { name: "FAKE branch" } }), {
    name: "FAKE shop", branch: "FAKE branch", logoUrl: "/api/files/1", businessHours: null, website: null,
  });
});
