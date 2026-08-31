// =============================================================
// เภสัชกรกด PIN อนุมัติจ่ายยาที่เครื่องขาย (9.29)
// -------------------------------------------------------------
// ก่อน 9.29 ยาที่ต้องมีใบสั่งแพทย์ขายไม่ได้เลยทุกช่องทาง และสินค้าที่ยังไม่มีนโยบาย
// ที่อนุมัติแล้วก็ขายไม่ได้กลางคิวลูกค้า · ร้านยาจริงแก้ปัญหานี้ด้วยคนที่ยืนอยู่ตรงนั้น
// เทสชุดนี้จึงคุมสองอย่างพร้อมกัน: "ขายได้จริงไหม" และ "ขายได้แล้วมีหลักฐานไหม"
//
// สร้าง tenant ของตัวเองแล้วลบทิ้ง — `business_archetype = 'pharmacy'` เปลี่ยนการกัน
// บิลของ **ทุกสินค้า** ในร้านนั้น ยืมร้านจริงมาทดสอบแล้ว teardown ล้ม = ร้านจริงค้าง
// เป็นร้านยา (เกิดมาแล้ว ดูโน้ตใน CLAUDE.local.md)
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/pharmacy-counter-authorization-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only — never production.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { createOrder } from "../apps/web/lib/bms/orders.ts";
import { listPharmacistCounterAuthorizations } from "../apps/web/lib/bms/pharmacy/counterAuthorizations.ts";

const TAG = "rxcounter-test";
const RX_SKU = `FAKE-${TAG}-RX`;      // PRESCRIPTION_REQUIRED, policy APPROVED
const NEW_SKU = `FAKE-${TAG}-NEW`;    // ไม่มีแถว policy เลย
const CAP_SKU = `FAKE-${TAG}-CAP`;    // DIRECT_SALE แต่มีเพดาน 2 ชิ้น
const SIZE = "10MG";

let tenantId = "";
let locationId = "";
let pharmacistId = "";
let pharmacist2Id = "";
let clerkId = "";
let deviceId = "";
let shiftId = "";
const orders: string[] = [];

const sell = async (
  sku: string,
  qty: number,
  authorizer: string | null,
  note?: string,
  extra: Record<string, unknown> = {}
) =>
  createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: [{ sku, size: SIZE, qty }],
    pharmacistCounterAuthorization: authorizer
      ? { pharmacistUserId: authorizer, note: note ?? null }
      : null,
    ...extra,
  } as any);

/** เคสในคิวที่เกิดจากเครื่องขาย — draft คือสิ่งที่บอกว่าเคสนี้เป็นเรื่องของตะกร้าใบไหน */
async function mkCounterCase(opts: {
  status: string;
  shiftId: string | null;
  draftItems: Array<{ sku: string; size: string; qty: number }>;
}): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO bms_pharmacy_assessments
       (tenant_id, channel_id, patient_relationship, consent_status, status,
        needs_manual_intake, risk_level, complaint, structured_answers,
        missing_fields, conflicting_fields, completeness_status,
        customer_confirmation_status, checkout_order_draft, expires_at)
     VALUES ($1,'pos','SELF','GRANTED',$2,TRUE,'LOW',
             $3::jsonb,'{}'::jsonb,'{}'::text[],'{}'::text[],'COMPLETE',
             'CONFIRMED',$4::jsonb, now() + interval '1 day')
     RETURNING id`,
    [
      tenantId,
      opts.status,
      JSON.stringify({
        requestType: "PRODUCT_PURCHASE",
        sourceMeta: { source: "pos", shiftId: opts.shiftId },
      }),
      JSON.stringify({
        status: "AWAITING_CUSTOMER_CONFIRMATION",
        items: opts.draftItems.map((item) => ({
          ...item,
          unitPrice: 100,
          productName: item.sku,
          drugName: null,
          dosageInstruction: null,
          pharmacistNote: null,
        })),
        estimatedTotal: 100,
        createdOrderId: null,
        approvedAt: null,
      }),
    ]
  );
  return res.rows[0].id;
}

const caseStatusOf = async (caseId: string) =>
  (
    await query<{ status: string; reason: string | null }>(
      `SELECT status, decision_reason AS reason
         FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, caseId]
    )
  ).rows[0];

