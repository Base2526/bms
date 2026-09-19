import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  initialPosClientFlow,
  transitionPosClientFlow,
} from "../packages/pos-client-core/src/flow.ts";
import {
  calculateCashChange,
  validatePayments,
} from "../packages/pos-client-core/src/payment.ts";
import { selectPosCatalogCardVariant } from "../packages/pos-client-core/src/catalog.ts";
import {
  isPosPinValid,
  normalizePosPinInput,
  POS_PIN_MAX_LENGTH,
  POS_PIN_MIN_LENGTH,
  visiblePosPinSlots,
} from "../packages/pos-client-core/src/posPin.ts";

const desktopRenderer = readFileSync(
  new URL("../apps/web/components/pos-desktop/DesktopPosRenderer.tsx", import.meta.url),
  "utf8",
);
const restaurantRenderer = readFileSync(
  new URL("../apps/web/app/(pos)/pos/restaurant/page.tsx", import.meta.url),
  "utf8",
);
const retailRenderer = readFileSync(
  new URL("../apps/web/app/(pos)/pos/page.tsx", import.meta.url),
  "utf8",
);
const boardGameRenderer = readFileSync(
  new URL("../apps/web/components/pos/BoardGamePanel.tsx", import.meta.url),
  "utf8",
);

test("desktop and native register flow requires a verified device, cashier PIN, and open shift", () => {
  let state = initialPosClientFlow(true);
  assert.equal(state.stage, "VERIFYING_DEVICE");

  state = transitionPosClientFlow(state, "DEVICE_VERIFIED");
  state = transitionPosClientFlow(state, "SHIFT_STATUS_OPEN");
  assert.equal(state.stage, "CASHIER_LOGIN");
  assert.equal(state.shiftOpen, true);

  state = transitionPosClientFlow(state, "CASHIER_VERIFIED");
  assert.equal(state.stage, "CATALOG");
  state = transitionPosClientFlow(state, "START_CHECKOUT");
  assert.equal(state.stage, "CHECKOUT");
  state = transitionPosClientFlow(state, "SALE_COMPLETED");
  assert.equal(state.stage, "RECEIPT");
});

test("an unopened shift blocks checkout even after cashier verification", () => {
  let state = transitionPosClientFlow(initialPosClientFlow(true), "DEVICE_VERIFIED");
  state = transitionPosClientFlow(state, "CASHIER_VERIFIED");
  assert.equal(state.stage, "SHIFT_REQUIRED");
  state = transitionPosClientFlow(state, "START_CHECKOUT");
  assert.equal(state.stage, "SHIFT_REQUIRED");
});

test("shared payment validation balances split tender and computes cash change", () => {
  const result = validatePayments(250, [
    { id: "cash", method: "cash", amount: 100, tendered: 120 },
    { id: "qr", method: "qr", amount: 150, reference: "TX-1" },
  ]);
  assert.equal(result.canConfirm, true);
  assert.equal(result.paidTotal, 250);
  assert.equal(calculateCashChange(100, 120), 20);
});

test("every POS client uses the shared numeric 4-8 digit PIN policy", () => {
  assert.equal(POS_PIN_MIN_LENGTH, 4);
  assert.equal(POS_PIN_MAX_LENGTH, 8);
  assert.equal(isPosPinValid("0123"), true, "a leading zero is part of the PIN");
  assert.equal(isPosPinValid("12345678"), true);
  assert.equal(isPosPinValid("123"), false);
  assert.equal(isPosPinValid("123456789"), false);
  assert.equal(isPosPinValid("12a4"), false);
  assert.equal(normalizePosPinInput("01a23-456789"), "01234567");
  assert.equal(visiblePosPinSlots(""), 4);
  assert.equal(visiblePosPinSlots("123456"), 6);
});

