// Opt-in browser layout check: TAX_PRINT_PLAYWRIGHT_DIR=<package path> TAX_PRINT_BROWSER=<Chrome executable>
// Optional TAX_PRINT_SCREENSHOT=<absolute PNG path>. No production server or tenant data used.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { buildInputVatReportDoc, buildSalesTaxReportDoc } from "../apps/web/lib/bms/documentGenerator.ts";
import { formatTaxDate } from "../apps/web/lib/bms/taxReportMath.ts";
import { renderTaxReportPrint } from "../apps/web/lib/bms/taxReportPrint.ts";

test("browser paginates Thai rows without losing signs, identity, sequence or branch totals", {skip:!process.env.TAX_PRINT_PLAYWRIGHT_DIR}, async () => {
  const {chromium}=createRequire(import.meta.url)(process.env.TAX_PRINT_PLAYWRIGHT_DIR!);
  const browser=await chromium.launch({headless:true,executablePath:process.env.TAX_PRINT_BROWSER});
  const rows=Array.from({length:75},(_,index)=>({locationId:'hq',branchCode:'00000',documentDate:'2026-09-01',documentNo:`INV-${index+1}`,payeeName:'บริษัท ทดสอบภาษาไทย จำกัด',payeeTaxId:'0105555555554',payeeBranchCode:'00054',amountBeforeVat:index===8?-2000:500,vatAmount:index===8?-140:35,totalAmount:index===8?-2140:535,note:index%8===0?'ทดสอบหมายเหตุยาวและการขึ้นบรรทัดใหม่โดยไม่ตัดข้อมูล '.repeat(3):''}));
  const report={buyer:{name:'บริษัท ทดสอบ จำกัด',taxId:'0105555555554'},period:{from:'2026-09-01',to:'2026-09-30'},establishments:[{locationId:'hq',code:'MAIN',name:'สำนักงานใหญ่',branchCode:'00000',isHeadOffice:true,address:'999/95 กรุงเทพมหานคร 10900'},{locationId:'branch',code:'BR1',name:'สาขา',branchCode:'00001',isHeadOffice:false,address:'FAKE branch'}],rows,totals:{documentCount:75,amountBeforeVat:35000,vatAmount:2450,totalAmount:37450}};
  const date=(v:string)=>formatTaxDate(v,'BE');
  let html=renderTaxReportPrint(buildInputVatReportDoc(report,date),'test');
  const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'nonce-test'; style-src 'nonce-test'"});res.end(html);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const page=await browser.newPage({viewport:{width:1200,height:850}});
    const errors:string[]=[];
    page.on('pageerror',(e:Error)=>errors.push(e.message));
    page.on('console',(m:any)=>{if(m.type()==='error')errors.push(m.text());});
    const url=`http://127.0.0.1:${(server.address() as any).port}`;
    await page.goto(url); await page.waitForSelector('body[data-ready="true"]');
    const metrics=await page.evaluate(()=>({
      rows:Array.from(document.querySelectorAll('tbody tr')).map(r=>r.firstElementChild!.textContent),
      pages:Array.from(document.querySelectorAll('.page')).map(p=>({
        number:p.querySelector('.page-number')!.textContent,base:p.querySelector('.page-base')!.textContent,vat:p.querySelector('.page-vat')!.textContent,
        grand:p.querySelector('.grand:not(.pending) .grand-base')?.textContent,
        fits:p.querySelector('table')!.getBoundingClientRect().bottom<=p.getBoundingClientRect().bottom,
        digits:p.querySelectorAll('.digits .digit').length,
      })),negative:document.body.textContent!.includes('-2,000.00'),supplier:document.body.textContent!.includes('ชื่อผู้ขายสินค้า/ผู้ให้บริการ'),
    }));
    assert.equal(metrics.rows.length,75); assert.deepEqual(metrics.rows,rows.map((_,i)=>String(i+1)));
    assert.ok(metrics.pages.length>2); assert.ok(metrics.pages.every((p:any)=>p.fits&&p.digits===18));
    assert.ok(metrics.negative&&metrics.supplier); assert.equal(metrics.pages.at(-1).number,'Page 1 of 1');
    assert.equal(metrics.pages.filter((p:any)=>p.grand!==undefined).length,2);
    assert.equal(metrics.pages.at(-2).grand,'35,000.00'); assert.equal(metrics.pages.at(-1).grand,'0.00');
    assert.equal(metrics.pages.reduce((sum:number,p:any)=>sum+Number(p.base.replaceAll(',','')),0),35000);
    assert.equal(metrics.pages.reduce((sum:number,p:any)=>sum+Number(p.vat.replaceAll(',','')),0),2450);
    assert.deepEqual(errors,[]);
    await page.emulateMedia({media:'print'});
    assert.ok(await page.locator('.page').evaluateAll((pages:Element[])=>pages.every(p=>p.querySelector('table')!.getBoundingClientRect().bottom<=p.getBoundingClientRect().bottom)));
    if(process.env.TAX_PRINT_SCREENSHOT) await page.locator('.page').first().screenshot({path:process.env.TAX_PRINT_SCREENSHOT});
    const allPurchase={...report,rows:[...rows,{...rows[0],locationId:'branch',branchCode:'00001',payeeBranchCode:'00000',note:''}],totals:{documentCount:76,amountBeforeVat:35500,vatAmount:2485,totalAmount:37985}};
    html=renderTaxReportPrint(buildInputVatReportDoc(allPurchase,date,{includeBuyerEstablishment:true}),'test');
    for (const width of [1200,390]) {
      await page.setViewportSize({width,height:850});
      await page.emulateMedia({media:'screen'});
      await page.goto(url); await page.waitForSelector('body[data-ready="true"]');
      assert.equal(await page.locator('tbody tr').count(),76);
      assert.equal(await page.locator('table.all-establishments').count(),await page.locator('.page').count());
      assert.ok(await page.locator('thead').evaluateAll((heads:Element[])=>heads.every(h=>h.textContent!.includes('สถานประกอบการผู้ซื้อ (ร้านเรา)')&&h.textContent!.includes('สถานประกอบการผู้ขาย'))));
      assert.deepEqual((await page.locator('tbody tr').first().locator('td').allTextContents()).slice(5,10),['00054','00000','','500.00','35.00']);
      assert.deepEqual((await page.locator('tbody tr').last().locator('td').allTextContents()).slice(5,10),['00000','','00001','500.00','35.00']);
      assert.equal(await page.locator('thead th[colspan="2"]').count(),await page.locator('.page').count()*2);
      assert.deepEqual(await page.locator('.grand:not(.pending) .grand-base').allTextContents(),['35,000.00','500.00']);
      assert.deepEqual(await page.locator('.grand:not(.pending) .grand-vat').allTextContents(),['2,450.00','35.00']);
      assert.ok((await page.locator('td[data-key="amountBeforeVat"]').allTextContents()).includes('-2,000.00'));
      assert.equal((await page.locator('.page-base').allTextContents()).reduce((sum:number,v:string)=>sum+Number(v.replaceAll(',','')),0),35500);
      await page.emulateMedia({media:'print'});
      assert.ok(await page.locator('.page').evaluateAll((pages:Element[])=>pages.every(p=>p.querySelector('table')!.getBoundingClientRect().bottom<=p.getBoundingClientRect().bottom)));
      if(process.env.TAX_PRINT_SCREENSHOT) await page.locator('.page').first().screenshot({path:process.env.TAX_PRINT_SCREENSHOT.replace(/\.png$/,`-purchase-all-${width}.png`)});
      assert.deepEqual(errors,[]);
    }
    const salesTotal={base:35000,vat:2450,exempt:0,rounding:0,total:37450,documentCount:75};
    const salesReport: Parameters<typeof buildSalesTaxReportDoc>[0] = {seller:{...report.buyer,vatRegistered:true,calendarEra:'BE'},period:report.period,establishments:report.establishments,
      rows:rows.map((r,index)=>({kind:index===8?'CREDIT_NOTE':'FULL',issueDate:r.documentDate,locationId:r.locationId,branchCode:r.branchCode,deviceCode:null,docNoFrom:r.documentNo,docNoTo:r.documentNo,docCount:1,cancelledCount:0,buyerName:r.payeeName,buyerTaxId:r.payeeTaxId,buyerBranchCode:r.payeeBranchCode,referenceDocNo:index===8?'INV-original':null,base:r.amountBeforeVat,vat:r.vatAmount,total:r.totalAmount,exempt:0,rounding:0})),
      totals:[{...salesTotal,locationId:'hq',branchCode:'00000'}],grandTotal:salesTotal,exceptions:[],cancelled:[],exceptionCounts:{PAID_WITHOUT_TAX_DOCUMENT:0,RETURN_WITHOUT_CREDIT_NOTE:0,FULL_REPLACES_OTHER_MONTH:0}};
    html=renderTaxReportPrint(buildSalesTaxReportDoc(salesReport,date),'test');
    await page.goto(url); await page.waitForSelector('body[data-ready="true"]');
    assert.equal(await page.locator('tbody tr').count(),75);
    assert.ok((await page.locator('body').textContent()).includes('ชื่อผู้ซื้อสินค้า/ผู้รับบริการ'));
    assert.ok((await page.locator('body').textContent()).includes('01/09/2569'));
    assert.deepEqual(await page.locator('.grand:not(.pending) .grand-base').allTextContents(),['35,000.00','0.00']);
    assert.ok(await page.locator('.page').evaluateAll((pages:Element[])=>pages.every(p=>p.querySelector('table')!.getBoundingClientRect().bottom<=p.getBoundingClientRect().bottom)));
    assert.deepEqual(errors,[]);
    salesReport.rows.push({...salesReport.rows[0],locationId:'branch',branchCode:'00001',buyerBranchCode:'00000'});
    salesReport.totals.push({locationId:'branch',branchCode:'00001',documentCount:1,base:500,vat:35,total:535,exempt:0,rounding:0});
    salesReport.grandTotal={...salesTotal,base:35500,vat:2485,total:37985,documentCount:76};
    html=renderTaxReportPrint(buildSalesTaxReportDoc(salesReport,date,{includeSellerEstablishment:true}),'test');
    for (const width of [1200,390]) {
      await page.setViewportSize({width,height:850});
      await page.emulateMedia({media:'screen'});
      await page.goto(url); await page.waitForSelector('body[data-ready="true"]');
      assert.equal(await page.locator('tbody tr').count(),76);
      assert.ok(await page.locator('thead').evaluateAll((heads:Element[])=>heads.every(h=>h.textContent!.includes('สถานประกอบการผู้ขาย (ร้านเรา)')&&h.textContent!.includes('สถานประกอบการผู้ซื้อ'))));
      assert.deepEqual(await page.locator('tbody tr').first().locator('td').allTextContents(),['1','01/09/2569','INV-1','บริษัท ทดสอบภาษาไทย จำกัด','0105555555554','00054','00000','','500.00','35.00','ใบกำกับภาษีเต็มรูป']);
      assert.deepEqual((await page.locator('tbody tr').last().locator('td').allTextContents()).slice(5,10),['00000','','00001','500.00','35.00']);
      assert.equal(await page.locator('thead th[colspan="2"]').count(),await page.locator('.page').count()*2);
      assert.deepEqual(await page.locator('.grand:not(.pending) .grand-base').allTextContents(),['35,000.00','500.00']);
      assert.deepEqual(await page.locator('.grand:not(.pending) .grand-vat').allTextContents(),['2,450.00','35.00']);
      assert.ok((await page.locator('td[data-key="base"]').allTextContents()).includes('-2,000.00'));
      await page.emulateMedia({media:'print'});
      assert.ok(await page.locator('.page').evaluateAll((pages:Element[])=>pages.every(p=>p.querySelector('table')!.getBoundingClientRect().bottom<=p.getBoundingClientRect().bottom)));
      if(process.env.TAX_PRINT_SCREENSHOT) await page.locator('.page').first().screenshot({path:process.env.TAX_PRINT_SCREENSHOT.replace(/\.png$/,`-sales-all-${width}.png`)});
      assert.deepEqual(errors,[]);
    }
    // Large supported NUMERIC amounts must not cross into the adjacent VAT/notes cell.
    const largeRow={...rows[0],amountBeforeVat:999999999999.99,vatAmount:69999999999.99,totalAmount:1069999999999.98,note:''};
    html=renderTaxReportPrint(buildInputVatReportDoc({...report,rows:[largeRow]},date,{includeBuyerEstablishment:true}),'test');
    await page.goto(url); await page.waitForSelector('body[data-ready="true"]');
    assert.ok(await page.locator('.money').evaluateAll((cells:HTMLElement[])=>cells.every(c=>c.scrollWidth<=c.clientWidth)), 'large monetary values must fit their own cells');
    assert.equal(await page.locator('td[data-key="amountBeforeVat"]').textContent(),'999,999,999,999.99');
    assert.equal(await page.locator('.grand:not(.pending) .grand-base').first().textContent(),'999,999,999,999.99');
    assert.ok(await page.locator('.money.compact').count()>0);
    if(process.env.TAX_PRINT_SCREENSHOT) await page.locator('.page').first().screenshot({path:process.env.TAX_PRINT_SCREENSHOT.replace(/\.png$/,'-large-amount.png')});
    html=renderTaxReportPrint(buildInputVatReportDoc({...report,rows:[{...largeRow,amountBeforeVat:-largeRow.amountBeforeVat,vatAmount:-largeRow.vatAmount}]},date,{includeBuyerEstablishment:true}),'test');
    await page.goto(url); await page.waitForSelector('body[data-ready="true"]');
    assert.equal(await page.locator('td[data-key="amountBeforeVat"]').textContent(),'-999,999,999,999.99');
    assert.ok(await page.locator('.money').evaluateAll((cells:HTMLElement[])=>cells.every(c=>c.scrollWidth<=c.clientWidth)));
    // An unsupported oversized value fails visibly rather than overlapping or truncating evidence.
    html=renderTaxReportPrint(buildInputVatReportDoc({...report,rows:[{...largeRow,amountBeforeVat:1e30}]},date,{includeBuyerEstablishment:true}),'test');
    await page.goto(url); await page.waitForSelector('body.failed');
    assert.ok((await page.locator('#status').textContent()).includes('ยอดเงินยาวเกินช่องพิมพ์'));
    assert.equal(await page.locator('#print').isDisabled(),true);
    assert.equal(await page.locator('.page').first().isVisible(),false,'Ctrl+P must also hide invalid output');
    html=renderTaxReportPrint(buildInputVatReportDoc({...report,rows:[{...rows[0],note:'ข้อความยาว '.repeat(4000)}]},v=>v),'test');
    await page.goto(url); await page.waitForSelector('body.failed');
    assert.equal(await page.locator('#print').isDisabled(),true);
  } finally {await browser.close(); await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
