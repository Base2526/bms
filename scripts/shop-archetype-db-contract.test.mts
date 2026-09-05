/**
 * Do the three archetypes added in `9.40` work, and did they leave existing shops alone?
 *
 * An archetype is an onboarding preset, nothing more. It picks the initial `bms_store_capabilities`
 * defaults and it is read on the sale path by exactly one module (pharmacy). Everything else at the
 * register is decided by per-product data. That claim is easy to write in a document and easy to
 * break in code, because `9.40` put `resolveStockConsumptionInTx()` in front of *every* order line
 * of *every* tenant — so the shop that must keep working is the one that has no stock policy row,
 * no capability row, and an archetype chosen years ago (or none at all).
 *
 * These tests build exactly that shop and sell from it, then build the new ones and check the gates
 * they claim. Throwaway tenants are created and dropped; no existing shop is touched, because a
 * test that flips `business_archetype` on a real shop can strand it as a pharmacy (see the note in
 * CLAUDE.local.md — it happened, and it took ten POS tests down with it).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { getClient } from "../apps/web/lib/db.ts";
import { cancelOrder, createOrder } from "../apps/web/lib/bms/orders.ts";
import { enqueueKitchenTicketsInTx } from "../apps/web/lib/bms/kitchen.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import {
  getBusinessArchetypeLockState,
  upsertStoreProfile,
} from "../apps/web/lib/bms/storeProfile.ts";
import {
  GATING_CAPABILITIES,
  STORE_CAPABILITIES,
  isCapabilityEnabledInTx,
  listStoreCapabilities,
  presetCapabilitiesForArchetype,
} from "../apps/web/lib/bms/storeCapabilities.ts";
import { SHOP_ARCHETYPE_OPTIONS } from "../apps/web/lib/bms/shopArchetypes.ts";
import { DECLARE_FAKE_SALES_SURFACES_SQL } from "./testing/salesSurfaces.mts";

const TAG = "archetype-test";
const SIZE = "BASE";
const LEGACY_SKU = `FAKE-${TAG}-LEGACY`;
const PACK_SKU = `FAKE-${TAG}-PACK`;

/** ร้านยุคก่อน 9.40: archetype เก่า ไม่มีแถว policy/capability เลย */
let legacyTenant = "";
let legacyLocation = "";
/** ร้านที่ไม่เคยเลือกประเภทเลย — มีจริงเยอะในฐานเก่า */
let blankTenant = "";
let blankLocation = "";

async function makeShop(archetype: string | null, skus: string[]): Promise<[string, string]> {
  const tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${archetype ?? "none"}-${Date.now()}`]
  )).rows[0].id;
  const locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name) VALUES ($1,'MAIN',$2) RETURNING id`,
    [tenantId, `FAKE ${TAG} branch`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1,$2)`,
    [tenantId, archetype]
  );
  for (const sku of skus) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
       VALUES ($1,$2,$3,100,TRUE,'V')`,
      [tenantId, sku, sku]
    );
    // สินค้าที่ INSERT ตรง ๆ เป็นฉบับร่างตั้งแต่ 9.51 — ต้องประกาศช่องทางขายเอง
    await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,500,0)`,
      [tenantId, locationId, sku, SIZE]
    );
  }
  return [tenantId, locationId];
}

const reservedOf = async (tenantId: string, locationId: string, sku: string) =>
  Number((await query<{ qty: string }>(
    `SELECT reserved_stock::text AS qty FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, sku, SIZE]
  )).rows[0]?.qty ?? 0);

test("setup: one pre-9.40 shop and one that never chose a type", async () => {
  [legacyTenant, legacyLocation] = await makeShop("fashion", [LEGACY_SKU, PACK_SKU]);
  [blankTenant, blankLocation] = await makeShop(null, [LEGACY_SKU]);
  // A pack is per-product configuration, not a capability: `fashion`'s preset happens to include
  // PACK, but nothing reads that flag, so this must work the same in every shop.
  await query(
    `INSERT INTO bms_product_packs (tenant_id, product_sku, pack_code, unit_name, base_qty, is_base, active)
     VALUES ($1,$2,'BASE','ชิ้น',1,TRUE,TRUE), ($1,$2,'BOX','กล่อง',12,FALSE,TRUE)`,
    [legacyTenant, PACK_SKU]
  );
  for (const tenantId of [legacyTenant, blankTenant]) {
    assert.equal(
      Number((await query<{ n: string }>(
        `SELECT count(*)::text AS n FROM bms_product_stock_policies WHERE tenant_id = $1`, [tenantId]
      )).rows[0].n),
      0,
      "the shop under test must have no 9.40 rows — that is the whole point"
    );
    assert.equal(
      Number((await query<{ n: string }>(
        `SELECT count(*)::text AS n FROM bms_store_capabilities WHERE tenant_id = $1`, [tenantId]
      )).rows[0].n),
      0
    );
  }
});

