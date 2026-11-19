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
      if (url.pathname==="/api/auth/me") return route.fulfill({json:{isAuthenticated:true,admin:{id:"FAKE",role:"Administrator",name:"FAKE fish tester",language:"th"}}});
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
        sourceYear:null,note:null,createdAt:"2026-11-16T13:40:18.000Z",lines:[
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
    console.log(`${browserType.name()} ${width}px: form validation and separate receipt lots visible`);
    await context.close();
  }
} finally {await browser.close();}