test("catalog cards show stock for the same variant that clicking will sell", () => {
  const item42 = selectPosCatalogCardVariant({
    price: 149,
    availableTotal: 99,
    availableSizes: [
      { size: "S", available: 25, price: 149 },
      { size: "M", available: 32, price: 149 },
      { size: "L", available: 17, price: 149 },
      { size: "XL", available: 25, price: 149 },
    ],
  });
  const item453 = selectPosCatalogCardVariant({
    price: 3_831,
    availableTotal: 99,
    availableSizes: [
      { size: "S", available: 2, price: 3_831 },
      { size: "M", available: 13, price: 3_831 },
      { size: "L", available: 48, price: 3_831 },
      { size: "XL", available: 36, price: 3_831 },
    ],
  });

  assert.equal(item42.variant?.size, "L");
  assert.equal(item42.available, 17);
  assert.equal(item453.variant?.size, "L");
  assert.equal(item453.available, 48);
  assert.notEqual(item42.available, 99, "the all-size total must not label the selected L variant");
});

test("desktop header keeps cashier identity without a permanent legacy-sales escape button", () => {
  assert.doesNotMatch(
    desktopRenderer,
    />ฟังก์ชันขายทั้งหมด<\/button>/,
    "the desktop renderer must have one obvious primary sales surface",
  );
  assert.match(desktopRenderer, /className=\{styles\.accountMenu\}/);
  assert.doesNotMatch(desktopRenderer, />ข้อมูลกะ<\/button>/);
  assert.doesNotMatch(desktopRenderer, />ตั้งค่าเครื่อง<\/button>/);
  assert.doesNotMatch(desktopRenderer, /className=\{styles\.signOut\}/);
  assert.match(desktopRenderer, /ล็อก \/ เปลี่ยนพนักงาน/);
  assert.match(
    desktopRenderer,
    /สินค้านี้ต้องกรอก serial \/ น้ำหนัก \/ ตัวเลือกเพิ่มเติม[\s\S]*?openModule\("sell"\)/,
    "advanced items must retain a contextual path to the full sales workflow",
  );
});

test("desktop checkout does not repeat the payment selector for a single tender", () => {
  assert.match(
    desktopRenderer,
    /\{payments\.length > 1 \? \([\s\S]*?<select value=\{payment\.method\}/,
    "the per-row method selector belongs only to split payments",
  );
  assert.match(
    desktopRenderer,
    /const paymentCount = payments\.length;[\s\S]*?\}, \[paymentCount, total\]\);/,
    "returning from split to one tender must restore the authoritative total",
  );
});

test("desktop POS alerts expose a close control on every operating surface", () => {
  const restaurantAlerts = restaurantRenderer.match(/<Alert\b[\s\S]*?\/>/g) ?? [];
  assert.ok(restaurantAlerts.length > 0, "restaurant POS should render operational alerts");
  restaurantAlerts.forEach((alert, index) => {
    assert.match(alert, /\bclosable\b/, `restaurant Alert ${index + 1} must expose a close button`);
  });

  assert.match(retailRenderer, /PosDismissibleAlert/);
  assert.doesNotMatch(retailRenderer, /<div className="pos-note(?:\s|"|`)/);
  assert.match(boardGameRenderer, /PosDismissibleAlert/);
  assert.match(desktopRenderer, /PosDismissibleAlert/);
  assert.match(desktopRenderer, /useOrderAlerts\(Boolean\(bootstrap && cashier\)\)/);
  assert.match(desktopRenderer, /OrderAlertSettingsModal/);
  assert.match(desktopRenderer, /styles\.alertBell/);
  assert.match(desktopRenderer, /serviceCalls\.length > 0/);
  assert.match(desktopRenderer, /\/api\/pos\/restaurant\/service-calls/);
  assert.match(desktopRenderer, /action: "service\.acknowledge"/);
  assert.doesNotMatch(desktopRenderer, /<(?:div|p) className=\{styles\.(?:errorBox|noticeBox)\}/);
});
