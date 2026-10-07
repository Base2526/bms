import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
const output = ".test-output/desktop-refresh-status";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const cashier = { id: "FAKE-cashier", name: "FAKE Cashier", hasPin: true, role: "Cashier", posOnly: true, approvals: [] };
const bootstrap = {
  device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
  location: { id: "FAKE-location", name: "FON Board GAME สาขาหลัก", branchCode: "MAIN" },
  shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt: new Date().toISOString() },
  cashiers: [cashier], approvers: [], kitchenOperators: [],
  store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
  surface: "retail", businessArchetype: "retail",
  vat: { registered: false, priceIncludesVat: true, rate: 7, cashRounding: "NONE" },
};
const catalog = [{ sku: "FAKE-A", name: "FAKE Product", price: 100, availability: "AVAILABLE", availableTotal: 10,
  imageUrl: "/sample/restaurant/pork-garlic.jpg", availableSizes: [{ size: "STD", price: 100, available: 10 }] }];

try {
  for (const width of [1440, 1024, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "lang", value: "th", url: base }]);
    await context.addInitScript(() => {
      window.bmsDesktop = { isDesktop: true, getDeviceToken: async () => "FAKE-token",
        getStorageNamespace: async () => "FAKE-refresh",
        getAppInfo: async () => ({ version: "0.2.14-pilot.2", platform: "darwin", arch: "arm64" }) };
    });
    let pending = null, hold = false, fail = false, bootstrapReads = 0;
    const errors = [], writes = [];
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
      let json = {};
      if (path === "/api/graphql") {
        const q = body?.query || "";
        let data = {};
        if (q.includes("query PosBootstrap")) {
          bootstrapReads++;
          if (hold) await new Promise(resolve => { pending = resolve; });
          if (fail) {
            await route.fulfill({ json: { errors: [{ message: "FAKE refresh failed", extensions: { code: "INTERNAL_SERVER_ERROR" } }] } });
            return;
          }
          data = { bmsPosSession: bootstrap };
        } else if (q.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
        else if (q.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: catalog } };
        else if (q.includes("mutation")) writes.push(q);
        json = { data };
      } else if (path === "/api/pos/session") json = bootstrap;
      else if (path.endsWith("/desktop-update")) json = { status: "unavailable", releases: [] };
      else if (body && !["/api/logs", "/api/ws/ticket"].includes(path)) writes.push(path);
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`${base}/pos/app`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
      await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
      const scanner = page.getByLabel("สแกนบาร์โค้ดหรือรหัสสินค้า");
      await scanner.waitFor();
      const header = page.locator('header[class*="DesktopPosRenderer_topbar"]');
      const refresh = header.getByRole("button", { name: "รีเฟรชข้อมูล", exact: true });
      const status = header.getByRole("status", { name: "สถานะการอัปเดตข้อมูล" });
      const progress = header.locator('[class*="refreshProgress"]');
      await scanner.fill("UNSUBMITTED-DRAFT");
      const initial = await scanner.boundingBox();
      const headerInitial = await header.boundingBox();
      const reads = bootstrapReads;
      hold = true;
      await refresh.click();
      await status.getByText("กำลังอัปเดตข้อมูล…", { exact: true }).waitFor();
      assert.equal(await refresh.isDisabled(), true);
      await page.waitForFunction(() => document.querySelector('[class*="refreshProgress"]'));
      assert.equal(await progress.count(), 1);
      assert.equal(await page.locator('[class*="contentRefreshOverlay"]').count(), 0);
      assert.equal(await page.getByText("เมนู ผู้ปฏิบัติงาน และกะจะยังคงอยู่").count(), 0);
      assert.deepEqual(await scanner.boundingBox(), initial, "refresh must not move the scanner");
      assert.deepEqual(await header.boundingBox(), headerInitial, "refresh must not resize the header");
      const bounds = await status.boundingBox();
      assert.ok(bounds.x >= headerInitial.x && bounds.x + bounds.width <= width);
      assert.ok(bounds.y >= headerInitial.y && bounds.y + bounds.height <= headerInitial.y + headerInitial.height);
      const bar = await progress.boundingBox();
      assert.equal(bar.height, 3);
      assert.ok(bar.y + bar.height <= headerInitial.y + headerInitial.height);
      assert.ok(bar.y + bar.height < initial.y, "progress must stay above the scanner");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${output}/${width}-loading.png`, fullPage: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await progress.evaluate(el => getComputedStyle(el, "::after").animationName), "none");
      assert.equal(await refresh.locator(".anticon-spin").evaluate(el => getComputedStyle(el).animationName), "none");
      for (let attempt = 0; !pending && attempt < 500; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(pending, "refresh reached the delayed fixture");
      hold = false; pending(); pending = null;
      await page.waitForFunction(() => !document.querySelector('[class*="refreshProgress"]'));
      assert.equal(bootstrapReads, reads + 1);
      assert.equal(await status.innerText(), "");
      assert.equal(await refresh.isDisabled(), false);
      assert.equal(await scanner.inputValue(), "UNSUBMITTED-DRAFT");
      assert.deepEqual(await scanner.boundingBox(), initial);
      fail = true;
      await refresh.click();
      await page.getByRole("alert").filter({ hasText: "รีเฟรชข้อมูลไม่สำเร็จ" }).waitFor();
      assert.equal(await progress.count(), 0);
      assert.equal(await status.innerText(), "");
      assert.equal(await refresh.isDisabled(), false);
      assert.equal(await scanner.inputValue(), "UNSUBMITTED-DRAFT");
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: header-only status, stable layout, reduced motion, success/failure cleanup; no live writes`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      throw error;
    } finally { pending?.(); await context.close(); }
  }
} finally { await browser.close(); }
