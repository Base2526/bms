import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import * as pricing from "../apps/web/lib/bms/restaurantPricePlanning.ts";
const math = {};
new Function("require", "exports", ts.transpileModule(readFileSync(new URL("../apps/web/lib/bms/restaurantMenuPlanning.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(name => { assert.equal(name, "./restaurantPricePlanning"); return pricing; }, math);
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local mocked server only");
const output = ".test-output/restaurant-menu-plan-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const recipe = n => ({ id: id(n), productSku: `FAKE-MENU-${n}`, size: "PLATE", version: 7, outputQty: 1, active: false,
  items: [{ sku: "FAKE-RICE", size: "GRAM", qty: 100 }], directItems: [{ sku: "FAKE-RICE", size: "GRAM", qty: 100 }],
  subrecipes: [], sopSteps: [], costAssumptions: { labor: null, electricity: null, gas: null } });
try {
  for (const lang of ["th", "en"]) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }, { name: "lang", value: lang, url: base }]);
    let permissions = ["product.view", "report.view"], mode = "complete", savedInput;
    const mutations = [];
    let nextPreviewGate = null;
    function holdNextPreview() {
      let signalArrival, release;
      const arrived = new Promise(resolve => { signalArrival = resolve; });
      const wait = new Promise(resolve => { release = resolve; });
      nextPreviewGate = { signalArrival, wait };
      return { release, async waitForArrival() {
        let timer;
        try { await Promise.race([arrived, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Preview request did not arrive")), 20000);
        })]); } finally { clearTimeout(timer); }
      } };
    }
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
        else if (q.includes("query RestaurantMenuPlan")) {
          savedInput = variables.input;
          const gate = nextPreviewGate; nextPreviewGate = null;
          if (gate) { gate.signalArrival(); await gate.wait; }
          if (mode === "error") return route.fulfill({ json: { errors: [{ message: "FAKE unavailable", extensions: { code: "INTERNAL_SERVER_ERROR" } }] } });
          if (mode === "invalid") data = { bmsRestaurantMenuPlan: { status: "INVALID_INPUT", errorCode: "MENU_PLAN_INVALID_INPUT", estimates: [], analysis: null } };
          else {
            const costs = new Map([[id(1), 40], [id(2), mode === "incomplete" ? null : 20], [id(3), 50]]);
            data = { bmsRestaurantMenuPlan: { status: "OK", errorCode: null,
              estimates: variables.input.items.map(item => ({ recipeId: item.recipeId, recipeVersion: item.recipeId === id(3) ? 8 : 7, calculatedAt: "2026-10-15T00:00:00.000Z",
                status: costs.get(item.recipeId) == null ? "INCOMPLETE" : "COMPLETE", totalUnitCost: costs.get(item.recipeId) })),
              analysis: math.calculateMenuPlan(variables.input, costs) } };
          }
        } else if (q.includes("StockRecipeVersions")) data = { bmsProductRecipes: variables.sku.endsWith("2")
          ? [recipe(2)] : [recipe(1), { ...recipe(1), id: id(3), version: 8 }] };
        else if (q.includes("StockModelCapabilities")) data = { bmsStoreProfile: { businessArchetype: "restaurant" },
          bmsStoreCapabilities: [{ capability: "RECIPE", enabled: true, configured: true, status: "ON", source: "MANUAL", gating: true }] };
        else if (q.includes("StockModelProducts")) data = { bmsProducts: { items: [1, 2].map(n => ({ sku: `FAKE-MENU-${n}`, name: `FAKE menu ${n}`, active: true, variants: [{ size: "PLATE" }] })) } };
        else if (q.includes("query StockModel(")) data = {
          bmsProductStockPolicy: { productSku: "FAKE-MENU-1", stockPolicy: "RECIPE", baseUnit: "PORTION", displayUnit: null,
            displayPrecision: 0, lotTracking: false, expiryTracking: false, fefo: false, kitchenStation: null, kitchenStationId: null, scaleItemCode: null, scaleSize: null },
          bmsProductRecipes: [recipe(1)], bmsProductModifiers: [], bmsProductBundleItems: [],
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
    const title = lang === "th" ? "จำลองโปรโมชันและวิเคราะห์เมนู" : "Promotion & menu planning";
    const calculate = lang === "th" ? "คำนวณตัวอย่าง" : "Calculate preview";
    try {
      const response = await page.goto(`${base}/admin/stock-models?sku=FAKE-MENU-1`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.equal(response.status(), 200);
      await page.getByRole("button", { name: title, exact: true }).click();
      const dialog = page.getByRole("dialog"), result = dialog.getByRole("region", { name: lang === "th" ? "ผลวางแผนเมนู (บาท)" : "Menu planning results (THB)" });
      const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await dialog.locator("#assumptionSource").fill("FAKE dated daily population, branch/channel assumptions");
      await dialog.locator("#dailyFixedCost").fill("100");
      for (let i = 0; i < 2; i++) {
        const card = dialog.locator(".ant-card").nth(i);
        await card.getByRole("combobox", { name: lang === "th" ? "ค้นหาสินค้าเมนู" : "Search menu product", exact: true }).click();
        await page.locator(".ant-select-item-option:visible").filter({ hasText: `FAKE-MENU-${i + 1} ·` }).click();
        await card.getByRole("combobox", { name: lang === "th" ? "เวอร์ชันสูตร / หน่วยฐานผลผลิต" : "Recipe version / output base unit", exact: true }).click();
        await page.locator(".ant-select-item-option:visible").filter({ hasText: `FAKE-MENU-${i + 1}/PLATE · v7` }).click();
        for (const [field, value] of [["label", `FAKE ${i + 1}`], ["price", i === 0 ? "100" : "60"], ["expectedDailyUnits", i === 0 ? "40" : "10"]]) await dialog.locator(`#items_${i}_scenario_${field}`).fill(value);
        await dialog.locator(`#items_${i}_bundleQty`).fill(i === 0 ? "1" : "2");
      }
      await dialog.getByRole("checkbox", { name: lang === "th" ? "จำลองชุดโปรโมชันด้วย" : "Also simulate a promotion bundle" }).check();
      for (const [field, value] of [["label", "FAKE Bundle"], ["price", "180"], ["expectedDailyUnits", "5"], ["targetMarginPercent", "20"]]) await dialog.locator(`#bundleScenario_${field}`).fill(value);
      await page.screenshot({ path: `${output}/${lang}-${width}-input.png`, animations: "disabled" });
      const slowV7 = holdNextPreview();
      await dialog.getByRole("button", { name: new RegExp(calculate) }).click();
      await slowV7.waitForArrival();
      // Keep the response held until assertions finish: no timing-dependent sleeps.
      try {
        assert.equal(await dialog.locator("#assumptionSource").isDisabled(), true);
        for (const picker of await dialog.locator('.ant-card').first().getByRole('combobox').all()) {
          assert.equal(await picker.isDisabled(), true, "product, recipe version and scenario selectors lock during a slow request");
        }
        assert.equal(await result.count(), 0);
      } finally { slowV7.release(); }
      await result.getByText("FAKE 1", { exact: true }).waitFor();
      assert.equal(savedInput.items.length, 2); assert.deepEqual(savedInput.bundle.parts.map(p => p.qty), [1, 2]);
      assert.equal(savedInput.tenantId, undefined); assert.equal(savedInput.cost, undefined);
      await result.getByText("2,700", { exact: true }).waitFor();
      await result.getByText(/Star —/).waitFor(); await result.getByText(/Dog —/).waitFor();
      await result.getByText("-40", { exact: true }).waitFor();
      await result.evaluate(el => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: `${output}/${lang}-${width}-result.png`, animations: "disabled" });
      assert.ok(await result.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "results fit viewport");
      await result.locator(".ant-card").first().evaluate(el => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: `${output}/${lang}-${width}-menu.png`, animations: "disabled" });
      await result.locator(".ant-card").last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${lang}-${width}-bundle.png`, animations: "disabled" });
      await dialog.locator("#items_0_scenario_price").fill("101"); assert.equal(await result.count(), 0);
      mode = "incomplete";
      await dialog.getByRole("button", { name: new RegExp(calculate) }).click();
      await result.getByText(lang === "th" ? "ยังไม่จัดกลุ่ม — ข้อมูลไม่พอ" : "Unclassified — insufficient evidence", { exact: true }).first().waitFor();
      mode = "complete"; await dialog.locator("#items_0_scenario_expectedDailyUnits").fill("");
      await dialog.getByRole("button", { name: new RegExp(calculate) }).click();
      await result.getByText(lang === "th" ? "จำนวนขายไม่ครบ — ยังไม่ทราบเกณฑ์ร่วมและกลุ่มเมนู" : "Demand incomplete — common benchmark and groups unknown", { exact: true }).waitFor();
      assert.equal(savedInput.items[0].scenario.expectedDailyUnits, null);
      for (let i = 0; i < 2; i++) await dialog.locator(`#items_${i}_scenario_expectedDailyUnits`).fill("0");
      await dialog.getByRole("button", { name: new RegExp(calculate) }).click();
      await result.getByText(lang === "th" ? "จำนวนขายเป็นศูนย์ทั้งหมด — ยังไม่มีเกณฑ์ความนิยมและกำไรส่วนเกิน" : "All demand is zero — no popularity or contribution benchmark", { exact: true }).waitFor();
      mode = "error"; await dialog.getByRole("button", { name: new RegExp(calculate) }).click();
      await dialog.getByText("FAKE unavailable", { exact: true }).waitFor(); assert.equal(await result.count(), 0);
      mode = "invalid"; await dialog.getByRole("button", { name: new RegExp(calculate) }).click();
      await dialog.getByText("MENU_PLAN_INVALID_INPUT", { exact: true }).waitFor(); assert.equal(await result.count(), 0);
      mode = "complete";
      await dialog.getByRole("checkbox").uncheck(); await dialog.getByRole("button", { name: new RegExp(calculate) }).click();
      await result.waitFor(); assert.equal(savedInput.bundle, null); assert.deepEqual(mutations, []);
      await dialog.getByRole("button", { name: lang === "th" ? "เพิ่มเมนู" : "Add menu", exact: true }).click(); assert.equal(await result.count(), 0);
      await dialog.getByRole("button", { name: lang === "th" ? "นำออก" : "Remove", exact: true }).last().click();
      // Once the previous request finishes, selecting v8 must invalidate v7 and use v8's cost.
      await dialog.locator('.ant-card').first().locator('.ant-select-selector').nth(1).click();
      await page.locator('.ant-select-item-option:visible').filter({ hasText: 'FAKE-MENU-1/PLATE · v8' }).click();
      assert.equal(await result.count(), 0);
      const slowV8 = holdNextPreview();
      await dialog.getByRole('button', { name: new RegExp(calculate) }).click();
      await slowV8.waitForArrival();
      try {
        assert.equal(savedInput.items[0].recipeId, id(3));
        assert.equal(await dialog.locator('.ant-card').first().getByRole('combobox').nth(1).isDisabled(), true);
      } finally { slowV8.release(); }
      await result.getByText('FAKE 1', { exact: true }).waitFor();
      assert.match(await result.locator('.ant-card').first().innerText(), /v8/);
      assert.doesNotMatch(await result.locator('.ant-card').first().innerText(), /v7/);
      assert.equal(await dialog.locator('.ant-card').first().getByRole('combobox').nth(1).isDisabled(), false);
      permissions = ["product.view"];
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(`tr[data-row-key="${id(1)}"]`).waitFor();
      assert.equal(await page.getByRole("button", { name: title, exact: true }).count(), 0);
      await page.goto(`${base}/admin/manual`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByText(lang === "th" ? /จำลองโปรโมชันและวิเคราะห์เมนู: เปิดจากการ์ดสูตร/ : /Promotion & menu planning: open from the Recipes card/).waitFor();
      assert.deepEqual(errors, []);
      console.log(`PASS ${lang}/${width}px: held API response locks recipe picker, v7-to-v8 recalculation, menu/bundle, incomplete/error states, no mutations, permissions and manual; mocked API only`);
    } catch (error) {
      console.log({ pageErrors: errors }); await page.screenshot({ path: `${output}/${lang}-${width}-failure.png`, fullPage: true }); throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
