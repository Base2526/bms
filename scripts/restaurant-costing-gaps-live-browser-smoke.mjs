// Real local Docker follow-up; requires the separately provisioned disposable tenant.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.BMS_PLAYWRIGHT_MODULE||'playwright');
const f=JSON.parse(readFileSync(process.env.BMS_LIVE_COSTING_FIXTURE,'utf8'));
assert.match(f.email,/^live-costing-[a-f0-9-]+@example\.invalid$/);
const base=process.env.BMS_SMOKE_URL||'https://jachoei.com',host=new URL(base).hostname,output='.test-output/costing-gap-fixes';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:[`--host-resolver-rules=MAP ${host} 127.0.0.1`,'--no-proxy-server']});
const summary=[];
async function gql(page,query,variables={}) {
 const r=await page.evaluate(async({query,variables})=>{const r=await fetch('/api/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables})});return {status:r.status,body:await r.json()};},{query,variables});
 assert.equal(r.status,200);assert.equal(r.body.errors,undefined,JSON.stringify(r.body.errors));return r.body.data;
}
try {
 for(const width of [1280,390]) {
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width,height:1000}});
  await context.route('**/*',route=>new URL(route.request().url()).hostname===host?route.continue():route.abort());
  await context.addCookies([{name:'lang',value:'en',url:base}]);
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  const shot=name=>`${output}/gaps-${width}-${name}.png`;
  const choose=async(select,text)=>{await select.locator('.ant-select-selector').click();await page.locator('.ant-select-item-option:visible').filter({hasText:text}).click();};
  const close=async(dialog)=>{await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});};
  try {
   const res=await page.goto(`${base}/admin/login`,{waitUntil:'networkidle',timeout:120000});
   assert.ok(['127.0.0.1','::1','[::1]'].includes((await res.serverAddr()).ipAddress));
   assert.equal((await gql(page,'mutation($input:LoginInput!){loginAdmin(input:$input){ok}}',{input:{email:f.email,password:f.password}})).loginAdmin.ok,true);
   await gql(page,'mutation($data:MeInput!){updateMe(data:$data){id language}}',{data:{language:'en'}});
   await page.goto(`${base}/admin/reports`,{waitUntil:'networkidle',timeout:120000});
   await page.getByRole('button',{name:'Open report and review opening values',exact:true}).click();
   let d=page.getByRole('dialog');await d.getByText('NO_SALES',{exact:true}).first().waitFor();await d.getByText('STAR',{exact:true}).waitFor();
   await choose(d.locator('.ant-select').first(),'FAKE Live Branch A');
   await d.locator('.ant-pagination-item[title="21"]').click();
   await d.locator('tr').filter({has:page.getByText('ZZ-PAGE-1007',{exact:true})}).getByRole('button',{name:'Review opening value',exact:true}).waitFor();
   await d.screenshot({path:shot('page-21')});
   await d.getByRole('searchbox').count();
   const search=d.getByLabel('Search SKU or variant');await search.fill('ZZ-PAGE-1007');await search.press('Enter');
   await d.locator('tr').filter({has:page.getByText('ZZ-PAGE-1007',{exact:true})}).waitFor();
   assert.equal(await d.locator('tr').filter({has:page.getByText('ZZ-PAGE-1006',{exact:true})}).count(),0);
   await d.screenshot({path:shot('search')});
   const population=d.locator('.ant-select').nth(1).locator('input');await population.fill('FAKE-LIVE-SALES');await population.press('Enter');
   await d.getByText('NO_SALES',{exact:true}).first().waitFor({state:'hidden'});
   await d.getByText('STAR',{exact:true}).waitFor();await close(d);
   console.log('PASS',width,'page 21, literal search and menu population');
   await page.goto(`${base}/admin/stock-models?sku=FAKE-LIVE-MENU`,{waitUntil:'networkidle',timeout:120000});
   await page.locator(`tr[data-row-key="${f.recipes[0]}"] .ant-table-row-expand-icon`).click();
   await page.getByRole('button',{name:'Recipe cost estimate',exact:true}).first().click();d=page.getByRole('dialog');
   await choose(d.locator('.ant-select').first(),'FAKE Live Branch A');
   const ingredient=d.locator('tr').filter({hasText:'FAKE-LIVE-RICE/BASE'});
   await ingredient.getByText('฿40.00',{exact:true}).waitFor();await ingredient.getByText('Actual weighted average',{exact:true}).waitFor();
   await d.screenshot({path:shot('weighted-recipe')});
   await choose(d.locator('.ant-select').first(),'FAKE Live Branch B');await d.getByText('Incomplete — total unknown',{exact:true}).waitFor();
   await d.screenshot({path:shot('unknown-branch')});await close(d);
   await page.getByRole('button',{name:'Price & break-even scenarios',exact:true}).first().click();d=page.getByRole('dialog');
   await choose(d.locator('.ant-select').filter({has:page.locator('#costSelection')}),'FAKE Live Branch A');
   await d.locator('#assumptionSource').fill('FAKE receipt-backed live review');await d.locator('#dailyFixedCost').fill('0');
   await d.locator('#scenarios_0_label').fill('FAKE scoped offer');
   await choose(d.locator('.ant-select').filter({has:page.locator('#scenarios_0_vatMode')}),'VAT included');
   for(const [key,value] of [['price','80.25'],['vatPercent','7'],['gpPercent','0'],['extraUnitCost','0'],['expectedDailyUnits','10']])await d.locator(`#scenarios_0_${key}`).fill(value);
   await d.getByRole('button',{name:'Calculate preview',exact:true}).click();
   const results=d.getByRole('region',{name:'Scenario results'});await results.getByText('35 THB',{exact:true}).waitFor();
   await results.getByRole('button',{name:'Publish selling price',exact:true}).click();
   const pub=page.getByRole('dialog',{name:'Publish selling price',exact:true});
   await choose(pub.locator('.ant-select').filter({has:page.locator('#mode')}),'N-for-price promotion');
   await pub.locator('#quantity').fill('2');await choose(pub.locator('.ant-select').filter({has:page.locator('#locationId')}),'FAKE Live Branch A');
   await choose(pub.locator('.ant-select').filter({has:page.locator('#salesSurface')}),'RETAIL_POS');
   await pub.locator('#startsAt').fill('2099-01-01T12:00');await pub.locator('#endsAt').fill('2099-02-01T12:00');
   await pub.getByRole('button',{name:'Review before confirmation',exact:true}).click();
   await pub.getByRole('button',{name:'Confirm and publish this price',exact:true}).waitFor();
   await pub.locator('#quantity').fill('3');assert.equal(await pub.getByRole('button',{name:'Confirm and publish this price',exact:true}).count(),0);
   await pub.locator('#quantity').fill('2');await pub.getByRole('button',{name:'Review before confirmation',exact:true}).click();
   await pub.getByRole('button',{name:'Confirm and publish this price',exact:true}).waitFor();
   await pub.getByRole('button',{name:'Confirm and publish this price',exact:true}).scrollIntoViewIfNeeded();
   const bounds=await pub.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.height<=1000);
   await pub.screenshot({path:shot('scoped-review')});
   await pub.getByRole('button',{name:'Confirm and publish this price',exact:true}).click();await pub.getByText('Price published',{exact:true}).waitFor();
   await close(pub);await close(d);
   const data=await gql(page,'query {bmsProductPromotions {productSku locationId buySize salesSurface startsAt endsAt bundlePrice}}');
   const saved=data.bmsProductPromotions.find(p=>p.productSku==='FAKE-LIVE-MENU'&&p.locationId===f.locations[0]);
   assert.equal(saved.buySize,'BASE');assert.equal(saved.salesSurface,'RETAIL_POS');assert.equal(saved.bundlePrice,160.5);assert.ok(saved.startsAt.startsWith('2099-01-01'));
   await page.getByRole('button',{name:'Promotion & menu planning',exact:true}).click();
   d=page.getByRole('dialog',{name:'Promotion & menu planning',exact:true});
   await choose(d.locator('.ant-select').filter({has:page.locator('#costSelection')}),'FAKE Live Branch A');
   await d.locator('#assumptionSource').fill('FAKE receipt-backed menu population');await d.locator('#dailyFixedCost').fill('0');
   for(let i=0;i<2;i++) {
    const product=d.getByRole('combobox',{name:'Search menu product',exact:true}).nth(i);
    await product.fill('FAKE-LIVE-MENU');
    await page.locator('.ant-select-item-option:visible').filter({hasText:/^FAKE-LIVE-MENU ·/}).click();
    const version=d.getByRole('combobox',{name:'Recipe version / output base unit',exact:true}).nth(i);
    await choose(d.locator('.ant-select').filter({has:page.getByRole('combobox',{name:'Recipe version / output base unit',exact:true})}).nth(i),`FAKE-LIVE-MENU/${i===0?'BASE':'L'} ·`);
    await d.locator(`#items_${i}_scenario_label`).fill(`FAKE menu ${i}`);
    await choose(d.locator('.ant-select').filter({has:page.locator(`#items_${i}_scenario_vatMode`)}),'VAT included');
    for(const [key,value] of [['price','107'],['vatPercent','7'],['expectedDailyUnits','1']])await d.locator(`#items_${i}_scenario_${key}`).fill(value);
   }
   const menuResponse=page.waitForResponse(r=>r.url().endsWith('/api/graphql')&&r.request().postData()?.includes('query RestaurantMenuPlan'));
   await d.getByRole('button',{name:'Calculate preview',exact:true}).click();
   const menuData=(await(await menuResponse).json()).data.bmsRestaurantMenuPlan;
   assert.equal(menuData.status,'OK');assert.equal(menuData.analysis.totalContribution,100);
   assert.deepEqual(menuData.estimates.map(e=>e.totalUnitCost),[40,60]);
   const menuResults=d.getByRole('region',{name:'Menu planning results (THB)'});await menuResults.getByText('FAKE menu 1',{exact:true}).waitFor();
   await menuResults.screenshot({path:shot('weighted-menu-plan')});await close(d);
   await page.goto(`${base}/admin/promotions`,{waitUntil:'networkidle',timeout:120000});
   await page.getByText(/RETAIL_POS/).first().waitFor();await page.screenshot({path:shot('promotion-management')});
   assert.equal(await page.getByText(/restaurant_actual\./).count(),0);
   await page.goto(`${base}/pos`,{waitUntil:'domcontentloaded',timeout:120000});await page.locator('body').waitFor();await page.screenshot({path:shot('pos-route')});
   assert.deepEqual(errors,[]);summary.push({width,status:'PASS',checks:['page beyond 1000','literal search','unsold menu population','receipt-based recipe','unknown branch stays unknown','weighted price scenario','weighted menu plan','variant branch surface schedule publication','review invalidation','promotion management','POS route'],mocked:false});
   console.log('PASS',width,'weighted cost and scoped publication');
  }catch(e){await writeFile(`${output}/gaps-${width}-failure.txt`,`${e.stack}\n${await page.locator('body').innerText()}`);await page.screenshot({path:shot('failure'),timeout:15000});throw e;}finally{await context.close();}
 }
}finally{await writeFile(`${output}/gaps-browser-summary.json`,JSON.stringify(summary,null,2));await browser.close();}