test("every archetype, old and new, resolves a preset of known capabilities only", () => {
  const known = new Set<string>(STORE_CAPABILITIES);
  for (const option of SHOP_ARCHETYPE_OPTIONS) {
    for (const capability of presetCapabilitiesForArchetype(option.value)) {
      assert.ok(known.has(capability), `${option.value} presets unknown capability ${capability}`);
    }
  }
  // An unset archetype must resolve, not throw: most pre-existing shops are in this state.
  assert.deepEqual([...presetCapabilitiesForArchetype(null)], []);
  assert.deepEqual([...presetCapabilitiesForArchetype("not_a_real_type")], []);
});

test("the three new archetypes turn on exactly the gates they promise", async () => {
  const expected: Record<string, Partial<Record<string, boolean>>> = {
    restaurant: { RECIPE: true, MODIFIER: true, KITCHEN_WORKFLOW: true, WASTAGE: true, WEIGHTED_PRODUCT: false },
    pet_supply: { WEIGHTED_PRODUCT: true, RECIPE: false, MODIFIER: false, KITCHEN_WORKFLOW: false, WASTAGE: false },
    building_materials: { WEIGHTED_PRODUCT: true, RECIPE: false, MODIFIER: false, KITCHEN_WORKFLOW: false, WASTAGE: false },
  };
  for (const [archetype, gates] of Object.entries(expected)) {
    await query(`UPDATE bms_store_profile SET business_archetype = $2 WHERE tenant_id = $1`,
      [blankTenant, archetype]);
    for (const [capability, want] of Object.entries(gates)) {
      assert.equal(
        await isCapabilityEnabledInTx({ query }, blankTenant, capability as any),
        want,
        `${archetype} should have ${capability} ${want ? "on" : "off"}`
      );
    }
  }
  await query(`UPDATE bms_store_profile SET business_archetype = NULL WHERE tenant_id = $1`, [blankTenant]);
});

test("a shop with no archetype at all has every gate off and still sells", async () => {
  for (const capability of GATING_CAPABILITIES) {
    assert.equal(await isCapabilityEnabledInTx({ query }, blankTenant, capability), false);
  }
  const order = await createOrder({
    tenantId: blankTenant, channel: "web", locationId: blankLocation,
    items: [{ sku: LEGACY_SKU, size: SIZE, qty: 2 }],
  } as any);
  assert.equal(order.status, "CREATED", JSON.stringify(order));
  if (order.status !== "CREATED") return;
  assert.equal(await reservedOf(blankTenant, blankLocation, LEGACY_SKU), 2);
  assert.equal(await cancelOrder(blankTenant, order.orderId), true);
  assert.equal(await reservedOf(blankTenant, blankLocation, LEGACY_SKU), 0);
});

test("a pre-9.40 shop sells exactly as before, and the snapshot calls it DIRECT", async () => {
  const order = await createOrder({
    tenantId: legacyTenant, channel: "web", locationId: legacyLocation,
    items: [{ sku: LEGACY_SKU, size: SIZE, qty: 3 }],
  } as any);
  assert.equal(order.status, "CREATED", JSON.stringify(order));
  if (order.status !== "CREATED") return;
  assert.equal(await reservedOf(legacyTenant, legacyLocation, LEGACY_SKU), 3);

  const snapshot = await query<{ product_sku: string; qty: number; source: string }>(
    `SELECT c.product_sku, c.qty, c.source
       FROM bms_order_item_stock_consumption c
       JOIN bms_order_items oi ON oi.tenant_id = c.tenant_id AND oi.id = c.order_item_id
      WHERE c.tenant_id = $1 AND oi.order_id = $2`,
    [legacyTenant, order.orderId]
  );
  assert.equal(snapshot.rowCount, 1, "an ordinary line expands to itself, not to something else");
  assert.equal(snapshot.rows[0].product_sku, LEGACY_SKU);
  assert.equal(Number(snapshot.rows[0].qty), 3);
  assert.equal(snapshot.rows[0].source, "DIRECT");

  const view = await query<{ product_sku: string; qty: number }>(
    `SELECT product_sku, qty FROM bms_order_stock_lines WHERE tenant_id = $1 AND order_id = $2`,
    [legacyTenant, order.orderId]
  );
  assert.equal(view.rowCount, 1);
  assert.equal(Number(view.rows[0].qty), 3);

  // No stock policy, no kitchen queue: an ordinary shop must never accumulate kitchen tickets.
  const client = await getClient();
  try {
    assert.equal(await enqueueKitchenTicketsInTx(client, legacyTenant, order.orderId), 0);
  } finally {
    client.release();
  }
  assert.equal(await cancelOrder(legacyTenant, order.orderId), true);
  assert.equal(await reservedOf(legacyTenant, legacyLocation, LEGACY_SKU), 0);
});