async function mkUser(name: string, licensed: boolean): Promise<string> {
  const email = `fake-${TAG}-${name}-${process.pid}@example.invalid`;
  const res = await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash,
                        fake_test, is_licensed_pharmacist, pharmacist_license_no)
     SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE, $4, $5
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1
     RETURNING id`,
    [tenantId, `FAKE ${TAG} ${name}`, email, licensed, licensed ? "FAKE-LIC" : null]
  );
  return res.rows[0].id;
}

test("setup: throwaway pharmacy tenant + ยา 3 แบบ + เภสัชกร 1 คน / ไม่ใช่เภสัชกร 1 คน", async () => {
  tenantId = (
    await query<{ id: string }>(
      `INSERT INTO bms_tenants (name, slug) VALUES ($1, $2) RETURNING id`,
      [`FAKE ${TAG} shop`, `fake-${TAG}-${Date.now()}`]
    )
  ).rows[0].id;
  locationId = (
    await query<{ id: string }>(
      `INSERT INTO bms_locations (tenant_id, code, name) VALUES ($1,'MAIN',$2) RETURNING id`,
      [tenantId, `FAKE ${TAG} branch`]
    )
  ).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1,'pharmacy')`,
    [tenantId]
  );

  for (const sku of [RX_SKU, NEW_SKU, CAP_SKU]) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
       VALUES ($1,$2,$3,100,TRUE,'V')`,
      [tenantId, sku, `FAKE ${TAG} ${sku}`]
    );
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,100,0)`,
      [tenantId, locationId, sku, SIZE]
    );
  }
  await query(
    `INSERT INTO bms_pharmacy_product_policies (tenant_id, product_sku, sale_policy, status)
     VALUES ($1,$2,'PRESCRIPTION_REQUIRED','APPROVED')`,
    [tenantId, RX_SKU]
  );
  await query(
    `INSERT INTO bms_pharmacy_product_policies (tenant_id, product_sku, sale_policy, status, max_quantity)
     VALUES ($1,$2,'DIRECT_SALE','APPROVED',2)`,
    [tenantId, CAP_SKU]
  );

  pharmacistId = await mkUser("rx", true);
  pharmacist2Id = await mkUser("rx2", true);
  clerkId = await mkUser("clerk", false);

  // เครื่องขาย + กะที่เปิดค้าง (เปิดโดยคนที่ไม่ใช่เภสัชกร — กรณีปกติของร้านที่แคชเชียร์
  // เปิดร้านเอง จึงไม่มีใครถูกบันทึกว่าเป็นเภสัชกรประจำกะ)
  deviceId = (
    await query<{ id: string }>(
      `INSERT INTO bms_pos_devices (tenant_id, location_id, code, name)
       VALUES ($1,$2,'POS-1',$3) RETURNING id`,
      [tenantId, locationId, `FAKE ${TAG} device`]
    )
  ).rows[0].id;
  shiftId = (
    await query<{ id: string }>(
      `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float)
       VALUES ($1,$2,$3,$4,0) RETURNING id`,
      [tenantId, locationId, deviceId, clerkId]
    )
  ).rows[0].id;
});

test("ไม่มีใครอนุมัติ = ยาที่ต้องมีใบสั่งแพทย์ยังขายไม่ได้", async () => {
  const res = await sell(RX_SKU, 1, null);
  assert.equal(res.status, "PHARMACY_PRESCRIPTION_REQUIRED", JSON.stringify(res));
});

test("คนที่ไม่ได้เป็นเภสัชกรกด PIN ก็ปลดไม่ได้ — ใบอนุญาตคือด่านจริง ไม่ใช่ permission", async () => {
  const res = await sell(RX_SKU, 1, clerkId);
  assert.equal(res.status, "PHARMACY_PRESCRIPTION_REQUIRED", JSON.stringify(res));
});

test("เภสัชกรอนุมัติ → ขายได้ และมีหลักฐานในทรานแซกชันเดียวกับบิล", async () => {
  const res = await sell(RX_SKU, 2, pharmacistId, "ใบสั่ง รพ.ทดสอบ เลข 123");
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  orders.push(res.orderId);

  const evidence = await query<{
    product_sku: string; size: string; qty: number;
    sale_policy: string; policy_status: string; pharmacist_user_id: string; note: string | null;
  }>(
    `SELECT product_sku, size, qty, sale_policy, policy_status, pharmacist_user_id, note
       FROM bms_pos_pharmacist_authorizations
      WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, res.orderId]
  );
  assert.equal(evidence.rowCount, 1, "ต้องมีหลักฐาน 1 แถวต่อ (sku, ไซซ์)");
  const row = evidence.rows[0];
  assert.equal(row.product_sku, RX_SKU);
  assert.equal(Number(row.qty), 2, "หลักฐานต้องบอกว่าจ่ายไปเท่าไร");
  assert.equal(row.sale_policy, "PRESCRIPTION_REQUIRED", "เก็บนโยบาย ณ เวลานั้น");
  assert.equal(row.policy_status, "APPROVED");
  assert.equal(row.pharmacist_user_id, pharmacistId);
  assert.equal(row.note, "ใบสั่ง รพ.ทดสอบ เลข 123");

  const audit = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_audit_log
      WHERE tenant_id = $1 AND action = 'pharmacy.counter_authorization' AND target = $2`,
    [tenantId, res.orderId]
  );
  assert.equal(Number(audit.rows[0].n), 1, "ต้องมีร่องรอยว่าใครอนุมัติบิลนี้");
});

