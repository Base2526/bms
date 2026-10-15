import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local fixture server only");
const output = ".test-output/recipe-versioning-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"]) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }, { name: "lang", value: lang, url: base }]);
    let recipes = [{ id: "recipe-1", productSku: "FAKE-MENU", size: "PLATE", version: 1, outputQty: 1, active: true,
      items: [{ sku: "FAKE-RICE", size: "GRAM", qty: 100 }], directItems: [{ sku: "FAKE-RICE", size: "GRAM", qty: 100 }], subrecipes: [], sopSteps: [], costAssumptions: { labor: null, electricity: null, gas: null } }];
    const childId = "00000000-0000-4000-8000-000000000001";
    let savedInput;
    let permissions = ["product.view", "product.edit"];
    let costReads = 0;
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!/\/api\/|\/graphql$/.test(url.pathname)) return route.continue();
      let json = {};
      if (url.pathname === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE", role: "Administrator", name: "FAKE admin", language: lang } };
      else if (url.pathname.endsWith("/graphql")) {
        const { query: q = "", variables = {} } = route.request().postDataJSON() || {};
        let data = {};
        if (q.includes("MyBmsPermissions")) data = { myBmsPermissions: permissions };
        else if (q.includes("SaveProductRecipe")) {
          savedInput = variables.input;
          recipes = [{ ...recipes[0], active: false }, { ...recipes[0], id: "recipe-2", version: 2,
            outputQty: variables.input.outputQty, directItems: variables.input.directItems, sopSteps: variables.input.sopSteps,
            costAssumptions: variables.input.costAssumptions,
            subrecipes: variables.input.subrecipes.map(ref => ({ ...ref, productSku: "FAKE-SAUCE", size: "GRAM", version: 1, outputQty: 100 })),
            items: [...variables.input.directItems, { sku: "FAKE-SUGAR", size: "GRAM", qty: 12 }] }];
          data = { bmsUpsertProductRecipe: { id: "recipe-2", version: 2, active: true } };
        } else if (q.includes("StockModelCapabilities")) data = {
          bmsStoreProfile: { businessArchetype: "restaurant" },
          bmsStoreCapabilities: [{ capability: "RECIPE", enabled: true, configured: true, status: "ON", source: "MANUAL", gating: true }],
        };
        else if (q.includes("StockModelProducts")) data = { bmsProducts: { items: [
          { sku: "FAKE-MENU", name: "FAKE menu", active: true, variants: [{ size: "PLATE" }] },
          { sku: "FAKE-SAUCE", name: "FAKE sauce", active: true, variants: [{ size: "GRAM" }] },
        ] } };
        else if (q.includes("StockRecipeVersions")) data = { bmsProductRecipes: [{ id: childId, productSku: "FAKE-SAUCE", size: "GRAM", version: 1, outputQty: 100, active: false }] };
        else if (q.includes("StockRecipeCost")) {
          costReads++;
          if (costReads > 2) return route.fulfill({ json: { errors: [{ message: "FAKE unavailable", extensions: { code: "INTERNAL_SERVER_ERROR" } }] } });
          const incomplete = costReads === 2;
          data = { bmsRecipeCostEstimate: { recipeId: "recipe-2", recipeVersion: 2, outputQty: 2, calculatedAt: "2026-10-15T00:00:00.000Z",
            status: incomplete ? "INCOMPLETE" : "COMPLETE", currency: "THB", scope: "WHOLE_BATCH_INCLUDING_SUBRECIPES",
            missingIngredientCount: incomplete ? 1 : 0, ingredientBatchCost: incomplete ? null : 26,
            knownBatchCost: incomplete ? 48.25 : 68.25, totalBatchCost: incomplete ? null : 68.25, totalUnitCost: incomplete ? null : 34.13,
            ingredients: [{ sku: "FAKE-RICE", size: "GRAM", qty: 100, unitCost: incomplete ? null : 0.2, batchCost: incomplete ? null : 20, source: incomplete ? "MISSING" : "CATALOG_CURRENT" },
              { sku: "FAKE-SUGAR", size: "GRAM", qty: 12, unitCost: 0.5, batchCost: 6, source: "CATALOG_CURRENT" }],
            overhead: [{ category: "labor", quantity: 30, rate: 80, source: "FAKE roster estimate", batchCost: 40 },
              { category: "electricity", quantity: 0.5, rate: 4.5, source: "FAKE meter estimate", batchCost: 2.25 },
              { category: "gas", quantity: 0, rate: 30, source: "FAKE no gas used", batchCost: 0 }],
          } };
        }
        else if (q.includes("query StockModel(")) data = {
          bmsProductStockPolicy: { productSku: "FAKE-MENU", stockPolicy: "RECIPE", baseUnit: "PORTION", displayUnit: null,
            displayPrecision: 0, lotTracking: false, expiryTracking: false, fefo: false, kitchenStation: null, kitchenStationId: null, scaleItemCode: null, scaleSize: null },
          bmsProductRecipes: recipes, bmsProductModifiers: [], bmsProductBundleItems: [],
        };
        else if (q.includes("KitchenStationSlas")) data = { bmsKitchenStationSlas: [] };
        else if (q.includes("KitchenStations")) data = { bmsKitchenStations: [], bmsUnmappedKitchenStationNames: [] };
        else if (q.includes("StockModelLocations")) data = { bmsLocations: [] };
        else if (q.includes("bmsActingTenant")) data = { bmsActingTenant: null };
        json = { data };
      }
      return route.fulfill({ json });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(30000);
    try {
      const response = await page.goto(`${base}/admin/stock-models?sku=FAKE-MENU`, { waitUntil: "domcontentloaded", timeout: 120000 });
      assert.equal(response.status(), 200);
      const edit = lang === "th" ? "แก้ไข" : "Edit";
      await page.locator('tr[data-row-key="recipe-1"]').getByRole("button", { name: edit, exact: true }).click();
      const dialog = page.getByRole("dialog");
      const hint = dialog.getByText(lang === "th" ? /เปลี่ยนวัตถุดิบ ปริมาณ หรือผลผลิต/ : /Changing ingredients, quantities, or yield/);
      await hint.waitFor();
      assert.ok(await hint.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `hint overflow: ${lang}/${width}`);
      await page.screenshot({ path: `${output}/${lang}-${width}-recipe.png`, fullPage: true, animations: "disabled" });
      await dialog.locator('input[id="outputQty"]').fill("2");
      for (const [category, quantity, rate, source] of [["labor", "30", "80", "FAKE roster estimate"], ["electricity", "0.5", "4.5", "FAKE meter estimate"], ["gas", "0", "30", "FAKE no gas used"]]) {
        await dialog.locator(`#costs_${category}_enabled`).check();
        await dialog.locator(`#costs_${category}_quantity`).fill(quantity);
        await dialog.locator(`#costs_${category}_rate`).fill(rate);
        await dialog.locator(`#costs_${category}_source`).fill(source);
      }
      await dialog.locator('#costs_electricity_source').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${lang}-${width}-cost-input.png`, fullPage: true, animations: "disabled" });
      await dialog.getByRole("button", { name: lang === "th" ? "เพิ่มสูตรย่อย" : "Add subrecipe" }).click();
      await dialog.getByRole("combobox", { name: lang === "th" ? "ค้นหาสินค้าของสูตรย่อย" : "Find subrecipe product" }).click();
      await page.locator('.ant-select-item-option[title="FAKE-SAUCE · FAKE sauce"]').click();
      await dialog.getByRole("combobox", { name: lang === "th" ? "เลือกเวอร์ชันสูตร" : "Choose recipe version" }).click();
      await page.locator('.ant-select-item-option').filter({ hasText: "FAKE-SAUCE/GRAM · v1" }).click();
      await dialog.locator('#subrecipes_0_qty').fill("20");
      await dialog.getByRole("button", { name: lang === "th" ? "เพิ่มขั้นตอน" : "Add step" }).click();
      await dialog.locator('#sopSteps_0').fill("Mix sauce with rice");
      await dialog.locator('#sopSteps_0').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${lang}-${width}-composition.png`, fullPage: true, animations: "disabled" });
      await dialog.locator(".ant-modal-footer .ant-btn-primary").click();
      await dialog.waitFor({ state: "hidden" });
      await page.locator('tr[data-row-key="recipe-2"]').waitFor();
      assert.equal(await page.locator('tr[data-row-key="recipe-1"]').count(), 1);
      assert.equal(savedInput.id, "recipe-1"); assert.equal(savedInput.outputQty, 2);
      assert.equal(savedInput.items, undefined);
      assert.deepEqual(savedInput.directItems, [{ sku: "FAKE-RICE", size: "GRAM", qty: 100 }]);
      assert.deepEqual(savedInput.subrecipes, [{ recipeId: childId, qty: 20 }]);
      assert.deepEqual(savedInput.sopSteps, ["Mix sauce with rice"]);
      assert.deepEqual(savedInput.costAssumptions, { labor: { quantity: 30, rate: 80, source: "FAKE roster estimate" },
        electricity: { quantity: 0.5, rate: 4.5, source: "FAKE meter estimate" }, gas: { quantity: 0, rate: 30, source: "FAKE no gas used" } });
      assert.ok(!JSON.stringify(savedInput).includes("__typename"));
      await page.locator('tr[data-row-key="recipe-2"]').getByRole("button", { name: edit, exact: true }).click();
      assert.equal(await dialog.locator('#subrecipes_0_qty').inputValue(), "20");
      assert.equal(await dialog.locator('#sopSteps_0').inputValue(), "Mix sauce with rice");
      assert.equal(await dialog.locator('#costs_gas_quantity').inputValue(), "0");
      assert.equal(await dialog.locator('#costs_labor_source').inputValue(), "FAKE roster estimate");
      await dialog.locator('.ant-modal-close').click();
      permissions = ["product.view"];
      await page.reload({ waitUntil: "domcontentloaded" });
      const savedRow = page.locator('tr[data-row-key="recipe-2"]');
      await savedRow.waitFor();
      assert.equal(await savedRow.getByRole("button", { name: edit, exact: true }).count(), 0);
      await savedRow.locator('.ant-table-row-expand-icon').click();
      await page.getByText("Mix sauce with rice", { exact: true }).waitFor();
      await page.getByRole("button", { name: lang === "th" ? "ต้นทุนประมาณการสูตร" : "Recipe cost estimate", exact: true }).click();
      const costCard = page.getByRole("dialog").locator('.ant-card');
      await costCard.getByText(/34\.13/).waitFor();
      await costCard.scrollIntoViewIfNeeded();
      const bounds = await costCard.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `cost details must fit ${width}px`);
      assert.ok(await costCard.locator('.ant-alert-message').evaluate(el => el.scrollWidth <= el.clientWidth + 1), "cost scope text must wrap");
      assert.equal(await costCard.getByText(/FAKE roster estimate/).count(), 1);
      await page.screenshot({ path: `${output}/${lang}-${width}-cost-complete.png`, animations: "disabled" });
      const total = costCard.getByText(/34\.13/);
      await total.scrollIntoViewIfNeeded();
      const totalBounds = await total.boundingBox();
      assert.ok(totalBounds && totalBounds.x >= 0 && totalBounds.x + totalBounds.width <= width && totalBounds.y >= 0 && totalBounds.y < 1000,
        "complete totals must be reachable and fit the viewport");
      await page.screenshot({ path: `${output}/${lang}-${width}-cost-total.png`, animations: "disabled" });
      await costCard.getByRole("button", { name: lang === "th" ? "รีเฟรช" : "Refresh" }).click();
      await costCard.getByText(lang === "th" ? "ข้อมูลไม่ครบ — ยอดรวมยังไม่ทราบ" : "Incomplete — total unknown", { exact: true }).waitFor();
      assert.equal(await costCard.getByText(/34\.13/).count(), 0);
      await page.screenshot({ path: `${output}/${lang}-${width}-cost-incomplete.png`, animations: "disabled" });
      await costCard.getByRole("button", { name: lang === "th" ? "รีเฟรช" : "Refresh" }).click();
      await costCard.locator('.ant-alert-error').waitFor();
      assert.equal(await costCard.getByText(/48\.25/).count(), 0);
      await page.getByRole("dialog").locator('.ant-modal-close').click();
      await page.goto(`${base}/admin/manual`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByText(lang === "th" ? /สูตรอาหาร: เปลี่ยนวัตถุดิบ/ : /Recipes: ingredient, quantity or yield/).waitFor();
      await page.screenshot({ path: `${output}/${lang}-${width}-manual.png`, fullPage: true, animations: "disabled" });
      assert.deepEqual(errors, []);
      console.log(`PASS ${lang}/${width}px: pinned child, SOP, cost inputs/zero, new version, read-only estimate, incomplete/error states and manual; mocked API only`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${lang}-${width}-failure.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
