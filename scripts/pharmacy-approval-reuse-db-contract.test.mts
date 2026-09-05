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
import { approveAssessment } from "../apps/web/lib/bms/pharmacy/assessments.ts";
import { DECLARE_FAKE_SALES_SURFACES_SQL } from "./testing/salesSurfaces.mts";

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
  // สินค้าที่ INSERT ตรง ๆ เป็นฉบับร่างตั้งแต่ 9.51 — ต้องประกาศช่องทางขายเอง
  await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
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

// ---------------------------------------------------------------
// ใบอนุมัติที่ระบุตัวคนไข้ ใช้กับคนอื่นไม่ได้
// ---------------------------------------------------------------
// การซักถามความปลอดภัยของเภสัชกรเป็นเรื่องของ "คนนี้" ไม่ใช่ "ตะกร้านี้" ถ้าใบอนุมัติ
// ของคนไข้ A ใช้ปลดบิลของคนไข้ B ที่ซื้อของเหมือนกันได้ การซักถามนั้นก็ไม่มีความหมาย
test("ใบอนุมัติของคนไข้ A ใช้กับบิลของคนไข้ B ไม่ได้ · ของ A ใช้ได้", async () => {
  const mk = async (name: string) =>
    (
      await query<{ id: string }>(
        `INSERT INTO bms_customers (tenant_id, name) VALUES ($1,$2) RETURNING id`,
        [tenantId, `FAKE ${TAG} ${name}`]
      )
    ).rows[0].id;
  const customerA = await mk("patient A");
  const customerB = await mk("patient B");

  const draft = {
    status: "AWAITING_CUSTOMER_CONFIRMATION",
    items: [{ sku: SKU, size: SIZE, qty: 1, unitPrice: 100, productName: `FAKE ${TAG} drug` }],
    estimatedTotal: 100,
    createdOrderId: null,
    approvedAt: new Date().toISOString(),
  };
  const forA = (
    await query<{ id: string }>(
      `INSERT INTO bms_pharmacy_assessments
         (tenant_id, customer_id, channel_id, patient_relationship, consent_status, status,
          needs_manual_intake, risk_level, complaint, structured_answers,
          missing_fields, conflicting_fields, completeness_status,
          customer_confirmation_status, checkout_order_draft, expires_at)
       VALUES ($1,$2,'pos','SELF','GRANTED','APPROVED',FALSE,'LOW',
               '{}'::jsonb,'{}'::jsonb,'{}'::text[],'{}'::text[],'COMPLETE',
               'CONFIRMED',$3::jsonb, now() + interval '1 day')
       RETURNING id`,
      [tenantId, customerA, JSON.stringify(draft)]
    )
  ).rows[0].id;

  const wrongPatient = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    customerId: customerB,
    items: [{ sku: SKU, size: SIZE, qty: 1 }],
    pharmacyApprovedAssessmentId: forA,
  } as any);
  assert.equal(
    wrongPatient.status,
    "PHARMACY_REVIEW_REQUIRED",
    `ใบอนุมัติของคนอื่นต้องปลดบล็อกไม่ได้ แต่ได้ ${JSON.stringify(wrongPatient)}`
  );

  const rightPatient = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    customerId: customerA,
    items: [{ sku: SKU, size: SIZE, qty: 1 }],
    pharmacyApprovedAssessmentId: forA,
  } as any);
  assert.equal(rightPatient.status, "CREATED", JSON.stringify(rightPatient));
  if (rightPatient.status === "CREATED") createdOrders.push(rightPatient.orderId);
});

