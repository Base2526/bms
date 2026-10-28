// Focused PostgreSQL component test. Synthetic dependency tables intentionally do
// not claim coverage of the restored BMS schema, its triggers or business writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Client } = require("pg"), ts = require("typescript");
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

test("inventory PostgreSQL SQL, RLS, partial receipts, migrations and exact forecast horizon", async () => {
  const client = new Client({ host: process.env.POSTGRES_HOST || "localhost", port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "appdb", user: process.env.POSTGRES_USER || "app", password: process.env.POSTGRES_PASSWORD || "app" });
  const schema = `inventory_test_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}; GRANT USAGE ON SCHEMA ${schema} TO bms_app`);
    // Only fields consumed by these read services; authoritative stock view is
    // represented by explicit sale-time rows, not reconstructed from order items.
    await client.query(`
      CREATE TABLE bms_tenants(id uuid PRIMARY KEY);
      CREATE TABLE users(id uuid PRIMARY KEY);
      CREATE TABLE bms_locations(tenant_id uuid, id uuid, name text, active boolean DEFAULT true, PRIMARY KEY(tenant_id,id));
      CREATE TABLE bms_products(tenant_id uuid, sku text, name text, active boolean DEFAULT true, PRIMARY KEY(tenant_id,sku));
      CREATE TABLE bms_inventory(tenant_id uuid, location_id uuid, product_sku text, size text, current_stock int, reserved_stock int, quarantine_stock int, reorder_point int);
      CREATE TABLE bms_inventory_lots(id uuid, tenant_id uuid, location_id uuid, product_sku text, size text, lot_no text, qty int, expiry_date date);
      CREATE TABLE bms_operation_lot_holds(tenant_id uuid, lot_id uuid, status text);
      CREATE TABLE bms_inventory_policies(tenant_id uuid, product_sku text, size text, safety_stock_days int, lead_time_days int);
      CREATE TABLE bms_inventory_demand_events(tenant_id uuid NOT NULL REFERENCES bms_tenants(id), product_sku text, size text, qty int, occurred_at timestamptz);
      CREATE TABLE bms_restock_subscriptions(tenant_id uuid, product_sku text, size text, requested_qty int, status text);
      CREATE TABLE bms_orders(tenant_id uuid, id uuid, location_id uuid, status text, paid_at timestamptz, created_at timestamptz);
      CREATE TABLE bms_order_stock_lines(tenant_id uuid, order_id uuid, location_id uuid, product_sku text, size text, qty int);
      CREATE TABLE bms_purchase_orders(tenant_id uuid, id uuid, supplier_id uuid, status text, created_at timestamptz, updated_at timestamptz, PRIMARY KEY(tenant_id,id));
      CREATE TABLE bms_purchase_order_items(tenant_id uuid, id bigint, po_id uuid, product_sku text, size text, qty_ordered int, qty_received int, unit_cost numeric);
      CREATE TABLE bms_branch_requisitions(tenant_id uuid, id uuid, location_id uuid, status text);
      CREATE TABLE bms_branch_requisition_items(tenant_id uuid, id bigint, requisition_id uuid, product_sku text, size text);
      CREATE TABLE bms_branch_requisition_purchases(tenant_id uuid, item_id bigint, po_item_id bigint, qty int);
      CREATE TABLE bms_stock_transfers(tenant_id uuid, id uuid, from_location_id uuid, to_location_id uuid, status text, sent_at timestamptz);
      CREATE TABLE bms_stock_movements(tenant_id uuid, location_id uuid, product_sku text, size text, type text, qty int, created_at timestamptz);
      CREATE TABLE bms_inventory_wastage(tenant_id uuid, location_id uuid, product_sku text, size text, qty int, created_at timestamptz);
      CREATE TABLE bms_suppliers(tenant_id uuid, id uuid, name text);
      CREATE TABLE bms_supplier_products(tenant_id uuid, supplier_id uuid, active boolean);
      GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO bms_app;
    `);
    for (let pass = 0; pass < 2; pass++) {
      await client.query(read("db/migrations/10.99__bms_branch_inventory_intelligence.sql"));
      await client.query(read("db/migrations/10.100__bms_inventory_demand_location_delete.sql"));
    }
    const tenant = id(1), other = id(2), a = id(3), b = id(4), po = id(5);
    await client.query(`INSERT INTO bms_tenants VALUES ($1),($2);
    `, [tenant, other]);
    for (const t of [tenant, other]) {
      await client.query("INSERT INTO bms_locations VALUES ($1,$2,'A',true),($1,$3,'B',true)", [t,a,b]);
      await client.query("INSERT INTO bms_products VALUES ($1,'TEST','Test',true)", [t]);
      await client.query("INSERT INTO bms_inventory VALUES ($1,$2,'TEST','M',10,0,0,5),($1,$3,'TEST','M',10,0,0,5)", [t,a,b]);
      await client.query("INSERT INTO bms_inventory_location_policies(tenant_id,location_id,product_sku,size,safety_stock_days,lead_time_days) VALUES($1,$2,'TEST','M',9,3)", [t,a]);
    }
    for (const location of [a,b]) {
      for (let i=1;i<=7;i++) {
        const order = randomUUID();
        await client.query("INSERT INTO bms_orders VALUES ($1,$2,$3,'COMPLETED',now()-make_interval(days=>$4),now()-make_interval(days=>$4))", [tenant,order,location,i]);
        await client.query("INSERT INTO bms_order_stock_lines VALUES ($1,$2,$3,'TEST','M',1)", [tenant,order,location]);
      }
    }
    await client.query("INSERT INTO bms_purchase_orders VALUES($1,$2,NULL,'PARTIAL',now(),now())", [tenant,po]);
    await client.query("INSERT INTO bms_purchase_order_items VALUES($1,1,$2,'TEST','M',100,30,10)", [tenant,po]);
    for (const [location, item, qty] of [[a,1,60],[b,2,40]] as const) {
      const requisition = randomUUID();
      await client.query("INSERT INTO bms_branch_requisitions VALUES($1,$2,$3,'APPROVED')", [tenant,requisition,location]);
      await client.query("INSERT INTO bms_branch_requisition_items VALUES($1,$2,$3,'TEST','M')", [tenant,item,requisition]);
      await client.query("INSERT INTO bms_branch_requisition_purchases VALUES($1,$2,1,$3)", [tenant,item,qty]);
    }
    function load(name: string, deps: Record<string, any>) {
      const code = ts.transpileModule(read(`apps/web/lib/bms/${name}.ts`), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
      const mod = { exports: {} as any };
      new Function("require", "module", "exports", code)((name: string) => {
        if (name === "crypto" || name === "node:crypto") return require(name);
        assert.ok(name in deps, name); return deps[name];
      }, mod, mod.exports);
      return mod.exports;
    }
    const db = { getClient: async () => ({ query: client.query.bind(client), release() {} }) };
    const tenantModule = load("tenant", {});
    const evidence = load("inventoryEvidenceRead", { "@/lib/db": db, "./tenant": tenantModule });
    const deps = { "@/lib/db": db, "./tenant": tenantModule, "./inventoryEvidenceRead": evidence,
      "./forecastQuality": load("forecastQuality", {}), "./lotQuality": load("lotQuality", { "./operationQualityDispatch": {} }) };
    const service = load("inventoryIntelligence", deps);
    const result = await service.getInventoryIntelligence({ tenantId: tenant });
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].policySource, "LOCATION", "RLS must expose the current tenant's policy");
    assert.equal(result.items[0].safetyStockDays, 9);
    assert.deepEqual(result.items.map((i: any) => i.allocatedIncoming), [30,10]);
    assert.equal(result.summary.unallocatedIncomingUnits, 30);
    assert.equal(result.items.reduce((sum: number, i: any) => sum+i.allocatedIncoming, 0)+result.summary.unallocatedIncomingUnits, 70);
    const scoped = await service.getInventoryIntelligence({ tenantId: tenant, allowedLocationIds: [a] });
    assert.deepEqual(scoped.items.map((i: any) => i.locationId), [a]);
    assert.deepEqual(scoped.unallocatedIncoming, []);
    await load("inventoryAnomalies", deps).getInventoryAnomalies({ tenantId: tenant });
    await load("supplierIntelligence", deps).getSupplierIntelligence({ tenantId: tenant });
    const snapshot = await service.recordInventoryForecastSnapshot({ tenantId: tenant, horizonDays: 1 });
    assert.equal(snapshot.itemCount, 2);
    assert.equal((await service.recordInventoryForecastSnapshot({ tenantId: tenant, horizonDays: 1 })).replayed, true);
    await client.query("UPDATE bms_inventory_forecast_runs SET generated_at=now()-interval '2 days' WHERE tenant_id=$1 AND id=$2", [tenant,snapshot.runId]);
    await client.query("UPDATE bms_orders SET paid_at=now()-interval '10 days'");
    for (const [days, qty] of [[0,17],[1,900]]) {
      const order = randomUUID();
      await client.query("INSERT INTO bms_orders SELECT $1,$2,$3,'COMPLETED',generated_at+make_interval(days=>$4),generated_at FROM bms_inventory_forecast_runs WHERE id=$5", [tenant,order,a,days,snapshot.runId]);
      await client.query("INSERT INTO bms_order_stock_lines VALUES($1,$2,$3,'TEST','M',$4)", [tenant,order,a,qty]);
    }
    assert.equal(await service.evaluateDueInventoryForecasts(tenant), 2);
    assert.deepEqual((await client.query("SELECT actual_qty::int qty FROM bms_inventory_forecast_items WHERE run_id=$1 ORDER BY location_id", [snapshot.runId])).rows, [{qty:17},{qty:0}]);
    assert.equal(await service.evaluateDueInventoryForecasts(tenant), 0, "matured evidence is evaluated once");
    const accuracy = await service.getInventoryForecastAccuracy({ tenantId: tenant });
    assert.equal(accuracy.sampleCount, 2);
    assert.equal((await service.getInventoryForecastAccuracy({ tenantId: other })).sampleCount, 0);
    // Prove the policy itself, without a tenant WHERE that could mask broken RLS.
    await tenantModule.beginTenantTx(await db.getClient(), tenant);
    const visible = await client.query("SELECT tenant_id FROM bms_inventory_location_policies");
    assert.deepEqual(visible.rows.map((r: any) => r.tenant_id), [tenant]);
    await assert.rejects(client.query("INSERT INTO bms_inventory_location_policies(tenant_id,location_id,product_sku,size,safety_stock_days,lead_time_days) VALUES($1,$2,'TEST','M',1,1)", [other,b]), (e: any) => e.code === "42501");
    await client.query("ROLLBACK");
    // Branch deletion retains the tenant and the demand, clearing only attribution.
    const removed = randomUUID();
    await client.query("INSERT INTO bms_locations VALUES($1,$2,'Temporary',true)", [tenant,removed]);
    await client.query("INSERT INTO bms_inventory_demand_events(tenant_id,location_id,product_sku,size,qty,occurred_at) VALUES($1,$2,'TEST','M',3,now())", [tenant,removed]);
    await client.query("DELETE FROM bms_locations WHERE tenant_id=$1 AND id=$2", [tenant,removed]);
    assert.deepEqual((await client.query("SELECT tenant_id,location_id FROM bms_inventory_demand_events")).rows, [{ tenant_id: tenant, location_id: null }]);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("RESET ROLE");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
