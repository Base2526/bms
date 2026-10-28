import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("db/migrations/10.99__bms_branch_inventory_intelligence.sql");
const service=read("apps/web/lib/bms/inventoryIntelligence.ts");
const anomalies=read("apps/web/lib/bms/inventoryAnomalies.ts");
const catalog=read("apps/web/lib/bms/tools/catalog.ts");
const runtime=read("apps/web/lib/bms/tools/runtime.ts");
const schema=read("apps/web/graphql/typeDefs.ts");
const resolver=read("apps/web/graphql/bmsDashboard.ts");
const confirm=read("apps/web/components/work-assistant/confirmMutations.ts");
const purchase=read("apps/web/lib/bms/purchase.ts");
const scheduler=read("apps/web/scheduler/jobs.json");

test("10.99 adds tenant-scoped branch policy, forecast evidence and PO idempotency",()=>{
  for(const table of ["bms_inventory_location_policies","bms_inventory_forecast_runs","bms_inventory_forecast_items","bms_purchase_order_idempotency"]){
    assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration,/ADD COLUMN IF NOT EXISTS location_id UUID/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/FORCE ROW LEVEL SECURITY/);
  assert.match(migration,/GRANT UPDATE\(actual_qty, evaluated_at\)/);
  assert.doesNotMatch(migration,/GRANT[\s\S]*DELETE[\s\S]*bms_inventory_forecast/);
});

test("inventory recommendations use authoritative branch evidence and keep unknown allocation separate",()=>{
  assert.match(service,/bms_order_stock_lines/);
  assert.match(service,/usableStockSql/);
  assert.match(service,/sl\.location_id,sl\.product_sku/);
  assert.match(service,/location_id IS NULL/);
  assert.match(service,/unallocatedDemand/);
  assert.match(service,/unallocatedIncoming/);
  assert.match(service,/bms_inventory_location_policies/);
  assert.match(service,/beginTenantTx\(client, input\.tenantId\)/);
  assert.match(service,/includeUnallocated = input\.includeUnallocated \?\? allowed === null/);
  assert.match(service,/includeUnallocated \? query<any>/);
});

test("anomaly detection is review-only and checks the stock integrity boundaries",()=>{
  for(const evidence of ["RESERVATION_UNATTRIBUTED","LOT_TOTAL_MISMATCH","STALE_TRANSFER","STALE_PURCHASE_ORDER","UNUSUAL_WASTAGE","MISSING_LOCATION_POLICY"]){
    assert.match(anomalies,new RegExp(evidence));
  }
  assert.doesNotMatch(anomalies,/UPDATE bms_inventory|INSERT INTO bms_stock_movements/);
});

test("assistant reads intelligence but sensitive inventory writes remain shared proposals",()=>{
  for(const name of ["get_inventory_intelligence","explain_inventory_risk","get_inventory_anomalies","find_inventory_transfer_opportunities","get_inventory_forecast_accuracy","get_supplier_intelligence"]){
    assert.match(catalog,new RegExp(`name:\\s*[\"']${name}[\"']`));
  }
  assert.match(catalog,/name:\s*"create_purchase_order"[\s\S]*sensitive:\s*true[\s\S]*mutation:\s*"bmsCreatePurchaseOrder"/);
  assert.match(catalog,/name:\s*"propose_stock_transfer"[\s\S]*mutation:"bmsCreateStockTransfer"/);
  assert.doesNotMatch(catalog,/name:\s*"receive_purchase_order"/);
  assert.match(runtime,/create_purchase_order/);
  assert.match(runtime,/propose_stock_transfer/);
  assert.match(confirm,/bmsCreatePurchaseOrder/);
  assert.match(confirm,/bmsCreateStockTransfer/);
  assert.match(purchase,/INSERT INTO bms_audit_log[\s\S]*purchase\.create/);
  assert.match(purchase,/!result\.replayed && input\.audit/);
  assert.match(purchase,/error instanceof IdempotencyConflictError/);
});

test("GraphQL and daily maintenance expose branch scope and matured forecast accuracy",()=>{
  assert.match(schema,/bmsInventoryActionCenter\([^)]*locationId: ID/);
  assert.match(schema,/bmsInventoryAnomalies/);
  assert.match(schema,/bmsInventoryForecastAccuracy/);
  assert.match(resolver,/listLocationsForUser/);
  assert.match(resolver,/userHasLocationScope/);
  assert.match(resolver,/userCanAccessLocation/);
  assert.match(resolver,/includeUnallocated:!locationScoped/);
  assert.match(resolver,/includeTenantWide:!locationScoped/);
  assert.match(anomalies,/includeTenantWide \? query<any>/);
  assert.match(scheduler,/inventory-intelligence\/maintain/);
  assert.match(service,/evaluateDueInventoryForecasts/);
  assert.match(service,/\bmae\b/);
  assert.match(service,/\bwape\b/);
  assert.match(service,/\bbias\b/);
});
