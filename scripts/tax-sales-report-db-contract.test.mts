// =============================================================
// รายงานภาษีขาย — DB contract (เขียนจริงลงฐาน ห้ามรันกับ production)
// -------------------------------------------------------------
// ตัวเลขทุกตัวคำนวณมือ ไม่ได้ก็อปจาก output:
//   สินค้า 107 บาท (รวม VAT 7%) → ฐานภาษี 100.00 · VAT 7.00
//   ใบลดหนี้ 53.50 → VAT 53.50 × 7/107 = 3.50 · ฐาน 50.00 · เป็นยอดลบในรายงาน
//
// ตรึง: ใบย่อสรุปรายวันต่อเครื่องเป็นช่วงเลข · ใบลดหนี้เป็นลบ · แยกยอดรายสถานประกอบการ ·
//       ส่วน "ต้องตรวจสอบ" จับบิลที่ชำระแล้วไม่มีใบกำกับ, คืนของไม่มีใบลดหนี้,
//       ใบเต็มที่ออกแทนใบย่อเป็นแถวอ้างอิงยอดศูนย์แม้ออกข้ามเดือน · ไฟล์ XLSX มีครบทุกแผ่น
//
//   node scripts/run-contract-tests.mjs db tax-sales-report
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const XLSX: typeof import("../apps/web/node_modules/xlsx") =
  createRequire(new URL("../apps/web/package.json", import.meta.url))("xlsx");

import { getClient, query } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { upsertPosDevice } from "../apps/web/lib/bms/pos.ts";
import {
  getCreditNoteView,
  getFullTaxInvoiceView,
  getVatSettings,
  issueAbbreviatedInvoiceInTx,
  issueCreditNote,
  issueFullTaxInvoice,
} from "../apps/web/lib/bms/taxDocuments.ts";
import { getSalesTaxReport, listTaxDocuments } from "../apps/web/lib/bms/taxReports.ts";
import { cancelOrder } from "../apps/web/lib/bms/orders.ts";
import { buildSalesTaxReportDoc, buildXlsx } from "../apps/web/lib/bms/documentGenerator.ts";
import { formatTaxDate } from "../apps/web/lib/bms/taxReportMath.ts";
import { taxClockOf } from "../apps/web/lib/bms/taxDocumentNumber.ts";

const TAG = "taxsales-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";

let tenantId = "";
let userId = "";
let hqId = "";
let branchId = "";
let devA = "";
let devC = "";
const today = taxClockOf(new Date()).isoDate;
const period = { from: `${today.slice(0, 7)}-01`, to: today };
const orders: Record<string, string> = {};