test("สินค้าที่ยังไม่มีนโยบาย: เภสัชกรรับผิดชอบได้ และหลักฐานบอกว่าไม่มีนโยบาย", async () => {
  const blocked = await sell(NEW_SKU, 1, null);
  assert.equal(blocked.status, "PHARMACY_POLICY_UNKNOWN", JSON.stringify(blocked));

  const res = await sell(NEW_SKU, 1, pharmacistId);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  orders.push(res.orderId);

  const row = await query<{ sale_policy: string; policy_status: string }>(
    `SELECT sale_policy, policy_status FROM bms_pos_pharmacist_authorizations
      WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, res.orderId]
  );
  assert.equal(row.rows[0].sale_policy, "UNKNOWN");
  assert.equal(row.rows[0].policy_status, "MISSING");
});

test("PIN เภสัชกรปลดเพดานจำนวนต่อครั้งไม่ได้ และไม่ทิ้งหลักฐานหลอกไว้", async () => {
  const res = await sell(CAP_SKU, 5, pharmacistId);
  assert.equal(res.status, "PHARMACY_QUANTITY_LIMIT_EXCEEDED", JSON.stringify(res));
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pos_pharmacist_authorizations
      WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, CAP_SKU]
  );
  assert.equal(Number(rows.rows[0].n), 0, "บิลที่ถูกปฏิเสธต้องไม่ทิ้งหลักฐานการอนุมัติ");
});

test("ตะกร้าที่ไม่ติดอะไรเลย ไม่สร้างหลักฐานแม้จะส่งผู้อนุมัติมาด้วย", async () => {
  const res = await sell(CAP_SKU, 1, pharmacistId);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  orders.push(res.orderId);
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pos_pharmacist_authorizations
      WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, res.orderId]
  );
  assert.equal(Number(rows.rows[0].n), 0, "หลักฐานควรมีเฉพาะรายการที่ต้องใช้การอนุมัติจริง");
});

test("ร้านที่ปิดการอนุมัติที่เครื่อง = กลับไปบล็อกเหมือนเดิม", async () => {
  await query(
    `UPDATE bms_store_profile SET pharmacy_counter_authorization = FALSE WHERE tenant_id = $1`,
    [tenantId]
  );
  const res = await sell(RX_SKU, 1, pharmacistId);
  assert.equal(res.status, "PHARMACY_PRESCRIPTION_REQUIRED", JSON.stringify(res));
  await query(
    `UPDATE bms_store_profile SET pharmacy_counter_authorization = TRUE WHERE tenant_id = $1`,
    [tenantId]
  );
});

test("ช่องทางออนไลน์ไม่ได้รับอนุญาตแบบนี้เลย ไม่ว่าจะส่งเภสัชกรมาหรือไม่", async () => {
  const res = await createOrder({
    tenantId,
    channel: "line",
    locationId,
    items: [{ sku: RX_SKU, size: SIZE, qty: 1 }],
    pharmacistCounterAuthorization: { pharmacistUserId: pharmacistId, note: null },
  } as any);
  assert.equal(res.status, "PHARMACY_PRESCRIPTION_REQUIRED", JSON.stringify(res));
});

// ---------------------------------------------------------------
// เคสในคิวที่ถูกแทนด้วยการอนุมัติที่เคาน์เตอร์ ต้องถูกปิด — ในทรานแซกชันของบิล
// ---------------------------------------------------------------
// ถ้าปล่อยค้าง แล้วมีเภสัชกรไปกดอนุมัติในคิวทีหลัง จะได้ "ใบอนุมัติที่ใช้ขายได้อีกใบ"
// ของตะกร้าที่ของออกจากร้านไปแล้ว
test("ปิดเคสในคิวเมื่อขายด้วยการอนุมัติที่เคาน์เตอร์แทน (ทรานแซกชันเดียวกับบิล)", async () => {
  const caseId = await mkCounterCase({
    status: "WAITING_FOR_PHARMACIST",
    shiftId,
    draftItems: [{ sku: RX_SKU, size: SIZE, qty: 1 }],
  });

  const res = await sell(RX_SKU, 1, pharmacistId, null, {
    posShiftId: shiftId,
    posDeviceId: deviceId,
    pharmacySupersededAssessmentId: caseId,
  });
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  orders.push(res.orderId);

  const row = await caseStatusOf(caseId);
  assert.equal(row.status, "CLOSED");
  assert.equal(row.reason, "dispensed_at_counter_with_pharmacist_authorization",
    "ต้องอ่านย้อนได้ว่าปิดเพราะขายหน้าเคาน์เตอร์ ไม่ใช่หมดอายุ");

  const events = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pharmacy_assessment_events
      WHERE tenant_id = $1 AND assessment_id = $2 AND action = 'assessment.closed'`,
    [tenantId, caseId]
  );
  assert.equal(Number(events.rows[0].n), 1, "ร่องรอยการปิดต้อง commit มาพร้อมบิล");
});

