import assert from "node:assert/strict";
import test from "node:test";

import {
  decoratePosSale,
  isDistinctPosApprover,
  isPosUuid,
  normalizePosSearchQuery,
  parsePosExtraLines,
  parsePosPayments,
  parsePosSaleLines,
} from "../apps/web/lib/bms/posRouteHelpers.ts";
import { cashRoundingDelta, isCashRounding } from "../apps/web/lib/pos/cashRounding.ts";
import { calculatePettyCashSettlement } from "../apps/web/lib/pos/pettyCash.ts";

test("POS sale line parser keeps only valid positive integer pack quantities", () => {
  const lines = parsePosSaleLines([
    { sku: "SKU-1 ", size: "M", packQty: 2, packCode: "BOX" },
    { sku: " ", size: "M", packQty: 1 },
    { sku: "SKU-2", size: "", packQty: 1 },
    { sku: "SKU-3", size: "L", packQty: 1.5 },
  ]);
  assert.deepEqual(lines, [
    {
      sku: "SKU-1",
      size: "M",
      packQty: 2,
      packCode: "BOX",
      unitName: null,
      baseQty: null,
      packPrice: null,
      serials: null,
    },
  ]);
});

test("POS payment parser accepts valid methods and rejects bad inputs", () => {
  const ok = parsePosPayments([{ method: "wallet", amount: 199, ref: "APP-123" }]);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.payments[0], {
      method: "WALLET",
      amount: 199,
      cashTendered: null,
      ref: "APP-123",
    });
  }
  assert.deepEqual(parsePosPayments([{ method: "CRYPTO", amount: 10 }]), {
    ok: false,
    error: "วิธีชำระเงินไม่ถูกต้อง: CRYPTO",
  });
  assert.deepEqual(parsePosPayments([{ method: "CASH", amount: 0 }]), {
    ok: false,
    error: "จำนวนเงินต้องมากกว่า 0",
  });
  assert.deepEqual(parsePosPayments([{ method: "CASH", amount: 100, cashTendered: 99 }]), {
    ok: false,
    error: "เงินสดที่รับมาต้องไม่น้อยกว่ายอดที่ชำระด้วยเงินสด",
  });
  assert.deepEqual(parsePosPayments([{ method: "CASH", amount: 100, cashTendered: "not-a-number" }]), {
    ok: false,
    error: "เงินสดที่รับมาต้องไม่น้อยกว่ายอดที่ชำระด้วยเงินสด",
  });
  assert.equal(parsePosPayments([
    { method: "CASH", amount: 100, cashTendered: 120 },
    { method: "CARD", amount: 50, ref: "EDC-001" },
  ]).ok, true);
});

test("POS sale parser treats browser price fields as optional transport data", () => {
  const [line] = parsePosSaleLines([
    { sku: "SKU-1", size: "M", packQty: 1, packCode: "BOX", baseQty: 999, packPrice: 0.01 },
  ]);
  assert.equal(line.sku, "SKU-1");
  assert.equal(line.packCode, "BOX");
  // The route may carry these previews, but recordPosSale re-resolves pack/base quantity/price
  // from the tenant catalog before creating the order.
  assert.equal(line.baseQty, 999);
  assert.equal(line.packPrice, 0.01);
});

test("POS extra lines drop non-finite quantities before they reach Postgres", () => {
  assert.deepEqual(parsePosExtraLines([
    { label: "ค่าถุง", qty: "not-a-number", unitAmount: 5 },
    { label: "จำนวนเศษ", qty: 1.5, unitAmount: 10 },
    { label: "ค่าห่อ", qty: 2, unitAmount: 10 },
  ]), [
    { label: "ค่าห่อ", qty: 2, unitAmount: 10 },
  ]);
});

test("POS search query normalization trims whitespace and null safely", () => {
  assert.equal(normalizePosSearchQuery("  milk tea  "), "milk tea");
  assert.equal(normalizePosSearchQuery(null), "");
});

