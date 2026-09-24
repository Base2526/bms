// =============================================================
// เลขและวันที่ของเอกสารภาษี — DB contract (เขียนจริงลงฐาน ห้ามรันกับ production)
// -------------------------------------------------------------
// ตรึงสิ่งที่เกิดจริงเมื่อออกเอกสารกับฐานข้อมูล (ชุด pure ตรึงสูตร ชุดนี้ตรึงผล):
//  - สองเครื่องที่ไม่ได้ตั้ง prefix ออกใบย่อวันเดียวกันได้ ไม่ชน unique แล้วทำให้การขาย rollback
//  - ใบเต็ม/ใบลดหนี้ของสาขาไม่ชนกับสำนักงานใหญ่
//  - issue_date เป็นวันที่ไทยของ issued_at เสมอ
//  - ตั้ง prefix ซ้ำกับเครื่องอื่นไม่ได้ แต่เครื่องที่ซ้ำอยู่ก่อนแล้วยังแก้ค่าอื่นได้
//
// ชุดนี้สร้างร้านทดสอบของตัวเองแล้วลบทิ้ง (รันซ้ำได้)
//
//   node scripts/run-contract-tests.mjs db tax-document-numbering
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { getClient, query } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { upsertPosDevice } from "../apps/web/lib/bms/pos.ts";
import {
  getVatSettings,
  issueAbbreviatedInvoiceInTx,
  issueCreditNote,
  issueFullTaxInvoice,
  type TaxDocument,
} from "../apps/web/lib/bms/taxDocuments.ts";

const TAG = "taxdocno-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";

let tenantId = "";
let hqId = "";
let branchId = "";
const devices: Record<string, string> = {};

async function newOrder(locationId: string, status = "COMPLETED"): Promise<string> {
  const orderId = (await query<{ id: string }>(
    `INSERT INTO bms_orders (tenant_id, channel, customer_ref, status, total_amount, location_id)
     VALUES ($1,'pos',$2,$4,107,$3) RETURNING id`,
    [tenantId, `fake-${TAG}`, locationId, status]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_order_items
       (tenant_id, order_id, location_id, product_sku, size, qty, unit_price, line_amount, receipt_unit_price, vat_category)
     VALUES ($1,$2,$3,$4,$5,1,107,107,107,'V')`,
    [tenantId, orderId, locationId, SKU, SIZE]
  );
  return orderId;
}

async function abbreviated(locationId: string, deviceId: string | null): Promise<TaxDocument> {
  const orderId = await newOrder(locationId);
  const settings = await getVatSettings(tenantId);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const res = await issueAbbreviatedInvoiceInTx(client, { tenantId, orderId, locationId, deviceId, settings });
    await client.query("COMMIT");
    assert.equal(res.status, "ISSUED", JSON.stringify(res));
    if (res.status !== "ISSUED") throw new Error("not issued");
    return res.document;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

test("setup: a VAT-registered shop with a head office, a branch and three registers", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${process.pid}`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, vat_registered, price_includes_vat, vat_rate,
                                    abbreviated_tax_invoice_approved, tax_id)
     VALUES ($1,TRUE,TRUE,7,TRUE,'0105500000000')`,
    [tenantId]
  );
  hqId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office, active)
     VALUES ($1,'MAIN','FAKE HQ','00000',TRUE,TRUE) RETURNING id`,
    [tenantId]
  )).rows[0].id;
  branchId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office, active)
     VALUES ($1,'BR1','FAKE branch 1','00001',FALSE,TRUE) RETURNING id`,
    [tenantId]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$2,107,TRUE,'V')`,
    [tenantId, SKU]
  );
  for (const loc of [hqId, branchId]) {
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,100,0)`,
      [tenantId, loc, SKU, SIZE]
    );
  }
  // สองเครื่องที่สำนักงานใหญ่ไม่ได้ตั้ง prefix — สภาพที่เลขชนกันได้
  devices.a = (await upsertPosDevice(tenantId, { locationId: hqId, code: "POS-A", active: true })).id;
  devices.b = (await upsertPosDevice(tenantId, { locationId: hqId, code: "POS-B", active: true })).id;
  devices.c = (await upsertPosDevice(tenantId, {
    locationId: branchId, code: "POS-C", receiptPrefix: "C", active: true,
  })).id;
});

test("two registers without a prefix issue on the same day without colliding", async () => {
  const a = await abbreviated(hqId, devices.a);
  const b = await abbreviated(hqId, devices.b);
  // ก่อนแก้: ทั้งคู่ได้ "yyMMdd0001" แล้วใบที่สองชน UNIQUE (tenant, doc_type, doc_no)
  assert.notEqual(a.docNo, b.docNo);
  assert.ok(a.docNo.startsWith("POS-A-"), a.docNo);
  assert.ok(b.docNo.startsWith("POS-B-"), b.docNo);
  assert.ok(a.docNo.endsWith("0001") && b.docNo.endsWith("0001"), "each register keeps its own sequence");
});

test("two transactions can create the first counter row concurrently", async () => {
  devices.d = (await upsertPosDevice(tenantId, {
    locationId: hqId, code: "POS-D", receiptPrefix: "D", active: true,
  })).id;
  const [first, second] = await Promise.all([
    abbreviated(hqId, devices.d),
    abbreviated(hqId, devices.d),
  ]);
  const suffixes = [first.docNo, second.docNo].map((docNo) => Number(docNo.slice(-4))).sort((a, b) => a - b);
  assert.deepEqual(suffixes, [1, 2], "upsert must arbitrate the first row instead of racing on a plain INSERT");
});

test("a register with its own prefix keeps the familiar format", async () => {
  const c = await abbreviated(branchId, devices.c);
  assert.match(c.docNo, /^C\d{10}$/);
});

test("full invoices at the head office and a branch on the same day do not collide", async () => {
  const buyer = { name: "FAKE buyer", taxId: "0105500000001" };
  const hqOrder = await newOrder(hqId);
  const brOrder = await newOrder(branchId);
  const hq = await issueFullTaxInvoice({ tenantId, orderId: hqOrder, buyer });
  const br = await issueFullTaxInvoice({ tenantId, orderId: brOrder, buyer });
  assert.equal(hq.status, "ISSUED", JSON.stringify(hq));
  assert.equal(br.status, "ISSUED", JSON.stringify(br));
  if (hq.status !== "ISSUED" || br.status !== "ISSUED") return;
  assert.match(hq.document.docNo, /^\d{10}$/, "head office format is unchanged");
  assert.match(br.document.docNo, /^00001-\d{10}$/);
  assert.equal(hq.document.docNo.slice(-4), "0001");
  assert.equal(br.document.docNo.slice(-4), "0001");
});

test("a pending or voided order cannot receive a full tax invoice", async () => {
  const buyer = { name: "FAKE buyer", taxId: "0105500000001" };
  const pending = await issueFullTaxInvoice({
    tenantId, orderId: await newOrder(hqId, "PENDING"), buyer,
  });
  assert.equal(pending.status, "ORDER_NOT_INVOICEABLE", JSON.stringify(pending));

  const voidedOrderId = await newOrder(hqId);
  await query(`UPDATE bms_orders SET voided_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, voidedOrderId]);
  const voided = await issueFullTaxInvoice({ tenantId, orderId: voidedOrderId, buyer });
  assert.equal(voided.status, "ORDER_NOT_INVOICEABLE", JSON.stringify(voided));
});

