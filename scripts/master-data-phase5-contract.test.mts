import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { composeEmergencyReply, EMERGENCY_CONTACTS, pharmacyEmergencyReply } from "../apps/web/lib/bms/pharmacy/emergency.ts";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const migration = read("db/migrations/10.80__bms_starter_reference_master.sql");
const service = read("apps/web/lib/bms/starterMasterData.ts");
const emergencyRuntime = read("apps/web/lib/bms/emergencyFacilities.ts");

test("phase 5 master tables preserve global/tenant security boundaries", () => {
  for (const table of ["category_templates", "archetype_units", "holidays", "emergency_numbers"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS bms_master_${table}`));
  }
  assert.match(migration, /bms_category_template_applications[\s\S]*ENABLE ROW LEVEL SECURITY[\s\S]*FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT ON TABLE %I TO bms_app/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/);
  assert.doesNotMatch(migration, /INSERT INTO bms_product_categories/);
});

test("category application uses a durable template ledger and never overwrites names", () => {
  assert.match(service, /NOT EXISTS[\s\S]*bms_category_template_applications/);
  assert.match(service, /ON CONFLICT \(tenant_id,name\) DO NOTHING/);
  assert.match(service, /ON CONFLICT \(tenant_id,template_id\) DO NOTHING/);
  assert.doesNotMatch(service, /UPDATE bms_product_categories SET name/);
});

test("canonical emergency output remains byte exact while contacts are injectable", () => {
  const output = composeEmergencyReply({ kind: "MEDICAL", english: false, facilities: [] });
  assert.equal(output, pharmacyEmergencyReply("หมดสติ"));
  const custom = composeEmergencyReply({ kind: "POISONING", english: true, facilities: [], contacts: {
    ...EMERGENCY_CONTACTS, medical: "999", poisoning: "888",
  }});
  assert.match(custom, /^In Thailand, call 999/);
  assert.match(custom, /Poison Center 888/);
});

test("emergency master lookup is bounded and falls back to code constants", () => {
  assert.match(emergencyRuntime, /SET LOCAL statement_timeout = '400ms'/);
  assert.match(emergencyRuntime, /setTimeout\(\(\) => resolve\(EMERGENCY_CONTACTS\), 500\)/);
  assert.match(emergencyRuntime, /return EMERGENCY_CONTACTS/);
});

test("holiday master stays display-only", () => {
  assert.match(migration, /Display-only holiday reference/);
  for (const file of ["apps/web/lib/bms/ar.ts", "apps/web/lib/bms/orders.ts"]) {
    assert.doesNotMatch(read(file), /bms_master_holidays/);
  }
});

test("every Starter Catalog category is present in the template seed", () => {
  const sample = read("apps/web/lib/bms/sampleData.ts");
  const categories = [...sample.matchAll(/category:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(categories.length > 40);
  for (const category of new Set(categories)) assert.ok(migration.includes(`'${category}'`), category);
});
