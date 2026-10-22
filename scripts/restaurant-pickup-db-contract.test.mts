import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import { loadService } from "./testing/restaurantCheckoutHarness.mts";

// Synthetic SQL contract only: not a restored BMS schema or a valuation/realtime certification.
assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
assert.equal(process.env.POSTGRES_PORT, "5547");
assert.equal(process.env.POSTGRES_DB, "bms_restaurant_readiness_test");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = require("pg");
const schema = "pickup_" + randomUUID().replaceAll("-", "");
const pool = new Pool({
  host: process.env.POSTGRES_HOST, port: 5547, database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  options: `-c search_path=${schema},public`,
});
const { beginTenantTx } = loadService("tenant", { crypto });
const q = (sql: string, values?: unknown[]) => pool.query(sql, values);
let quoteHook: null | (() => Promise<void>) = null;
let quotes = 0;
const service = loadService("orders", {
  "@/lib/db": { query: q, getClient: () => pool.connect() },
  "./tenant": { beginTenantTx },
  "./shipping": { MARKETPLACE_CHANNELS: new Set(["shopee", "lazada"]) },
  "./shippingRates": { quoteShipping: async () => {
    quotes++;
    if (quoteHook) await quoteHook();
    return { fee: 40, source: "flat" };
  } },
  "./movements": { recordOrderMovements: async (client: any, ids: string[], type: string, actor: string) => {
    await client.query(`INSERT INTO test_movements(tenant_id,order_id,type,actor)
      SELECT tenant_id,id,$2,$3 FROM bms_orders WHERE id=ANY($1::uuid[])`, [ids, type, actor]);
  } },
  "./orderNotify": { notifyOrderStatusEmail: async () => {} },
}, true);

