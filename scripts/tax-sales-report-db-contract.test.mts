// =============================================================
// รายงานภาษีขาย — DB contract (เขียนจริงลงฐาน ห้ามรันกับ production)
// -------------------------------------------------------------
// ตัวเลขทุกตัวคำนวณมือ ไม่ได้ก็อปจาก output:
//   สินค้า 107 บาท (รวม VAT 7%) → ฐานภาษี 100.00 · VAT 7.00
//   ใบลดหนี้ 53.50 → VAT 53.50 × 7/107 = 3.50 · ฐาน 50.00 · เป็นยอดลบในรายงาน
//
// ตรึง: ใบย่อสรุปรายวันต่อเครื่องเป็นช่วงเลข · ใบลดหนี้เป็นลบ · แยกยอดรายสถานประกอบการ ·
//       ส่วน "ต้องตรวจสอบ" จับบิลที่ชำระแล้วไม่มีใบกำกับ, คืนของไม่มีใบลดหนี้,
//       ใบเต็มที่ออกแทนใบย่อข้ามเดือน · ไฟล์ XLSX มีครบทุกแผ่น
//
//   node scripts/run-contract-tests.mjs db tax-sales-report
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "../apps/web/node_modules/xlsx/xlsx.mjs";

import { getClient, query } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { upsertPosDevice } from "../apps/web/lib/bms/pos.ts";
import {
  getVatSettings,
  issueAbbreviatedInvoiceInTx,
  issueCreditNote,
  issueFullTaxInvoice,
} from "../apps/web/lib/bms/taxDocuments.ts";
import { getSalesTaxReport, listTaxDocuments } from "../apps/web/lib/bms/taxReports.ts";
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
       (tenant_id, order_id, location_id, product_sku, size, qty, unit_price, receipt_unit_price, vat_category)
     VALUES ($1,$2,$3,$4,$5,1,107,107,'V')`,
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
                                    abbreviated_tax_invoice_approved, tax_id, calendar_era)
     VALUES ($1,TRUE,TRUE,7,TRUE,'0105500000009','BE')`,
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
  // ใบที่สามลูกค้าขอใบเต็ม → ใบย่อถูกยกเลิก ใบเต็มนับแทน
  const full = await issueFullTaxInvoice({
    tenantId, orderId: orders.a3, buyer: { name: "FAKE Co., Ltd.", taxId: "0105500000017", branchCode: "00002" },
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
});

test("abbreviated invoices are summarised per day per register as a number range", async () => {
  const r = await getSalesTaxReport(tenantId, period);
  const day = r.rows.filter((x) => x.kind === "ABBREVIATED_DAY" && x.locationId === hqId);
  assert.equal(day.length, 1);
  const [g] = day;
  assert.match(g.docNoFrom, /^A\d{10}$/);
  assert.match(g.docNoTo, /^A\d{10}$/);
  assert.ok(g.docNoFrom.endsWith("0001") && g.docNoTo.endsWith("0003"), `${g.docNoFrom}–${g.docNoTo}`);
  assert.equal(g.docCount, 2, "the replaced abbreviated invoice is not counted");
  assert.equal(g.cancelledCount, 1);
  assert.equal(g.base, 200);
  assert.equal(g.vat, 14);
  assert.equal(g.exempt, 0);
  assert.equal(g.total, 214);
});

test("a full invoice is one row with the buyer, and a credit note is negative", async () => {
  const r = await getSalesTaxReport(tenantId, period);
  const full = r.rows.find((x) => x.kind === "FULL");
  assert.ok(full);
  assert.equal(full.buyerName, "FAKE Co., Ltd.");
  assert.equal(full.buyerTaxId, "0105500000017");
  assert.equal(full.buyerBranchCode, "00002");
  assert.equal(full.base, 100);
  assert.equal(full.vat, 7);

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
  // HQ: ใบย่อ 2 + ใบเต็ม 1 = ฐาน 300 · VAT 21
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
  assert.deepEqual(noDoc.map((x) => x.orderId), [orders.noDoc]);
  const noNote = r.exceptions.filter((x) => x.kind === "RETURN_WITHOUT_CREDIT_NOTE");
  assert.deepEqual(noNote.map((x) => x.orderId), [orders.a1], "the return that has a credit note is not flagged");
  assert.equal(r.exceptionCounts.PAID_WITHOUT_TAX_DOCUMENT, 1);
  assert.equal(r.exceptionCounts.RETURN_WITHOUT_CREDIT_NOTE, 1);
  assert.equal(r.exceptionCounts.FULL_REPLACES_OTHER_MONTH, 0);
  assert.equal(r.cancelled.length, 1);
});

test("a full invoice replacing last month's abbreviated invoice is flagged", async () => {
  // ย้ายใบย่อที่ถูกแทนไปเดือนก่อน — สภาพของลูกค้าที่มาขอใบเต็มหลังสิ้นเดือน
  await query(
    `UPDATE bms_tax_documents SET issue_date = issue_date - interval '40 days'
      WHERE tenant_id = $1 AND order_id = $2 AND doc_type = 'ABBREVIATED'`,
    [tenantId, orders.a3]
  );
  const r = await getSalesTaxReport(tenantId, period);
  const flagged = r.exceptions.filter((x) => x.kind === "FULL_REPLACES_OTHER_MONTH");
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].orderId, orders.a3);
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
  const byBuyer = await listTaxDocuments(tenantId, { ...period, search: "0105500000017" });
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
  assert.deepEqual(wb.SheetNames, ["Summary", "สรุปรายสถานประกอบการ", "รายงานภาษีขาย", "ต้องตรวจสอบ", "เอกสารที่ยกเลิก"]);
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets["รายงานภาษีขาย"]);
  const year = Number(today.slice(0, 4)) + 543;
  assert.ok(rows.some((row) => String(row["วันที่"]).endsWith(`/${year}`)));
  const vatSum = rows.reduce((n, row) => n + Number(row["ภาษีมูลค่าเพิ่ม"]), 0);
  assert.equal(Math.round(vatSum * 100) / 100, 24.5, "numbers stay numeric so the accountant can sum them");
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
