import assert from "node:assert/strict";
import test, { after } from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  createExpenseDocument,
  getExpenseTaxSummary,
  listExpenseDocuments,
  voidExpenseDocument,
} from "../apps/web/lib/bms/expenseDocuments.ts";

const tag = `FAKE-expense-contract-${process.pid}`;
let tenantId = "";
let locationId = "";
let actorId = "";
let documentId = "";

test("setup finds a local tenant, branch and actor", async () => {
  const row = (await query<{ tenant_id: string; location_id: string; actor_id: string }>(`
    SELECT t.id AS tenant_id, l.id AS location_id, u.id AS actor_id
      FROM bms_tenants t
      JOIN bms_locations l ON l.tenant_id=t.id AND l.active
      JOIN users u ON u.tenant_id=t.id
     ORDER BY t.created_at, l.created_at, u.created_at LIMIT 1`)).rows[0];
  assert.ok(row, "local test DB needs one tenant/location/user fixture");
  tenantId = row.tenant_id;
  locationId = row.location_id;
  actorId = row.actor_id;
});

test("one document lands expense, input VAT and WHT in their own authority periods", async () => {
  const input = {
    locationId,
    category: "PROFESSIONAL_FEE" as const,
    documentKind: "TAX_INVOICE" as const,
    payeeName: tag,
    payeeTaxId: "0105555555555",
    payeeBranchCode: "00000",
    payeeType: "JURISTIC" as const,
    documentNo: tag,
    documentDate: "2026-01-15",
    paidAt: "2026-03-05",
    amountBeforeVat: 100,
    vatAmount: 7,
    vatClaimMonth: "2026-02-01",
    whtIncomeType: "SERVICE" as const,
    whtRate: 3,
    whtAmount: 3,
    idempotencyKey: tag,
  };
  const [created, concurrentReplay] = await Promise.all([
    createExpenseDocument(tenantId, actorId, input),
    createExpenseDocument(tenantId, actorId, input),
  ]);
  documentId = created.id;
  assert.equal(created.amountBeforeVat, 100);
  assert.equal(concurrentReplay.id, documentId, "same-key requests arriving together must return one row");

  const replay = await createExpenseDocument(tenantId, actorId, input);
  assert.equal(replay.id, documentId, "a later retry must replay the original row");
  const duplicates = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM bms_expense_documents WHERE tenant_id=$1 AND idempotency_key=$2`,
    [tenantId, input.idempotencyKey],
  );
  assert.equal(duplicates.rows[0]?.count, "1", "concurrent retries must not duplicate financial evidence");
  await assert.rejects(
    createExpenseDocument(tenantId, actorId, { ...input, amountBeforeVat: 101 }),
    /คนละชุด/,
  );

  const january = await getExpenseTaxSummary(tenantId, { from: "2026-01-01", to: "2026-01-31", locationId });
  assert.deepEqual(january.grandTotal, { documentCount: 1, expenseBase: 100, vatPurchase: 0, wht: 0 });
  const february = await getExpenseTaxSummary(tenantId, { from: "2026-02-01", to: "2026-02-28", locationId });
  assert.deepEqual(february.grandTotal, { documentCount: 0, expenseBase: 0, vatPurchase: 7, wht: 0 });
  const march = await getExpenseTaxSummary(tenantId, { from: "2026-03-01", to: "2026-03-31", locationId });
  assert.deepEqual(march.grandTotal, { documentCount: 0, expenseBase: 0, vatPurchase: 0, wht: 3 });

  const listed = await listExpenseDocuments(tenantId, {
    from: "2026-01-01", to: "2026-01-31", locationId, allowedLocationIds: [locationId],
  });
  assert.equal(listed.total, 1);
  assert.equal(listed.rows[0].id, documentId);
});

test("void preserves the row but removes it from active accounting totals", async () => {
  const result = await voidExpenseDocument(tenantId, actorId, documentId, "contract cleanup", [locationId]);
  assert.equal(result.status, "VOID");
  const january = await getExpenseTaxSummary(tenantId, { from: "2026-01-01", to: "2026-01-31", locationId });
  assert.deepEqual(january.grandTotal, { documentCount: 0, expenseBase: 0, vatPurchase: 0, wht: 0 });
  const row = await query<{ status: string; void_reason: string }>(
    `SELECT status,void_reason FROM bms_expense_documents WHERE tenant_id=$1 AND id=$2`, [tenantId,documentId],
  );
  assert.deepEqual(row.rows[0], { status: "VOID", void_reason: "contract cleanup" });
});

after(async () => {
  if (!tenantId) return;
  if (documentId) {
    await query(`DELETE FROM bms_audit_log WHERE tenant_id=$1 AND target=$2`, [tenantId,documentId]);
    await query(`DELETE FROM bms_expense_documents_revisions WHERE tenant_id=$1 AND snapshot->>'id'=$2`, [tenantId,documentId]);
    await query(`DELETE FROM bms_expense_documents WHERE tenant_id=$1 AND id=$2`, [tenantId,documentId]);
  }
});
