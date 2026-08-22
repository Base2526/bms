import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration=readFileSync(new URL("../db/migrations/9.14__bms_retention_engine.sql",import.meta.url),"utf8");
const service=readFileSync(new URL("../apps/web/lib/bms/retention.ts",import.meta.url),"utf8");

test("retention cases are tenant isolated and holdout-aware",()=>{
  assert.match(migration,/FORCE ROW LEVEL SECURITY/);
  assert.match(migration,/cohort IN \('TREATMENT','HOLDOUT'\)/);
  assert.doesNotMatch(migration,/GRANT SELECT,INSERT,UPDATE,DELETE/);
});

test("recommendations use verified order and basket history",()=>{
  assert.match(service,/o\.status=ANY\(\$2\)/);
  assert.match(service,/JOIN bms_order_items peer ON peer\.order_id=seed\.order_id/);
  assert.match(service,/recommended_product_sku/);
});

test("holdout cannot be contacted and conversion is order-attributed",()=>{
  assert.match(service,/holdout cases cannot be contacted/);
  assert.match(service,/converted_order_id/);
  assert.match(service,/incrementalLift:tr-hr/);
  assert.match(service,/INSERT INTO bms_audit_log/);
  assert.match(service,/ATTRIBUTION_DAYS = 30/);
  assert.match(service,/status='EXPIRED'/);
  assert.match(service,/created_at<=COALESCE\(rc\.contacted_at,rc\.created_at\)/);
});
