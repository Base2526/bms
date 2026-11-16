// Local compiled page with intercepted, synthetic auth/data. No DB or customer calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { firefox,chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base=process.env.BMS_SMOKE_URL || "http://127.0.0.1:3018";
assert.ok(["localhost","127.0.0.1"].includes(new URL(base).hostname),"Local fixture only");
const output=".test-output/fish-dock-browser";
await mkdir(output,{recursive:true});
const browserType=process.env.BMS_BROWSER==="chromium"?chromium:firefox;
const browser=await browserType.launch({headless:true,...(browserType===chromium?{channel:"chrome"}:
  process.env.BMS_FIREFOX_EXECUTABLE?{executablePath:process.env.BMS_FIREFOX_EXECUTABLE}:{})});
try {
  for (const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"});
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
      if (url.pathname==="/api/bms/fish-intake" && req.method()==="GET") return route.fulfill({json:{items:[]}});
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
    console.log(`${browserType.name()} ${width}px: fish setup warning, ready option and form rendered`);
    await context.close();
  }
} finally {await browser.close();}
