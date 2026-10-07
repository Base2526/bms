import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
const output = ".test-output/desktop-scan-selection";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const cashier = { id: "FAKE-cashier", name: "FAKE Cashier", hasPin: true, role: "Cashier", posOnly: true, approvals: [] };
const barcode = "2018443771676", sku = "FAKE-A";
const imageUrl = "/sample/restaurant/pork-garlic.jpg";
const selection = { scanCode: barcode, sku, productName: "FAKE Product", imageUrl,
  variants: [{ size: "S", price: 100, available: 10, stockTracked: true }, { size: "L", price: 200, available: 10, stockTracked: true },
    { size: "XL", price: 250, available: 0, stockTracked: true }] };
const promotion = { kind: "BUY_A_GET_B", id: "FAKE-PROMO", buySku: sku, buySize: "S", buyQty: 1, giftSku: "FAKE-GIFT", giftSize: "STD", getQty: 1 };
const hit = (size, pack = false) => ({ sku, size, productName: selection.productName, receiptName: selection.productName,
  baseQty: pack ? 6 : 1, packCode: pack ? "BOX" : "BASE", unitName: pack ? "กล่อง" : "ชิ้น", packPrice: pack ? 900 : size === "S" ? 100 : 200,
  basePrice: size === "S" ? 100 : 200, available: 10, stockTracked: true, serialTracked: false, scaleBarcode: null,
  imageUrl, barcode: pack ? "EXACT-BOX" : barcode, priceTiers: [], promotion, modifiers: [], packs: [] });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "lang", value: "th", url: base }]);
    await context.addInitScript(() => {
      window.bmsDesktop = { isDesktop: true, getDeviceToken: async () => "FAKE-token", getStorageNamespace: async () => "FAKE-scan",
        getAppInfo: async () => ({ version: "0.2.14-pilot.2", platform: "darwin", arch: "arm64" }) };
    });
    const bootstrap = { device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
      location: { id: "FAKE-location", name: "FAKE shop", branchCode: "MAIN" }, shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt: new Date().toISOString() },
      cashiers: [cashier], approvers: [], kitchenOperators: [], store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
      surface: "retail", businessArchetype: "retail", vat: { registered: false, priceIncludesVat: true, rate: 7, cashRounding: "NONE" } };
    const catalog = [{ sku, name: selection.productName, price: 100, availability: "AVAILABLE", availableTotal: 20, imageUrl, availableSizes: selection.variants },
      { sku: "FAKE-OTHER", name: "FAKE Other Product", price: 40, availability: "AVAILABLE", availableTotal: 10,
        imageUrl: "/sample/restaurant/green-curry-chicken.jpg", availableSizes: [{ size: "STD", price: 40, available: 10 }] }];
    const errors = [], consoleErrors = [], mutations = [], scans = [];
    let releaseScan = null;
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
      let json = {};
      if (path === "/api/graphql") {
        const q = body?.query || "", vars = body?.variables || {};
        let data = {};
        if (q.includes("query PosBootstrap")) data = { bmsPosSession: bootstrap };
        else if (q.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
        else if (q.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: catalog } };
        else if (q.includes("query MobilePosScan")) {
          scans.push(vars);
          if (vars.code === "PENDING-S") await new Promise(resolve => { releaseScan = resolve; });
          if ([barcode, sku].includes(vars.code) && !vars.size) {
            await route.fulfill({ json: { data: null, errors: [{ message: "มีหลายไซส์ กรุณาเลือกไซส์", extensions: {
              code: "CONFLICT", reason: "VARIANT_SELECTION_REQUIRED", selection: { ...selection, scanCode: vars.code } } }] } });
            return;
          }
          const item = vars.code === "EXACT-BOX" ? hit("L", true) : ["EXACT-S", "PENDING-S"].includes(vars.code) ? hit("S")
            : [barcode, sku].includes(vars.code) ? hit(vars.size) : vars.code === "FAKE-GIFT"
              ? { ...hit("STD"), sku: "FAKE-GIFT", productName: "FAKE Gift", receiptName: "FAKE Gift", packPrice: 30, basePrice: 30, imageUrl: null }
              : null;
          if (!item) {
            await route.fulfill({ json: { errors: [{ message: "ไม่พบสินค้า", extensions: { code: "NOT_FOUND" } }] } }); return;
          }
          data = { bmsPosScan: item };
        } else if (q.includes("query DesktopBenefitsPreview")) data = { bmsPosMemberPreview: {
          status: "READY", subtotal: vars.input.subtotal, netTotal: vars.input.subtotal, amountDue: vars.input.subtotal,
          totalDiscount: 0, tierDiscount: 0, couponDiscount: 0, pointsDiscount: 0, manualDiscount: 0, pointsUsed: 0, loyaltyEnabled: false, member: null } };
        else if (q.includes("mutation")) mutations.push(q);
        json = { data };
      } else if (path === "/api/pos/session") json = bootstrap;
      else if (path.endsWith("/desktop-update")) json = { status: "unavailable", releases: [] };
      else if (body && !["/api/logs", "/api/ws/ticket"].includes(path)) mutations.push(path);
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    const scanInput = page.getByLabel("สแกนบาร์โค้ดหรือรหัสสินค้า");
    const panel = page.getByRole("region", { name: "สินค้าที่สแกน" });
    const scan = async code => { await scanInput.fill(code); await scanInput.press("Enter"); };
    const imageCheck = async () => {
      assert.equal(await panel.locator("img").count(), 1);
      assert.equal(await panel.locator("img").getAttribute("src"), imageUrl);
      await panel.locator("img").evaluate(img => img.decode());
      assert.ok(await panel.locator("img").evaluate(img => img.naturalWidth > 0));
      assert.equal(await page.getByRole("button", { name: /FAKE Other Product/ }).count(), 0);
      const bounds = await panel.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    };
    try {
      await page.goto(`${base}/pos/app`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
      await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
      await scanInput.waitFor();
      await scan(barcode);
      await panel.getByRole("radio", { name: "ไซส์ S", exact: true }).waitFor();
      await imageCheck();
      assert.equal(await page.locator("article").count(), 0, "ambiguous code must not add a guessed size");
      assert.equal(await panel.getByRole("button", { name: "เพิ่มลงบิล" }).isDisabled(), true);
      assert.equal(await panel.getByRole("radio", { name: "ไซส์ XL", exact: true }).isDisabled(), true);
      await panel.getByRole("radio", { name: "ไซส์ L", exact: true }).check();
      await page.screenshot({ path: `${output}/${width}-choose-size.png`, fullPage: true });
      await panel.getByRole("button", { name: "เพิ่มลงบิล" }).click();
      await panel.getByText("เพิ่มลงบิลแล้ว", { exact: true }).waitFor();
      assert.match(await page.locator("article").first().innerText(), /FAKE-A · L/);
      assert.equal(scans.at(-1).size, "L");
      await scan("FAKE-GIFT");
      await panel.getByText("เพิ่มลงบิลแล้ว", { exact: true }).waitFor();
      await page.getByRole("button", { name: /ไปชำระเงิน/ }).click();
      assert.equal(await page.getByLabel("รับเงินมา", { exact: true }).inputValue(), "230", "L must not qualify for the S gift rule");
      await page.getByRole("button", { name: /กลับไปแก้รายการ/ }).click();
      await scan(barcode);
      await panel.getByRole("radio", { name: "ไซส์ S", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: /ไปชำระเงิน/ }).isDisabled(), true, "an unresolved size cannot be skipped with an existing basket");
      assert.equal(await panel.getByRole("radio", { name: "ไซส์ L", exact: true }).isChecked(), false, "a fresh scan does not reuse the previous choice");
      await panel.getByRole("radio", { name: "ไซส์ S", exact: true }).check();
      await panel.getByRole("button", { name: "เพิ่มลงบิล" }).click();
      await panel.getByText("เพิ่มลงบิลแล้ว", { exact: true }).waitFor();
      await imageCheck();
      await page.getByRole("button", { name: /ไปชำระเงิน/ }).click();
      assert.equal(await page.getByLabel("รับเงินมา", { exact: true }).inputValue(), "300", "the selected S qualifies for the real gift line");
      await page.getByRole("button", { name: /กลับไปแก้รายการ/ }).click();
      await panel.getByRole("button", { name: "กลับแคตตาล็อก" }).click();
      await page.getByRole("button", { name: /FAKE Product FAKE-A/ }).click();
      await panel.getByRole("radio", { name: "ไซส์ S", exact: true }).waitFor();
      assert.equal(scans.at(-1).size, null, "catalog cards must ask instead of selecting their display price variant");
      assert.equal(await panel.getByRole("button", { name: "เพิ่มลงบิล" }).isDisabled(), true);
      await panel.getByRole("button", { name: "กลับแคตตาล็อก" }).click();
      const before = await page.locator("article").count();
      await scan("EXACT-BOX");
      await panel.getByText("เพิ่มลงบิลแล้ว", { exact: true }).waitFor();
      await panel.getByText(/ไซส์ L · กล่อง · ฿900\.00/).waitFor();
      assert.equal(await page.locator("article").count(), before + 1);
      await imageCheck();
      await page.screenshot({ path: `${output}/${width}-exact-pack.png`, fullPage: true });
      const baseL = page.locator("article").filter({ hasText: "FAKE-A · L" }).first();
      for (let index = 0; index < 4; index++) await baseL.getByRole("button", { name: "+", exact: true }).click();
      assert.equal(await baseL.locator("b").innerText(), "4", "four loose units plus a six-pack exhaust ten base units");
      await page.getByRole("alert").filter({ hasText: "หน่วยฐาน" }).waitFor();
      await scan("PENDING-S");
      assert.equal(await page.getByRole("button", { name: /ไปชำระเงิน/ }).isDisabled(), true, "checkout waits for the scan response");
      assert.equal(await baseL.getByRole("button", { name: "−", exact: true }).isDisabled(), true, "quantity edits cannot race the stock check");
      for (let attempt = 0; !releaseScan && attempt < 500; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(releaseScan, "the delayed scan reached the mocked server");
      releaseScan(); releaseScan = null;
      await panel.getByText("เพิ่มลงบิลแล้ว", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: /ไปชำระเงิน/ }).isDisabled(), false);
      await scan("MISSING");
      await page.getByRole("alert").filter({ hasText: "ไม่พบสินค้า" }).waitFor();
      assert.equal(await panel.count(), 0, "failed scan must not leave the previous product photo displayed");
      assert.equal(await page.locator("article").count(), before + 1);
      assert.deepEqual(mutations, []);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: one product image, explicit sizes, size-specific gifts, exact pack and missing code; no live writes`);
    } catch (error) {
      console.error(consoleErrors.map(message => message.slice(0, 1000)).join("\n"));
      console.error((await page.locator("body").innerText()).slice(-6000));
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      throw error;
    } finally { releaseScan?.(); await context.close(); }
  }
} finally { await browser.close(); }
