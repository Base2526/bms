import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../db/migrations/9.12__bms_phase1_action_center.sql", import.meta.url), "utf8");
const bilingualMigration = readFileSync(new URL("../db/migrations/9.13__bms_actions_bilingual_copy.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../apps/web/lib/bms/actionCenter.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../apps/web/lib/bms/dashboard.ts", import.meta.url), "utf8");

test("Phase 1 tenant tables enforce RLS and expose no delete grant", () => {
  for (const table of ["bms_actions", "bms_action_events", "bms_inventory_policies", "bms_inventory_demand_events"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_actions/);
});

test("action transitions are bounded and audited in the write transaction", () => {
  assert.match(service, /NEW: \["ACCEPTED","DISMISSED","EXPIRED"\]/);
  assert.match(service, /ACCEPTED: \["COMPLETED","DISMISSED","EXPIRED"\]/);
  assert.match(service, /INSERT INTO bms_action_events/);
  assert.match(service, /INSERT INTO bms_audit_log/);
  assert.match(service, /await client\.query\("COMMIT"\)/);
  assert.match(service, /system:action-refresh/);
  assert.match(service, /INSERT INTO bms_action_events[\s\S]*signal_cleared/);
});

test("inventory recommendation includes policy, incoming supply, feedback, and expiry", () => {
  assert.match(dashboard, /bms_inventory_policies/);
  assert.match(dashboard, /bms_inventory_demand_events/);
  assert.match(dashboard, /bms_restock_subscriptions/);
  assert.match(dashboard, /bms_purchase_order_items/);
  assert.match(dashboard, /bms_inventory_lots/);
  assert.match(dashboard, /safetyStock/);
  assert.match(dashboard, /leadTimeDays/);
});

test("persisted actions have bilingual copy", () => {
  assert.match(bilingualMigration, /ADD COLUMN IF NOT EXISTS title_en/);
  assert.match(bilingualMigration, /ADD COLUMN IF NOT EXISTS expected_impact_en/);
  assert.match(service, /titleEn/);
  assert.match(service, /expectedImpactEn/);
});
