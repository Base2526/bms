import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.BMS_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BMS_SMOKE_URL||'http://127.0.0.1:3107';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output='.test-output/restaurant-actual-browser';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const lang of ['th','en'])for(const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
    await context.addCookies([{name:'ADMIN_COOKIE',value:'FAKE-fixture',url:base},{name:'lang',value:lang,url:base}]);
    await context.routeWebSocket('**/*',socket=>socket.onMessage(raw=>{const msg=JSON.parse(String(raw));if(msg.type==='connection_init')socket.send(JSON.stringify({type:'connection_ack'}));}));
    let saved=false;const mutations=[];const branch='00000000-0000-4000-8000-000000000001';
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!==new URL(base).origin)return route.abort();
      if(!/\/api\/|\/graphql$/.test(url.pathname))return route.continue();
      let json={};
      if(url.pathname==='/api/auth/me')json={isAuthenticated:true,admin:{id:'FAKE',role:'Administrator',name:'FAKE',language:lang}};
      else if(url.pathname==='/api/bms/realtime/ticket')json={ticket:'FAKE-fixture'};
      else if(url.pathname.endsWith('/graphql')) {
        const {query:q='',variables={}}=route.request().postDataJSON()||{};let data={};
        if(q.includes('MyBmsPermissions'))data={myBmsPermissions:['product.view','report.view','tax.document.view','inventory.count.apply']};
        else if(q.includes('query MenuActual'))data={bmsRestaurantMenuActual:{status:'OK',errorCode:null,complete:false,truncated:false,observedAt:'2026-10-15T00:00:00Z',totalUnits:'2',totalContribution:null,basis:'POSTED_SALES_RETURNS_EX_VAT',costBasis:'MOVING_WEIGHTED_AVERAGE',issues:['ACTUAL_INVENTORY_COST_UNKNOWN'],rows:[{sku:'FAKE-MENU',size:'BASE',units:'2',revenue:'200.00',cost:null,contribution:null,classification:'UNCLASSIFIED',popularityPercent:100}]}};
        else if(q.includes('query InventoryValues'))data={bmsInventoryValuation:{status:'OK',errorCode:null,truncated:false,rows:[{sku:'FAKE-RICE',size:'BASE',qty:'100',value:saved?'1000.000000':null,unitCost:saved?'10.000000':null,version:saved?'1':'0'}]}};
        else if(q.includes('mutation InventoryOpening')) {
          mutations.push(variables.input);assert.equal(variables.input.confirmed,true);assert.equal(variables.input.qty,'100');assert.equal(variables.input.version,'0');assert.equal(variables.input.locationId,branch);assert.equal(variables.input.tenantId,undefined);
          saved=true;data={bmsConfirmInventoryValue:{status:'SAVED',errorCode:null}};
        } else if(q.includes('bmsLocations'))data={bmsLocations:[{id:branch,name:'FAKE Branch'}]};
        else if(q.includes('bmsSalesSummary'))data={bmsSalesSummary:null,bmsInventorySummary:null,bmsTopSellingProducts:[],bmsManagementReport:null};
        else if(q.includes('bmsGeneratedReports'))data={bmsGeneratedReports:[]};
        else if(q.includes('bmsActingTenant'))data={bmsActingTenant:null};
        else assert.ok(!q.includes('mutation'),'unexpected mutation');
        json={data};
      }
      return route.fulfill({json});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
    const label=(th,en)=>lang==='th'?th:en;
    try {
      assert.equal((await page.goto(`${base}/admin/reports`,{waitUntil:'domcontentloaded',timeout:120000})).status(),200);
      await page.getByRole('button',{name:label('เปิดรายงานและตรวจยอดตั้งต้น','Open report and review opening values'),exact:true}).click();
      const dialog=page.getByRole('dialog');await dialog.getByText('UNCLASSIFIED',{exact:true}).waitFor();
      await dialog.locator('.ant-select-selector').first().click();await page.getByText('FAKE Branch',{exact:true}).last().click();
      await dialog.getByRole('button',{name:label('ตรวจยอดตั้งต้น','Review opening value'),exact:true}).click();
      const opening=page.getByRole('dialog').last();await opening.locator('#value').fill('1000');await opening.locator('#evidence').fill('FAKE opening invoice evidence');
      await opening.getByRole('button',{name:label('ตรวจสอบก่อนยืนยัน','Review before confirmation'),exact:true}).click();
      assert.equal(mutations.length,0);
      await opening.locator('#value').fill('1001');assert.equal(await opening.getByRole('button',{name:label('ยืนยันมูลค่าตั้งต้นตามหลักฐาน','Confirm evidence-backed opening value'),exact:true}).count(),0);
      await opening.locator('#value').fill('1000');await opening.getByRole('button',{name:label('ตรวจสอบก่อนยืนยัน','Review before confirmation'),exact:true}).click();
      await opening.screenshot({path:`${output}/${lang}-${width}-opening.png`,animations:'disabled'});
      await opening.getByRole('button',{name:label('ยืนยันมูลค่าตั้งต้นตามหลักฐาน','Confirm evidence-backed opening value'),exact:true}).click();
      await page.getByText('฿1000.000000',{exact:true}).waitFor();assert.equal(mutations.length,1);
      await page.getByRole('dialog',{name:label('ตรวจยอดตั้งต้น','Review opening value'),exact:true}).waitFor({state:'hidden'});
      const worksheet=page.getByRole('dialog'),bounds=await worksheet.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
      assert.ok(await worksheet.locator('.ant-modal-body').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'worksheet fits viewport');
      await worksheet.screenshot({path:`${output}/${lang}-${width}-result.png`,animations:'disabled'});
      assert.equal(await page.getByText(/restaurant_actual\./).count(),0);assert.deepEqual(errors,[]);
      console.log(`PASS ${lang}/${width}: actual menu gaps, opening review/confirmation, invalidation and viewport; mocked API`);
    }catch(e){await page.screenshot({path:`${output}/${lang}-${width}-failure.png`,fullPage:true});throw e;}finally{await context.close();}
  }
} finally {await browser.close();}
