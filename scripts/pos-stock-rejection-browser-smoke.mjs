import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Real renderer, intercepted API fixtures only; never submits a real stock/refund mutation.
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3100";
const output = ".test-output/pos-stock-rejection";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const cashier = { id: "FAKE-cashier", name: "FAKE Cashier", hasPin: true, role: "Cashier", posOnly: true, approvals: [] };
const bootstrap = {
  device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
  location: { id: "FAKE-location", name: "FAKE branch", branchCode: "MAIN" },
  shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 1000, openedAt: new Date().toISOString() },
  cashiers: [cashier], approvers: [], kitchenOperators: [],
  store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
  surface: "retail", businessArchetype: "retail",
  vat: { registered: false, priceIncludesVat: true, rate: 7, cashRounding: "NONE" },
};
const reason = "ยอดล็อตปลายทางไม่ตรงกับสต็อก กรุณาตรวจสอบก่อนรับสินค้า";
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    // This fixture has no WS gateway; exercise the renderer's normal polling fallback.
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addCookies([{ name: "lang", value: "th", url: base }, { name: "ADMIN_COOKIE", value: "FAKE-fixture", url: base }]);
    await context.addInitScript(() => {
      window.bmsDesktop = { isDesktop: true, getDeviceToken: async () => "FAKE-token",
        getStorageNamespace: async () => "FAKE-stock-recheck",
        getAppInfo: async () => ({ version: "0.2.14-pilot.5", platform: "win32", arch: "x64" }) };
    });
    const submissions = [], errors = [];
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
      let json = {};
      if (path === "/api/graphql") {
        const q = body?.query || "";
        let data = {};
        if (q.includes("query PosBootstrap")) data = { bmsPosSession: bootstrap };
        else if (q.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
        else if (q.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: [] } };
        else if (q.includes("MyBmsPermissions")) data = { myBmsPermissions: ["product.view"] };
        json = { data };
      } else if (path === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE-admin", name: "FAKE Admin", role: "Administrator", tenant_id: "FAKE-tenant", language: "th" } };
      else if (path === "/api/pos/session") json = bootstrap;
      else if (path === "/api/pos/recent-sales") json = { sales: [{
        orderId: "FAKE-order", docNo: "FAKE-001", orderStatus: "COMPLETED", saleLocationId: "FAKE-location",
        posDeviceId: "FAKE-device", total: 100, soldAt: new Date().toISOString(), paymentMethod: "CASH",
        payments: [{ method: "CASH", amount: 100 }], lines: [{ orderItemId: 1, sku: "FAKE-SKU", receiptName: "FAKE Product",
          size: "BASE", packQty: 2, packPrice: 50, basePrice: 50, refundablePackQty: 2, baseQty: 1 }],
      }] };
      else if (path === "/api/pos/return") {
        submissions.push(body);
        return route.fulfill({ status: 409, json: { status: "STOCK_REVIEW_REQUIRED", reason } });
      } else if (path.endsWith("/desktop-update")) json = { status: "unavailable", releases: [] };
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    try {
      await page.goto(`${base}/pos/app?module=returns`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
      await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
      await page.getByRole("button", { name: /บิลล่าสุด \(1\)/ }).click();
      await page.getByRole("button", { name: "▸ คืน/เปลี่ยนสินค้า", exact: true }).click();
      await page.locator(".pos-ret-reason select").selectOption("QUALITY_ISSUE");
      await page.getByPlaceholder("รายละเอียดเหตุผล (บังคับและแสดงในประวัติ)").fill("FAKE stock check");
      await page.getByRole("button", { name: "คืนทั้งบิล", exact: true }).click();
      await page.locator('.pos-note--err').filter({ hasText: reason }).waitFor();
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].mode, "FULL");
      assert.ok(submissions[0].idempotencyKey);
      await page.getByRole('button', { name: /เพิ่มจำนวนคืน.*FAKE-SKU/ }).click();
      for (const label of ['คืนบางรายการ', 'คืนที่เลือก + ทำบิลเปลี่ยน']) {
        await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === '/api/pos/return'),
          page.getByRole('button', { name: label, exact: true }).click(),
        ]);
        await page.locator('.pos-note--err').filter({ hasText: reason }).waitFor();
        assert.equal(submissions.at(-1).mode, 'PARTIAL');
        assert.deepEqual(submissions.at(-1).lines, [{ orderItemId: 1, packQty: 1 }]);
      }
      assert.equal(submissions.length, 3);
      assert.equal(await page.getByText("ดูใบรับคืนล่าสุด", { exact: true }).count(), 0);
      await page.locator('.pos-note--err').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${width}-rejected.png`, fullPage: true });
      assert.deepEqual(errors, []);
      // Also exercise the edited manual route at both viewport sizes.
      await page.goto(`${base}/admin/manual`, { waitUntil: "domcontentloaded", timeout: 120000 });
      const manualNote = page.getByText(/สินค้าที่ติดตามล็อต\/วันหมดอายุหรือยังมีข้อมูลล็อตต้องคืนผ่านบิลต้นทาง/);
      await manualNote.waitFor();
      await manualNote.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${width}-manual.png` });
      assert.deepEqual(errors, []);
      console.log(`PASS stock rejection and manual at ${width}px`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      console.error({ errors, text: (await page.locator('body').innerText()).slice(0, 6000) });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