async function newOrder(locationId: string, status = "COMPLETED"): Promise<string> {
  const id = (await query<{ id: string }>(
    `INSERT INTO bms_orders (tenant_id, channel, customer_ref, status, total_amount, location_id, paid_at)
     VALUES ($1,'pos',$2,$3,107,$4,now()) RETURNING id`,
    [tenantId, `fake-${TAG}`, status, locationId]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_order_items
       (tenant_id, order_id, location_id, product_sku, size, qty, unit_price, line_amount, receipt_unit_price, vat_category)
     VALUES ($1,$2,$3,$4,$5,1,107,107,107,'V')`,
    [tenantId, id, locationId, SKU, SIZE]
  );
  return id;
}

async function abbreviated(locationId: string, deviceId: string): Promise<{ orderId: string; docNo: string }> {
  const orderId = await newOrder(locationId);
  const settings = await getVatSettings(tenantId);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const res = await issueAbbreviatedInvoiceInTx(client, { tenantId, orderId, locationId, deviceId, settings });
    await client.query("COMMIT");
    if (res.status !== "ISSUED") throw new Error(JSON.stringify(res));
    return { orderId, docNo: res.document.docNo };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function posReturn(orderId: string, amount: number, key: string): Promise<string> {
  return (await query<{ id: string }>(
    `INSERT INTO bms_pos_returns
       (tenant_id, order_id, returned_by, return_mode, refund_amount, settlement_status, idempotency_key, is_void)
     VALUES ($1,$2,$3,'PARTIAL',$4,'COMPLETED',$5,FALSE) RETURNING id`,
    [tenantId, orderId, userId, amount, `${TAG}-${key}-${process.pid}`]
  )).rows[0].id;
}

test("setup: a VAT-registered shop with documents at two establishments", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${process.pid}`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, vat_registered, price_includes_vat, vat_rate,
                                    abbreviated_tax_invoice_approved, tax_id, calendar_era, address)
     VALUES ($1,TRUE,TRUE,7,TRUE,'0105555555554','BE','FAKE seller address')`,
    [tenantId]
  );
  userId = (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT 'FAKE staff', $2, $2, 'Administrator', r.id, $1, 'x', TRUE
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1 RETURNING id`,
    [tenantId, `fake-${TAG}-${process.pid}@example.invalid`]
  )).rows[0].id;
  hqId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office, active)
     VALUES ($1,'MAIN','FAKE HQ','00000',TRUE,TRUE) RETURNING id`, [tenantId]
  )).rows[0].id;
  branchId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office, active)
     VALUES ($1,'BR1','FAKE branch','00001',FALSE,TRUE) RETURNING id`, [tenantId]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category) VALUES ($1,$2,$2,107,TRUE,'V')`,
    [tenantId, SKU]
  );
  for (const loc of [hqId, branchId]) {
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,100,0)`, [tenantId, loc, SKU, SIZE]
    );
  }
  devA = (await upsertPosDevice(tenantId, { locationId: hqId, code: "POS-A", receiptPrefix: "A", active: true })).id;
  devC = (await upsertPosDevice(tenantId, { locationId: branchId, code: "POS-C", receiptPrefix: "C", active: true })).id;

  // สำนักงานใหญ่: ใบย่อ 3 ใบจากเครื่องเดียว วันเดียวกัน
  orders.a1 = (await abbreviated(hqId, devA)).orderId;
  orders.a2 = (await abbreviated(hqId, devA)).orderId;
  orders.a3 = (await abbreviated(hqId, devA)).orderId;
  // ใบที่สามลูกค้าขอใบเต็ม → ใบย่อยังเป็นยอดขายเดิม ใบเต็มเป็นแถวอ้างอิงยอดศูนย์
  const full = await issueFullTaxInvoice({
    tenantId, orderId: orders.a3, issuedBy: userId,
    buyer: { name: "FAKE Co., Ltd.", taxId: "0105555555554", branchCode: "00002", address: "FAKE address" },
  });
  assert.equal(full.status, "ISSUED", JSON.stringify(full));

  // สาขา: ใบย่อ 1 ใบ แล้วรับคืน 53.50 พร้อมใบลดหนี้
  orders.c1 = (await abbreviated(branchId, devC)).orderId;
  const retWithNote = await posReturn(orders.c1, 53.5, "with-note");
  const note = await issueCreditNote({
    tenantId, orderId: orders.c1, amount: 53.5, reason: "รับคืนสินค้าบางรายการ", returnRef: retWithNote,
  });
  assert.equal(note.status, "ISSUED", JSON.stringify(note));

  // ต้องตรวจสอบ: บิลที่ชำระแล้วไม่มีใบกำกับ + การคืนที่ไม่มีใบลดหนี้
  orders.noDoc = await newOrder(hqId, "PAID");
  await posReturn(orders.a1, 20, "without-note");

  // Historical inconsistency: a legacy/back-office path marked an invoiced sale cancelled
  // without cancelling its tax document or creating a POS return. The report must surface it.
  orders.inconsistent = (await abbreviated(hqId, devA)).orderId;
  await query(
    `UPDATE bms_tax_documents
        SET issue_date = $3::date - 1,
            issued_at = (($3::date - 1)::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Bangkok'
      WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, orders.inconsistent, period.from]
  );
  await query(
    `UPDATE bms_orders SET status = 'CANCELLED', cancelled_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orders.inconsistent]
  );
});