test("pack conversion is per-product configuration, untouched by any capability", async () => {
  const order = await createOrder({
    tenantId: legacyTenant, channel: "web", locationId: legacyLocation,
    // one box of twelve, exactly as the register canonicalises it
    items: [{ sku: PACK_SKU, size: SIZE, qty: 12, packCode: "BOX", packQty: 1 }],
  } as any);
  assert.equal(order.status, "CREATED", JSON.stringify(order));
  if (order.status !== "CREATED") return;
  assert.equal(await reservedOf(legacyTenant, legacyLocation, PACK_SKU), 12,
    "a box reserves twelve base units whether or not PACK is 'enabled'");
  const source = await query<{ source: string }>(
    `SELECT c.source FROM bms_order_item_stock_consumption c
       JOIN bms_order_items oi ON oi.tenant_id = c.tenant_id AND oi.id = c.order_item_id
      WHERE c.tenant_id = $1 AND oi.order_id = $2`,
    [legacyTenant, order.orderId]
  );
  assert.equal(source.rows[0]?.source, "PACK");
  assert.equal(await cancelOrder(legacyTenant, order.orderId), true);
});

test("products and fake orders stay editable; the first real order locks the archetype", async () => {
  const sku = `FAKE-${TAG}-CHANGE`;
  const [tenantId, locationId] = await makeShop("fashion", [sku]);
  const before = await query<{ current_stock: number; reserved_stock: number }>(
    `SELECT current_stock, reserved_stock FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2 AND size = $3`,
    [tenantId, sku, SIZE]
  );

  await query(
    `INSERT INTO bms_orders (tenant_id, location_id, channel, customer_ref, status, total_amount)
     VALUES ($1, $2, 'test', $3, 'CANCELLED', 0)`,
    [tenantId, locationId, `FAKE-${TAG}-SEED`]
  );
  assert.equal((await getBusinessArchetypeLockState(tenantId)).locked, false);
  await upsertStoreProfile(tenantId, { businessArchetype: "restaurant" });

  // The archetype now says "restaurant", but the product never became a menu item, so it still
  // sells as an ordinary line. An archetype that silently reinterpreted existing stock would be a
  // dropdown that rewrites a shop's inventory meaning.
  assert.equal(
    Number((await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM bms_product_stock_policies WHERE tenant_id = $1`, [tenantId]
    )).rows[0].n),
    0
  );
  // ร้านนี้เพิ่งถูกสลับเป็น restaurant ด้านบน — ตั้งแต่ 9.56 ออร์เดอร์ออนไลน์ของร้านอาหาร
  // ต้องระบุประเภทรับของ ไม่งั้นได้ FULFILLMENT_REQUIRED (เทสนี้เขียนก่อน 9.56)
  const order = await createOrder({
    tenantId, channel: "web", locationId, fulfillmentType: "DELIVERY",
    items: [{ sku, size: SIZE, qty: 1 }],
  } as any);
  assert.equal(order.status, "CREATED", JSON.stringify(order));
  if (order.status !== "CREATED") return;
  assert.equal(await cancelOrder(tenantId, order.orderId), true);
  const after = await query<{ current_stock: number; reserved_stock: number }>(
    `SELECT current_stock, reserved_stock FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2 AND size = $3`,
    [tenantId, sku, SIZE]
  );
  assert.deepEqual(after.rows[0], before.rows[0]);

  // …and the capability list still resolves for a shop that has no override rows.
  const capabilities = await listStoreCapabilities(tenantId);
  assert.equal(capabilities.length, STORE_CAPABILITIES.length);
  assert.ok(capabilities.every((row) => row.source === "PRESET"));

  assert.equal((await getBusinessArchetypeLockState(tenantId)).locked, true);

  await assert.rejects(
    () => upsertStoreProfile(tenantId, { businessArchetype: "fashion" }),
    /มีออร์เดอร์จริงแล้ว|locked/i
  );
  await assert.rejects(
    () => query(`UPDATE bms_store_profile SET business_archetype = 'fashion' WHERE tenant_id = $1`, [tenantId]),
    /มีออร์เดอร์จริงแล้ว|locked/i
  );

  // Idempotent writes and unrelated profile edits remain valid after go-live.
  await query(`UPDATE bms_store_profile SET business_archetype = 'restaurant' WHERE tenant_id = $1`, [tenantId]);

  const updated = await upsertStoreProfile(tenantId, { businessType: "fashion" });
  assert.equal(updated.businessType, "fashion");
});

test("a concurrent first real order cannot race past the database lock", async () => {
  const sku = `FAKE-${TAG}-RACE`;
  const [tenantId, locationId] = await makeShop("fashion", [sku]);
  const orderClient = await getClient();
  const profileClient = await getClient();
  try {
    await beginTenantTx(orderClient, tenantId);
    await orderClient.query(
      `INSERT INTO bms_orders (tenant_id, location_id, channel, status, total_amount)
       VALUES ($1, $2, 'web', 'PENDING', 0)`,
      [tenantId, locationId]
    );

    await beginTenantTx(profileClient, tenantId);
    let changeSettled = false;
    const change = profileClient
      .query(`UPDATE bms_store_profile SET business_archetype = 'restaurant' WHERE tenant_id = $1`, [tenantId])
      .then(
        (result) => { changeSettled = true; return result; },
        (error) => { changeSettled = true; throw error; }
      );

    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(changeSettled, false, "the archetype write must wait for the in-flight order transaction");
    await orderClient.query("COMMIT");
    await assert.rejects(change, /มีออร์เดอร์จริงแล้ว|locked/i);
    await profileClient.query("ROLLBACK");

    const profile = await query<{ business_archetype: string }>(
      `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1`,
      [tenantId]
    );
    assert.equal(profile.rows[0].business_archetype, "fashion");
  } finally {
    try { await orderClient.query("ROLLBACK"); } catch {}
    try { await profileClient.query("ROLLBACK"); } catch {}
    orderClient.release();
    profileClient.release();
  }
});

test("a missing legacy profile cannot acquire an archetype after real orders exist", async () => {
  const tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1, $2) RETURNING id`,
    [`FAKE ${TAG} profileless`, `fake-${TAG}-profileless-${Date.now()}`]
  )).rows[0].id;
  const locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name) VALUES ($1, 'MAIN', $2) RETURNING id`,
    [tenantId, `FAKE ${TAG} profileless branch`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_orders (tenant_id, location_id, channel, status, total_amount)
     VALUES ($1, $2, 'web', 'PENDING', 0)`,
    [tenantId, locationId]
  );

  await assert.rejects(
    () => query(
      `INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1, 'fashion')`,
      [tenantId]
    ),
    /มีออร์เดอร์จริงแล้ว|locked/i
  );
  assert.equal(
    Number((await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM bms_store_profile WHERE tenant_id = $1`,
      [tenantId]
    )).rows[0].n),
    0,
    "the rejected AFTER INSERT trigger must roll the profile row back"
  );

  // Keeping the legacy profile unset is safe; only assigning a new meaning is blocked.
  await query(`INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1, NULL)`, [tenantId]);
});

test("teardown: drop every throwaway shop", async () => {
  const stale = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]
  );
  const ids = [...new Set([legacyTenant, blankTenant, ...stale.rows.map((row) => row.id)].filter(Boolean))];
  if (!ids.length) return;
  for (const table of [
    "bms_kitchen_tickets", "bms_order_item_stock_consumption", "bms_order_items",
    "bms_order_discounts", "bms_orders", "bms_stock_movements", "bms_product_packs",
    "bms_product_stock_policies", "bms_inventory", "bms_products",
    "bms_store_capabilities", "bms_store_profile", "bms_locations", "bms_customers",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  assert.equal(Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]
  )).rows[0].n), 0);
});