// ---------------------------------------------------------------
// approve ที่ไม่ได้ส่ง draft มา ต้องไม่ลบ draft ที่เคสถืออยู่
// ---------------------------------------------------------------
// เคสจากหน้าเคาน์เตอร์เกิดมาพร้อม checkout_order_draft ที่เป็นตะกร้าที่แคชเชียร์สแกน
// (createProductReviewAssessmentOnce) และ draft นั้นคือสิ่งเดียวที่ปลดบิลที่พักไว้ได้
// เดิม approveAssessment เขียนทับด้วย NULL ทุกครั้งที่ผู้เรียกไม่ส่ง draft → เคส APPROVED
// แต่บิลที่พักไว้จบไม่ได้ และย้อนกลับไม่ได้เพราะเคสที่ APPROVED แล้ว approve ซ้ำไม่ได้
test("approve โดยไม่ส่ง draft ต้องคง draft เดิมไว้ แล้วบิลหน้าร้านจบได้", async () => {
  // คอลัมน์ที่ users บังคับ (role/role_id/username) ยกรูปแบบมาจาก provisionShopWithIdentity()
  const email = `fake-${TAG}-rx-${process.pid}@example.invalid`;
  const pharmacist = (
    await query<{ id: string }>(
      `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash,
                          fake_test, is_licensed_pharmacist, pharmacist_license_no)
       SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE, TRUE, 'FAKE-LIC'
         FROM roles r WHERE r.name = 'Administrator' LIMIT 1
       RETURNING id`,
      [tenantId, `FAKE ${TAG} pharmacist`, email]
    )
  ).rows[0].id;

  const draft = {
    status: "AWAITING_CUSTOMER_CONFIRMATION",
    items: [{ sku: SKU, size: SIZE, qty: 2, unitPrice: 100, productName: `FAKE ${TAG} drug` }],
    estimatedTotal: 200,
    createdOrderId: null,
    approvedAt: null,
  };
  const caseId = (
    await query<{ id: string }>(
      `INSERT INTO bms_pharmacy_assessments
         (tenant_id, channel_id, patient_relationship, consent_status, status,
          needs_manual_intake, risk_level, complaint, structured_answers,
          missing_fields, conflicting_fields, completeness_status,
          customer_confirmation_status, checkout_order_draft, expires_at)
       VALUES ($1,'pos','SELF','GRANTED','PHARMACIST_REVIEWING',TRUE,'LOW',
               $2::jsonb,'{}'::jsonb,'{}'::text[],'{}'::text[],'COMPLETE',
               'CONFIRMED',$3::jsonb, now() + interval '1 day')
       RETURNING id`,
      [
        tenantId,
        JSON.stringify({ requestType: "PRODUCT_PURCHASE", sourceMeta: { source: "pos" } }),
        JSON.stringify(draft),
      ]
    )
  ).rows[0].id;
  const version = (
    await query<{ version: number }>(
      `SELECT version FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, caseId]
    )
  ).rows[0].version;

  const decision = await approveAssessment(
    tenantId,
    caseId,
    pharmacist,
    version,
    "จ่ายยาได้ กินหลังอาหาร"
    // ไม่ส่ง orderDraft — จุดที่เคยพัง
  );
  assert.equal(decision.status, "OK", JSON.stringify(decision));

  const after = await query<{ status: string | null; items: string | null }>(
    `SELECT checkout_order_draft->>'status' AS status,
            checkout_order_draft->'items' AS items
       FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, caseId]
  );
  assert.equal(after.rows[0].status, "AWAITING_CUSTOMER_CONFIRMATION", "draft เดิมต้องยังอยู่");

  const sale = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: [{ sku: SKU, size: SIZE, qty: 2 }],
    pharmacyApprovedAssessmentId: caseId,
  } as any);
  assert.equal(sale.status, "CREATED", `บิลที่พักไว้ต้องจบได้ แต่ได้ ${JSON.stringify(sale)}`);
  if (sale.status === "CREATED") createdOrders.push(sale.orderId);
});

