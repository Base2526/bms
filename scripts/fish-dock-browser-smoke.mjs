// Local compiled page with intercepted, synthetic auth/data. No DB or customer calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { firefox,chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base=process.env.BMS_SMOKE_URL || "http://127.0.0.1:3018";
assert.ok(["localhost","127.0.0.1"].includes(new URL(base).hostname),"Local fixture only");
const output=".test-output/fish-dock-browser";
const fixtureIntakeId="00000000-0000-4000-8000-000000000099";
await mkdir(output,{recursive:true});
const browserType=process.env.BMS_BROWSER==="chromium"?chromium:firefox;
const browser=await browserType.launch({headless:true,...(browserType===chromium?{channel:"chrome"}:
  process.env.BMS_FIREFOX_EXECUTABLE?{executablePath:process.env.BMS_FIREFOX_EXECUTABLE}:{})});
try {
  for (const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:width===1280?1200:900},serviceWorkers:"block"});
    let previewRequest=null;
    const lateAdjustments=[];
    let lateMode="normal";
    let fixtureLang="th";
    context.setDefaultTimeout(20000);
    await context.addCookies([
      {name:"ADMIN_COOKIE",value:"FAKE-fish-ui",url:base},
      {name:"lang",value:"th",url:base},
    ]);
    await context.routeWebSocket("**/*",socket=>socket.onMessage(raw=>{
      if (JSON.parse(String(raw)).type==="connection_init") socket.send(JSON.stringify({type:"connection_ack"}));
    }));
    await context.route("**/*",route=>{
      const req=route.request(),url=new URL(req.url());
      const isApi=/\/api\/|\/graphql$/.test(url.pathname);
      // The compiled app may use its configured absolute GraphQL URL. Fulfill
      // that request with fixture data too; never let it reach the remote host.
      if (url.origin!==new URL(base).origin && !isApi) return route.abort();
      if (!isApi) return route.continue();
      if (url.pathname==="/api/auth/me") return route.fulfill({json:{isAuthenticated:true,admin:{id:"FAKE",role:"Administrator",name:"FAKE fish tester",language:fixtureLang}}});
      if (url.pathname==="/api/bms/realtime/ticket") return route.fulfill({json:{ticket:"FAKE-local-ticket"}});
      if (url.pathname.endsWith("/graphql")) {
        const q=req.postDataJSON()?.query??"";
        return route.fulfill({json:{data:q.includes("MyBmsPermissions")?{myBmsPermissions:["purchase.view","purchase.edit","purchase.receive","inventory.count","inventory.count.apply","report.view"]}:{}}});
      }
      if (url.pathname==="/api/bms/fish-intake/options") return route.fulfill({json:{
        locations:[{id:"00000000-0000-4000-8000-000000000001",name:"FAKE branch"}],
        products:[{sku:"FAKE-READY",name:"ปลาพร้อมรับ",size:"L",expiry_tracking:false}],
        unreadyProducts:[{sku:"FAKE-UNREADY",name:"ปลาไม่มีล็อต",reasons:["NOT_WEIGHTED","NOT_GRAM","LOT_DISABLED"]}],
        currency:"THB",
      }});
      if (url.pathname==="/api/bms/fish-intake" && req.method()==="GET") return route.fulfill({json:{items:[{
        id:fixtureIntakeId,kind:"LIVE",createdAt:"2026-11-16T13:40:18.000Z",lineCount:2,
        receivedGrams:105000,purchaseAmount:"4170.25",sourceName:null,
      }]}});
      if (url.pathname===`/api/bms/fish-intake/${fixtureIntakeId}`) return route.fulfill({json:{
        id:fixtureIntakeId,kind:"LIVE",locationName:"FAKE branch",sourceName:null,sourceSheet:null,
        sourceYear:null,note:null,createdAt:"2026-11-16T13:40:18.000Z",adjustments:lateAdjustments,lines:[
          {lineNo:1,sourceRow:null,billDate:"2026-11-16",receivedDate:"2026-11-16",
            supplierName:"FAKE supplier",vesselRegistration:null,fishName:"FAKE fish",billSize:null,
            actualSize:"L",sku:"FAKE-READY",size:"L",billGrams:98000,receivedGrams:98000,
            unitPricePerKg:"39.75",purchaseAmount:"3895.50",extraAmount:"0.00",quality:null,
            note:null,lotNo:"FAKE-LOT-1",expiryDate:null},
          {lineNo:2,sourceRow:null,billDate:"2026-11-16",receivedDate:"2026-11-16",
            supplierName:"FAKE supplier",vesselRegistration:null,fishName:"FAKE fish",billSize:null,
            actualSize:"L",sku:"FAKE-READY",size:"L",billGrams:7000,receivedGrams:7000,
            unitPricePerKg:"39.25",purchaseAmount:"274.75",extraAmount:"0.00",quality:null,
            note:null,lotNo:"FAKE-LOT-2",expiryDate:null},
        ],
      }});
      if (url.pathname===`/api/bms/fish-intake/${fixtureIntakeId}/late-cost` && req.method()==="POST") {
        const body=req.postDataJSON();
        if (lateMode==="denied") return route.fulfill({status:403,json:{error:"forbidden"}});
        if (!body.input.reason.trim()) return route.fulfill({status:400,json:{code:"INVALID_REASON",error:"ระบุเหตุผล"}});
        if (body.action==="preview") return route.fulfill({json:{status:"PREVIEW",previewHash:"FAKE-cost-preview",
          lineNo:body.input.lineNo,originalExtraAmount:"0.00",priorAdjustments:"0.00",currentExtraCost:"0.00",
          addedAmount:body.input.amount,newExtraCost:body.input.amount,valuationBefore:"4170.250000",
          valuationAfter:"4182.590000",stockQty:105000}});
        assert.equal(body.confirmed,true);
        assert.equal(body.previewHash,"FAKE-cost-preview");
        if (lateMode==="conflict") return route.fulfill({status:409,json:{code:"IDEMPOTENCY_CONFLICT",error:"conflict"}});
        if (lateMode==="replay") return route.fulfill({json:{status:"REPLAYED",adjustmentId:"FAKE-adjustment"}});
        lateAdjustments.push({id:"FAKE-adjustment",lineNo:body.input.lineNo,category:body.input.category,
          amount:body.input.amount,reason:body.input.reason,reference:body.input.reference,
          actorId:"FAKE",actorName:"FAKE fish tester",createdAt:"2026-11-20T13:00:00.000Z"});
        return route.fulfill({status:201,json:{status:"SAVED",adjustmentId:"FAKE-adjustment"}});
      }
      if (url.pathname==="/api/bms/fish-intake" && req.method()==="POST") {
        previewRequest=req.postDataJSON();
        return route.fulfill({json:{previewHash:"FAKE-preview",totals:{lineCount:1,billGrams:98000,
          receivedGrams:98000,purchaseAmount:"3895.50",extraAmount:"0.00"}}});
      }
      return route.fulfill({json:{}});
    });
    const page=await context.newPage();
    await page.goto(`${base}/admin/fish-intake`,{waitUntil:"domcontentloaded"});
    await page.getByRole("tab",{name:"รับปลาใหม่"}).click();
    await page.getByText("ปลาไม่มีล็อต").first().waitFor();
    await page.getByText("43.17 บาท/กก.",{exact:false}).first().waitFor();
    await page.locator(".ant-select-selector").nth(2).click();
    await page.getByText("ปลาพร้อมรับ").first().waitFor();
    await page.getByText("ปลาพร้อมรับ · L (FAKE-READY)").click();
    await page.getByLabel("วันที่รับปลา").fill("2025-09-01");
    await page.getByLabel("วันที่บิล").fill("2025-09-01");
    await page.getByLabel("แพ/ผู้ขาย").fill("FAKE supplier");
    await page.getByLabel("น้ำหนักตามบิล (กก.)").fill("98.0000");
    await page.getByLabel("น้ำหนักรับจริง (กก.)").fill("98");
    await page.getByLabel("ราคาตามบิล (บาท/กก.)").fill("39.75");
    await page.getByLabel("ยอดค่าปลาตามบิล (บาท)").fill("3895.5");
    await page.getByRole("button",{name:"ตรวจยอดก่อนบันทึก"}).click();
    await page.getByText("กรอกน้ำหนักเป็นกิโลกรัม ทศนิยมไม่เกิน 3 ตำแหน่ง").waitFor();
    assert.equal(previewRequest,null,"invalid weight must remain on the form");
    await page.getByLabel("น้ำหนักตามบิล (กก.)").fill(" 98 ");
    await page.getByRole("button",{name:"ตรวจยอดก่อนบันทึก"}).click();
    await page.getByText("ยอดที่ตรวจแล้ว").waitFor();
    await page.getByText("กรอกน้ำหนักเป็นกิโลกรัม ทศนิยมไม่เกิน 3 ตำแหน่ง").waitFor({state:"hidden"});
    assert.equal(previewRequest.input.lines[0].billKg,"98");
    assert.equal(previewRequest.input.lines[0].receivedKg,"98");
    assert.equal(await page.getByText("ยังไม่มีปลาที่ตั้งค่าเป็นสินค้าชั่งน้ำหนักพร้อมติดตามล็อต").count(),0);
    await page.screenshot({path:`${output}/${browserType.name()}-${width}.png`,fullPage:true});
    await page.addStyleTag({content:".ant-message{display:none!important}"});
    if (width===1280) await page.locator(".ant-card").filter({hasText:"รายการล่าสุด"}).last()
      .screenshot({path:`${output}/mockup-recent-desktop.png`});
    await page.getByRole("button",{name:"ดูรายการ / ล็อต"}).click();
    await page.getByText("FAKE-LOT-1").waitFor();
    await page.getByText("FAKE-LOT-2").waitFor();
    const dialog=page.getByRole("dialog");
    await page.waitForFunction(()=>{
      const modal=document.querySelector('[role="dialog"]');
      return modal && getComputedStyle(modal).opacity==="1";
    });
    const bounds=await dialog.boundingBox();
    assert.ok(bounds && bounds.x>=0 && bounds.x+bounds.width<=width &&
      bounds.y>=0 && bounds.y<900,"receipt detail must fit the viewport");
    if (width<500) await page.screenshot({path:`${output}/mockup-detail-mobile-first.png`});
    if (width<500) await page.getByText("FAKE-LOT-2").scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/${browserType.name()}-${width}-detail.png`});
    await page.screenshot({path:`${output}/mockup-detail-${width===1280?"desktop":"mobile-second"}.png`});
    await dialog.getByRole("button",{name:"เพิ่มค่าใช้จ่ายที่ลืมลง"}).click();
    await dialog.getByPlaceholder("จำนวนเงินเพิ่ม (บาท)").fill("12.34");
    await dialog.getByRole("button",{name:"ตรวจยอดก่อนยืนยัน"}).click();
    await dialog.getByText("ระบุเหตุผล").waitFor();
    await dialog.getByPlaceholder("เหตุผลที่เพิ่มค่าใช้จ่าย (บังคับ)").fill("FAKE transport receipt");
    await dialog.getByPlaceholder("เลขที่ใบเสร็จหรือหลักฐานอ้างอิง (ถ้ามี)").fill("FAKE-RC-1");
    await dialog.getByRole("button",{name:"ตรวจยอดก่อนยืนยัน"}).click();
    await dialog.getByText("ผลตรวจยอดก่อนยืนยัน").waitFor();
    await page.screenshot({path:`${output}/${browserType.name()}-${width}-late-cost-preview.png`});
    await dialog.getByRole("button",{name:"ยืนยันเพิ่มค่าใช้จ่าย"}).click();
    await page.getByRole("button",{name:"ยืนยัน",exact:true}).last().click();
    await dialog.getByText("เพิ่มต้นทุนสำเร็จ").waitFor();
    await page.locator(".ant-modal-confirm-title").waitFor({state:"hidden"});
    await dialog.getByText("FAKE transport receipt").waitFor();
    await page.screenshot({path:`${output}/${browserType.name()}-${width}-late-cost-history.png`});
    await dialog.getByRole("button",{name:"เพิ่มค่าใช้จ่ายที่ลืมลง"}).click();
    await dialog.getByPlaceholder("จำนวนเงินเพิ่ม (บาท)").fill("5.00");
    await dialog.getByPlaceholder("เหตุผลที่เพิ่มค่าใช้จ่าย (บังคับ)").fill("FAKE second cost");
    await dialog.getByRole("button",{name:"ตรวจยอดก่อนยืนยัน"}).click();
    await dialog.getByText("ผลตรวจยอดก่อนยืนยัน").waitFor();
    lateMode="conflict";
    await dialog.getByRole("button",{name:"ยืนยันเพิ่มค่าใช้จ่าย"}).click();
    await page.getByRole("button",{name:"ยืนยัน",exact:true}).last().click();
    await dialog.getByText("รหัสคำขอนี้เคยใช้กับข้อมูลอื่นแล้ว").waitFor();
    await page.locator(".ant-modal-confirm-title").waitFor({state:"hidden"});
    lateMode="replay";
    await dialog.getByRole("button",{name:"ยืนยันเพิ่มค่าใช้จ่าย"}).click();
    await page.getByRole("button",{name:"ยืนยัน",exact:true}).last().click();
    await dialog.getByText("คำขอนี้เคยบันทึกแล้ว ไม่เพิ่มต้นทุนซ้ำ").waitFor();
    await page.locator(".ant-modal-confirm-title").waitFor({state:"hidden"});
    await dialog.getByRole("button",{name:"เพิ่มค่าใช้จ่ายที่ลืมลง"}).click();
    lateMode="denied";
    await dialog.getByRole("button",{name:"ตรวจยอดก่อนยืนยัน"}).click();
    await dialog.getByText("ไม่มีสิทธิ์เพิ่มต้นทุน").waitFor();
    fixtureLang="en";
    await context.addCookies([{name:"lang",value:"en",url:base}]);
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByRole("button",{name:"View lines / lots"}).first().click();
    const englishDialog=page.getByRole("dialog");
    await englishDialog.getByText("Cost adjustment history").waitFor();
    await englishDialog.getByRole("button",{name:"Add forgotten cost"}).click();
    await englishDialog.getByPlaceholder("Added amount (THB)").waitFor();
    await page.screenshot({path:`${output}/${browserType.name()}-${width}-late-cost-en.png`});
    console.log(`${browserType.name()} ${width}px: receipt, late-cost preview/history, conflict, replay and denial visible`);
    await context.close();
  }
} finally {await browser.close();}