// ช่องแข่งที่เส้นทางเดิม (best-effort หลัง commit) ปิดไม่ได้: closeAssessment() ไม่รับ
// สถานะ APPROVED จึงเงียบ ๆ ทิ้งใบอนุมัติที่ยังใช้ขายตะกร้าเดิมได้อีกใบไว้
test("เคสที่คิวเพิ่งกดอนุมัติไปพร้อมกัน ก็ต้องถูกปิด", async () => {
  const caseId = await mkCounterCase({
    status: "APPROVED",
    shiftId,
    draftItems: [{ sku: RX_SKU, size: SIZE, qty: 1 }],
  });
  const res = await sell(RX_SKU, 1, pharmacistId, null, {
    posShiftId: shiftId,
    posDeviceId: deviceId,
    pharmacySupersededAssessmentId: caseId,
  });
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  orders.push(res.orderId);
  assert.equal((await caseStatusOf(caseId)).status, "CLOSED");
});

test("id เคสของกะอื่น ปิดไม่ได้ — เครื่องหนึ่งเครื่องต้องไม่ปิดเคสของลูกค้าคนอื่น", async () => {
  const otherShiftCase = await mkCounterCase({
    status: "WAITING_FOR_PHARMACIST",
    shiftId: "00000000-0000-0000-0000-000000000000",
    draftItems: [{ sku: RX_SKU, size: SIZE, qty: 1 }],
  });
  const res = await sell(RX_SKU, 1, pharmacistId, null, {
    posShiftId: shiftId,
    posDeviceId: deviceId,
    pharmacySupersededAssessmentId: otherShiftCase,
  });
  // บิลยังต้องจบ — ของถูกจ่ายตามการตัดสินของเภสัชกรแล้ว การปิดเคสผิดใบไม่ใช่เหตุให้ล้มบิล
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  orders.push(res.orderId);
  assert.equal((await caseStatusOf(otherShiftCase)).status, "WAITING_FOR_PHARMACIST");
});

test("เคสของตะกร้าอื่น (draft ไม่อยู่ในบิลนี้) ปิดไม่ได้", async () => {
  const otherBasketCase = await mkCounterCase({
    status: "WAITING_FOR_PHARMACIST",
    shiftId,
    // draft ขอ 3 ชิ้น แต่บิลนี้ขาย 1 → ไม่ใช่ตะกร้าเดียวกัน
    draftItems: [{ sku: RX_SKU, size: SIZE, qty: 3 }],
  });
  const res = await sell(RX_SKU, 1, pharmacistId, null, {
    posShiftId: shiftId,
    posDeviceId: deviceId,
    pharmacySupersededAssessmentId: otherBasketCase,
  });
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  orders.push(res.orderId);
  assert.equal((await caseStatusOf(otherBasketCase)).status, "WAITING_FOR_PHARMACIST");
});