test("POS order references reject barcodes before reaching UUID database columns", () => {
  assert.equal(isPosUuid("2000000000015"), false);
  assert.equal(isPosUuid("c4f9052a-9484-46e9-a47d-e7b57c08e867"), true);
  assert.equal(isPosUuid(" C4F9052A-9484-46E9-A47D-E7B57C08E867 "), true);
});

test("POS approval requires a different acting user", () => {
  assert.equal(isDistinctPosApprover("cashier-1", "manager-1"), true);
  assert.equal(isDistinctPosApprover("cashier-1", "cashier-1"), false);
  assert.equal(isDistinctPosApprover(" CASHIER-1 ", "cashier-1"), false);
  assert.equal(isDistinctPosApprover("cashier-1", " "), false);
});

// จอขายกับ server ต้องได้ตัวเลขเดียวกันเป๊ะ ไม่งั้นบิลโดน PAYMENT_MISMATCH ทิ้งทั้งใบ
// (ทั้งสองฝั่ง import ฟังก์ชันตัวเดียวกันนี้ — เทสต์ล็อกพฤติกรรมของมันไว้)
test("cash rounding matches the amount the counter must actually collect", () => {
  assert.equal(cashRoundingDelta(101.13, "NONE"), 0);
  // ปัดขึ้น/ลงเข้าหาค่าที่ใกล้ที่สุด
  assert.equal(cashRoundingDelta(101.13, "0.25"), 0.12);
  assert.equal(cashRoundingDelta(101.13, "0.50"), -0.13);
  assert.equal(cashRoundingDelta(101.13, "1.00"), -0.13);
  // เศษครึ่งพอดีปัดขึ้น (เข้าทางร้าน)
  assert.equal(cashRoundingDelta(10.5, "1.00"), 0.5);
  assert.equal(cashRoundingDelta(10.125, "0.25"), 0.13);
  // ยอดที่ลงตัวอยู่แล้วต้องไม่ขยับ
  assert.equal(cashRoundingDelta(20, "0.25"), 0);
  assert.equal(cashRoundingDelta(20.5, "0.50"), 0);
});

test("cash rounding rejects modes that are not in the settings enum", () => {
  assert.equal(isCashRounding("0.25"), true);
  assert.equal(isCashRounding("0.10"), false);
  assert.equal(isCashRounding(null), false);
});

test("petty-cash advances return change or request only the real extra cash", () => {
  assert.deepEqual(calculatePettyCashSettlement(500, 430), {
    advancedAmount: 500,
    actualAmount: 430,
    returnedAmount: 70,
    extraCashOut: 0,
    drawerDelta: -70,
  });
  assert.deepEqual(calculatePettyCashSettlement(500, 540.125), {
    advancedAmount: 500,
    actualAmount: 540.13,
    returnedAmount: 0,
    extraCashOut: 40.13,
    drawerDelta: 40.13,
  });
  assert.deepEqual(calculatePettyCashSettlement(500, 500), {
    advancedAmount: 500,
    actualAmount: 500,
    returnedAmount: 0,
    extraCashOut: 0,
    drawerDelta: 0,
  });
  assert.throws(() => calculatePettyCashSettlement(0, 0), RangeError);
  assert.throws(() => calculatePettyCashSettlement(100, -1), RangeError);
});

test("POS last-sale decorator adds storefront metadata without changing sale fields", () => {
  const decorated = decoratePosSale(
    { orderId: "ord-1", total: 250, paymentMethod: "CARD" },
    { storeName: "Main Branch", branchCode: "00001", posLabel: "POS01", vatRegistered: true }
  );
  assert.deepEqual(decorated, {
    orderId: "ord-1",
    total: 250,
    paymentMethod: "CARD",
    storeName: "Main Branch",
    branchCode: "00001",
    posLabel: "POS01",
    vatRegistered: true,
  });
});
