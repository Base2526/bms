import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveThaiAddressCodesInTx, resolveThaiAddressTextInTx, structuredAddressSnapshot } from "../apps/web/lib/bms/thaiAddress.ts";

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("db/migrations/10.77__bms_structured_thai_addresses.sql");
const customers=read("apps/web/lib/bms/customers.ts");
const tax=read("apps/web/lib/bms/taxDocuments.ts");
const matcher=read("scripts/match-th-addresses.mts");
const checkout=read("apps/web/app/(checkout)/checkout/CheckoutClient.tsx");

test("phase 2 migration is additive and preserves legacy free text",()=>{
  assert.doesNotMatch(migration,/\bDROP\s+(?:COLUMN|TABLE)\b/i);
  for(const table of ["bms_customer_addresses","bms_store_profile","bms_locations","bms_tax_documents"])
    assert.match(migration,new RegExp(`ALTER TABLE ${table}`));
  for(const table of ["bms_store_profile","bms_locations","bms_tax_documents"])
    for(const field of ["province","district","subdistrict"])
      assert.match(migration,new RegExp(`conname='${table}_(?:buyer_)?${field}_code_fkey'`));
  assert.match(migration,/Immutable buyer address snapshot/);
});

test("one shared resolver validates hierarchy and returns display snapshots",async()=>{
  const client={query:async()=>({rowCount:1,rows:[{province_code:"10",district_code:"1001",subdistrict_code:"100101",province:"กรุงเทพมหานคร",district:"พระนคร",subdistrict:"พระบรมมหาราชวัง",postcode:"10200"}]})} as any;
  const row=await resolveThaiAddressCodesInTx(client,{provinceCode:"10",districtCode:"1001",subdistrictCode:"100101"});
  assert.equal(row?.postcode,"10200");
  assert.equal(structuredAddressSnapshot("1 ถนน",row!),"1 ถนน\nพระบรมมหาราชวัง\nพระนคร\nกรุงเทพมหานคร\n10200");
  assert.match(customers,/resolveThaiAddressCodesInTx/);
});

test("AI-address resolution asks when the same subdistrict is ambiguous",async()=>{
  const rows=[{province_code:"10",district_code:"1",subdistrict_code:"a",province:"A",district:"D",subdistrict:"Same",postcode:"10000"},{province_code:"20",district_code:"2",subdistrict_code:"b",province:"B",district:"E",subdistrict:"Same",postcode:"20000"}];
  const client={query:async()=>({rowCount:2,rows})} as any;
  await assert.rejects(()=>resolveThaiAddressTextInTx(client,"1 Same"),/มากกว่าหนึ่งจังหวัด/);
  assert.match(customers,/resolveThaiAddressTextInTx/);
});

test("re-selecting a saved legacy address does not require master-data matching",()=>{
  assert.match(customers,/existing\.rows\[0\]\s*\?\s*null\s*:\s*await resolveThaiAddressTextInTx/);
  assert.match(customers,/SET label = COALESCE\(\$3, label\), is_default = true/);
});

test("issued invoices use frozen buyer text and never rejoin master for printing",()=>{
  assert.match(tax,/preserveAddressSnapshot/);
  assert.match(read("apps/web/lib/bms/taxInvoiceRequests.ts"),/buyer: \{ \.\.\.row\.buyer, preserveAddressSnapshot: true \}/);
  assert.match(tax,/buyer_address/);
  assert.match(tax,/structuredAddressSnapshot/);
  assert.doesNotMatch(read("apps/web/lib/bms/etax/xml.ts"),/JOIN\s+bms_master_th_/i);
});

test("legacy matcher defaults to rollback and writes exact matches only",()=>{
  assert.match(matcher,/const apply = argv\.includes\("--apply"\)/);
  assert.match(matcher,/if \(!apply \|\| found\.length!==1\) continue/);
  assert.match(matcher,/apply\?"COMMIT":"ROLLBACK"/);
  assert.match(matcher,/"AMBIGUOUS"/);
  assert.match(matcher,/master_data\.address_match/);
});

test("customer, checkout, tax request, store and branch forms expose structured selectors",()=>{
  assert.match(checkout,/PublicThaiAddressSelects/);
  const taxRequest="apps/web/app/tax-invoice/request/requestClient.tsx";
  assert.match(read(taxRequest),/<Form\.Item name="province"[^>]+required: true/);
  for(const file of [taxRequest,"apps/web/app/(admin)/admin/tax-documents/page.tsx","apps/web/app/(admin)/admin/settings/StoreProfileCard.tsx","apps/web/app/(admin)/admin/locations/page.tsx"])
    assert.match(read(file),/<ThaiAddressFields\s+form=/);
});
