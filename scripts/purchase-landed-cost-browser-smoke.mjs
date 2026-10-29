import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.BMS_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BMS_SMOKE_URL||'http://127.0.0.1:3112';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output='.test-output/purchase-landed-browser';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const lang of ['th','en'])for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
    await context.addCookies([{name:'ADMIN_COOKIE',value:'FAKE-fixture',url:base},{name:'lang',value:lang,url:base}]);
    await context.routeWebSocket('**/*',s=>s.close());
    const mutations=[],errors=[];
    const po={id:'00000000-0000-4000-8000-000000000001',status:'OPEN',total:100,landedTotal:120,note:null,
      qtyOrdered:10,qtyReceived:0,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',supplier:null,
      items:[{sku:'FAKE-BEAN',size:'BASE',supplierSku:null,supplierProductName:null,qtyOrdered:10,qtyReceived:0,
        unitCost:10,additionalUnitCost:2,landedUnitCost:12,additionalCostNote:'FAKE freight / 10 units'}]};
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.origin!==new URL(base).origin)return route.abort();
      if(!/\/api\/|\/graphql$/.test(url.pathname))return route.continue();
      let json={};
      if(url.pathname==='/api/auth/me')json={isAuthenticated:true,admin:{id:'FAKE',role:'Administrator',name:'FAKE',language:lang}};
      else if(url.pathname.endsWith('/graphql')) {
        const {query:q='',variables={}}=route.request().postDataJSON()||{};let data={};
        if(q.includes('MyBmsPermissions'))data={myBmsPermissions:['purchase.view','purchase.edit']};
        else if(q.includes('bmsCreatePurchaseOrder')) {mutations.push(variables);data={bmsCreatePurchaseOrder:{status:'CREATED',poId:po.id,message:'FAKE created'}};}
        else if(q.includes('BmsPurchaseOrders'))data={bmsPurchaseOrders:[po]};
        else if(q.includes('BmsPurchaseProducts'))data={bmsProducts:{items:[{sku:'FAKE-BEAN',name:'FAKE Bean',variants:[{size:'BASE'}]}]}};
        else if(q.includes('bmsSuppliers'))data={bmsSuppliers:[]};
        else assert.ok(!q.includes('mutation'),'unexpected mutation');
        json={data};
      }
      return route.fulfill({json});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const label=(th,en)=>lang==='th'?th:en;
    try {
      assert.equal((await page.goto(base+'/admin/purchase')).status(),200);
      await page.locator(`tr[data-row-key="${po.id}"] .ant-table-row-expand-icon`).click();
      await page.getByText('FAKE freight / 10 units',{exact:true}).waitFor();
      await page.getByRole('button',{name:new RegExp(label('สร้างใบสั่งซื้อ','Create purchase order'))}).click();
      const dialog=page.getByRole('dialog');
      await dialog.locator('#items_0_sku').click();
      await page.locator('.ant-select-item-option').filter({hasText:'FAKE Bean'}).click();
      await dialog.locator('#items_0_qty').fill('10');
      await dialog.locator('#items_0_unitCost').fill('10');
      await dialog.locator('#items_0_additionalUnitCost').fill('2');
      const create=dialog.getByRole('button',{name:label('สร้าง','Create'),exact:true});
      await create.click();
      await dialog.locator('.ant-form-item-explain-error').first().waitFor();
      assert.equal(mutations.length,0,'allocation without evidence is not submitted');
      await dialog.locator('#items_0_additionalCostNote').fill('FAKE freight 20 / 10 units');
      await dialog.locator('.ant-form-item-explain-error').waitFor({state:'hidden'});
      await dialog.screenshot({path:`${output}/${lang}-${width}.png`});
      assert.ok(await dialog.locator('.ant-modal-body').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
      await create.click();await dialog.waitFor({state:'hidden'});
      assert.equal(mutations.length,1);assert.equal(mutations[0].items[0].additionalUnitCost,2);
      assert.equal(mutations[0].items[0].additionalCostNote,'FAKE freight 20 / 10 units');
      assert.deepEqual(errors,[]);
      console.log(`PASS ${lang}/${width}: landed cost display, evidence validation, create payload, modal viewport (mocked API)`);
    }catch(e){await page.screenshot({path:`${output}/${lang}-${width}-failure.png`,fullPage:true});throw e;}
    finally{await context.close();}
  }
}finally{await browser.close();}
