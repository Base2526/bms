import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3003";
const output = ".test-output/desktop-checkout-summary";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const cashier = { id: "FAKE-cashier", name: "FAKE Cashier", hasPin: true, role: "Cashier", posOnly: true, approvals: [] };
const promotion = { kind: "BUY_A_GET_B", id: "FAKE-gift", buySku: "FAKE-A", buySize: "S", buyQty: 1, giftSku: "FAKE-G", giftSize: "S", getQty: 1 };
const hit = (sku, size, price, promo = null) => ({ sku, size, name: sku, productName: sku, receiptName: sku, baseQty: 1, packCode: "BASE", unitName: "ชิ้น", packPrice: price, basePrice: price, available: 20,
  stockTracked: true, serialTracked: false, priceTiers: [], packs: [], modifiers: [], promotion: promo, imageUrl: null });
const hits = { FIRST: hit("FAKE-355", "L", 1963), BUY: hit("FAKE-A", "S", 3596, promotion), GIFT: hit("FAKE-G", "S", 1458), LARGE: hit("FAKE-A", "L", 4000) };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "lang", value: "th", url: base }]);
    await context.addInitScript(() => {
      window.bmsDesktop = { isDesktop: true, getDeviceToken: async () => "FAKE-token", getStorageNamespace: async () => "FAKE-summary",
        getAppInfo: async () => ({ version: "0.2.14-pilot.2", platform: "darwin", arch: "arm64" }) };
    });
    const session = { device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
      location: { id: "FAKE-location", name: "FAKE shop", branchCode: "MAIN" }, shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt: new Date().toISOString() },
      cashiers: [cashier], approvers: [], kitchenOperators: [], store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
      surface: "retail", businessArchetype: "retail", vat: { registered: false, priceIncludesVat: true, rate: 7, cashRounding: "NONE" } };
    const errors = [], mutations = [];
    const preview = (input) => ({ status: "READY", subtotal: input.subtotal, netTotal: input.subtotal, amountDue: input.subtotal,
      totalDiscount: 0, tierDiscount: 0, couponDiscount: 0, pointsDiscount: 0, manualDiscount: 0, pointsUsed: 0, loyaltyEnabled: false, member: null });
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
      let json = {};
      if (path === "/api/graphql") {
        const q = body?.query || "", variables = body?.variables || {};
        let data = {};
        if (q.includes("query PosBootstrap")) data = { bmsPosSession: session };
        else if (q.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
        else if (q.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: [] } };
        else if (q.includes("query MobilePosScan")) data = { bmsPosScan: hits[variables.code] || Object.values(hits).find(h => h.sku === variables.code && h.size === variables.size) };
        else if (q.includes("query DesktopBenefitsPreview")) data = { bmsPosMemberPreview: preview(variables.input) };
        else if (q.includes("mutation")) mutations.push(q);
        json = { data };
      } else if (path === "/api/pos/session") json = session;
      else if (path === "/api/pos/member/preview") json = preview(body);
      else if (path.endsWith("/desktop-update")) json = { status: "unavailable", releases: [] };
      else if (body && path !== "/api/logs") mutations.push(path);
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", e => errors.push(e.message));
    const checkout = () => page.getByRole("button", { name: /ไปชำระเงิน/ }).click();
    const scan = async (code) => {
      const input = page.getByLabel("สแกนบาร์โค้ดหรือรหัสสินค้า");
      await input.fill(code); await input.press("Enter");
      await page.waitForFunction(() => document.querySelector('input[aria-label="สแกนบาร์โค้ดหรือรหัสสินค้า"]')?.value === "");
    };
    try {
      await page.goto(`${base}/pos/app`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
      await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
      // Gift starts paid; adding its qualifying SKU later must reduce automatic cash.
      await scan("GIFT"); await scan("FIRST"); await scan("LARGE"); await checkout();
      assert.equal(await page.getByLabel("รับเงินมา", { exact: true }).inputValue(), "7421");
      await page.getByRole("button", { name: /กลับไปแก้รายการ/ }).click();
      await scan("BUY"); await checkout();
      await page.getByText(/ของแถม 1 หน่วยฐาน/).waitFor();
      const rows = page.locator('article').filter({ hasText: /หลังโปร/ });
      assert.equal(await rows.count(), 4);
      assert.match(await rows.filter({ hasText: "FAKE-G" }).innerText(), /หลังโปร ฿0\.00/);
      assert.equal(await page.getByLabel("รับเงินมา", { exact: true }).inputValue(), "9559");
      await page.getByLabel("รับเงินมา", { exact: true }).fill("12354");
      await page.getByText("฿2,795.00", { exact: true }).waitFor();
      await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("ยืนยันรับชำระ"))?.disabled);
      const cashBounds = await page.getByLabel("รับเงินมา", { exact: true }).boundingBox();
      assert.ok(cashBounds.x >= 0 && cashBounds.x + cashBounds.width <= width, "cash field stays inside viewport");
      await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
      if (width < 600) {
        await rows.first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/${width}-summary.png`, fullPage: true });
      }
      await page.getByRole("button", { name: "พอดี", exact: true }).click();
      await page.getByRole("button", { name: /กลับไปแก้รายการ/ }).click();
      // Removing a paid item lowers the default tender. Removing the buyer revokes the gift.
      await page.locator('article').filter({ hasText: "FAKE-355" }).getByRole("button", { name: "−", exact: true }).click();
      await checkout();
      assert.equal(await page.getByLabel("รับเงินมา", { exact: true }).inputValue(), "7596");
      await page.getByLabel("รับเงินมา", { exact: true }).fill("8000");
      await page.getByRole("button", { name: /กลับไปแก้รายการ/ }).click();
      await scan("FIRST"); await checkout();
      assert.equal(await page.getByLabel("รับเงินมา", { exact: true }).inputValue(), "8000");
      assert.equal(await page.getByRole("button", { name: /ยืนยันรับชำระ/ }).isDisabled(), true);
      assert.deepEqual(mutations, []);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: gift summary, automatic repricing, manual cash, insufficient cash, no sale mutations`);
    } catch (error) {
      console.error((await page.locator("body").innerText()).slice(-6500));
      await page.screenshot({ path: `${output}/${width}-failure.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
