import assert from "node:assert/strict";
import test, { after } from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  createExpenseDocument,
  getExpenseTaxSummary,
  getInputVatReport,
  listExpenseDocuments,
  voidExpenseDocument,
} from "../apps/web/lib/bms/expenseDocuments.ts";

const tag = `FAKE-expense-contract-${process.pid}`;
let tenantId = "";
let locationId = "";
let actorId = "";
let documentId = "";

test("setup creates its own VAT-registered tenant, branch and actor", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [tag, `${tag.toLowerCase()}-${Date.now()}`]
  )).rows[0].id;
  await query(`INSERT INTO bms_store_profile (tenant_id,vat_registered,price_includes_vat,vat_rate) VALUES ($1,TRUE,TRUE,7)`, [tenantId]);
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id,code,name,branch_code,is_head_office,active)
     VALUES ($1,'MAIN',$2,'00000',TRUE,TRUE) RETURNING id`, [tenantId, tag]
  )).rows[0].id;
  actorId = (await query<{ id: string }>(
    `INSERT INTO users (name,username,email,role,role_id,tenant_id,password_hash,fake_test)
     SELECT $2,$3,$3,'Administrator',r.id,$1,'x',TRUE FROM roles r
      WHERE r.name='Administrator' ORDER BY r.id LIMIT 1 RETURNING id`,
    [tenantId, tag, `${tag.toLowerCase()}@example.invalid`]
  )).rows[0].id;
});

test("one document lands expense, input VAT and WHT in their own authority periods", async () => {
  const input = {
    locationId,
    category: "PROFESSIONAL_FEE" as const,
    documentKind: "TAX_INVOICE" as const,
    payeeName: tag,
    payeeTaxId: "0105555555554",
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
    createExpenseDocument(tenantId, actorId, { ...input, amountBeforeVat: 101, vatAmount: 7.07 }),
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

test("normalized invoice number and blank/head-office branch cannot claim twice", async () => {
  await query(
    `INSERT INTO bms_expense_documents
       (tenant_id,location_id,category,document_kind,payee_name,payee_tax_id,payee_branch_code,
        document_no,document_date,amount_before_vat,vat_amount,vat_claim_month,status)
     VALUES ($1,$2,'OTHER','TAX_INVOICE',$3,'0105555555554',NULL,
             ' ab- 123 ','2026-01-15',100,7,'2026-01-01','ACTIVE')`,
    [tenantId, locationId, tag]
  );
  await assert.rejects(
    createExpenseDocument(tenantId, actorId, {
      locationId, category: "OTHER", documentKind: "TAX_INVOICE", payeeName: tag,
      payeeTaxId: "0105555555554", payeeBranchCode: "00000", documentNo: "AB123",
      documentDate: "2026-01-15", amountBeforeVat: 100, vatAmount: 7,
      vatClaimMonth: "2026-01-01", idempotencyKey: `${tag}-duplicate`,
    }),
    /ใบนี้ถูกบันทึกแล้ว/
  );
});

test("a non-VAT-registered shop cannot record positive input VAT", async () => {
  await query(`UPDATE bms_store_profile SET vat_registered=FALSE WHERE tenant_id=$1`, [tenantId]);
  await assert.rejects(
    createExpenseDocument(tenantId, actorId, {
      locationId, category: "OTHER", documentKind: "TAX_INVOICE", payeeName: tag,
      payeeTaxId: "0105555555554", payeeBranchCode: "00000", documentNo: "OTHER-1",
      documentDate: "2026-01-15", amountBeforeVat: 100, vatAmount: 7,
      vatClaimMonth: "2026-01-01", idempotencyKey: `${tag}-not-vat`,
    }),
    /ไม่ได้จด VAT/
  );
  await query(`UPDATE bms_store_profile SET vat_registered=TRUE WHERE tenant_id=$1`, [tenantId]);
});

test("supplier notes replay once, use receipt month, sign reports, exclude VOID and enforce scope", async () => {
  const common = { locationId, category: "OTHER" as const, payeeName: tag, payeeTaxId: "0105555555554", payeeBranchCode: "00000",
    documentDate: "2026-04-15", receivedDate: "2026-05-01", referenceDocumentNo: "INV-original", adjustmentReason: "FAKE returned goods" };
  const input = { ...common, documentKind: "SUPPLIER_CREDIT_NOTE" as const, documentNo: "CN-001", amountBeforeVat: 2000, vatAmount: 140, idempotencyKey: `${tag}-cn` };
  const [credit, replay] = await Promise.all([createExpenseDocument(tenantId,actorId,input),createExpenseDocument(tenantId,actorId,input)]);
  assert.equal(credit.id,replay.id);
  assert.equal(credit.vatClaimMonth,"2026-05-01");
  assert.equal(credit.documentDate,"2026-04-15");
  assert.equal(credit.receivedDate,"2026-05-01");
  assert.equal(credit.amountBeforeVat,2000,"stored evidence remains positive");
  await assert.rejects(createExpenseDocument(tenantId,actorId,{...input,documentNo:" cn 001 ",idempotencyKey:`${tag}-cn-duplicate`}),/ใบนี้ถูกบันทึกแล้ว/);
  await assert.rejects(createExpenseDocument(tenantId,actorId,{...input,amountBeforeVat:1000,vatAmount:70}),/คนละชุด/);
  await createExpenseDocument(tenantId,actorId,{...common,documentKind:"SUPPLIER_DEBIT_NOTE",documentNo:"DN-001",amountBeforeVat:500,vatAmount:35,idempotencyKey:`${tag}-dn`});
  const may={from:"2026-05-01",to:"2026-05-31",locationId};
  const report=await getInputVatReport(tenantId,may);
  assert.equal(report.rows.length,2);
  assert.deepEqual(report.totals,{documentCount:2,amountBeforeVat:-1500,vatAmount:-105,totalAmount:-1605});
  assert.match(report.rows.find(r=>r.documentNo==="CN-001")!.note!,/ใบลดหนี้.*INV-original/);
  assert.equal((await getInputVatReport(tenantId,{from:"2026-04-01",to:"2026-04-30",locationId})).rows.length,0);
  assert.equal((await getExpenseTaxSummary(tenantId,may)).grandTotal.vatPurchase,-105);
  assert.equal((await getInputVatReport(tenantId,{from:may.from,to:may.to,allowedLocationIds:[]})).rows.length,0);
  assert.equal((await getInputVatReport("00000000-0000-0000-0000-000000000000",{from:may.from,to:may.to})).rows.length,0);
  await voidExpenseDocument(tenantId,actorId,credit.id,"FAKE correction",[locationId]);
  assert.equal((await getInputVatReport(tenantId,may)).totals.vatAmount,35);
});

test("void preserves the row but removes it from active accounting totals", async () => {
  const result = await voidExpenseDocument(tenantId, actorId, documentId, "contract cleanup", [locationId]);
  assert.equal(result.status, "VOID");
  const january = await getExpenseTaxSummary(tenantId, { from: "2026-01-01", to: "2026-01-31", locationId });
  // The normalized-duplicate test above retained a separate active January invoice.
  assert.deepEqual(january.grandTotal, { documentCount: 1, expenseBase: 100, vatPurchase: 7, wht: 0 });
  const row = await query<{ status: string; void_reason: string }>(
    `SELECT status,void_reason FROM bms_expense_documents WHERE tenant_id=$1 AND id=$2`, [tenantId,documentId],
  );
  assert.deepEqual(row.rows[0], { status: "VOID", void_reason: "contract cleanup" });
});

after(async () => {
  if (!tenantId) return;
  await query(`DELETE FROM bms_audit_log WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_expense_documents_revisions WHERE tenant_id=$1`, [tenantId]).catch(() => {});
  await query(`DELETE FROM bms_expense_documents WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM users WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_locations WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_store_profile WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_tenants WHERE id=$1`, [tenantId]);
});