before(async () => {
  assert.equal((await q("SELECT current_database() AS name")).rows[0].name, "bms_restaurant_readiness_test");
  await q(`CREATE SCHEMA ${schema};
    DO $$ BEGIN CREATE ROLE bms_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    GRANT USAGE ON SCHEMA ${schema} TO bms_app;
    CREATE TABLE bms_orders(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,customer_id uuid,location_id uuid,
      status text,channel text,fulfillment_type text,total_amount numeric,preferred_carrier text,
      shipping_fee numeric DEFAULT 0,shipping_fee_source text DEFAULT 'none',updated_at timestamptz DEFAULT now());
    CREATE TABLE bms_order_items(id bigserial PRIMARY KEY,tenant_id uuid,order_id uuid,location_id uuid,
      product_sku text,size text,qty integer);
    CREATE TABLE bms_payments(id bigserial PRIMARY KEY,tenant_id uuid,order_id uuid,status text);
    CREATE TABLE bms_customer_addresses(id bigserial PRIMARY KEY,tenant_id uuid,customer_id uuid,
      address_type text,is_default boolean,province text,province_code text,address text);
    CREATE TABLE bms_inventory(tenant_id uuid,location_id uuid,product_sku text,size text,
      current_stock integer CHECK(current_stock>=0),reserved_stock integer CHECK(reserved_stock>=0),updated_at timestamptz);
    CREATE TABLE bms_audit_log(tenant_id uuid,actor text,action text,target text,meta jsonb);
    CREATE TABLE test_movements(tenant_id uuid,order_id uuid,type text,actor text);
    CREATE VIEW bms_order_stock_lines AS SELECT tenant_id,order_id,location_id,product_sku,size,qty FROM bms_order_items;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO bms_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO bms_app;`);
  for (const table of ["bms_orders", "bms_order_items", "bms_payments", "bms_customer_addresses", "bms_inventory", "bms_audit_log", "test_movements"]) {
    await q(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_scope ON ${table} USING(tenant_id=current_setting('bms.tenant_id',true)::uuid)
      WITH CHECK(tenant_id=current_setting('bms.tenant_id',true)::uuid)`);
  }
});
after(async () => {
  await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});

async function fixture(type: string | null = "DELIVERY", status = "PENDING", channel = "line") {
  const f = { tenant: randomUUID(), customer: randomUUID(), order: randomUUID(), location: randomUUID() };
  await q(`INSERT INTO bms_orders(id,tenant_id,customer_id,location_id,status,channel,fulfillment_type,total_amount)
    VALUES($1,$2,$3,$4,$5,$6,$7,100)`, [f.order, f.tenant, f.customer, f.location, status, channel, type]);
  await q(`INSERT INTO bms_order_items(tenant_id,order_id,location_id,product_sku,size,qty) VALUES($1,$2,$3,'FAKE','M',2)`, [f.tenant, f.order, f.location]);
  await q(`INSERT INTO bms_inventory VALUES($1,$2,'FAKE','M',5,2,now())`, [f.tenant, f.location]);
  return f;
}
async function fee(f: any) {
  return Number((await q("SELECT shipping_fee FROM bms_orders WHERE id=$1", [f.order])).rows[0].shipping_fee);
}

test("pickup and POS orders are never requoted when customer contact/address is saved", async () => {
  for (const [type, channel] of [["PICKUP", "line"], [null, "pos"]]) {
    const f = await fixture(type, "PENDING", channel!);
    quotes = 0;
    assert.deepEqual(await service.recalculateOrderShipping(f.tenant, f.customer), { updated: 0 });
    assert.equal(quotes, 0);
    assert.equal(await fee(f), 0);
  }
});

test("delivery fee and audit commit under tenant RLS; an exact rerun creates no extra audit", async () => {
  const f = await fixture();
  assert.deepEqual(await service.recalculateOrderShipping(f.tenant, f.customer), { updated: 1 });
  assert.equal(await fee(f), 40);
  assert.deepEqual(await service.recalculateOrderShipping(f.tenant, f.customer), { updated: 0 });
  assert.equal((await q("SELECT * FROM bms_audit_log WHERE tenant_id=$1", [f.tenant])).rowCount, 1);
  assert.deepEqual(await service.recalculateOrderShipping(randomUUID(), f.customer), { updated: 0 });
});

test("payment submitted while a carrier quote is in flight prevents changing the amount", async () => {
  const f = await fixture();
  quoteHook = async () => {
    const payer = await pool.connect();
    try {
      await beginTenantTx(payer, f.tenant);
      // A real separate connection can take this lock: quote I/O holds no order lock.
      await payer.query("SET LOCAL lock_timeout='1s'");
      await payer.query("SELECT id FROM bms_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [f.tenant, f.order]);
      await payer.query("INSERT INTO bms_payments(tenant_id,order_id,status) VALUES($1,$2,'PENDING')", [f.tenant, f.order]);
      await payer.query("COMMIT");
    } finally { payer.release(); }
  };
  try {
    assert.deepEqual(await service.recalculateOrderShipping(f.tenant, f.customer), { updated: 0 });
    assert.equal(await fee(f), 0);
  } finally { quoteHook = null; }
});

test("cancellation or changed quote inputs discard an in-flight shipping quote", async () => {
  for (const change of ["cancel", "total", "address", "items"]) {
    const f = await fixture();
    quoteHook = async () => {
      if (change === "cancel") await q("UPDATE bms_orders SET status='CANCELLED' WHERE id=$1", [f.order]);
      if (change === "total") await q("UPDATE bms_orders SET total_amount=200 WHERE id=$1", [f.order]);
      if (change === "items") await q("UPDATE bms_order_items SET qty=3 WHERE order_id=$1", [f.order]);
      if (change === "address") await q(`INSERT INTO bms_customer_addresses(tenant_id,customer_id,address_type,is_default,address)
        VALUES($1,$2,'shipping',true,'FAKE changed address')`, [f.tenant, f.customer]);
    };
    try {
      assert.deepEqual(await service.recalculateOrderShipping(f.tenant, f.customer), { updated: 0 }, change);
      assert.equal(await fee(f), 0);
    } finally { quoteHook = null; }
  }
});

test("audit failure rolls the shipping fee back", async () => {
  const f = await fixture();
  await q(`CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'FAKE audit failure'; END $$;
    CREATE TRIGGER reject_audit BEFORE INSERT ON bms_audit_log FOR EACH ROW EXECUTE FUNCTION reject_audit()`);
  try {
    await assert.rejects(service.recalculateOrderShipping(f.tenant, f.customer), /FAKE audit failure/);
    assert.equal(await fee(f), 0);
  } finally { await q("DROP TRIGGER reject_audit ON bms_audit_log; DROP FUNCTION reject_audit()"); }
});

test("pickup handover without address deducts stock only once under concurrent requests", async () => {
  const f = await fixture("PICKUP", "PACKING");
  const results = await Promise.all([service.shipOrder(f.tenant, f.order), service.shipOrder(f.tenant, f.order)]);
  assert.deepEqual(results.sort(), [false, true]);
  const stock = (await q("SELECT current_stock,reserved_stock FROM bms_inventory WHERE tenant_id=$1", [f.tenant])).rows[0];
  assert.deepEqual(stock, { current_stock: 3, reserved_stock: 0 });
  assert.equal((await q("SELECT * FROM test_movements WHERE tenant_id=$1", [f.tenant])).rowCount, 1);
});

test("delivery still refuses handover without address; foreign tenant cannot hand over pickup", async () => {
  const delivery = await fixture("DELIVERY", "PACKING");
  assert.equal(await service.shipOrder(delivery.tenant, delivery.order), false);
  const pickup = await fixture("PICKUP", "PACKING");
  assert.equal(await service.shipOrder(randomUUID(), pickup.order), false);
  assert.equal((await q("SELECT status FROM bms_orders WHERE id=$1", [pickup.order])).rows[0].status, "PACKING");
});
