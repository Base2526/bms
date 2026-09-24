import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  validateOfflinePosTender,
  type PosSaleInput,
  type PosPaymentInput,
} from "../apps/web/lib/bms/pos.ts";

const now = Date.parse("2026-09-18T10:00:00.000Z");
const cash: PosPaymentInput[] = [
  { method: "CASH", amount: 100, cashTendered: 100, ref: null },
];
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function sale(overrides: Partial<PosSaleInput> = {}): PosSaleInput {
  return {
    tenantId: "00000000-0000-4000-8000-000000000001",
    deviceId: "00000000-0000-4000-8000-000000000002",
    shiftId: "00000000-0000-4000-8000-000000000003",
    cashierUserId: "00000000-0000-4000-8000-000000000004",
    idempotencyKey: "offline-contract-key",
    offlineTenderedAt: "2026-09-18T09:55:00.000Z",
    mode: "SALE",
    salesSurface: "RETAIL_POS",
    lines: [{ sku: "FAKE-SKU", size: "STD", packQty: 1 }],
    payments: cash,
    ...overrides,
  };
}

test("offline tender accepts only a plain retail cash sale", () => {
  assert.equal(validateOfflinePosTender(sale(), cash, now), null);
  const card: PosPaymentInput[] = [{ method: "CARD", amount: 100 }];
  assert.match(validateOfflinePosTender(sale({ payments: card }), card, now) ?? "", /เงินสด/);
  assert.match(validateOfflinePosTender(sale({ customerId: "member" }), cash, now) ?? "", /สมาชิก/);
  assert.match(
    validateOfflinePosTender(sale({
      lines: [{ sku: "FAKE-SKU", size: "STD", packQty: 1, serials: ["S1"] }],
    }), cash, now) ?? "",
    /serial/,
  );
  assert.match(
    validateOfflinePosTender(sale({
      offlineTenderedAt: "2026-09-18T10:10:01.000Z",
    }), cash, now) ?? "",
    /อนาคต/,
  );
});

test("ordinary online sales do not enter the offline policy", () => {
  assert.equal(
    validateOfflinePosTender(sale({ offlineTenderedAt: null, customerId: "member" }), cash, now),
    null,
  );
});

test("native recovery remains bounded, visible after commit, and cannot be hidden by unpair", () => {
  const operation = read("apps/mobile/src/lib/operation.ts");
  const sharedOperation = read("packages/pos-client-core/src/operation.ts");
  const settings = read("apps/mobile/src/screens/settings/DeviceSettingsScreen.tsx");
  const receiptOperation = read("apps/mobile/src/graphql/operations.graphql");
  const service = read("apps/web/lib/bms/pos.ts");

  // Mobile deliberately re-exports the platform-neutral helper used by Desktop as well. Verify
  // both the wiring and the implementation instead of requiring a duplicated timeout locally.
  assert.match(operation, /packages\/pos-client-core\/src\/operation/);
  assert.match(sharedOperation, /runWithOperationTimeout/);
  assert.match(sharedOperation, /AbortController/);
  assert.match(settings, /loadOfflineSales/);
  assert.match(settings, /ยังเลิกจับคู่ไม่ได้/);
  assert.match(receiptOperation, /offlineTenderedAt\s+offlineSyncedAt/);
  assert.match(service, /o\.pos_offline_tendered_at/);
  assert.match(service, /offlineSyncedAt:/);
});
