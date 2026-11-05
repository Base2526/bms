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
    const mutations=[],receipts=[],errors=[];
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
        if(q.includes('MyBmsPermissions'))data={myBmsPermissions:['purchase.view','purchase.edit','purchase.receive']};
        else if(q.includes('bmsCreatePurchaseOrder')) {mutations.push(variables);data={bmsCreatePurchaseOrder:{status:'CREATED',poId:po.id,message:'FAKE created'}};}
        else if(q.includes('bmsReceivePurchaseOrder')) {
          receipts.push(variables);
          if(variables.items[0].lotNo==='FAKE-LOST') {
            if(receipts.length===4) { po.status='RECEIVED';po.qtyReceived=10;po.items[0].qtyReceived=10;return route.abort('failed'); }
            return route.fulfill({json:{data:{bmsReceivePurchaseOrder:{status:'RECEIVED',poId:po.id,replayed:true}}}});
          }
          data={bmsReceivePurchaseOrder:variables.items[0].lotNo==='FAKE-OVER'
            ? {status:'OVER_RECEIVE',poId:po.id,message:'รับเกินจำนวนที่สั่ง',sku:'FAKE-BEAN',size:'BASE'}
            : variables.items[0].lotNo
              ? {status:'PARTIAL',poId:po.id,message:'FAKE received'}
              : {status:'INVALID_INPUT',poId:po.id,message:'FAKE-BEAN/BASE: ต้องระบุเลขล็อตก่อนรับสินค้า',reasonCode:'LOT_REQUIRED',sku:'FAKE-BEAN',size:'BASE'}};
        }
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
      await page.locator(`tr[data-row-key="${po.id}"]`).getByRole('button',{name:new RegExp(label('รับของ','Receive'))}).click();
      await dialog.locator('#FAKE-BEAN__BASE').fill('2');
      await dialog.locator('#lots_0_lotNo').fill('LOT-2026-A');
      await dialog.locator('#lots_0_expiryDate').fill('2027-01-01');
      await dialog.screenshot({path:`${output}/receipt-${lang}-${width}.png`,animations:'disabled'});
      await page.screenshot({path:`${output}/receipt-page-${lang}-${width}.png`,animations:'disabled'});
      const bounds=await dialog.boundingBox();
      assert.ok(bounds && bounds.x>=-1 && bounds.x+bounds.width<=width+1,`receipt modal outside viewport: ${JSON.stringify(bounds)}`);
      assert.ok(await dialog.locator('.ant-modal-body').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
      await dialog.locator('.ant-modal-footer button.ant-btn-primary').click();
      await dialog.waitFor({state:'hidden'});
      assert.ok(receipts[0].idempotencyKey);
      assert.deepEqual(receipts.map(({idempotencyKey,...receipt})=>receipt),[{id:po.id,items:[{sku:'FAKE-BEAN',size:'BASE',qty:2,lotNo:'LOT-2026-A',expiryDate:'2027-01-01'}]}]);
      // Closing a receipt must not carry a previous lot into the next receipt.
      await page.locator(`tr[data-row-key="${po.id}"]`).getByRole('button',{name:new RegExp(label('รับของ','Receive'))}).click();
      assert.equal(await dialog.locator('#lots_0_lotNo').inputValue(),'');
      assert.equal(await dialog.locator('#lots_0_expiryDate').inputValue(),'');
      await dialog.locator('#FAKE-BEAN__BASE').fill('1');
      await dialog.locator('.ant-modal-footer button.ant-btn-primary').click();
      await page.locator('.ant-message-notice').getByText(label('กรอกเลขล็อตก่อนรับสินค้ารายการนี้','Enter the lot number before receiving this item.'),{exact:false}).waitFor();
      assert.equal(receipts.length,2);
      assert.equal(await dialog.isVisible(),true,'invalid receipt keeps the form open');
      await dialog.locator('#lots_0_lotNo').fill('FAKE-OVER');
      await dialog.locator('.ant-modal-footer button.ant-btn-primary').click();
      await page.locator('.ant-message-notice').getByText(label('จำนวนรับมากกว่าที่ค้าง','Received quantity exceeds what is outstanding'),{exact:false}).waitFor();
      assert.equal(receipts.length,3);
      await dialog.locator('#lots_0_lotNo').fill('FAKE-LOST');
      await dialog.locator('.ant-modal-footer button.ant-btn-primary').click();
      await dialog.getByText(label('ยังยืนยันผลรับสินค้าไม่ได้','Receipt outcome is not confirmed'),{exact:false}).waitFor();
      assert.equal(await dialog.locator('#FAKE-BEAN__BASE').isDisabled(),true);
      await page.reload();
      await dialog.getByText(label('ยังยืนยันผลรับสินค้าไม่ได้','Receipt outcome is not confirmed'),{exact:false}).waitFor();
      await dialog.locator('.ant-modal-footer button.ant-btn-primary').click();
      await dialog.waitFor({state:'hidden'});
      assert.deepEqual(receipts[4],receipts[3],'admin reload reuses the request even when PO is already complete');
      assert.equal((await page.goto(base+'/admin/manual')).status(),200);
      await page.getByText(label('ตอนรับของให้ตรวจจำนวน เลขล็อต','When receiving, review quantities'),{exact:false}).first().waitFor();
      await page.screenshot({path:`${output}/manual-${lang}-${width}.png`,fullPage:false});
      assert.deepEqual(errors,[]);
      console.log(`PASS ${lang}/${width}: landed cost, receipt status/error, lot/date payload, form reset, modal viewport and manual (mocked API)`);
    }catch(e){await page.screenshot({path:`${output}/${lang}-${width}-failure.png`,fullPage:true});throw e;}
    finally{await context.close();}
  }
}finally{await browser.close();}
