import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { buildInputVatReportDoc } from "../apps/web/lib/bms/documentGenerator.ts";
import { renderTaxReportPrint } from "../apps/web/lib/bms/taxReportPrint.ts";

test("print is limited to statutory sheets, escapes markup and ships valid pagination JavaScript", () => {
  const doc=buildInputVatReportDoc({buyer:{name:'</script><script>alert(1)</script>',taxId:'0105555555554'},period:{from:'2026-09-01',to:'2026-09-30'},
    establishments:[{locationId:'hq',code:'MAIN',name:'FAKE',branchCode:'00000',isHeadOffice:true,address:'FAKE'}],rows:[],totals:{documentCount:0,amountBeforeVat:0,vatAmount:0,totalAmount:0}},v=>v);
  const html=renderTaxReportPrint(doc,'nonce');
  assert.doesNotMatch(html,/<script>alert\(1\)/);
  assert.doesNotMatch(html,/กระทบยอดภายใน/);
  assert.match(html,/\\u003c\/script>/);
  assert.match(html,/size: A4 landscape/);
  assert.match(html,/document\.fonts\.ready/);
  const script=html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)![1];
  assert.doesNotThrow(()=>new Script(script));
  assert.throws(()=>renderTaxReportPrint({...doc,sheets:[]},'nonce'),/ไม่มีสถานประกอบการ/);
});
test("print route and service preserve authentication, source permission, branch scope and no-store", () => {
  const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
  const route=read('apps/web/app/api/bms/reports/tax-print/route.ts');
  const service=read('apps/web/lib/bms/reportEngine.ts').split('export async function getTaxPrintReport')[1].split('async function reportPermissionFlags')[0];
  assert.match(route,/authorizeAdminRoute\("report.view"\)/);
  assert.match(route,/getTaxPrintReport\(auth.tenantId, auth.ctx/);
  assert.match(route,/private, no-store/);
  assert.match(route,/frame-ancestors 'none'/);
  assert.match(service,/requirePermission\(ctx, "report.view"\)/);
  assert.match(service,/"tax.document.view" : "expense.view"/);
  assert.match(service,/allowedReportLocationIds\(tenantId, ctx\)/);
  assert.match(service,/!allowedLocationIds.includes\(input.locationId\)/);
});