test("a branch credit note carries the branch code", async () => {
  const doc = await abbreviated(branchId, devices.c);
  const note = await issueCreditNote({ tenantId, orderId: doc.orderId, amount: 50, reason: "FAKE return" });
  assert.equal(note.status, "ISSUED", JSON.stringify(note));
  if (note.status !== "ISSUED") return;
  assert.match(note.document.docNo, /^CN00001-\d{10}$/);
  // ใบลดหนี้ต้องแยก VAT จากยอดคืน ไม่ใช่เป็นยอดรวมเฉย ๆ
  assert.equal(note.document.vatAmount, 3.27);
});

test("every document's issue_date is the Thai date of its issued_at", async () => {
  const res = await query<{ n: number; wrong: number }>(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE issue_date <> (issued_at AT TIME ZONE 'Asia/Bangkok')::date)::int AS wrong
       FROM bms_tax_documents WHERE tenant_id = $1`,
    [tenantId]
  );
  assert.ok(res.rows[0].n >= 8);
  assert.equal(res.rows[0].wrong, 0);
  // และค่าที่แอปอ่านกลับมาต้องตรงกับฐาน (ไม่ถอยวันเพราะ toISOString)
  const row = await query<{ id: string; d: string }>(
    `SELECT id, issue_date::text AS d FROM bms_tax_documents WHERE tenant_id = $1 LIMIT 1`, [tenantId]
  );
  const { getTaxDocument } = await import("../apps/web/lib/bms/taxDocuments.ts");
  const doc = await getTaxDocument(tenantId, row.rows[0].id);
  assert.equal(doc?.issueDate, row.rows[0].d);
});

test("a prefix already used by another register is rejected", async () => {
  await assert.rejects(
    upsertPosDevice(tenantId, { locationId: hqId, code: "POS-A", receiptPrefix: "C", active: true }),
    /ถูกใช้กับเครื่อง POS-C/
  );
  // เครื่องที่ซ้ำกันอยู่ก่อนแล้ว (ตั้งผ่านฐานตรง ๆ) ต้องยังแก้ค่าอื่นได้
  await query(`UPDATE bms_pos_devices SET receipt_prefix = 'C' WHERE tenant_id = $1 AND id = $2`, [tenantId, devices.b]);
  const edited = await upsertPosDevice(tenantId, {
    locationId: hqId, code: "POS-B", name: "renamed", receiptPrefix: "C", active: true,
  });
  assert.equal(edited.name, "renamed");
  // และเมื่อ prefix ซ้ำ เลขที่ออกได้รหัสเครื่องต่อท้าย ไม่ชนกับเครื่อง C
  const b = await abbreviated(hqId, devices.b);
  assert.ok(b.docNo.startsWith("CPOS-B-"), b.docNo);
});

test("teardown", async () => {
  if (!tenantId) return;
  await query(`DELETE FROM bms_etax_submissions WHERE tenant_id = $1`, [tenantId]).catch(() => {});
  await query(`DELETE FROM bms_tax_documents WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_document_counters WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_order_items WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_orders WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_locations WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_store_profile WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_tenants WHERE id = $1`, [tenantId]);
  const left = await query<{ n: number }>(`SELECT count(*)::int AS n FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]);
  assert.equal(left.rows[0].n, 0);
});
