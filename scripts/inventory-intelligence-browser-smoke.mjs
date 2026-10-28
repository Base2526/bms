// Actual compiled dashboard, synthetic API/auth only; never writes tenant data.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { buildSchema, parse, validate } = require("graphql");
const schema = buildSchema(readFileSync(new URL("../schema.graphql", import.meta.url), "utf8"));
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3018";
assert.ok(["localhost","127.0.0.1"].includes(new URL(base).hostname));
const output = ".test-output/inventory-intelligence-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th","en"]) for (const width of [1440,390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.routeWebSocket("**/*", (socket) => socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "connection_init") socket.send(JSON.stringify({ type:"connection_ack" }));
    }));
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-ui-fixture", url: base },{ name: "lang", value: lang, url: base }]);
    let failure = true;
    const calls = [], errors = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (!path.endsWith("/graphql") && url.origin !== new URL(base).origin) return route.abort();
      if (!path.includes("/api/") && !path.endsWith("/graphql")) return route.continue();
      let json = {};
      if (path === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE admin", language: lang } };
      else if (path.endsWith("/graphql")) {
        const { query: q, variables: v = {} } = route.request().postDataJSON();
        assert.ok(!/\bmutation\b/.test(q), "read-only smoke must not mutate");
        let data = {};
        if (q.includes("MyBmsPermissions")) data = { myBmsPermissions: ["report.view"] };
        else if (q.includes("bmsInventory")) {
          assert.deepEqual(validate(schema, parse(q)), [], "inventory UI queries must match the committed SDL");
          calls.push(v);
          if (q.includes("bmsInventoryIntelligenceLocations")) data = { bmsInventoryIntelligenceLocations: [
            { id:"11111111-1111-4111-8111-111111111111", name:"FAKE Branch A", active:true } ] };
          else if (failure) return route.fulfill({ json: { errors: [{ message:"FAKE evidence unavailable" }] } });
          else if (q.includes("bmsInventoryAnomalies")) data = { bmsInventoryAnomalies: { items:[],totalCount:0,truncated:false,verifiedAt:"2026-10-28T00:00:00Z" },
            bmsInventoryForecastAccuracy: { method:"branch_stock_consumption_velocity",methodVersion:"2.1",windowDays:90,sampleCount:0,mae:0,wape:null,bias:0,
              firstGeneratedAt:null,lastEvaluatedAt:null,disclaimer:"FAKE fixture" } };
          else data = { bmsInventoryActionCenter: { summary: {
            lowStockCount:0,outOfStockCount:0,stockoutWithin7DaysCount:0,purchaseSuggestionCount:0,totalSuggestedQty:0,
            slowMovingCount:0,deadStockCount:0,expiringLotCount:0,expiringUnits:0,unallocatedDemandUnits:0,unallocatedIncomingUnits:0,
            windowDays:30,coverageDays:30,disclaimer:"FAKE fixture" },lowStock:[],stockoutRisk:[],purchaseSuggestions:[],slowMoving:[],expiringLots:[] } };
        } else if (q.includes("DashboardActionList")) data = { bmsActions:[] };
        else if (q.includes("bmsDashboard")) data = { bmsDashboard: { revenueTotal:0,revenueToday:0,orderCount:0,lowStockCount:0,customerCount:0,
          ordersByStatus:[],topProducts:[],topCustomers:[],salesDaily:[],couponSummary:null } };
        else if (q.includes("bmsChannelHealth")) data = { bmsChannels:[],bmsChannelHealth:[] };
        else if (q.includes("bmsOperationalAlerts")) data = { bmsOperationalAlerts:{ packingOverdueCount:0,slipPendingCount:0,reservationExpiringCount:0,chatWaitingCount:0 } };
        else if (q.includes("bmsAiConfig")) data = { bmsAiConfig:{ has_key:true },bmsAiUsage:null };
        else if (q.includes("bmsAiFailureSummary")) data = { bmsAiFailureSummary:{ days:7,totalToolCalls:0,errorCalls:0,handoffCount:0,topFailingTools:[] } };
        json = { data };
      }
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`${base}/admin/dashboard`, { waitUntil:"domcontentloaded" });
      const region = page.getByRole("region", { name: lang === "en" ? "Inventory intelligence" : "วิเคราะห์สต็อก" });
      const errorText = lang === "en" ? "Inventory evidence could not be loaded" : "อ่านข้อมูลวิเคราะห์สต็อกไม่สำเร็จ";
      const matureText = lang === "en" ? "Forecast accuracy will appear after the first forecast matures." : "ความแม่นยำจะแสดงเมื่อ forecast รอบแรกครบกำหนด";
      await region.getByText(errorText, { exact:true }).waitFor();
      assert.equal(await region.getByText(matureText, { exact:true }).count(), 0);
      assert.equal(await region.locator("table").count(), 0, "failed reads must not display empty evidence tables");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path:`${output}/${lang}-${width}-error.png`, fullPage:true });
      failure = false;
      await region.getByRole("button", { name:lang === "en" ? "Retry inventory reads" : "ลองอ่านข้อมูลสต็อกใหม่",exact:true }).click();
      await region.getByText(matureText, { exact:true }).waitFor();
      await region.getByText(errorText, { exact:true }).waitFor({ state:"hidden" });
      assert.ok(await region.locator("table").count() > 0);
      await region.locator(".ant-select-selector").click();
      await page.getByTitle("FAKE Branch A", { exact:true }).click();
      await page.waitForFunction(() => !document.body.innerText.includes("Loading inventory evidence") && !document.body.innerText.includes("กำลังอ่านข้อมูลวิเคราะห์สต็อก"));
      assert.ok(calls.some((v) => v.locationId === "11111111-1111-4111-8111-111111111111"));
      await region.getByRole("combobox").press("Escape");
      await page.locator(".ant-select-dropdown:visible").waitFor({ state:"hidden" });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path:`${output}/${lang}-${width}-ready.png` });
      assert.deepEqual(errors, []);
      console.log(`PASS ${lang} ${width}px: read failure, no false empty state, retry, branch scope, SDL, overflow`);
    } catch (error) {
      console.error((await page.locator("body").innerText()).slice(-3000));
      await page.screenshot({ path:`${output}/${lang}-${width}-failure.png`,fullPage:true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
