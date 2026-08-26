// =============================================================
// One pharmacist approval authorises exactly one sale
// -------------------------------------------------------------
// checkPharmacySaleInTx() used to clear a sku whenever an assessment was
// APPROVED and its checkout draft covered the requested quantity. Nothing ever
// read back the ORDER_CREATED marker, and the marker itself was written
// fire-and-forget *after* the sale transaction had already committed. So one
// approved case could dispense a pharmacist-approval item again and again, and
// a failure while marking left the case spendable with the goods already gone.
//
// This suite creates its own tenant and drops it at the end. That is not
// tidiness: the shop-wide `business_archetype = 'pharmacy'` switch changes
// gating for *every* product in that shop, so borrowing the first tenant the
// way the other suites do would leave a real shop mid-test if teardown ever
// failed — which is exactly what happened while this suite was being written,
// and it then poisoned the POS suites because the next run read 'pharmacy' back
// as the value to "restore".
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/pharmacy-approval-reuse-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only — never production.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { createOrder } from "../apps/web/lib/bms/orders.ts";

const TAG = "rxapproval-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "10MG";

let tenantId = "";
let locationId = "";
let assessmentId = "";
const createdOrders: string[] = [];

const sell = async (approvedAssessmentId: string | null) =>
  createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: [{ sku: SKU, size: SIZE, qty: 1 }],
    pharmacyApprovedAssessmentId: approvedAssessmentId,
  } as any);

test("setup: a throwaway pharmacy tenant with one approval-gated drug", async () => {
  const tenant = await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1, $2) RETURNING id`,
    [`FAKE ${TAG} shop`, `fake-${TAG}-${Date.now()}`]
  );
  tenantId = tenant.rows[0].id;

  const location = await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name) VALUES ($1,'MAIN',$2) RETURNING id`,
    [tenantId, `FAKE ${TAG} branch`]
  );
  locationId = location.rows[0].id;

  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1,'pharmacy')`,
    [tenantId]
  );
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,100,TRUE,'V')`,
    [tenantId, SKU, `FAKE ${TAG} drug`]
  );
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,100,0)`,
    [tenantId, locationId, SKU, SIZE]
  );
  await query(
    `INSERT INTO bms_pharmacy_product_policies (tenant_id, product_sku, sale_policy, status)
     VALUES ($1,$2,'PHARMACIST_APPROVAL','APPROVED')`,
    [tenantId, SKU]
  );

  // ใบอนุมัติที่ครอบ 5 ชิ้น — จำนวนไม่ใช่ตัวจำกัด ประเด็นคือ "ใบเดียวใช้ได้ครั้งเดียว"
  const draft = {
    status: "AWAITING_CUSTOMER_CONFIRMATION",
    items: [{ sku: SKU, size: SIZE, qty: 5, unitPrice: 100, productName: `FAKE ${TAG} drug` }],
    estimatedTotal: 500,
    createdOrderId: null,
    approvedAt: new Date().toISOString(),
  };
  const inserted = await query<{ id: string }>(
    `INSERT INTO bms_pharmacy_assessments
       (tenant_id, channel_id, patient_relationship, consent_status, status,
        needs_manual_intake, risk_level, complaint, structured_answers,
        missing_fields, conflicting_fields, completeness_status,
        customer_confirmation_status, checkout_order_draft, expires_at)
     VALUES ($1,'pos','SELF','GRANTED','APPROVED',FALSE,'LOW',
             '{}'::jsonb,'{}'::jsonb,'{}'::text[],'{}'::text[],'COMPLETE',
             'CONFIRMED',$2::jsonb, now() + interval '1 day')
     RETURNING id`,
    [tenantId, JSON.stringify(draft)]
  );
  assessmentId = inserted.rows[0].id;
});

test("ไม่มีใบอนุมัติ = ขายไม่ได้ (ยืนยันว่าด่านทำงานอยู่จริง)", async () => {
  const res = await sell(null);
  assert.equal(res.status, "PHARMACY_REVIEW_REQUIRED", JSON.stringify(res));
});

test("บิลแรกที่ใช้ใบอนุมัติ ขายได้ และประทับว่าใช้แล้วในทรานแซกชันเดียวกัน", async () => {
  const res = await sell(assessmentId);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  createdOrders.push(res.orderId);

  const draft = await query<{ status: string; created_order_id: string | null }>(
    `SELECT checkout_order_draft->>'status' AS status,
            checkout_order_draft->>'createdOrderId' AS created_order_id
       FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId]
  );
  assert.equal(draft.rows[0].status, "ORDER_CREATED");
  assert.equal(draft.rows[0].created_order_id, res.orderId,
    "ต้องรู้ว่าใบอนุมัตินี้ถูกใช้ไปกับบิลไหน");

  const events = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pharmacy_assessment_events
      WHERE tenant_id = $1 AND assessment_id = $2 AND action = 'assessment.checkout_order_created'`,
    [tenantId, assessmentId]
  );
  assert.equal(Number(events.rows[0].n), 1, "ต้องมีร่องรอยการใช้ใบอนุมัติ");
});

test("ใบอนุมัติเดิมใช้ซ้ำไม่ได้ — นี่คือช่องที่เคยเปิดอยู่", async () => {
  const res = await sell(assessmentId);
  assert.equal(
    res.status,
    "PHARMACY_REVIEW_REQUIRED",
    `ใบอนุมัติที่ใช้แล้วต้องปลดบล็อกไม่ได้อีก แต่ได้ ${JSON.stringify(res)}`
  );
});

test("รอบที่ถูกปฏิเสธต้องไม่กินสต็อกและไม่ทิ้งบิลค้าง", async () => {
  const inv = await query<{ reserved_stock: number }>(
    `SELECT reserved_stock FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  assert.equal(Number(inv.rows[0].reserved_stock), 1,
    "บิลแรกจอง 1 ชิ้น รอบที่ถูกปฏิเสธต้องไม่จองเพิ่ม");
  const orders = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_orders WHERE tenant_id = $1`,
    [tenantId]
  );
  assert.equal(Number(orders.rows[0].n), 1, "ต้องมีบิลเดียวเท่านั้นในร้านทดสอบนี้");
});

test("teardown: drop the throwaway tenant and everything under it", async () => {
  // ลบตามลำดับ FK เอง ไม่พึ่ง cascade — bms_products_tenant_fk ไม่ใช่ ON DELETE
  // CASCADE (เจอตอนเขียนเทสนี้) เทนแนนต์เป็นของทิ้งอยู่แล้วจึงลบตาม tenant_id
  // ได้ทั้งหมดโดยไม่ต้องกลัวโดนข้อมูลจริง
  //
  // เก็บกวาดร้านทดสอบที่ค้างจากรอบก่อนด้วย (รอบที่ assertion ล้มก่อนถึง teardown)
  // ไม่งั้นมันค้างเป็นร้านยาในฐาน dev ไปเรื่อย ๆ
  const stale = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`,
    [`fake-${TAG}-%`]
  );
  const ids = [...new Set([tenantId, ...stale.rows.map((r) => r.id)].filter(Boolean))];
  if (ids.length === 0) return;
  for (const table of [
    "bms_order_items",
    "bms_orders",
    "bms_pharmacy_assessment_events",
    "bms_pharmacy_assessments",
    "bms_pharmacy_product_policies",
    "bms_stock_movements",
    "bms_inventory",
    "bms_products",
    "bms_store_profile",
    "bms_locations",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  const left = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_tenants WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  assert.equal(Number(left.rows[0].n), 0, "ร้านทดสอบต้องไม่เหลือค้างในฐาน");
});
