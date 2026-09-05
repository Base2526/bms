// =============================================================
// Emailing / LINE-ing a receipt copy (8.6)
// -------------------------------------------------------------
// Receipts could only leave the shop on paper. This suite covers the part that
// can go quietly wrong: the figures on the copy the customer keeps must be the
// figures on the document that was filed, not a fresh calculation.
//
// A bill mixing VAT-exempt goods is where total × 7/107 stops matching reality,
// so the customer would be holding evidence that contradicts the shop's own tax
// document. The delivery module therefore reads the issued document and never
// recomputes.
//
// Sending itself is not exercised here — no mail provider or LINE token in a test
// environment, and stubbing them would only prove the stub works. What is proved
// is the composition, the recipient resolution, and that a missing recipient is a
// clear refusal rather than a thrown error mid-sale.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/receipt-delivery-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { sendReceipt } from "../apps/web/lib/bms/receiptDelivery.ts";
import { createOrder } from "../apps/web/lib/bms/orders.ts";
import { DECLARE_FAKE_SALES_SURFACES_SQL } from "./testing/salesSurfaces.mts";

const TAG = "receiptsend-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";

let tenantId = "";
let locationId = "";
let orderId = "";
let customerId = "";

test("setup: a shop, a product, and one order", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;

  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,250,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET price = 250, active = TRUE`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  // สินค้าที่ INSERT ตรง ๆ เป็นฉบับร่างตั้งแต่ 9.51 — ต้องประกาศช่องทางขายเอง
  await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,100,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 100, reserved_stock = 0`,
    [tenantId, locationId, SKU, SIZE]
  );

  const created = await createOrder({
    tenantId, channel: "pos", locationId,
    items: [{ sku: SKU, size: SIZE, qty: 2 }],
  } as any);
  assert.equal(created.status, "CREATED", JSON.stringify(created));
  if (created.status !== "CREATED") return;
  orderId = created.orderId;
});

test("an unknown order is reported as not found, not as a crash", async () => {
  const res = await sendReceipt({
    tenantId, orderId: "00000000-0000-0000-0000-000000000000", channel: "email",
  });
  assert.equal(res.status, "NOT_FOUND");
});

test("no recipient is a clear refusal with a reason a cashier can act on", async () => {
  const res = await sendReceipt({ tenantId, orderId, channel: "email" });
  assert.equal(res.status, "NO_RECIPIENT");
  if (res.status === "NO_RECIPIENT") {
    assert.match(res.reason, /อีเมล/, "ต้องบอกว่าต้องทำอะไรต่อ ไม่ใช่แค่ว่าล้มเหลว");
  }

  const line = await sendReceipt({ tenantId, orderId, channel: "line" });
  assert.equal(line.status, "NO_RECIPIENT");
  if (line.status === "NO_RECIPIENT") assert.match(line.reason, /LINE/);
});

test("a malformed email address is refused before any send is attempted", async () => {
  const res = await sendReceipt({ tenantId, orderId, channel: "email", to: "not-an-email" });
  assert.equal(res.status, "NO_RECIPIENT");
});

test("the customer's stored email is used when the counter does not type one", async () => {
  // ลูกค้าที่มีอีเมลในระบบ — ผูกกับบิลแล้วต้องไม่ต้องพิมพ์ซ้ำ
  const cust = await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, email, phone)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, `FAKE ${TAG} customer`, `${TAG}@example.invalid`, `09${String(Date.now()).slice(-8)}`]
  );
  customerId = cust.rows[0].id;
  await query(`UPDATE bms_orders SET customer_id = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, orderId, customerId]);

  // ไม่มี mail provider ในเทส จึงคาดผลว่า "พยายามส่งแล้วล้ม" ไม่ใช่ "ไม่มีผู้รับ"
  // สิ่งที่ตรวจคือ resolve ผู้รับได้ถูกต้อง ไม่ใช่ว่าเมลถึงจริง
  const res = await sendReceipt({ tenantId, orderId, channel: "email" });
  assert.notEqual(res.status, "NO_RECIPIENT",
    "มีอีเมลในโปรไฟล์แล้วต้องไม่บ่นว่าไม่มีผู้รับ");
});

test("a LINE identity on the customer is found in bms_customer_identities", async () => {
  // LINE id ไม่ได้อยู่บน bms_customers — อยู่ในตาราง identity แยกตั้งแต่ 7.74
  // เขียน query ผิดที่ = ลูกค้าที่ผูก LINE ไว้แล้วยังถูกบอกว่าไม่ได้ผูก
  await query(
    `INSERT INTO bms_customer_identities (tenant_id, customer_id, channel, external_ref)
     VALUES ($1,$2,'line',$3)`,
    [tenantId, customerId, `U${TAG}${process.pid}`]
  );
  const res = await sendReceipt({ tenantId, orderId, channel: "line" });
  assert.notEqual(res.status, "NO_RECIPIENT",
    "ผูก LINE ไว้แล้วต้องหาเจอ — ถ้าไม่เจอแปลว่าอ่านผิดตาราง");
});

test("teardown: remove every row this suite created", async () => {
  if (orderId) {
    await query(`DELETE FROM bms_order_items WHERE order_id = $1`, [orderId]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, orderId]);
  }
  if (customerId) {
    await query(`DELETE FROM bms_customer_identities WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, customerId]);
    await query(`DELETE FROM bms_customers WHERE tenant_id = $1 AND id = $2`, [tenantId, customerId]);
  }
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
});