test("normal full-invoice issuance cancels the abbreviated document and audits atomically", async () => {
  const docs = await query<{ doc_type: string; cancelled_at: Date | null }>(
    `SELECT doc_type, cancelled_at FROM bms_tax_documents
      WHERE tenant_id = $1 AND order_id = $2 ORDER BY issued_at`,
    [tenantId, orders.a3]
  );
  assert.deepEqual(docs.rows.map((row) => row.doc_type), ["ABBREVIATED", "FULL"]);
  assert.ok(docs.rows[0].cancelled_at, "the replaced abbreviated invoice must be cancelled");
  const audit = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms_audit_log
      WHERE tenant_id = $1 AND action = 'tax.document.issue_full' AND meta->>'orderId' = $2`,
    [tenantId, orders.a3]
  );
  assert.equal(audit.rows[0].n, 1);
});

test("a partially returned order cannot receive a full tax invoice", async () => {
  const orderId = await newOrder(hqId);
  orders.partiallyReturned = orderId;
  await posReturn(orderId, 20, "before-full");
  const result = await issueFullTaxInvoice({
    tenantId,
    orderId,
    issuedBy: userId,
    buyer: { name: "FAKE returned buyer", taxId: "0105555555554", address: "FAKE address" },
  });
  assert.equal(result.status, "ORDER_NOT_INVOICEABLE", JSON.stringify(result));
});

test("abbreviated invoices are summarised per day per register as a number range", async () => {
  const r = await getSalesTaxReport(tenantId, period);
  const day = r.rows.filter((x) => x.kind === "ABBREVIATED_DAY" && x.locationId === hqId);
  assert.equal(day.length, 1);
  const [g] = day;
  assert.match(g.docNoFrom, /^A\d{10}$/);
  assert.match(g.docNoTo, /^A\d{10}$/);
  assert.ok(g.docNoFrom.endsWith("0001") && g.docNoTo.endsWith("0003"), `${g.docNoFrom}–${g.docNoTo}`);
  assert.equal(g.docCount, 3, "the replaced abbreviated invoice keeps the original sale value");
  assert.equal(g.cancelledCount, 1);
  assert.equal(g.base, 300);
  assert.equal(g.vat, 21);
  assert.equal(g.exempt, 0);
  assert.equal(g.total, 321);
});

test("a full invoice is one row with the buyer, and a credit note is negative", async () => {
  const r = await getSalesTaxReport(tenantId, period);
  const full = r.rows.find((x) => x.kind === "FULL");
  assert.ok(full);
  assert.equal(full.buyerName, "FAKE Co., Ltd.");
  assert.equal(full.buyerTaxId, "0105555555554");
  assert.equal(full.buyerBranchCode, "00002");
  assert.match(full.referenceDocNo ?? "", /^A\d{10}$/);
  assert.equal(full.docCount, 0);
  assert.equal(full.base, 0);
  assert.equal(full.vat, 0);

  const note = r.rows.find((x) => x.kind === "CREDIT_NOTE");
  assert.ok(note);
  assert.match(note.docNoFrom, /^CN00001-/);
  assert.match(note.referenceDocNo ?? "", /^C\d{10}$/);
  assert.equal(note.vat, -3.5);
  assert.equal(note.base, -50);
  assert.equal(note.total, -53.5);
});

test("totals are per establishment and add up to the grand total", async () => {
  const r = await getSalesTaxReport(tenantId, period);
  const hq = r.totals.find((t) => t.locationId === hqId)!;
  const br = r.totals.find((t) => t.locationId === branchId)!;
  // HQ: ใบย่อเดิม 3 ใบ = ฐาน 300 · VAT 21; ใบเต็มที่ออกแทนเป็นแถวอ้างอิงยอดศูนย์
  assert.equal(hq.base, 300);
  assert.equal(hq.vat, 21);
  assert.equal(hq.documentCount, 3);
  // สาขา: ใบย่อ 1 (100/7) − ใบลดหนี้ (50/3.50)
  assert.equal(br.base, 50);
  assert.equal(br.vat, 3.5);
  assert.equal(r.grandTotal.base, 350);
  assert.equal(r.grandTotal.vat, 24.5);
  assert.equal(r.grandTotal.total, 374.5);

  // ขอรายงานเฉพาะสาขา ได้เฉพาะสาขา
  const only = await getSalesTaxReport(tenantId, { ...period, locationId: branchId });
  assert.equal(only.establishments.length, 1);
  assert.equal(only.grandTotal.vat, 3.5);
});

test("the report lists what would make it incomplete", async () => {
  const r = await getSalesTaxReport(tenantId, period);
  const noDoc = r.exceptions.filter((x) => x.kind === "PAID_WITHOUT_TAX_DOCUMENT");
  assert.deepEqual(noDoc.map((x) => x.orderId).sort(), [orders.noDoc, orders.partiallyReturned].sort());
  const noNote = r.exceptions.filter((x) => x.kind === "RETURN_WITHOUT_CREDIT_NOTE");
  assert.deepEqual(
    noNote.map((x) => x.orderId).sort(),
    [orders.a1, orders.inconsistent].sort(),
    "returns and historical cancelled/invoiced rows are flagged, but a return with a credit note is not"
  );
  assert.equal(r.exceptionCounts.PAID_WITHOUT_TAX_DOCUMENT, 2);
  assert.equal(r.exceptionCounts.RETURN_WITHOUT_CREDIT_NOTE, 2);
  assert.equal(r.exceptionCounts.FULL_REPLACES_OTHER_MONTH, 0);
  assert.equal(r.cancelled.length, 1);
});

test("a full invoice replacing last month's abbreviated invoice never moves or duplicates tax value", async () => {
  // ย้ายใบย่อที่ถูกแทนไปเดือนก่อน — สภาพของลูกค้าที่มาขอใบเต็มหลังสิ้นเดือน
  await query(
    `UPDATE bms_tax_documents SET issue_date = issue_date - interval '40 days'
      WHERE tenant_id = $1 AND order_id = $2 AND doc_type = 'ABBREVIATED'`,
    [tenantId, orders.a3]
  );
  const r = await getSalesTaxReport(tenantId, period);
  assert.equal(r.exceptionCounts.FULL_REPLACES_OTHER_MONTH, 0);
  const full = r.rows.find((x) => x.kind === "FULL" && x.buyerTaxId === "0105555555554");
  assert.ok(full);
  assert.equal(full.base, 0);
  assert.equal(full.vat, 0);
  // คืนสภาพ — เทสถัดไปนับเอกสารในงวดนี้
  await query(
    `UPDATE bms_tax_documents SET issue_date = issue_date + interval '40 days'
      WHERE tenant_id = $1 AND order_id = $2 AND doc_type = 'ABBREVIATED'`,
    [tenantId, orders.a3]
  );
});

test("a shop that is not VAT-registered gets no false exceptions", async () => {
  await query(`UPDATE bms_store_profile SET vat_registered = FALSE WHERE tenant_id = $1`, [tenantId]);
  const r = await getSalesTaxReport(tenantId, period);
  assert.equal(r.seller.vatRegistered, false);
  assert.equal(r.exceptionCounts.PAID_WITHOUT_TAX_DOCUMENT, 0);
  await query(`UPDATE bms_store_profile SET vat_registered = TRUE WHERE tenant_id = $1`, [tenantId]);
});

test("the document list filters by type, search and cancellation", async () => {
  const all = await listTaxDocuments(tenantId, { ...period, includeCancelled: true });
  assert.ok(all.total >= 6);
  const notes = await listTaxDocuments(tenantId, { ...period, docType: "CREDIT_NOTE" });
  assert.equal(notes.total, 1);
  assert.equal(notes.rows[0].total, -53.5);
  const byBuyer = await listTaxDocuments(tenantId, { ...period, search: "0105555555554" });
  assert.equal(byBuyer.total, 1);
  assert.equal(byBuyer.rows[0].docType, "FULL");
  // % ในคำค้นต้องไม่กลายเป็น wildcard ที่คืนทุกแถว
  const wildcard = await listTaxDocuments(tenantId, { ...period, search: "%" });
  assert.equal(wildcard.total, 0);
  await assert.rejects(listTaxDocuments(tenantId, { from: "2026-13-01", to: "2026-13-02" }));
});

test("the XLSX export has every sheet and Thai-dated rows", async () => {
  const r = await getSalesTaxReport(tenantId, period);
  const buf = buildXlsx(buildSalesTaxReportDoc(r, (d) => formatTaxDate(d, "BE")));
  const wb = XLSX.read(buf, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, [
    "Summary", "สรุปรายสถานประกอบการ", "ภาษีขาย-00000-1", "ภาษีขาย-00001-2",
    "กระทบยอดภายใน", "ต้องตรวจสอบ", "เอกสารที่ยกเลิก",
  ]);
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets["กระทบยอดภายใน"]);
  const year = Number(today.slice(0, 4)) + 543;
  assert.ok(rows.some((row) => String(row["วันที่"]).endsWith(`/${year}`)));
  const vatSum = rows.reduce((n, row) => n + Number(row["ภาษีมูลค่าเพิ่ม"]), 0);
  assert.equal(Math.round(vatSum * 100) / 100, 24.5, "numbers stay numeric so the accountant can sum them");

  const hqRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["ภาษีขาย-00000-1"], { header: 1, defval: "" });
  assert.equal(hqRows[0][0], "รายงานภาษีขาย");
  assert.match(String(hqRows[1][0]), /^เดือนภาษี /);
  const headerIndex = hqRows.findIndex((row) => row[0] === "ลำดับที่");
  assert.ok(headerIndex > 0);
  assert.equal(hqRows[headerIndex][1], "ใบกำกับภาษี");
  assert.equal(hqRows[headerIndex][5], "สถานประกอบการ");
  const total = hqRows.at(-1)!;
  assert.equal(total[5], "รวมทั้งสิ้น");
  assert.equal(total[6], 300);
  assert.equal(total[7], 21);
});

test("a credit note prints its returned lines, the original invoice and value net of earlier notes", async () => {
  const { orderId, docNo } = await abbreviated(branchId, devC);
  const item = (await query<{ id: string }>(
    `SELECT id FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2`, [tenantId, orderId]
  )).rows[0].id;
  const notes: string[] = [];
  for (const key of ["cn-1", "cn-2"]) {
    const ret = await posReturn(orderId, 53.5, key);
    await query(
      `INSERT INTO bms_pos_return_items (tenant_id, pos_return_id, order_item_id, qty, refund_amount)
       VALUES ($1,$2,$3,1,53.5)`, [tenantId, ret, item]
    );
    const note = await issueCreditNote({
      tenantId, orderId, amount: 53.5, reason: "รับคืนสินค้าบางรายการ", returnRef: ret,
    });
    assert.equal(note.status, "ISSUED", JSON.stringify(note));
    if (note.status === "ISSUED") notes.push(note.document.id);
  }

  const first = await getCreditNoteView(tenantId, notes[0]);
  assert.ok(first);
  assert.equal(first.original.docNo, docNo);
  assert.equal(first.original.docType, "ABBREVIATED");
  assert.equal(first.buyer, null, "an abbreviated original has no buyer to print");
  assert.equal(first.reason, "รับคืนสินค้าบางรายการ", "the return uuid stays off the document");
  assert.equal(first.lines.length, 1);
  assert.equal(first.lines[0].amount, 53.5);
  assert.equal(first.originalValue, 107);
  assert.equal(first.previouslyCredited, 0);
  assert.equal(first.correctValue, 53.5);
  assert.equal(first.differenceBeforeVat, 50);
  assert.equal(first.vatAmount, 3.5);

  const second = await getCreditNoteView(tenantId, notes[1]);
  assert.equal(second?.previouslyCredited, 53.5);
  assert.equal(second?.correctValue, 0);

  // ขอบเขตสาขา: คนที่ดูได้แค่สำนักงานใหญ่ต้องไม่เห็นใบลดหนี้ของสาขา
  assert.equal(await getCreditNoteView(tenantId, notes[0], [hqId]), null);
  // ใบกำกับไม่ใช่ใบลดหนี้
  const invoice = (await query<{ id: string }>(
    `SELECT id FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = $2 AND doc_type = 'ABBREVIATED'`,
    [tenantId, orderId]
  )).rows[0].id;
  assert.equal(await getCreditNoteView(tenantId, invoice), null);

  // Issued print snapshots remain frozen even when an earlier note is later cancelled (10.60).
  await query(
    `UPDATE bms_tax_documents SET cancelled_at = now(), cancelled_reason = 'FAKE test'
      WHERE tenant_id = $1 AND id = $2`, [tenantId, notes[0]]
  );
  assert.equal((await getCreditNoteView(tenantId, notes[1]))?.previouslyCredited, 53.5);
  assert.ok((await getCreditNoteView(tenantId, notes[0]))?.cancelledAt);
});

test("a partially returned bill stays non-invoiceable even with a credit note", async () => {
  const { orderId } = await abbreviated(branchId, devC);
  const ret = await posReturn(orderId, 53.5, "pre-full");
  const before = await issueCreditNote({ tenantId, orderId, amount: 53.5, reason: "FAKE return", returnRef: ret });
  assert.equal(before.status, "ISSUED");
  const reportBefore = await getSalesTaxReport(tenantId, period);
  const result = await issueFullTaxInvoice({ tenantId, orderId, issuedBy: userId,
    buyer: { name: "FAKE Buyer", taxId: "0105555555554", branchCode: "00000", address: "FAKE address" } });
  assert.equal(result.status, "ORDER_NOT_INVOICEABLE");
  assert.equal((await query(
    "SELECT 1 FROM bms_tax_documents WHERE tenant_id=$1 AND order_id=$2 AND (doc_type='FULL' OR cancelled_at IS NOT NULL)",
    [tenantId, orderId])).rowCount, 0);
  assert.deepEqual((await getSalesTaxReport(tenantId, period)).grandTotal, reportBefore.grandTotal);
});

test("a return without a credit note still blocks the full invoice", async () => {
  const { orderId } = await abbreviated(branchId, devC);
  await posReturn(orderId, 10, "no-note");
  const res = await issueFullTaxInvoice({
    tenantId, orderId, issuedBy: userId,
    buyer: { name: "FAKE Co., Ltd.", taxId: "0105555555554", branchCode: "00000", address: "FAKE address" },
  });
  assert.equal(res.status, "ORDER_NOT_INVOICEABLE");
});

test("an individual buyer needs no tax ID and gets no branch; a company does", async () => {
  const { orderId } = await abbreviated(hqId, devA);
  const company = await issueFullTaxInvoice({
    tenantId, orderId, issuedBy: userId,
    buyer: { name: "FAKE Co., Ltd.", taxId: null, buyerType: "COMPANY", address: "FAKE address" },
  });
  assert.equal(company.status, "BUYER_INCOMPLETE");
  const person = await issueFullTaxInvoice({
    tenantId, orderId, issuedBy: userId,
    buyer: { name: "FAKE บุคคล", taxId: null, branchCode: "00000", buyerType: "INDIVIDUAL", address: "FAKE address" },
  });
  assert.equal(person.status, "ISSUED", JSON.stringify(person));
  if (person.status !== "ISSUED") return;
  assert.equal(person.document.buyerTaxId, null);
  assert.equal(person.document.buyerBranchCode, null, "an individual is never printed as head office");
  const view = await getFullTaxInvoiceView(tenantId, person.document.id);
  assert.equal(view?.buyer.branchCode, null);
  assert.equal(view?.calendarEra, "BE");
});

test("paid, packing and shipped orders cannot issue a full invoice", async () => {
  for (const status of ["PAID", "PACKING", "SHIPPED"]) {
    const orderId = await newOrder(hqId, status);
    const result = await issueFullTaxInvoice({ tenantId, orderId, issuedBy: userId,
      buyer: { name: "FAKE Buyer", taxId: "0105555555554", branchCode: "00000", address: "FAKE address" } });
    assert.equal(result.status, "ORDER_NOT_INVOICEABLE", status);
    assert.equal((await query("SELECT 1 FROM bms_tax_documents WHERE tenant_id=$1 AND order_id=$2", [tenantId, orderId])).rowCount, 0);
  }
});

test("full invoice issuance hides orders outside the issuer's branch", async () => {
  const result = await issueFullTaxInvoice({ tenantId, orderId: await newOrder(hqId), issuedBy: userId,
    allowedLocationIds: [branchId],
    buyer: { name: "FAKE Buyer", taxId: "0105555555554", branchCode: "00000", address: "FAKE address" } });
  assert.equal(result.status, "ORDER_NOT_FOUND");
});

test("a back-office cancel still refuses a counter bill with an abbreviated invoice", async () => {
  const { orderId } = await abbreviated(hqId, devA);
  await query(`UPDATE bms_orders SET status = 'PAID' WHERE tenant_id = $1 AND id = $2`, [tenantId, orderId]);
  await assert.rejects(cancelOrder(tenantId, orderId), /คืนผ่านหน้า POS/);
});

test("teardown", async () => {
  if (!tenantId) return;
  await query(`DELETE FROM bms_etax_submissions WHERE tenant_id = $1`, [tenantId]).catch(() => {});
  for (const t of [
    "bms_pos_returns", "bms_tax_documents", "bms_document_counters", "bms_order_items", "bms_orders",
    "bms_pos_devices", "bms_inventory", "bms_products", "bms_locations", "bms_store_profile",
  ]) {
    await query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
  }
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
  await query(`DELETE FROM bms_tenants WHERE id = $1`, [tenantId]);
  const left = await query<{ n: number }>(`SELECT count(*)::int AS n FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]);
  assert.equal(left.rows[0].n, 0);
});
