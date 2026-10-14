import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "../apps/web/node_modules/@types/pg/index.js";
import { issueFullTaxInvoiceInTx, getFullTaxInvoiceView } from "../apps/web/lib/bms/taxDocuments.ts";
import { assertNoActiveSalesTaxDocumentInTx } from "../apps/web/lib/bms/taxDocumentGuards.ts";

const buyer = { name: "FAKE buyer", taxId: "0105555555554", branchCode: "00000", address: "FAKE address" };

async function attempt(status: string, options: { returned?: boolean; voided?: boolean; locations?: string[] } = {}) {
  const calls: string[] = [];
  const client = { query: async (sql: string, params: unknown[]) => {
    calls.push(sql);
    assert.equal(params[0], "tenant");
    assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE)\b/);
    let rows: any[];
    if (sql.includes("FROM bms_store_profile")) rows = [{ vat_registered: true }];
    else if (sql.includes("FROM bms_orders")) rows = [{ location_id: "hq", status, voided_at: options.voided ? new Date() : null }];
    else if (sql.includes("FROM bms_pos_returns")) rows = options.returned ? [{ exists: 1 }] : [];
    else if (sql.includes("FROM bms_tenants")) rows = []; // Eligible orders reach seller validation.
    else throw new Error(`Unexpected query: ${sql}`);
    return { rows, rowCount: rows.length };
  }} as unknown as PoolClient;
  const result = await issueFullTaxInvoiceInTx(client, {
    tenantId: "tenant", orderId: "order", buyer, allowedLocationIds: options.locations,
  });
  assert.ok(calls.some(sql => /FROM bms_orders[\s\S]*FOR UPDATE/.test(sql)));
  return { result, calls };
}

test("full issuance rejects every unfinished/terminal status before any write", async () => {
  for (const status of ["PENDING", "PAID", "PACKING", "SHIPPED", "CANCELLED", "RETURNED"]) {
    assert.equal((await attempt(status)).result.status, "ORDER_NOT_INVOICEABLE", status);
  }
  assert.equal((await attempt("COMPLETED", { voided: true })).result.status, "ORDER_NOT_INVOICEABLE");
});

test("any prior non-void return blocks full issuance without consulting or rewriting credit notes", async () => {
  const { result, calls } = await attempt("COMPLETED", { returned: true });
  assert.equal(result.status, "ORDER_NOT_INVOICEABLE");
  const returns = calls.find(sql => sql.includes("FROM bms_pos_returns"))!;
  assert.match(returns, /tenant_id = \$1 AND order_id = \$2 AND is_void = FALSE/);
  assert.doesNotMatch(returns, /refund_amount|CREDIT_NOTE|NOT EXISTS/);
  assert.ok(!calls.some(sql => sql.includes("FROM bms_tax_documents")));
});

test("an intact completed order reaches seller validation; another branch stays hidden", async () => {
  assert.equal((await attempt("COMPLETED")).result.status, "SELLER_INCOMPLETE");
  for (const locations of [[], ["branch"]]) {
    const { result, calls } = await attempt("COMPLETED", { locations });
    assert.equal(result.status, "ORDER_NOT_FOUND");
    assert.ok(!calls.some(sql => sql.includes("FROM bms_pos_returns")));
  }
});

test("active invoices block the back-office guard regardless of credited balance", async () => {
  for (const docType of ["ABBREVIATED", "FULL"]) {
    let locked = false;
    const client = { query: async (sql: string, params: unknown[]) => {
      assert.deepEqual(params, ["tenant", "order"]);
      if (sql.includes("FROM bms_orders")) {
        assert.match(sql, /tenant_id = \$1 AND id = \$2 FOR UPDATE/);
        locked = true;
        return { rows: [{ id: "order" }], rowCount: 1 };
      }
      assert.equal(locked, true, "lock the order before checking tax documents");
      assert.match(sql, /doc_type IN \('ABBREVIATED','FULL'\) AND cancelled_at IS NULL/);
      assert.doesNotMatch(sql, /SUM\(|grand_total|CREDIT_NOTE/);
      return { rows: [{ doc_type: docType }], rowCount: 1 };
    }} as unknown as PoolClient;
    await assert.rejects(assertNoActiveSalesTaxDocumentInTx(client, "tenant", "order"), /คืนผ่านหน้า POS/);
  }
});

test("a cancelled full invoice is unavailable to print/copy readers", async () => {
  const reader = { query: async (sql: string, params: unknown[]) => {
    assert.match(sql, /d\.doc_type = 'FULL' AND d\.cancelled_at IS NULL/);
    assert.deepEqual(params, ["tenant", "document", ["hq"]]);
    return { rows: [], rowCount: 0 };
  }};
  assert.equal(await getFullTaxInvoiceView("tenant", "document", ["hq"], reader as any), null);
});
