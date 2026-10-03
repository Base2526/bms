import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { expenseDocumentSign, normalizeExpenseAdjustment } from "../apps/web/lib/bms/expenseAdjustments.ts";

const now = new Date("2026-10-03T12:00:00Z");
const note = { documentKind: "SUPPLIER_CREDIT_NOTE", documentDate: "2026-01-15", receivedDate: "2026-09-01", referenceDocumentNo: " INV-1 ", adjustmentReason: " คืนสินค้า ", vatAmount: 140 };
test("supplier notes use receipt month even beyond the normal invoice deferral window", () => {
  for (const documentKind of ["SUPPLIER_CREDIT_NOTE", "SUPPLIER_DEBIT_NOTE"]) {
    assert.deepEqual(normalizeExpenseAdjustment({ ...note, documentKind }, now), {
      receivedDate: "2026-09-01", referenceDocumentNo: "INV-1", adjustmentReason: "คืนสินค้า", vatClaimMonth: "2026-09-01",
    });
  }
  assert.equal(expenseDocumentSign("SUPPLIER_CREDIT_NOTE") * 2000, -2000);
  assert.equal(expenseDocumentSign("SUPPLIER_CREDIT_NOTE") * 140, -140);
  assert.equal(expenseDocumentSign("SUPPLIER_DEBIT_NOTE") * 140, 140);
  assert.equal(expenseDocumentSign("TAX_INVOICE"), 1);
});
test("supplier notes reject missing evidence, wrong periods, WHT and signed entry amounts", () => {
  for (const changed of [
    {receivedDate:null}, {receivedDate:"2026-02-30"}, {receivedDate:"2026-01-14"}, {receivedDate:"2026-10-04"},
    {referenceDocumentNo:" "}, {adjustmentReason:""}, {vatClaimMonth:"2026-08-01"},
    {vatAmount:-140}, {vatAmount:0}, {vatAmount:NaN}, {whtAmount:3}, {whtRate:3}, {whtIncomeType:"SERVICE"},
  ]) assert.throws(() => normalizeExpenseAdjustment({...note,...changed}, now));
  assert.equal(normalizeExpenseAdjustment({documentKind:"TAX_INVOICE",documentDate:"2026-01-01"}, now),null);
  assert.throws(() => normalizeExpenseAdjustment({...note,documentKind:"RECEIPT"}, now));
});
test("new migration gates notes without changing stored positive money or invoice uniqueness", () => {
  const sql=readFileSync(new URL("../db/migrations/10.37__bms_supplier_vat_adjustments.sql",import.meta.url),"utf8");
  assert.match(sql,/received_date IS NOT NULL AND received_date >= document_date/);
  assert.match(sql,/vat_claim_month = date_trunc\('month', received_date\)::date/);
  assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_expense_documents_adjustment_normalized/);
  assert.match(sql,/tenant_id, document_kind, payee_tax_id/);
  assert.doesNotMatch(sql,/DROP INDEX|DISABLE ROW LEVEL SECURITY|UPDATE bms_expense_documents/);
});
