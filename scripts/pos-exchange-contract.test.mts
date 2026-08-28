import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { selectedReturnLines } from "../apps/web/lib/pos/returnDraft.ts";

const posPagePath = fileURLToPath(new URL("../apps/web/app/(pos)/pos/page.tsx", import.meta.url));

function functionSource(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} must exist`);
  return source.slice(start, end);
}

test("exchange selection stays scoped to the exact sold variant and caps at refundable quantity", () => {
  const lines = [
    { orderItemId: 101, refundablePackQty: 2 },
    { orderItemId: 102, refundablePackQty: 1 },
    // SKU/variant rows without a server order-item identity are never return authority.
    { refundablePackQty: 5 },
    { orderItemId: 103, refundablePackQty: Number.NaN },
  ];

  assert.deepEqual(selectedReturnLines(lines, { 101: 9, 102: 0 }), [
    { orderItemId: 101, packQty: 2 },
  ]);
});

test("exchange commits the receipt return before replacing the sale cart", () => {
  const source = readFileSync(posPagePath, "utf8");
  const handler = functionSource(
    source,
    "async function startExchangeFromReceipt",
    "const activeReceiptRefundSummary"
  );

  const returnCall = handler.indexOf('fetch("/api/pos/return"');
  const successGuard = handler.indexOf('data.status !== "PARTIAL_RETURNED"');
  const cartWrite = handler.indexOf("setCart(refreshedCart)");
  const sellTab = handler.indexOf('setTab("sell")');

  assert.ok(returnCall >= 0, "exchange must use the permission/idempotency-gated return route");
  assert.ok(successGuard > returnCall, "exchange must verify the committed return result");
  assert.ok(cartWrite > successGuard, "the new sale cart must appear only after return success");
  assert.ok(sellTab > cartWrite, "the cashier must be taken to the visible sale workflow");
  assert.match(handler, /clearBillCustomerState\(\)/, "old customer/discount/approval state must not leak into the replacement sale");
  assert.match(handler, /returnIdempotencyKey\(row, "PARTIAL", lines, preferredRefundMethod\)/);
});

test("all three return actions report missing operator credentials instead of silently doing nothing", () => {
  const source = readFileSync(posPagePath, "utf8");
  const full = functionSource(source, "async function returnReceipt", "async function partialReturnReceipt");
  const partial = functionSource(source, "async function partialReturnReceipt", "async function completeRefundSettlement");
  const exchange = functionSource(source, "async function startExchangeFromReceipt", "const activeReceiptRefundSummary");

  assert.match(source, /function ensureReturnOperatorReady\(actionLabel: string\)/);
  assert.match(source, /เลือกพนักงานและใส่ PIN ก่อน\$\{actionLabel\}/);
  assert.match(full, /ensureReturnOperatorReady\("คืนทั้งบิล"\)/);
  assert.match(partial, /ensureReturnOperatorReady\("คืนบางรายการ"\)/);
  assert.match(exchange, /ensureReturnOperatorReady\("ทำบิลเปลี่ยนสินค้า"\)/);
});

test("partial and full return buttons send the correct modes and show the committed return receipt", () => {
  const source = readFileSync(posPagePath, "utf8");
  const full = functionSource(source, "async function returnReceipt", "async function partialReturnReceipt");
  const partial = functionSource(source, "async function partialReturnReceipt", "async function completeRefundSettlement");

  assert.match(full, /async function returnReceipt\(row: Receipt\)/, "full return must use the exact row the cashier clicked");
  assert.match(full, /mode: "FULL"/);
  assert.match(full, /returnIdempotencyKey\(row, "FULL", \[\], preferredRefundMethod\)/);
  assert.match(full, /data\.status === "RETURNED"/);
  assert.match(full, /setReceiptModalOpen\(true\)/);
  assert.match(full, /setReturnDrafts\(\(cur\) => \(\{ \.\.\.cur, \[orderId\]: \{\} \}\)\)/);
  assert.match(full, /กดซ้ำได้ ระบบใช้คีย์เดิมและไม่คืนซ้ำ/);

  assert.match(partial, /mode: "PARTIAL"/);
  assert.match(partial, /selectedReturnLines\(row\.lines, returnDrafts\[row\.orderId\] \?\? \{\}\)/);
  assert.match(partial, /returnIdempotencyKey\(row, "PARTIAL", lines, preferredRefundMethod\)/);
  assert.match(partial, /data\.status === "PARTIAL_RETURNED"/);
  assert.match(partial, /setReceiptModalOpen\(true\)/);
  assert.match(partial, /กดซ้ำได้ ระบบใช้คีย์เดิมและไม่คืนซ้ำ/);
});

test("exchange action cannot overwrite a pending sale or start without a selected refund path", () => {
  const source = readFileSync(posPagePath, "utf8");
  assert.match(
    source,
    /disabled=\{busy \|\| hasPendingOrderWrite \|\| getPartialRefundPreview\(row\) <= 0 \|\| needsRefundMethodChoice\}/
  );
  assert.match(source, /ตะกร้าขายปัจจุบันมี \$\{cart\.length\} รายการและจะถูกแทนที่/);
});
