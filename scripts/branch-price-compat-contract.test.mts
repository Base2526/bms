import assert from "node:assert/strict";
import test from "node:test";
import { branchPrice } from "../apps/web/lib/bms/branchPrices.ts";

test("branch price keeps the existing override when the window migration is absent", async () => {
  const statements: string[] = [];
  const reader = { query: async (sql: string) => {
    statements.push(sql);
    return { rows: sql.includes("to_regclass") ? [{ present: false }] : [{ price: "12.34" }] };
  } };
  const price = await branchPrice(reader as any, "tenant", "branch", "SKU", "BASE");
  assert.equal(price, 12.34);
  assert.equal(statements.length, 2);
  assert.match(statements[1], /FROM bms_branch_prices/);
  assert.doesNotMatch(statements[1], /FROM bms_branch_price_windows/);
});

test("branch price reads scheduled windows after the migration is present", async () => {
  const statements: string[] = [];
  const reader = { query: async (sql: string) => {
    statements.push(sql);
    return { rows: sql.includes("to_regclass") ? [{ present: true }] : [{ price: "0.00" }] };
  } };
  assert.equal(await branchPrice(reader as any, "tenant", "branch", "SKU", "BASE"), 0);
  assert.match(statements[1], /FROM bms_branch_price_windows/);
  assert.match(statements[1], /ORDER BY bp\.priority LIMIT 1/);
  statements.length = 0;
  assert.equal(await branchPrice(reader as any, "tenant", null, "SKU", "BASE"), null);
  assert.equal(statements.length, 0);
});
