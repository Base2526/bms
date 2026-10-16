import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildEtaxXml, LEGACY_ETAX_DOCUMENT_CODES } from "../apps/web/lib/bms/etax/xml.ts";
import { normalizeTaxBuyer } from "../apps/web/lib/bms/taxBuyer.ts";

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("db/migrations/10.79__bms_tax_reference_master.sql");
const queue=read("apps/web/lib/bms/etax/queue.ts");
const xmlSource=read("apps/web/lib/bms/etax/xml.ts");
const pos=read("apps/web/lib/bms/pos.ts");
const vat=read("apps/web/lib/bms/vat.ts");

const document:any={
  documentId:"doc-1",docType:"FULL",docNo:"INV-2026-0001",issueDate:"2026-10-16",operatorId:"OP-1",
  seller:{name:"ร้าน เอ & บี",taxId:"0105557009441",branchCode:"00000",address:"1 ถนนสุขุมวิท"},
  buyer:{name:"บริษัท ตัวอย่าง",taxId:"0105557009441",branchCode:"00000",address:"99 ถนนไทย"},
  lines:[{lineNo:1,sku:"SKU-1",name:"สินค้า",qty:1,unitName:"ชิ้น",unitCode:"H87",unitPrice:134,amount:134,vatCategory:"V"}],
  taxableAmount:134,exemptAmount:0,vatAmount:8.77,vatRate:7,roundingAmount:0,grandTotal:134,replacesDocNo:"ABB-1",
};

test("legacy e-Tax XML remains byte-identical when codes come from master data",()=>{
  const before=buildEtaxXml(document);
  const after=buildEtaxXml(document,{...LEGACY_ETAX_DOCUMENT_CODES});
  assert.equal(after,before);
  assert.equal(createHash("sha256").update(after).digest("hex"),"f36e1658b2f50e403298013ea8f2c08d0bca35cb8871ccddb3773744a3af68e7");
});

test("XML production path resolves document codes by immutable issue date",()=>{
  assert.match(queue,/resolveEtaxDocumentCodes\(doc\.issueDate\)/);
  assert.match(queue,/buildEtaxXml\(doc, documentCodes\)/);
  assert.doesNotMatch(queue,/resolveEtaxDocumentCodes\([^)]*new Date/);
  assert.match(xmlSource,/LEGACY_ETAX_DOCUMENT_CODES/);
});

test("tax reference tables are versioned global read-only masters",()=>{
  assert.match(migration,/^-- Recovery-safe entry point[\s\S]*ROLLBACK;\s*BEGIN;/);
  for(const table of ["tax_document_types","vat_rates","tax_buyer_types"]){
    assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS bms_master_${table}`));
  }
  assert.match(migration,/effective_from DATE NOT NULL/g);
  assert.match(migration,/effective_to DATE/g);
  assert.match(migration,/GRANT SELECT ON TABLE %I TO bms_app/);
  assert.doesNotMatch(migration,/ALTER TABLE bms_master_(?:tax_document_types|vat_rates|tax_buyer_types).*ROW LEVEL SECURITY/s);
  assert.match(migration,/Royal Decree 807 B\.E\. 2569/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.trg_global_revision\(\)/);
  assert.match(migration,/create_global_revision_trigger\('bms_master_tax_document_types'\)/);
  assert.doesNotMatch(migration,/create_revision_trigger\('bms_master_tax_/);
  assert.match(migration,/ALTER COLUMN tenant_id DROP NOT NULL/);
  assert.match(migration,/to_regclass\(format\('%I\.%I', 'public', p_table\)\) IS NULL/);
  assert.ok(migration.indexOf("create_global_revision_trigger('bms_master_vat_rates')")<migration.indexOf("INSERT INTO bms_master_vat_rates"));
});

test("VAT reference mismatch is advisory and the sale calculation stays untouched",()=>{
  assert.match(pos,/ไม่ตรงกับอัตราอ้างอิงที่มีผล.*ไม่บล็อกการขาย/);
  assert.match(pos,/result\.warnings\.push/);
  assert.doesNotMatch(vat,/taxMaster|bms_master_vat_rates|getEffectiveVatReference/);
});

test("buyer master rules guide validation while checksum stays in code",()=>{
  const individual=normalizeTaxBuyer({buyerType:"INDIVIDUAL",vatRegistered:false,name:"A",address:"B"},{code:"INDIVIDUAL",taxIdPolicy:"THAI_13_OPTIONAL",branchPolicy:"FORBIDDEN"});
  assert.equal(individual.taxId,null);assert.equal(individual.branchCode,null);
  const foreign=normalizeTaxBuyer({buyerType:"FOREIGNER",vatRegistered:false,name:"A",address:"B"},{code:"FOREIGNER",taxIdPolicy:"THAI_13_OPTIONAL",branchPolicy:"FORBIDDEN"});
  assert.equal(foreign.taxId,null);
  assert.throws(()=>normalizeTaxBuyer({buyerType:"FOREIGNER",vatRegistered:false,name:"A",address:"B",taxId:"FOREIGN-123"},{code:"FOREIGNER",taxIdPolicy:"THAI_13_OPTIONAL",branchPolicy:"FORBIDDEN"}));
  assert.throws(()=>normalizeTaxBuyer({buyerType:"COMPANY",vatRegistered:true,name:"A",address:"B"},{code:"COMPANY",taxIdPolicy:"THAI_13_REQUIRED",branchPolicy:"REQUIRED_DEFAULT_HEAD_OFFICE"}));
});

test("seeded e-Tax mappings are explicitly beta compatibility, never production certification",()=>{
  assert.match(migration,/BMS e-Tax beta compatibility mapping/);
  assert.match(migration,/not a claim of XSD readiness/);
  assert.doesNotMatch(migration,/production.ready|certified for submission/i);
});
