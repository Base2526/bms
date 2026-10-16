import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CARRIER_CODES, CARRIER_LABELS } from "../apps/web/lib/bms/carriers/constants.ts";
import { THAI_PROVINCES } from "../apps/web/lib/taxRequestFields.ts";
import { defaultShippingZoneForProvince, zoneForProvince } from "../apps/web/lib/bms/shippingZones.ts";

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("db/migrations/10.78__bms_shipping_master_data.sql");
const shippingMaster=read("apps/web/lib/bms/shippingMaster.ts");
const shipping=read("apps/web/lib/bms/shipping.ts");
const rates=read("apps/web/lib/bms/shippingRates.ts");
const importer=read("scripts/import-th-address.mts");
const assistantCapabilities=read("apps/web/lib/bms/assistantKnowledge/capabilities.ts");

test("carrier master seed remains exactly compatible with the TypeScript carrier type",()=>{
  const seeded=[...migration.matchAll(/\('([A-Z0-9_]+)','[A-Z]{2}','[^']*','([^']*)',NULL,NULL,'(?:LIVE|MOCK|NONE)'/g)]
    .map((match)=>({code:match[1],nameEn:match[2]}));
  assert.deepEqual(seeded.map((row)=>row.code),[...CARRIER_CODES]);
  for(const row of seeded) assert.equal(row.nameEn,CARRIER_LABELS[row.code as keyof typeof CARRIER_LABELS]);
  assert.match(migration,/\('FLASH'.*'MOCK'/);
  assert.match(migration,/\('KERRY'.*'MOCK'/);
  assert.doesNotMatch(migration,/\('(?:FLASH|KERRY)'[^\n]*'LIVE'/);
});

test("all 77 canonical provinces keep the exact legacy zone and shipping fee",()=>{
  assert.equal(THAI_PROVINCES.length,77);
  const rates={BANGKOK:41,PERIMETER:53,UPCOUNTRY:67} as const;
  const weightSurcharge=19;
  for(const province of THAI_PROVINCES){
    const oldZone=zoneForProvince(province);
    const newZone=defaultShippingZoneForProvince(province);
    assert.equal(newZone,oldZone,province);
    assert.ok(oldZone);
    assert.equal(rates[newZone]+weightSurcharge,rates[oldZone]+weightSurcharge,`${province} fee`);
  }
  assert.equal(THAI_PROVINCES.filter((p)=>defaultShippingZoneForProvince(p)==="BANGKOK").length,1);
  assert.equal(THAI_PROVINCES.filter((p)=>defaultShippingZoneForProvince(p)==="PERIMETER").length,5);
  assert.equal(THAI_PROVINCES.filter((p)=>defaultShippingZoneForProvince(p)==="UPCOUNTRY").length,71);
});

test("legacy aliases remain fallback-only and are reported separately from canonical provinces",()=>{
  const aliases=["กรุงเทพฯ","กทม.","Bangkok","BKK","Pathumthani","Samutprakan"];
  assert.ok(aliases.every((alias)=>zoneForProvince(alias)!==null));
  assert.ok(aliases.every((alias)=>!THAI_PROVINCES.includes(alias as any)));
  assert.match(rates,/provinceCode: input\.provinceCode/);
  assert.match(shippingMaster,/if \(!provinceCode\) return zoneForProvince\(args\.province\)/);
});

test("zone defaults, tenant overrides and importer are code-based and tenant isolated",()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS bms_master_th_shipping_zones/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS bms_shipping_zone_overrides/);
  assert.match(migration,/PRIMARY KEY \(tenant_id, province_code\)/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/CREATE POLICY bms_shipping_zone_overrides_tenant_isolation/);
  assert.match(shippingMaster,/o\.tenant_id = \$1 AND o\.province_code = d\.province_code/);
  assert.match(importer,/defaultShippingZoneForProvince\(row\.nameTh\)/);
});

test("shipment presentation is frozen and tracking format is advisory",()=>{
  for(const column of ["carrier_name","tracking_url","tracking_no_warning"])
    assert.match(migration,new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  assert.match(shipping,/buildTrackingSnapshot/);
  assert.match(shipping,/carrier_name = \$6/);
  assert.match(shipping,/tracking_no_warning = \$8/);
  assert.match(shippingMaster,/TRACKING_NUMBER_FORMAT_MISMATCH/);
  assert.doesNotMatch(shippingMaster,/throw new Error\("TRACKING_NUMBER_FORMAT_MISMATCH/);
});

test("non-live carrier integration is never described as connected",()=>{
  assert.match(assistantCapabilities,/live carrier booking is not available/);
  assert.match(assistantCapabilities,/never tell a customer booking is automated/);
  assert.match(migration,/integration_status IN \('LIVE','MOCK','NONE'\)/);
});
