// Real local Docker UI/API smoke. Requires an explicitly provisioned disposable tenant fixture.
// No mocked responses; DNS is pinned to loopback for the configured local HTTPS hostname.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.BMS_PLAYWRIGHT_MODULE||'playwright');
assert.ok(process.env.BMS_LIVE_COSTING_FIXTURE,'Provide the isolated fixture JSON; never an existing shop account');
const f=JSON.parse(readFileSync(process.env.BMS_LIVE_COSTING_FIXTURE,'utf8'));
assert.match(f.email,/^live-costing-[a-f0-9-]+@example\.invalid$/);
const base=process.env.BMS_SMOKE_URL||'https://jachoei.com';
const host=new URL(base).hostname;assert.equal(new URL(base).protocol,'https:');
const output='.test-output/local-main-costing';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:[`--host-resolver-rules=MAP ${host} 127.0.0.1`,'--no-proxy-server']});
const summary=[];
const gql=async(page,query,variables={})=>{
 const r=await page.evaluate(async({query,variables})=>{const res=await fetch('/api/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables})});return {status:res.status,body:await res.json()};},{query,variables});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.errors,undefined,JSON.stringify(r.body.errors));return r.body.data;
};
const contextOptions={ignoreHTTPSErrors:true,serviceWorkers:'block'};
try{
 const loginContext=await browser.newContext(contextOptions),login=await loginContext.newPage();
 const initial=await login.goto(`${base}/admin/login?next=/admin/reports`,{waitUntil:'networkidle',timeout:120000});
 assert.ok(['127.0.0.1','::1','[::1]'].includes((await initial.serverAddr()).ipAddress),'Browser must connect to local Docker');
 await login.locator('#identifier').fill(f.email);await login.locator('#password').fill(f.password);
 const [response]=await Promise.all([login.waitForResponse(r=>r.url().endsWith('/api/graphql')&&r.request().postData()?.includes('loginAdmin')),login.locator('button[type=submit]').click()]);
 assert.equal((await response.json()).data.loginAdmin.ok,true);
 await login.waitForURL('**/admin/reports',{timeout:120000});
 const auth=await loginContext.storageState();await loginContext.close();summary.push({case:'Real password login through local Caddy',status:'PASS'});
 let index=0;
 for(const lang of ['th','en'])for(const width of [1280,390]){
  const context=await browser.newContext({...contextOptions,storageState:auth,viewport:{width,height:1000}});
  // Only block unrelated external content; all application APIs and sockets are real.
  await context.route('**/*',route=>new URL(route.request().url()).hostname===host?route.continue():route.abort());
  const page=await context.newPage(),errors=[],apiErrors=[];page.setDefaultTimeout(45000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async response=>{if(response.url().endsWith('/api/graphql'))try{const body=await response.json();if(body.errors)apiErrors.push(...body.errors.map(e=>e.message));}catch{}});
  const label=(th,en)=>lang==='th'?th:en,shot=name=>`${output}/${lang}-${width}-${name}.png`;
  try{
   await page.goto(`${base}/admin/reports`,{waitUntil:'domcontentloaded',timeout:120000});
   await gql(page,'mutation LiveLanguage($data:MeInput!){updateMe(data:$data){id language}}',{data:{language:lang}});
   await context.addCookies([{name:'lang',value:lang,url:base}]);await page.reload({waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:label('เปิดรายงานและตรวจยอดตั้งต้น','Open report and review opening values'),exact:true}).click();
   let dialog=page.getByRole('dialog');await dialog.getByText('STAR',{exact:true}).waitFor();
   const sales=dialog.locator('tr').filter({has:page.getByText('FAKE-LIVE-SALES',{exact:true})});
   await sales.getByText('฿200.00',{exact:true}).waitFor();await sales.getByText('฿40.00',{exact:true}).waitFor();await sales.getByText('฿160.00',{exact:true}).waitFor();
   await dialog.locator('.ant-select-selector').first().click();await page.locator('.ant-select-item-option:visible').filter({hasText:'FAKE Live Branch A'}).click();
   const sku=`FAKE-LIVE-OPEN-${index}`;
   const stock=dialog.locator('tr').filter({has:page.getByText(sku,{exact:true})});
   await stock.getByRole('button',{name:label('ตรวจยอดตั้งต้น','Review opening value'),exact:true}).click();
   const opening=page.getByRole('dialog').last();
   await opening.locator('#value').fill('1000');await opening.locator('#evidence').fill('FAKE local UI opening inventory evidence');
   await opening.getByRole('button',{name:label('ตรวจสอบก่อนยืนยัน','Review before confirmation'),exact:true}).click();
   await opening.locator('#value').fill('1001');assert.equal(await opening.getByRole('button',{name:label('ยืนยันมูลค่าตั้งต้นตามหลักฐาน','Confirm evidence-backed opening value'),exact:true}).count(),0);
   await opening.locator('#value').fill('1000');await opening.getByRole('button',{name:label('ตรวจสอบก่อนยืนยัน','Review before confirmation'),exact:true}).click();
   await opening.screenshot({path:shot('opening-review'),animations:'disabled'});
   await opening.getByRole('button',{name:label('ยืนยันมูลค่าตั้งต้นตามหลักฐาน','Confirm evidence-backed opening value'),exact:true}).click();
   await stock.getByText('฿1000.000000',{exact:true}).waitFor();await stock.getByText('฿10.000000',{exact:true}).waitFor();
   await page.getByRole('dialog',{name:label('ตรวจยอดตั้งต้น','Review opening value'),exact:true}).waitFor({state:'hidden'});
   const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
   assert.ok(await dialog.locator('.ant-modal-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
   await dialog.screenshot({path:shot('actual-costs'),animations:'disabled'});
   await dialog.locator('.ant-select-selector').first().click();await page.locator('.ant-select-item-option:visible').filter({hasText:'FAKE Live Branch B'}).click();
   await dialog.locator('tr').filter({has:page.getByText(sku,{exact:true})}).getByRole('button',{name:label('ตรวจยอดตั้งต้น','Review opening value'),exact:true}).waitFor();
   assert.equal(await dialog.getByText('STAR',{exact:true}).count(),0,'Other branch has no sales');
   await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
   await page.getByRole('button',{name:label('เปิดกำไรสุทธิจากหลักฐาน','Open recorded net profit'),exact:true}).click();
   dialog=page.getByRole('dialog');await dialog.locator('[data-profit-field=netCost]').getByText('฿40.00',{exact:true}).waitFor();
   await dialog.locator('[data-profit-field=netProfit]').getByText('฿160.00',{exact:true}).waitFor();
   await dialog.screenshot({path:shot('net-profit'),animations:'disabled'});await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
   for(const [th,en,op] of [['เปิดกระทบยอดต้นทุน','Open cost reconciliation','OperatingCosts'],['เปิดปันส่วนค่าใช้จ่าย','Open expense allocation','CostAllocations']]){
    const response=page.waitForResponse(r=>r.url().endsWith('/api/graphql')&&r.request().postData()?.includes(`query ${op}`));
    await page.getByRole('button',{name:label(th,en),exact:true}).click();const data=(await(await response).json()).data;assert.ok(data,`Real ${op} response`);
    dialog=page.getByRole('dialog');await dialog.locator('.ant-table').first().waitFor();await dialog.screenshot({path:shot(op),animations:'disabled'});
    await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
   }
   console.log('PASS',lang,width,'reports and opening confirmation');
   await page.goto(`${base}/admin/stock-models?sku=FAKE-LIVE-MENU`,{waitUntil:'domcontentloaded',timeout:120000});
   await page.locator(`tr[data-row-key="${f.recipes[0]}"] .ant-table-row-expand-icon`).click();
   await page.getByText('FAKE weigh ingredients',{exact:true}).waitFor();await page.getByText('FAKE cook and plate',{exact:true}).waitFor();
   await page.getByRole('button',{name:label('ต้นทุนประมาณการสูตร','Recipe cost estimate'),exact:true}).click();
   dialog=page.getByRole('dialog');await dialog.getByText(/฿20.00/).first().waitFor();await dialog.screenshot({path:shot('recipe-cost'),animations:'disabled'});await dialog.getByRole('button',{name:'Close',exact:true}).click();
   await page.getByRole('button',{name:label('จำลองราคาและจุดคุ้มทุน','Price & break-even scenarios'),exact:true}).click();
   dialog=page.getByRole('dialog');await dialog.locator('#assumptionSource').fill('FAKE local UI dated assumptions');
   await dialog.locator('#dailyFixedCost').fill('1000');await dialog.locator('#dailyTargetProfit').fill('200');
   await dialog.locator('#scenarios_0_label').fill('FAKE Live');
   await dialog.locator('.ant-select').filter({has:page.locator('#scenarios_0_vatMode')}).locator('.ant-select-selector').click();await page.locator('.ant-select-item-option:visible').filter({hasText:label('ราคารวม VAT','VAT included')}).click();
   for(const [name,value] of [['price','107'],['vatPercent','7'],['gpPercent','30'],['extraUnitCost','5'],['expectedDailyUnits','60'],['targetMarginPercent','20']])await dialog.locator(`#scenarios_0_${name}`).fill(value);
   await dialog.getByRole('button',{name:label('คำนวณตัวอย่าง','Calculate preview'),exact:true}).click();
   const results=dialog.getByRole('region',{name:label('ผลจำลองสถานการณ์','Scenario results')});await results.getByText('FAKE Live',{exact:true}).waitFor();
   await results.getByText('45 THB',{exact:true}).waitFor(); // 100 ex-VAT - 30 GP - 20 ingredient cost - 5 extra.
   await results.screenshot({path:shot('price-plan'),animations:'disabled'});
   await results.getByRole('button',{name:label('นำราคาไปใช้ขาย','Publish selling price'),exact:true}).click();
   const publication=page.getByRole('dialog',{name:label('นำราคาไปใช้ขาย','Publish selling price'),exact:true});await publication.waitFor();
   const mode=index===1?'PACK':index===2?'PROMOTION':'BASE';
   if(mode!=='BASE'){
    await publication.locator('.ant-select').filter({has:page.locator('#mode')}).locator('.ant-select-selector').click();await page.locator('.ant-select-item-option:visible').filter({hasText:mode==='PACK'?label('ราคายกชุด (เมนูเดียวกัน)','Pack price (same menu)'):label('โปร N หน่วยในราคารวม','N-for-price promotion')}).click();
    await publication.locator('#quantity').fill('2');if(mode==='PACK')await publication.locator('#packCode').fill('LIVE2');
   }
   await publication.getByRole('button',{name:label('ตรวจสอบก่อนยืนยัน','Review before confirmation'),exact:true}).click();
   await publication.getByRole('button',{name:label('ยืนยันเปิดใช้ราคาขายนี้','Confirm and publish this price'),exact:true}).waitFor();
   await publication.screenshot({path:shot('publish-review'),animations:'disabled'});
   await publication.getByRole('button',{name:label('ยืนยันเปิดใช้ราคาขายนี้','Confirm and publish this price'),exact:true}).click();
   await publication.getByText(label('เปิดใช้ราคาแล้ว','Price published'),{exact:true}).waitFor();await publication.screenshot({path:shot('published'),animations:'disabled'});
   assert.equal(await page.getByText(/restaurant_actual\./).count(),0);assert.deepEqual(errors,[]);assert.deepEqual(apiErrors,[]);
   summary.push({case:`${lang}/${width}: real menu sales/costs, branch isolation, opening confirmation, SOP/BOM cost, VAT/GP/break-even, ${mode} publication`,status:'PASS'});console.log('PASS',summary.at(-1).case);index++;
  }catch(e){await page.screenshot({path:shot('failure'),fullPage:true});await writeFile(`${output}/failure.txt`,`${e.stack}\nPAGE ERRORS ${JSON.stringify(errors)}\nAPI ERRORS ${JSON.stringify(apiErrors)}\n${await page.locator('body').innerText()}`);throw e;}finally{await context.close();}
 }
}finally{await writeFile(`${output}/browser-summary.json`,JSON.stringify(summary,null,2));await browser.close();}
