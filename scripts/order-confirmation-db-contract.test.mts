// =============================================================
// create_order บน customer surface ต้องไม่เขียนก่อนลูกค้ายืนยัน — กับ Postgres จริง
// -------------------------------------------------------------
// **เขียนจริงลงฐาน ห้ามรันกับ production** (สร้าง/ลบข้อมูลของตัวเองครบ รันซ้ำได้)
//
// รันจาก apps/web (ดูคำสั่งเต็มใน CLAUDE.local.md § เทส):
//   cd apps/web && POSTGRES_HOST=localhost ... npx tsx \
//     --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/order-confirmation-db-contract.test.mts
// =============================================================
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { ALL_TOOLS } from "../apps/web/lib/bms/tools/catalog.ts";
import { orderQuoteFingerprint } from "../apps/web/lib/bms/orderQuote.ts";
import type { ExecCtx } from "../apps/web/lib/bms/tools/types.ts";

const SKU = "TEST-CONFIRM-SKU";
const SIZE = "M";
const CUSTOMER_REF = "TEST-CONFIRM-CUSTOMER";

let tenantId = "";
const createOrderTool = ALL_TOOLS.find((tool) => tool.name === "create_order")!;

function ctx(overrides: Partial<ExecCtx> = {}): ExecCtx {
  return {
    tenantId,
    surface: "customer",
    actor: "ai:customer",
    channel: "web",
    customerRef: CUSTOMER_REF,
    ...overrides,
  } as ExecCtx;
}

async function cleanup() {
  if (!tenantId) return;
  await query(
    `DELETE FROM bms_order_items WHERE order_id IN (
       SELECT id FROM bms_orders WHERE tenant_id = $1 AND customer_ref = $2)`,
    [tenantId, CUSTOMER_REF]
  );
  await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND customer_ref = $2`, [
    tenantId,
    CUSTOMER_REF,
  ]);
  // ต้องลบก่อน bms_products: FK bms_stock_movements_product_fk เป็น composite (tenant_id, sku)
  // การจอง/ตัดสต็อกของบิลที่สร้างสำเร็จในเทสนี้ทิ้งแถวไว้ที่นี่
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [
    tenantId,
    SKU,
  ]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [
    tenantId,
    SKU,
  ]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
}

before(async () => {
  const tenant = await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`);
  tenantId = tenant.rows[0]!.id;
  await cleanup();
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active)
     VALUES ($1, $2, 'สินค้าทดสอบยืนยันออร์เดอร์', 100, TRUE)`,
    [tenantId, SKU]
  );
  // bms_inventory.location_id เป็น NOT NULL ตั้งแต่ 7.84 (multi-location) — ต้องผูกสาขา
  // ใช้สำนักงานใหญ่ของร้าน ไม่สร้างสาขาใหม่ (branch_code '00000' สงวนไว้ให้สำนักงานใหญ่)
  const location = await query<{ id: string }>(
    `SELECT id FROM bms_locations
      WHERE tenant_id = $1
      ORDER BY is_head_office DESC, created_at
      LIMIT 1`,
    [tenantId]
  );
  const locationId = location.rows[0]?.id;
  assert.ok(locationId, "ร้านแรกไม่มีสาขาเลย — ต้อง apply 7.84 ก่อนรันเทสนี้");
  await query(
    `INSERT INTO bms_inventory (tenant_id, product_sku, size, current_stock, reserved_stock, location_id)
     VALUES ($1, $2, $3, 50, 0, $4)`,
    [tenantId, SKU, SIZE, locationId]
  );
});

after(cleanup);

async function orderCount(): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT count(*) AS n FROM bms_orders WHERE tenant_id = $1 AND customer_ref = $2`,
    [tenantId, CUSTOMER_REF]
  );
  return Number(res.rows[0]!.n);
}

async function reservedStock(): Promise<number> {
  const res = await query<{ reserved_stock: number }>(
    `SELECT reserved_stock FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2 AND size = $3`,
    [tenantId, SKU, SIZE]
  );
  return Number(res.rows[0]!.reserved_stock);
}

const LINES = [{ sku: SKU, size: SIZE, qty: 2 }];