// ---------------------------------------------------------------
// ยาที่ต้องมีใบสั่งแพทย์: จ่ายได้ที่เคาน์เตอร์ ไม่ใช่ทางออนไลน์
// ---------------------------------------------------------------
// ใบสั่งยาเป็นกระดาษที่เภสัชกรอ่าน เก็บสำเนาไว้กับเคส แล้วส่งยาข้ามเคาน์เตอร์ — ร้านขายยา
// ไม่ได้อนุมัติจากห้องแชทแล้วส่งของออกไป · ฝั่งออนไลน์จึงต้องบล็อกแม้จะมีใบอนุมัติของเคส
// อยู่ในมือ (และไม่มีใครเปิดเคสให้ตะกร้าออนไลน์ของยากลุ่มนี้ตั้งแต่แรก)
test("ยาที่ต้องมีใบสั่ง: ออนไลน์บล็อกแม้มีใบอนุมัติ · เคาน์เตอร์ที่เภสัชกรอนุมัติเคสแล้วจ่ายได้", async () => {
  const RX_SKU = `FAKE-${TAG}-RX`;
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,120,TRUE,'V')`,
    [tenantId, RX_SKU, `FAKE ${TAG} prescription drug`]
  );
  await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,50,0)`,
    [tenantId, locationId, RX_SKU, SIZE]
  );
  await query(
    `INSERT INTO bms_pharmacy_product_policies (tenant_id, product_sku, sale_policy, status)
     VALUES ($1,$2,'PRESCRIPTION_REQUIRED','APPROVED')`,
    [tenantId, RX_SKU]
  );

  const sellOn = (channel: string, approvedAssessmentId: string | null) =>
    createOrder({
      tenantId,
      channel,
      locationId,
      items: [{ sku: RX_SKU, size: SIZE, qty: 1 }],
      pharmacyApprovedAssessmentId: approvedAssessmentId,
    } as any);

  const blocked = await sellOn("line", null);
  assert.equal(blocked.status, "PHARMACY_PRESCRIPTION_REQUIRED", JSON.stringify(blocked));

  const mkApprovedCase = async (channelId: string) => {
    const draft = {
      status: "AWAITING_CUSTOMER_CONFIRMATION",
      items: [{ sku: RX_SKU, size: SIZE, qty: 1, unitPrice: 120, productName: `FAKE ${TAG} prescription drug` }],
      estimatedTotal: 120,
      createdOrderId: null,
      approvedAt: new Date().toISOString(),
    };
    return (
      await query<{ id: string }>(
        `INSERT INTO bms_pharmacy_assessments
           (tenant_id, channel_id, patient_relationship, consent_status, status,
            needs_manual_intake, risk_level, complaint, structured_answers,
            missing_fields, conflicting_fields, completeness_status,
            customer_confirmation_status, checkout_order_draft, expires_at)
         VALUES ($1,$2,'SELF','GRANTED','APPROVED',FALSE,'LOW',
                 '{}'::jsonb,'{}'::jsonb,'{}'::text[],'{}'::text[],'COMPLETE',
                 'CONFIRMED',$3::jsonb, now() + interval '1 day')
         RETURNING id`,
        [tenantId, channelId, JSON.stringify(draft)]
      )
    ).rows[0].id;
  };

  // ใบอนุมัติของเคสไม่ทำให้บิลออนไลน์ผ่าน — นี่คือกฎ ไม่ใช่ผลข้างเคียง
  const onlineCase = await mkApprovedCase("line");
  const stillBlocked = await sellOn("line", onlineCase);
  assert.equal(stillBlocked.status, "PHARMACY_PRESCRIPTION_REQUIRED", JSON.stringify(stillBlocked));

  // เคาน์เตอร์: ใบอนุมัติของเคสเดียวกันปลดได้
  const counterCase = await mkApprovedCase("pos");
  const sold = await sellOn("pos", counterCase);
  assert.equal(sold.status, "CREATED", `เคสที่เภสัชกรอนุมัติต้องจ่ายได้ที่เคาน์เตอร์ แต่ได้ ${JSON.stringify(sold)}`);
  if (sold.status === "CREATED") createdOrders.push(sold.orderId);

  // ใบเดียวใช้ครั้งเดียวยังเป็นกฎเดิม แม้จะเป็นยาที่ต้องมีใบสั่ง
  const again = await sellOn("pos", counterCase);
  assert.equal(again.status, "PHARMACY_PRESCRIPTION_REQUIRED", JSON.stringify(again));
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
    "bms_order_discounts",
    "bms_orders",
    "bms_pharmacy_assessment_events",
    "bms_pharmacy_assessments",
    "bms_pharmacy_product_policies",
    "bms_stock_movements",
    "bms_inventory",
    "bms_products",
    "bms_store_profile",
    "bms_locations",
    "bms_customers",
    "users",
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
