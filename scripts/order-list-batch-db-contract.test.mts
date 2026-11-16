import assert from "node:assert/strict";
import test from "node:test";
import { query } from "../apps/web/lib/db.ts";
import { loadOrderListItems, loadOrderListShippingAddresses } from "../apps/web/lib/bms/orderListRead.ts";
import { listOrderDiscounts, listOrderDiscountsBatch } from "../apps/web/lib/bms/membership.ts";
import { assertCostingTestDatabase } from "./testing/restaurantCostingFixture.mts";

test("order list batches preserve per-order reads and exclude cross-tenant rows", async () => {
  await assertCostingTestDatabase();
  const tenants = (await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM bms_orders GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 2`
  )).rows;
  assert.equal(tenants.length, 2, "restored test database needs at least two order tenants");
  const tenantId = String(tenants[0].tenant_id);
  const orders = (await query<{ id: string; customer_id: string | null }>(
    `SELECT id, customer_id FROM bms_orders WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tenantId]
  )).rows;
  assert.ok(orders.length > 1);
  const other = (await query<{ id: string; customer_id: string | null }>(
    `SELECT id, customer_id FROM bms_orders WHERE tenant_id=$1 LIMIT 1`, [String(tenants[1].tenant_id)]
  )).rows[0];
  const requested = [...orders, other];

  const [items, shipping, discounts] = await Promise.all([
    loadOrderListItems(tenantId, requested),
    loadOrderListShippingAddresses(tenantId, requested),
    listOrderDiscountsBatch(tenantId, requested.map(row => row.id)),
  ]);
  for (const order of orders) {
    const singleItems = (await query(
      `SELECT product_sku, product_name, size, qty, unit_price, line_amount
         FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2 ORDER BY id`, [tenantId, order.id]
    )).rows;
    assert.deepEqual((items.get(String(order.id)) ?? []).map(({ order_id: _id, ...row }) => row), singleItems);
    const singleAddress = order.customer_id ? (await query(
      `SELECT 1 FROM bms_customer_addresses
        WHERE tenant_id=$1 AND customer_id=$2 AND address_type='shipping' LIMIT 1`, [tenantId, order.customer_id]
    )).rowCount! > 0 : false;
    assert.equal(order.customer_id ? shipping.has(String(order.customer_id)) : false, singleAddress);
    assert.deepEqual(discounts.get(String(order.id)) ?? [], await listOrderDiscounts(tenantId, String(order.id)));
  }
  assert.deepEqual(items.get(String(other.id)), []);
  assert.deepEqual(discounts.get(String(other.id)), []);
});
