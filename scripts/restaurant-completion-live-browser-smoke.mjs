// Real local UI and GraphQL. Requires a disposable tenant; no mocked responses.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.BMS_PLAYWRIGHT_MODULE||'playwright');
const f=JSON.parse(readFileSync(process.env.BMS_LIVE_COSTING_FIXTURE,'utf8'));
assert.match(f.email,/^live-costing-[a-f0-9-]+@example\.invalid$/);
const base=process.env.BMS_SMOKE_URL||'https://jachoei.com',host=new URL(base).hostname,output='.test-output/costing-completion';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:[`--host-resolver-rules=MAP ${host} 127.0.0.1`,'--no-proxy-server']});
const summary=[];
async function gql(page,query,variables={}){const r=await page.evaluate(async({query,variables})=>{const r=await fetch('/api/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables})});return {status:r.status,body:await r.json()};},{query,variables});assert.equal(r.status,200);assert.equal(r.body.errors,undefined,JSON.stringify(r.body.errors));return r.body.data;}
try {for(const width of [1280,390]){
 const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width,height:1000}});
 await context.route('**/*',route=>new URL(route.request().url()).hostname===host?route.continue():route.abort());
 await context.addCookies([{name:'lang',value:'en',url:base}]);const page=await context.newPage(),errors=[];page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
 const shot=name=>`${output}/completion-${width}-${name}.png`;
 const choose=async(select,text)=>{await select.locator('.ant-select-selector').click();const id=await select.locator('input').getAttribute('aria-controls');await page.locator('.ant-select-dropdown').filter({has:page.locator(`[id="${id}"]`)}).locator('.ant-select-item-option').filter({hasText:text}).click();};
 const close=async d=>{await d.getByRole('button',{name:'Close',exact:true}).click();await d.waitFor({state:'hidden'});};
 try{
  const res=await page.goto(`${base}/admin/login`,{waitUntil:'networkidle',timeout:120000});assert.ok(['127.0.0.1','::1','[::1]'].includes((await res.serverAddr()).ipAddress));
  assert.equal((await gql(page,'mutation($input:LoginInput!){loginAdmin(input:$input){ok}}',{input:{email:f.email,password:f.password}})).loginAdmin.ok,true);
  await gql(page,'mutation($data:MeInput!){updateMe(data:$data){id language}}',{data:{language:'en'}});
  await page.goto(`${base}/admin/reports`,{waitUntil:'networkidle',timeout:120000});await page.getByRole('button',{name:'Open report and review opening values',exact:true}).click();
  let d=page.getByRole('dialog');const net=d.locator('.ant-card').filter({has:page.getByText('Net profit by menu',{exact:true})});
  await net.getByLabel('Allocation rationale and evidence').fill(`FAKE owner approval ${width}`);await net.getByRole('button',{name:'Preview menu allocation',exact:true}).click();
  await net.getByRole('button',{name:'Confirm menu net profit',exact:true}).waitFor();await net.screenshot({path:shot('net-preview')});
  await net.getByLabel('Allocation rationale and evidence').fill(`FAKE revised approval ${width}`);assert.equal(await net.getByRole('button',{name:'Confirm menu net profit',exact:true}).count(),0);
  await net.getByRole('button',{name:'Preview menu allocation',exact:true}).click();await net.getByRole('button',{name:'Confirm menu net profit',exact:true}).click();await net.getByText('Confirmed and current',{exact:true}).waitFor();await net.screenshot({path:shot('net-confirmed')});await close(d);
  console.log('PASS',width,'confirmed net menu profit and review invalidation');
  await page.goto(`${base}/admin/stock-models?sku=FAKE-LIVE-MENU`,{waitUntil:'networkidle',timeout:120000});
  await page.locator(`tr[data-row-key="${f.recipes[0]}"] .ant-table-row-expand-icon`).click();await page.getByRole('button',{name:'Price & break-even scenarios',exact:true}).first().click();d=page.getByRole('dialog');
  await d.locator('#assumptionSource').fill('FAKE branch pricing proof');await d.locator('#dailyFixedCost').fill('0');await d.locator('#scenarios_0_label').fill('FAKE branch menu');
  await choose(d.locator('.ant-select').filter({has:page.locator('#scenarios_0_vatMode')}),'VAT included');
  await d.locator('#scenarios_0_price').fill('321');await d.locator('#scenarios_0_vatPercent').fill('7');await d.getByRole('button',{name:'Calculate preview',exact:true}).click();
  await d.getByRole('button',{name:'Publish selling price',exact:true}).first().click();let pub=page.getByRole('dialog',{name:'Publish selling price',exact:true});
  await choose(pub.locator('.ant-select').filter({has:page.locator('#locationId')}),'FAKE Live Branch A');
  await pub.getByRole('button',{name:'Review before confirmation',exact:true}).click();await pub.getByRole('button',{name:'Confirm and publish this price',exact:true}).waitFor();await pub.screenshot({path:shot('branch-price-review')});
  await pub.getByRole('button',{name:'Confirm and publish this price',exact:true}).click();await pub.getByText('Price published',{exact:true}).waitFor();await close(pub);await close(d);
  // Build and publish a multi-menu set through the actual form, using the two stored recipe variants.
  await page.getByRole('button',{name:'Promotion & menu planning',exact:true}).click();d=page.getByRole('dialog',{name:'Promotion & menu planning',exact:true});
  await choose(d.locator('.ant-select').filter({has:page.locator('#costSelection')}),'FAKE Live Branch A');await d.locator('#assumptionSource').fill('FAKE actual weighted bundle costs');await d.locator('#dailyFixedCost').fill('0');
  for(let i=0;i<2;i++){
   await d.getByRole('combobox',{name:'Search menu product',exact:true}).nth(i).fill('FAKE-LIVE-MENU');await page.locator('.ant-select-item-option:visible').filter({hasText:/^FAKE-LIVE-MENU ·/}).click();
   await choose(d.locator('.ant-select').filter({has:page.getByRole('combobox',{name:'Recipe version / output base unit',exact:true})}).nth(i),`FAKE-LIVE-MENU/${i===0?'BASE':'L'} ·`);
   await d.locator(`#items_${i}_scenario_label`).fill(`FAKE dish ${i}`);await choose(d.locator('.ant-select').filter({has:page.locator(`#items_${i}_scenario_vatMode`)}),'VAT included');
   for(const [key,value]of [['price','107'],['vatPercent','7'],['expectedDailyUnits','1']])await d.locator(`#items_${i}_scenario_${key}`).fill(value);
   await d.locator(`#items_${i}_bundleQty`).fill('1');
  }
  await d.getByLabel('Also simulate a promotion bundle').check();await d.locator('#bundleScenario_label').fill('FAKE mixed set');
  await choose(d.locator('.ant-select').filter({has:page.locator('#bundleScenario_vatMode')}),'VAT included');await d.locator('#bundleScenario_price').fill('160.50');await d.locator('#bundleScenario_vatPercent').fill('7');
  await d.getByRole('button',{name:'Calculate preview',exact:true}).click();await d.getByRole('button',{name:'Publish menu bundle',exact:true}).click();pub=page.getByRole('dialog',{name:'Publish menu bundle',exact:true});
  const sku=`FAKE-WEB-SET-${width}${process.env.BMS_SMOKE_RUN_SUFFIX?`-${process.env.BMS_SMOKE_RUN_SUFFIX}`:''}`;await pub.getByLabel('New bundle SKU').fill(sku);await pub.getByLabel('Bundle name',{exact:true}).fill(`FAKE Web Set ${width}`);await pub.getByLabel('Bundle kitchen station').fill('FAKE Web Kitchen');
  await pub.getByRole('button',{name:'Preview bundle publication',exact:true}).click();await pub.getByRole('button',{name:'Confirm and publish bundle',exact:true}).waitFor();
  await pub.getByText('FAKE-LIVE-RICE',{exact:true}).waitFor();await pub.screenshot({path:shot('bundle-review')});
  await pub.getByRole('button',{name:'Confirm and publish bundle',exact:true}).click();await pub.getByText(`Bundle published: ${sku}`,{exact:true}).waitFor();await pub.screenshot({path:shot('bundle-published')});await close(pub);await close(d);
  console.log('PASS',width,'branch price and mixed-menu publication');
  await page.goto(`${base}/admin/promotions`,{waitUntil:'networkidle',timeout:120000});await page.locator('body').waitFor();await page.screenshot({path:shot('promotions')});
  await page.goto(`${base}/admin/manual`,{waitUntil:'networkidle',timeout:120000});await page.getByText(/Menu net profit: in the actual costs report/).waitFor();await page.screenshot({path:shot('manual')});
  assert.equal(await page.getByText(/restaurant_completion\./).count(),0);assert.deepEqual(errors,[]);summary.push({width,status:'PASS',mocked:false,checks:['confirmed menu net profit','review invalidation','branch base publication','weighted mixed-menu bundle preview and activation','promotions and manual']});
 }catch(e){await page.screenshot({path:shot('failure'),fullPage:true});await writeFile(`${output}/completion-${width}-failure.txt`,`${e.stack}\n${await page.locator('body').innerText()}`);throw e;}finally{await context.close();}
}}finally{await writeFile(`${output}/completion-browser-summary.json`,JSON.stringify(summary,null,2));await browser.close();}
