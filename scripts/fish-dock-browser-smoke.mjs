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
      return route.fulfill({json:{}});
    });
    const page=await context.newPage();
    await page.goto(`${base}/admin/fish-intake`,{waitUntil:"domcontentloaded"});
    await page.getByRole("tab",{name:"รับปลาใหม่"}).click();
    await page.getByText("ปลาไม่มีล็อต").first().waitFor();
    await page.getByText("43.17 บาท/กก.",{exact:false}).first().waitFor();
    await page.locator(".ant-select-selector").nth(2).click();
    await page.getByText("ปลาพร้อมรับ").first().waitFor();
    assert.equal(await page.getByText("ยังไม่มีปลาที่ตั้งค่าเป็นสินค้าชั่งน้ำหนักพร้อมติดตามล็อต").count(),0);
    await page.screenshot({path:`${output}/${browserType.name()}-${width}.png`,fullPage:true});
    console.log(`${browserType.name()} ${width}px: fish setup warning, ready option and form rendered`);
    await context.close();
  }
} finally {await browser.close();}
