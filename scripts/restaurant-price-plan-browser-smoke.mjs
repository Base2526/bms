import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { calculatePricePlan } from "../apps/web/lib/bms/restaurantPricePlanning.ts";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local mocked server only");
const output = ".test-output/restaurant-price-plan-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const recipeId = "00000000-0000-4000-8000-000000000001";
try {
  for (const lang of ["th", "en"]) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }, { name: "lang", value: lang, url: base }]);
    let permissions = ["product.view", "report.view", "product.edit"], reads = 0, savedInput;
    const mutations = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!/\/api\/|\/graphql$/.test(url.pathname)) return route.continue();
      let json = {};
      if (url.pathname === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE", role: "Administrator", name: "FAKE admin", language: lang } };
      else if (url.pathname.endsWith("/graphql")) {
        const { query: q = "", variables = {} } = route.request().postDataJSON() || {};
        if (/^\s*mutation/.test(q)) mutations.push(q);
        let data = {};
        if (q.includes("MyBmsPermissions")) data = { myBmsPermissions: permissions };
        else if (q.includes("query PreviewPricePublication")) data={bmsPreviewPricePublication:{status:"READY",errorCode:null,fingerprint:"a".repeat(64),snapshot:{sku:"FAKE-MENU",size:"PLATE",price:107,quantity:1,mode:"BASE",packs:[],tiers:[],promotions:[]}}};
        else if (q.includes("mutation PublishPricePlan")) {
          assert.equal(variables.review.confirmed,true);assert.equal(variables.review.fingerprint,"a".repeat(64));
          assert.equal(variables.input.plan.recipeId,recipeId);assert.equal(variables.input.quantity,1);
          assert.equal(variables.input.tenantId,undefined);data={bmsPublishPricePlan:{status:"PUBLISHED",errorCode:null}};
        }
        else if (q.includes("query RestaurantPricePlan")) {
          reads++; savedInput = variables.input;
          if (reads === 3) return route.fulfill({ json: { errors: [{ message: "FAKE unavailable", extensions: { code: "INTERNAL_SERVER_ERROR" } }] } });
          if (reads === 4) data = { bmsRestaurantPricePlan: { status: "INVALID_INPUT", errorCode: "PRICE_PLAN_INVALID_INPUT", estimate: null, scenarios: [] } };
          else data = { bmsRestaurantPricePlan: { status: "OK", errorCode: null,
            estimate: { recipeId, recipeVersion: 7, calculatedAt: "2026-10-15T00:00:00.000Z", status: reads === 2 ? "INCOMPLETE" : "COMPLETE", totalUnitCost: reads === 2 ? null : 40 },
            scenarios: calculatePricePlan(variables.input, reads === 2 ? null : 40) } };
        } else if (q.includes("StockModelCapabilities")) data = { bmsStoreProfile: { businessArchetype: "restaurant" },
          bmsStoreCapabilities: [{ capability: "RECIPE", enabled: true, configured: true, status: "ON", source: "MANUAL", gating: true }] };
        else if (q.includes("StockModelProducts")) data = { bmsProducts: { items: [{ sku: "FAKE-MENU", name: "FAKE menu", active: true, variants: [{ size: "PLATE" }] }] } };
        else if (q.includes("query StockModel(")) data = {
          bmsProductStockPolicy: { productSku: "FAKE-MENU", stockPolicy: "RECIPE", baseUnit: "PORTION", displayUnit: null,
            displayPrecision: 0, lotTracking: false, expiryTracking: false, fefo: false, kitchenStation: null, kitchenStationId: null, scaleItemCode: null, scaleSize: null },
          bmsProductRecipes: [{ id: recipeId, productSku: "FAKE-MENU", size: "PLATE", version: 7, outputQty: 1, active: false,
            items: [{ sku: "FAKE-RICE", size: "GRAM", qty: 100 }], directItems: [{ sku: "FAKE-RICE", size: "GRAM", qty: 100 }],
            subrecipes: [], sopSteps: [], costAssumptions: { labor: null, electricity: null, gas: null } }],
          bmsProductModifiers: [], bmsProductBundleItems: [],
        };
        else if (q.includes("KitchenStationSlas")) data = { bmsKitchenStationSlas: [] };
        else if (q.includes("KitchenStations")) data = { bmsKitchenStations: [], bmsUnmappedKitchenStationNames: [] };
        else if (q.includes("StockModelLocations")) data = { bmsLocations: [] };
        else if (q.includes("bmsActingTenant")) data = { bmsActingTenant: null };
        json = { data };
      }
      return route.fulfill({ json });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push({ message: error.message, stack: error.stack }));
    page.setDefaultTimeout(20000);
    const title = lang === "th" ? "จำลองราคาและจุดคุ้มทุน" : "Price & break-even scenarios";
    const calculate = lang === "th" ? "คำนวณตัวอย่าง" : "Calculate preview";
    try {
      const response = await page.goto(`${base}/admin/stock-models?sku=FAKE-MENU`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.equal(response.status(), 200);
      await page.locator(`tr[data-row-key="${recipeId}"] .ant-table-row-expand-icon`).click();
      await page.getByRole('button', { name: title, exact: true }).click();
      const dialog = page.getByRole('dialog');
      const result = dialog.getByRole('region', { name: lang === "th" ? "ผลจำลองสถานการณ์" : "Scenario results" });
      const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await dialog.locator('#assumptionSource').fill("FAKE dated planning assumptions, no double-counted labor");
      await dialog.locator('#dailyFixedCost').fill("1000"); await dialog.locator('#dailyTargetProfit').fill("200");
      await dialog.locator('#scenarios_0_label').fill("FAKE Delivery");
      await dialog.locator('.ant-select-selector').first().click();
      await page.locator('.ant-select-item-option').filter({ hasText: lang === "th" ? "ราคารวม VAT" : "VAT included" }).click();
      await dialog.locator('.ant-select-selector').nth(1).click();
      await page.locator('.ant-select-item-option').filter({ hasText: lang === "th" ? "ยอดลูกค้าจ่ายรวม VAT" : "Customer payment including VAT" }).click();
      for (const [name, value] of [["price", "107"], ["vatPercent", "7"], ["gpPercent", "30"], ["extraUnitCost", "5"], ["expectedDailyUnits", "60"], ["targetMarginPercent", "20"]]) await dialog.locator(`#scenarios_0_${name}`).fill(value);
      await dialog.getByRole('button', { name: lang === "th" ? "เพิ่มสถานการณ์" : "Add scenario" }).click();
      await dialog.locator('#scenarios_1_label').fill("FAKE Wholesale"); await dialog.locator('#scenarios_1_price').fill("80");
      await page.screenshot({ path: `${output}/${lang}-${width}-input.png`, animations: "disabled" });
      await dialog.getByRole('button', { name: new RegExp(calculate) }).click();
      await result.getByText("FAKE Delivery", { exact: true }).waitFor();
      assert.equal(savedInput.recipeId, recipeId); assert.equal(savedInput.scenarios.length, 2);
      assert.equal(savedInput.scenarios[0].vatMode, "INCLUSIVE"); assert.equal(savedInput.scenarios[0].gpBasis, "CUSTOMER_TOTAL");
      assert.ok(!JSON.stringify(savedInput).includes("__typename")); assert.equal(savedInput.unitCost, undefined); assert.equal(savedInput.tenantId, undefined);
      await result.getByText("100.53 THB", { exact: false }).waitFor();
      await result.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${lang}-${width}-result.png`, animations: "disabled" });
      assert.ok(await result.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "results fit viewport");
      assert.deepEqual(mutations,[]);
      await result.getByRole('button',{name:lang==='th'?'นำราคาไปใช้ขาย':'Publish selling price',exact:true}).first().click();
      const publication=page.getByRole('dialog').last();
      await publication.getByRole('button',{name:lang==='th'?'ตรวจสอบก่อนยืนยัน':'Review before confirmation',exact:true}).click();
      await publication.getByText(/฿107/).waitFor();assert.deepEqual(mutations,[]);
      await publication.screenshot({path:`${output}/${lang}-${width}-publication.png`,animations:'disabled'});
      await publication.getByRole('button',{name:lang==='th'?'ยืนยันเปิดใช้ราคาขายนี้':'Confirm and publish this price',exact:true}).click();
      await publication.getByText(lang==='th'?'เปิดใช้ราคาแล้ว':'Price published',{exact:true}).waitFor();
      assert.equal(mutations.length,1);mutations.length=0;
      await publication.getByRole('button',{name:'Close',exact:true}).click();
      await dialog.locator('#scenarios_0_price').fill("108"); assert.equal(await result.count(), 0, "changed inputs invalidate output");
      await dialog.getByRole('button', { name: new RegExp(calculate) }).click();
      await result.getByText(lang === "th" ? "ต้นทุนสูตรไม่ครบ — ยังไม่ทราบกำไรและเป้าขาย" : "Recipe estimate incomplete — profit and targets unknown", { exact: true }).first().waitFor();
      assert.equal(await result.getByText("100.53 THB", { exact: false }).count(), 0);
      await dialog.getByRole('button', { name: new RegExp(calculate) }).click();
      await dialog.getByText("FAKE unavailable", { exact: true }).waitFor(); assert.equal(await result.count(), 0);
      await dialog.getByRole('button', { name: new RegExp(calculate) }).click();
      await dialog.getByText("PRICE_PLAN_INVALID_INPUT", { exact: true }).waitFor(); assert.equal(await result.count(), 0);
      await dialog.locator('#dailyFixedCost').fill("");
      await dialog.getByRole('button', { name: new RegExp(calculate) }).click();
      await result.getByText(lang === "th" ? "ยังไม่ทราบต้นทุนคงที่ — ยังไม่ทราบเป้าขายและกำไรต่อวัน" : "Daily fixed cost unknown — daily targets and profit unknown", { exact: true }).first().waitFor();
      assert.equal(savedInput.dailyFixedCost, null); assert.deepEqual(mutations, []);
      permissions = ["product.view"];
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(`tr[data-row-key="${recipeId}"] .ant-table-row-expand-icon`).click();
      assert.equal(await page.getByRole('button', { name: title, exact: true }).count(), 0);
      await page.goto(`${base}/admin/manual`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByText(lang === "th" ? /จำลองราคาและจุดคุ้มทุน: ขยายแถวสูตร/ : /Price & break-even scenarios: expand a recipe/).waitFor();
      assert.deepEqual(errors, []);
      console.log(`PASS ${lang}/${width}px: alternatives, VAT/GP bases, changed input, incomplete/error states, permissions and manual; mocked API only`);
    } catch (error) {
      console.log({ pageErrors: errors });
      await page.screenshot({ path: `${output}/${lang}-${width}-failure.png`, fullPage: true }); throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
