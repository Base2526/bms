import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildEtaxXml } from "../apps/web/lib/bms/etax/xml.ts";

const read = (file: string) => fs.readFileSync(file, "utf8");
const migration = read("../../db/migrations/10.76__bms_master_data_foundation.sql");
const service = read("lib/bms/masterData.ts");
const resolver = read("graphql/bmsMasterData.ts");
const schema = read("graphql/typeDefs.ts");
const importer = read("../../scripts/import-th-address.mts");
const xml = read("lib/bms/etax/xml.ts");
const profile = read("lib/bms/storeProfile.ts");
const page = read("app/(admin)/admin/master-data/page.tsx");
const layout = read("app/(admin)/admin/master-data/layout.tsx");

test("master tables are global, provenance-aware, and read-only to bms_app", () => {
  for (const table of ["banks","units","th_provinces","th_districts","th_subdistricts"]) {
    assert.ok(new RegExp(`CREATE TABLE IF NOT EXISTS bms_master_${table} \\(`).test(migration));
  }
  const definitions = migration.split(/CREATE TABLE IF NOT EXISTS bms_master_/).slice(1).map((part) => part.split(/;\r?\n/)[0]);
  for (const definition of definitions.slice(0, 5)) assert.doesNotMatch(definition, /tenant_id/i);
  assert.doesNotMatch(migration, /ALTER TABLE bms_master_\w+ (?:ENABLE|FORCE) ROW LEVEL SECURITY/i);
  assert.match(migration, /GRANT SELECT ON TABLE %I TO bms_app/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/);
  assert.match(migration, /source_version/);
});

test("every master mutation rechecks platform admin and audits inside its transaction", () => {
  assert.match(service, /await requirePlatformAdmin\(ctx\)/);
  assert.match(service, /runInTransaction\(actorId, work\)/);
  assert.match(service, /INSERT INTO bms_audit_log/);
  for (const field of ["bmsUpsertMasterBank","bmsUpsertMasterUnit","bmsUpsertMasterThaiAddress"]) {
    assert.ok(schema.includes(field));
    assert.ok(resolver.includes(field));
  }
});

test("address importer is dry-run by default, licensed, and idempotent", () => {
  assert.match(importer, /const apply = args\.has\("--apply"\)/);
  assert.match(importer, /Apply refused: --actor-id and --audit-tenant-id are required/);
  assert.match(importer, /set_config\('app\.editor_id'/);
  assert.match(importer, /platform\.master_data\.th_address_import/);
  assert.match(importer, /license.*required/s);
  assert.match(importer, /Import refused: confirm the dataset licence/);
  assert.ok((importer.match(/ON CONFLICT\(code\) DO UPDATE/g) ?? []).length >= 3);
  assert.match(importer, /if \(apply\) await client\.query\("COMMIT"\); else await client\.query\("ROLLBACK"\)/);
});

test("legacy snapshots remain while optional master codes are added", () => {
  assert.match(profile, /bankCode:/);
  assert.match(profile, /bankName:/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS unit_code TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS subdistrict_code TEXT/);
  assert.match(xml, /l\.unitCode \?\? l\.unitName \?\? "EA"/);
});

test("e-Tax prefers the standard unit code and preserves the legacy fallback", () => {
  const base:any={documentId:"d",docType:"FULL_INVOICE",docNo:"INV-1",issueDate:"2026-10-16",operatorId:null,
    seller:{name:"Shop",taxId:"123",branchCode:"00000",address:null},buyer:{name:null,taxId:null,branchCode:null,address:null},
    taxableAmount:1,exemptAmount:0,vatAmount:0,vatRate:7,roundingAmount:0,grandTotal:1,replacesDocNo:null};
  const line={lineNo:1,sku:"SKU",name:"Item",qty:1,unitName:"ชิ้น",unitCode:"H87",unitPrice:1,amount:1,vatCategory:"V"};
  assert.match(buildEtaxXml({...base,lines:[line]}),/BilledQuantity unitCode="H87"/);
  assert.match(buildEtaxXml({...base,lines:[{...line,unitCode:null}]}),/BilledQuantity unitCode="ชิ้น"/);
});

test("platform page is gated, searchable, bilingual, and uses closable alerts", () => {
  assert.match(layout, /requirePlatformAdminPage/);
  assert.match(page, /admin_master_data\./);
  assert.match(page, /Input\.Search/);
  const alerts = [...page.matchAll(/<Alert\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(alerts.length >= 2);
  for (const alert of alerts) assert.match(alert, /closable/);
});