// ---------------------------------------------------------------
// เภสัชกรผู้รับผิดชอบกะ
// ---------------------------------------------------------------
// 7.97 บันทึกไว้เฉพาะกรณีคนเปิดกะเป็นเภสัชกรเอง กะที่แคชเชียร์เปิดจึงไม่มีใครบันทึก
// · การอนุมัติที่เครื่องคือหลักฐานว่ามีเภสัชกรอยู่จริง จึงประทับให้ **เมื่อยังว่างเท่านั้น**
test("การอนุมัติที่เครื่องประทับเภสัชกรประจำกะ และไม่ทับคนแรก", async () => {
  await query(
    `UPDATE bms_pos_shifts SET pharmacist_user_id = NULL WHERE tenant_id = $1 AND id = $2`,
    [tenantId, shiftId]
  );

  const first = await sell(NEW_SKU, 1, pharmacistId, null, {
    posShiftId: shiftId,
    posDeviceId: deviceId,
  });
  assert.equal(first.status, "CREATED", JSON.stringify(first));
  if (first.status === "CREATED") orders.push(first.orderId);
  const stamped = await query<{ pharmacist_user_id: string | null }>(
    `SELECT pharmacist_user_id FROM bms_pos_shifts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, shiftId]
  );
  assert.equal(stamped.rows[0].pharmacist_user_id, pharmacistId);

  const second = await sell(NEW_SKU, 1, pharmacist2Id, null, {
    posShiftId: shiftId,
    posDeviceId: deviceId,
  });
  assert.equal(second.status, "CREATED", JSON.stringify(second));
  if (second.status === "CREATED") orders.push(second.orderId);
  const after = await query<{ pharmacist_user_id: string | null }>(
    `SELECT pharmacist_user_id FROM bms_pos_shifts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, shiftId]
  );
  assert.equal(after.rows[0].pharmacist_user_id, pharmacistId,
    "คนที่ลงเวรไว้ก่อนต้องไม่ถูกเขียนทับด้วยผู้อนุมัติรายถัดไป");
});

// ---------------------------------------------------------------
// เส้นทางอ่าน: หลักฐานที่อ่านไม่ได้ = ตอบคำถามของคนไม่ได้
// ---------------------------------------------------------------
test("บันทึกการจ่ายยาที่เคาน์เตอร์อ่านกลับได้ พร้อมชื่อเภสัชกรและนโยบายที่ปลด", async () => {
  const page = await listPharmacistCounterAuthorizations(tenantId, { limit: 100 });
  assert.ok(page.total > 0, "ต้องมีรายการที่เทสข้างบนสร้างไว้");
  const rx = page.items.find((item) => item.productSku === RX_SKU);
  assert.ok(rx, "ยาที่ต้องมีใบสั่งซึ่งถูกอนุมัติต้องอยู่ในบันทึก");
  assert.equal(rx!.salePolicy, "PRESCRIPTION_REQUIRED");
  assert.equal(rx!.pharmacistUserId, pharmacistId);
  assert.ok(rx!.pharmacistName, "ต้องอ่านชื่อเภสัชกรได้ ไม่ใช่แค่ id");
  assert.equal(rx!.orderCode.length, 8, "ต้องมีรหัสบิลสั้นให้พนักงานเรียก");
  assert.ok(rx!.createdAt.endsWith("Z"), "เวลาต้องเป็น ISO string ไม่ใช่ Date/epoch");

  const unknown = page.items.find((item) => item.productSku === NEW_SKU);
  assert.ok(unknown, "สินค้าที่ยังไม่มีนโยบายก็ต้องอยู่ในบันทึก");
  assert.equal(unknown!.policyStatus, "MISSING");

  const none = await listPharmacistCounterAuthorizations(tenantId, {
    from: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(none.items.length, 0, "ตัวกรองช่วงเวลาต้องมีผลจริง");
});


test("teardown: drop the throwaway tenant and everything under it", async () => {
  const stale = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`,
    [`fake-${TAG}-%`]
  );
  const ids = [...new Set([tenantId, ...stale.rows.map((r) => r.id)].filter(Boolean))];
  if (ids.length === 0) return;
  for (const table of [
    "bms_pos_pharmacist_authorizations",
    "bms_pharmacy_assessment_events",
    "bms_pharmacy_assessments",
    "bms_order_items",
    "bms_order_discounts",
    // bms_orders.pos_shift_id is NO ACTION, so the bills have to go before the shift they were
    // rung on. Dropping the shift first failed every run and left this suite's rows in the
    // database — a teardown that throws is a teardown nobody notices is not running.
    "bms_orders",
    "bms_pos_shifts",
    "bms_pos_devices",
    "bms_pharmacy_product_policies",
    "bms_stock_movements",
    "bms_inventory",
    "bms_products",
    "bms_store_profile",
    "bms_locations",
    "bms_audit_log",
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