test("ครั้งแรกที่ยังไม่มีคำยืนยัน: ไม่สร้างบิล ไม่จองสต็อก และคืนรายการมาให้ยืนยัน", async () => {
  const before = await orderCount();
  const execCtx = ctx();
  const result = await createOrderTool.execute({ items: LINES }, execCtx);

  assert.equal(result.ok, true);
  assert.equal((result.data as any).status, "CONFIRMATION_REQUIRED");
  // ต้องคืนรายการครบ พร้อมชื่อสินค้าจริงจาก catalog (ไม่ใช่ SKU เปล่า)
  assert.equal((result.data as any).items.length, 1);
  assert.equal((result.data as any).items[0].name, "สินค้าทดสอบยืนยันออร์เดอร์");
  assert.equal((result.data as any).items[0].displayQty, 2);

  // สิ่งสำคัญที่สุดของเทสนี้: ฐานต้องไม่ขยับเลย
  assert.equal(await orderCount(), before, "ยังไม่ยืนยันแต่มีบิลเกิดขึ้น");
  assert.equal(await reservedStock(), 0, "ยังไม่ยืนยันแต่สต็อกถูกจองไปแล้ว");
  // และต้องติดธงให้ pipeline เอาไปถามยืนยัน
  assert.equal(execCtx.pendingOrderQuote?.fingerprint, orderQuoteFingerprint(LINES));
  assert.equal(execCtx.createdOrderId, undefined);
});

test("เรียกซ้ำโดยยังไม่ยืนยัน ก็ยังไม่เขียน (ไม่มีทางหลุดด้วยการยิงซ้ำ)", async () => {
  const before = await orderCount();
  await createOrderTool.execute({ items: LINES }, ctx());
  await createOrderTool.execute({ items: LINES }, ctx());
  assert.equal(await orderCount(), before);
  assert.equal(await reservedStock(), 0);
});

test("ยืนยันแล้วด้วยรายการชุดเดิม: สร้างบิลจริงและจองสต็อกจริง", async () => {
  const before = await orderCount();
  const execCtx = ctx({
    customerConfirmedQuote: { fingerprint: orderQuoteFingerprint(LINES) },
  });
  const result = await createOrderTool.execute({ items: LINES }, execCtx);

  assert.equal(result.ok, true);
  assert.equal((result.data as any).status, "CREATED");
  assert.equal(await orderCount(), before + 1);
  assert.equal(await reservedStock(), 2);
  assert.ok(execCtx.createdOrderId, "บิลถูกสร้างแล้วแต่ไม่ได้ตั้ง createdOrderId");
  assert.equal(execCtx.pendingOrderQuote, undefined);
});

test("คำยืนยันของตะกร้าอื่นใช้ข้ามตะกร้าไม่ได้", async () => {
  const before = await orderCount();
  const reservedBefore = await reservedStock();
  // ลูกค้ายืนยัน 2 ชิ้น แต่โมเดลส่ง 9 ชิ้นมา — ต้องไม่ผ่าน
  const execCtx = ctx({
    customerConfirmedQuote: { fingerprint: orderQuoteFingerprint([{ sku: SKU, size: SIZE, qty: 2 }]) },
  });
  const result = await createOrderTool.execute(
    { items: [{ sku: SKU, size: SIZE, qty: 9 }] },
    execCtx
  );
  assert.equal((result.data as any).status, "CONFIRMATION_REQUIRED");
  assert.equal(await orderCount(), before, "จำนวนถูกเปลี่ยนหลังลูกค้ายืนยันแล้วยังสร้างบิลได้");
  assert.equal(await reservedStock(), reservedBefore);
});

test("staff surface ไม่ถูกกระทบ — แอดมินสร้างบิลได้ในครั้งเดียวเหมือนเดิม", async () => {
  const before = await orderCount();
  const execCtx = ctx({
    surface: "staff",
    actor: "staff@example.com",
    customerRef: null,
    ctx: { admin: { id: null } },
  });
  const result = await createOrderTool.execute(
    { items: LINES, customerRef: CUSTOMER_REF, channel: "web" },
    execCtx
  );
  assert.equal(result.ok, true);
  assert.equal((result.data as any).status, "CREATED");
  assert.equal(await orderCount(), before + 1);
  assert.equal(execCtx.pendingOrderQuote, undefined);
});
