import assert from "node:assert/strict";
import test from "node:test";
import { query } from "../apps/web/lib/db.ts";
import { createOrder } from "../apps/web/lib/bms/orders.ts";
import { createShipment } from "../apps/web/lib/bms/shipping.ts";
import { withCostingFixture } from "./testing/restaurantCostingFixture.mts";

test("shipment consumes the reserved lot once and leaves movement evidence", async () =>
  withCostingFixture(async (f) => {
    await f.product("FAKE-LOT-SHIP", 40, 107);
    await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface,enabled)
      VALUES($1,'FAKE-LOT-SHIP','ONLINE_ORDER',TRUE)`, [f.tenant]);
    const lot = (await query<{ id: string }>(`INSERT INTO bms_inventory_lots
      (tenant_id,location_id,product_sku,size,lot_no,qty)
      VALUES($1,$2,'FAKE-LOT-SHIP','BASE','FAKE-SHIP-LOT',1000) RETURNING id`,
      [f.tenant, f.location])).rows[0].id;
    const customer = (await query<{ id: string }>(`INSERT INTO bms_customers(tenant_id,name,phone)
      VALUES($1,'FAKE shipping customer','FAKE-LOT-SHIP') RETURNING id`, [f.tenant])).rows[0].id;
    await query(`INSERT INTO bms_customer_addresses(tenant_id,customer_id,label,address,address_type)
      VALUES($1,$2,'FAKE address','FAKE address line','shipping')`, [f.tenant, customer]);
    const order = await createOrder({ tenantId: f.tenant, channel: "web", customerId: customer,
      locationId: f.location, items: [{ sku: "FAKE-LOT-SHIP", size: "BASE", qty: 1 }] });
    assert.equal(order.status, "CREATED", JSON.stringify(order));
    if (order.status !== "CREATED") return;
    await query(`UPDATE bms_orders SET status='PACKING' WHERE tenant_id=$1 AND id=$2`, [f.tenant, order.orderId]);
    const first = await createShipment({ tenantId: f.tenant, orderId: order.orderId,
      carrier: "OTHER", trackingNo: "FAKE-LOT-SHIP-TRACK" });
    assert.equal(first.status, "CREATED", JSON.stringify(first));
    if (first.status !== "CREATED") return;
    assert.equal(first.replayed, false);
    const replay = await createShipment({ tenantId: f.tenant, orderId: order.orderId,
      carrier: "OTHER", trackingNo: "FAKE-LOT-SHIP-TRACK" });
    assert.equal(replay.status, "CREATED");
    if (replay.status === "CREATED") assert.equal(replay.replayed, true);
    const stock = (await query<{ current_stock: number; reserved_stock: number }>(`SELECT current_stock,reserved_stock
      FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku='FAKE-LOT-SHIP' AND size='BASE'`,
      [f.tenant, f.location])).rows[0];
    assert.equal(Number(stock.current_stock), 999);
    assert.equal(Number(stock.reserved_stock), 0);
    assert.equal(Number((await query<{ qty: number }>(`SELECT qty FROM bms_inventory_lots WHERE tenant_id=$1 AND id=$2`,
      [f.tenant, lot])).rows[0].qty), 999);
    assert.equal(Number((await query<{ qty: string }>(`SELECT COALESCE(SUM(qty),0)::text AS qty FROM bms_order_item_lots
      WHERE tenant_id=$1 AND lot_id=$2`, [f.tenant, lot])).rows[0].qty), 1);
    assert.equal(Number((await query<{ count: string }>(`SELECT count(*)::text AS count FROM bms_stock_movements
      WHERE tenant_id=$1 AND ref_order_id=$2 AND type='SHIP'`, [f.tenant, order.orderId])).rows[0].count), 1);
  }));
