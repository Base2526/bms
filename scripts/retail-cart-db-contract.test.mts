import assert from "node:assert/strict";
import test from "node:test";
import { query } from "../apps/web/lib/db.ts";
import { previewRetailCart, confirmRetailCart } from "../apps/web/lib/bms/retailCart.ts";
import { verifyCheckoutToken } from "../apps/web/lib/bms/checkoutToken.ts";
import { withCostingFixture } from "./testing/restaurantCostingFixture.mts";

test("retail cart review rolls back, stale quotes fail, and repeated confirmation reuses one order", async () =>
  withCostingFixture(async (f) => {
    await f.product("FAKE-CART", 40, 107);
    await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface,enabled)
      VALUES ($1,'FAKE-CART','PUBLIC_STOREFRONT',TRUE),($1,'FAKE-CART','ONLINE_ORDER',TRUE)`, [f.tenant]);
    await query(`INSERT INTO bms_product_packs(tenant_id,product_sku,pack_code,unit_name,base_qty,price,active)
      VALUES($1,'FAKE-CART','BOX','box',2,190,TRUE)`, [f.tenant]);
    const slug = `fake-costing-${f.tenant}`;
    const lines = [{ sku: "FAKE-CART", size: "BASE", qty: 2 }];
    const first = await previewRetailCart(slug, lines);
    assert.equal(first.status, "READY", JSON.stringify(first));
    if (first.status !== "READY") return;
    assert.equal(first.review.lines[0].qty, 2);
    assert.equal((await query("SELECT count(*)::int AS n FROM bms_orders WHERE tenant_id=$1", [f.tenant])).rows[0].n, 0);
    assert.equal((await query("SELECT count(*)::int AS n FROM bms_customers WHERE tenant_id=$1", [f.tenant])).rows[0].n, 0);
    assert.equal(Number((await query("SELECT reserved_stock FROM bms_inventory WHERE tenant_id=$1 AND product_sku='FAKE-CART' AND location_id=$2", [f.tenant, f.location])).rows[0].reserved_stock), 0);

    await query("UPDATE bms_products SET price=150 WHERE tenant_id=$1 AND sku='FAKE-CART'", [f.tenant]);
    assert.equal((await confirmRetailCart(first.quoteToken)).status, "REVIEW_REQUIRED");
    assert.equal((await query("SELECT count(*)::int AS n FROM bms_orders WHERE tenant_id=$1", [f.tenant])).rows[0].n, 0);

    const fresh = await previewRetailCart(slug, lines);
    assert.equal(fresh.status, "READY", JSON.stringify(fresh));
    if (fresh.status !== "READY") return;
    const created = await confirmRetailCart(fresh.quoteToken);
    assert.equal(created.status, "CREATED", JSON.stringify(created));
    if (created.status !== "CREATED") return;
    assert.equal(created.replayed, false);
    const payload = verifyCheckoutToken(new URL(created.checkoutUrl).searchParams.get("t") || "");
    assert.equal(payload?.tenantId, f.tenant);
    const replay = await confirmRetailCart(fresh.quoteToken);
    assert.equal(replay.status, "CREATED");
    if (replay.status === "CREATED") {
      assert.equal(replay.replayed, true);
      assert.equal(verifyCheckoutToken(new URL(replay.checkoutUrl).searchParams.get("t") || "")?.orderId, payload?.orderId);
    }
    assert.equal((await query("SELECT count(*)::int AS n FROM bms_orders WHERE tenant_id=$1", [f.tenant])).rows[0].n, 1);
    assert.equal(Number((await query("SELECT reserved_stock FROM bms_inventory WHERE tenant_id=$1 AND product_sku='FAKE-CART' AND location_id=$2", [f.tenant, f.location])).rows[0].reserved_stock), 2);

    assert.equal((await previewRetailCart(slug, [{ ...lines[0], qty: 1, packCode: "FORGED" }])).status, "ORDER_REJECTED");
    const pack = await previewRetailCart(slug, [{ ...lines[0], qty: 1, packCode: "BOX" }]);
    assert.equal(pack.status, "READY", JSON.stringify(pack));
    if (pack.status === "READY") {
      assert.equal(pack.review.lines[0].packQty, 1);
      assert.equal(pack.review.lines[0].qty, 2);
      assert.equal(pack.review.lines[0].lineAmount, 190);
    }

    await query(`UPDATE bms_product_sales_surfaces SET enabled=FALSE
      WHERE tenant_id=$1 AND product_sku='FAKE-CART' AND surface='PUBLIC_STOREFRONT'`, [f.tenant]);
    assert.equal((await previewRetailCart(slug, lines)).status, "ORDER_REJECTED");
  }));
