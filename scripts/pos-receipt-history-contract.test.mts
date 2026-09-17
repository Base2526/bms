// Receipt-history compatibility and phone layout regression coverage.
// Run from apps/web: npx tsx --test ../../scripts/pos-receipt-history-contract.test.mts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizePosReceiptName } from "../apps/web/lib/bms/posReceiptDisplay.ts";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const posService = read("../apps/web/lib/bms/pos.ts");
const mobileHistory = read(
  "../apps/mobile/src/screens/sell/SalesHistoryScreen.tsx"
);
const searchField = read("../apps/mobile/src/components/SearchField.tsx");

test("legacy receipt lines always expose a readable non-null name", () => {
  assert.equal(normalizePosReceiptName("กาแฟ", "COFFEE"), "กาแฟ");
  assert.equal(normalizePosReceiptName("  ", " COFFEE "), "COFFEE");
  assert.equal(normalizePosReceiptName(null, "LEGACY-01"), "LEGACY-01");
  assert.equal(normalizePosReceiptName(undefined, null), "สินค้า");
});

test("recent sales and return history both normalize legacy product names", () => {
  const calls =
    posService.match(
      /normalizePosReceiptName\([^)]*product_name[^)]*product_sku[^)]*\)/g
    ) ?? [];
  assert.ok(calls.length >= 2, "ทั้งบรรทัดขายและบรรทัดคืนต้องมี fallback");
  assert.doesNotMatch(posService, /receiptName:\s*line\.product_name\s*[,}]/);
  assert.doesNotMatch(posService, /receiptName:\s*String\(row\.product_name\)/);
});

test("sales history adapts cards on phone and a table on iPad", () => {
  assert.match(mobileHistory, /styles\.phoneSummaryPanel/);
  assert.match(mobileHistory, /\{filtered\.length\}[\s\S]*ใบเสร็จ/);
  assert.match(mobileHistory, /phoneSaleAside:[\s\S]*flexDirection: 'row'/);
  assert.match(mobileHistory, /phoneToolbar:[\s\S]*marginTop: 12/);
  assert.match(mobileHistory, /styles\.tabletMetricCard/);
  assert.match(mobileHistory, /styles\.tabletHeaderRow/);
  assert.match(mobileHistory, /วันที่ \/ ลูกค้า/);
  assert.match(mobileHistory, /รายการสินค้า/);
  assert.match(mobileHistory, /styles\.tabletSaleRow/);
  assert.match(mobileHistory, /ReceiptMetricIcon/);
  assert.match(mobileHistory, /TotalMetricIcon/);
  assert.match(mobileHistory, /styles\.phoneMetricDivider/);
  assert.match(mobileHistory, /toLocaleString\('en-US'/);
  assert.match(mobileHistory, /showSearchIcon/);
  assert.match(searchField, /showSearchIcon \? 48 : minTouchTarget/);
  assert.doesNotMatch(mobileHistory, /components\/Button/);
});
