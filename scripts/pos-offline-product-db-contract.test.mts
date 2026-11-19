/** Offline cash may sync only ordinary DIRECT/PACK stock. Run on disposable localhost:5433. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { query } from "../apps/web/lib/db.ts";
import { assertCostingTestDatabase } from "./testing/restaurantCostingFixture.mts";
import {
  openPosShift, recordPosSale, resolvePosScan, upsertPosDevice,
} from "../apps/web/lib/bms/pos.ts";

const skus = ["DIRECT", "PACK", "WEIGHTED", "RECIPE", "BUNDLE", "SERIALIZED", "NON_STOCK"] as const;
let tenantId = "", otherTenantId = "", locationId = "", deviceId = "", cashierId = "", shiftId = "";
const sku = (policy: string) => `FAKE-OFFLINE-${policy}`;

test.before(async () => {
  await assertCostingTestDatabase();
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  for (const id of [tenantId, otherTenantId]) {
    await query(`INSERT INTO bms_tenants(id,name,slug) VALUES($1,'FAKE offline policy',$2)`, [id, `fake-offline-${id}`]);
    await query(`INSERT INTO bms_store_profile(tenant_id,business_archetype,currency,cash_rounding)
      VALUES($1,'mini_mart','THB','NONE')`, [id]);
  }
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations(tenant_id,code,name,branch_code,is_head_office)
      VALUES($1,'MAIN','FAKE offline branch','00000',true) RETURNING id`, [tenantId],
  )).rows[0].id;
  cashierId = (await query<{ id: string }>(
    `INSERT INTO users(name,username,email,role,role_id,tenant_id,password_hash,fake_test)
      SELECT 'FAKE offline cashier',$2,$2,'Administrator',id,$1,'x',true
        FROM roles WHERE name='Administrator' ORDER BY id LIMIT 1 RETURNING id`,
    [tenantId, `fake-offline-${tenantId}@example.invalid`],
  )).rows[0].id;
  for (const policy of skus) {
    await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category,is_bundle,serial_tracked)
      VALUES($1,$2,$2,100,true,'V',$3,$4)`, [tenantId, sku(policy), policy === "BUNDLE", policy === "SERIALIZED"]);
    await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface)
      VALUES($1,$2,'RETAIL_POS')`, [tenantId, sku(policy)]);
    await query(`INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
      VALUES($1,$2,$3,'STD',10,0)`, [tenantId, locationId, sku(policy)]);
    if (policy !== "DIRECT") {
      await query(`INSERT INTO bms_product_stock_policies(tenant_id,product_sku,stock_policy,base_unit)
        VALUES($1,$2,$3,$4)`, [tenantId, sku(policy), policy, policy === "WEIGHTED" ? "GRAM" : "PIECE"]);
    }
  }
  deviceId = (await upsertPosDevice(tenantId, {
    locationId, code: "FAKE-OFFLINE-REG", name: "FAKE offline register", active: true,
  })).id;
  const opened = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 0 });
  assert.ok(opened.status === "OPENED" || opened.status === "ALREADY_OPEN");
  shiftId = opened.shift.id;
});

test.after(async () => {
  if (!tenantId) return;
  await query(`DELETE FROM bms_orders WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_product_stock_policies WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_product_sales_surfaces WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_products WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM users WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_locations WHERE tenant_id=$1`, [tenantId]);
  await query(`DELETE FROM bms_store_profile WHERE tenant_id IN ($1,$2)`, [tenantId, otherTenantId]);
  await query(`DELETE FROM bms_tenants WHERE id IN ($1,$2)`, [tenantId, otherTenantId]);
});

test("scan publishes server-derived offline eligibility without crossing tenants", async () => {
  for (const policy of skus) {
    const hit = await resolvePosScan(tenantId, sku(policy), { size: "STD", locationId });
    assert.equal(hit?.offlineRetailEligible, policy === "DIRECT" || policy === "PACK", policy);
    assert.equal(await resolvePosScan(otherTenantId, sku(policy), { size: "STD", locationId }), null);
  }
});

test("offline sync rejects special products entered by SKU before any order or stock change", async () => {
  for (const policy of skus.filter(value => value !== "DIRECT" && value !== "PACK")) {
    const before = Number((await query<{ current_stock: string }>(
      `SELECT current_stock FROM bms_inventory
        WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='STD'`,
      [tenantId, locationId, sku(policy)],
    )).rows[0].current_stock);
    const result = await recordPosSale({
      tenantId, deviceId, shiftId, cashierUserId: cashierId,
      idempotencyKey: randomUUID(), offlineTenderedAt: new Date().toISOString(),
      mode: "SALE", salesSurface: "RETAIL_POS",
      lines: [{ sku: sku(policy), size: "STD", packQty: 1 }],
      payments: [{ method: "CASH", amount: 100, cashTendered: 100 }],
    });
    assert.equal(result.status, "OFFLINE_NOT_ALLOWED", policy);
    assert.equal(Number((await query<{ current_stock: string }>(
      `SELECT current_stock FROM bms_inventory
        WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='STD'`,
      [tenantId, locationId, sku(policy)],
    )).rows[0].current_stock), before);
  }
  const orders = await query<{ n: number }>(`SELECT count(*)::int n FROM bms_orders WHERE tenant_id=$1`, [tenantId]);
  assert.equal(orders.rows[0].n, 0);
});

test("ordinary direct and pack cash sales commit once and duplicate keys replay", async () => {
  for (const policy of ["DIRECT", "PACK"]) {
    const input = {
      tenantId, deviceId, shiftId, cashierUserId: cashierId,
      idempotencyKey: randomUUID(), offlineTenderedAt: new Date().toISOString(),
      mode: "SALE" as const, salesSurface: "RETAIL_POS" as const,
      lines: [{ sku: sku(policy), size: "STD", packQty: 1 }],
      payments: [{ method: "CASH" as const, amount: 100, cashTendered: 100 }],
    };
    const first = await recordPosSale(input);
    assert.equal(first.status, "SOLD", JSON.stringify(first));
    const second = await recordPosSale(input);
    assert.equal(second.status, "SOLD", JSON.stringify(second));
    if (first.status === "SOLD" && second.status === "SOLD") {
      assert.equal(second.orderId, first.orderId);
      assert.equal(second.replayed, true);
    }
    const stock = await query<{ current_stock: string }>(
      `SELECT current_stock FROM bms_inventory
        WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='STD'`,
      [tenantId, locationId, sku(policy)],
    );
    assert.equal(Number(stock.rows[0].current_stock), 9, policy);
  }
  const orders = await query<{ n: number }>(`SELECT count(*)::int n FROM bms_orders WHERE tenant_id=$1`, [tenantId]);
  assert.equal(orders.rows[0].n, 2);
});
