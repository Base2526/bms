import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3002";
const output = ".test-output/cross-sku-gifts";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const rule = { kind: "BUY_A_GET_B", id: "FAKE-promo", buySku: "FAKE-A", buySize: "M", buyQty: 2, giftSku: "FAKE-B", giftSize: "M", getQty: 1, bundlePrice: null };
const products = [
  { sku: "FAKE-A", name: "Test purchase A", price: 100 },
  { sku: "FAKE-B", name: "Test gift B", price: 30 },
].map((p) => ({ ...p, availability: "AVAILABLE", availableTotal: 100, imageUrl: null,
  availableSizes: [{ size: "M", available: 100, price: p.price }], catalogVariants: [{ code: "M", displayName: "Medium", active: true }] }));
const cashier = { id: "FAKE-cashier", name: "FAKE Cashier", role: "Cashier", hasPin: true, posOnly: true };
const errors = [], mutations = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base }, { name: "lang", value: "th", url: base }]);
await ctx.addInitScript(() => {
  window.bmsDesktop = { isDesktop: true, getDeviceToken: async () => "FAKE-token", getStorageNamespace: async () => "FAKE-gift-smoke",
    getAppInfo: async () => ({ version: "0.2.14-pilot.3", platform: "darwin", arch: "arm64" }) };
});
await ctx.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/retail-local/desktop-update") return route.fulfill({ json: { status: "unavailable", releases: [] } });
  if (path === "/api/auth/me") return route.fulfill({ json: { isAuthenticated: true,
    admin: { id: "FAKE-admin", name: "Test Admin", role: "Administrator", tenant_id: "FAKE-tenant", language: "th" } } });
  if (path !== "/api/graphql") return route.fulfill({ json: {} });
  const { query = "", variables = {} } = route.request().postDataJSON();
  let data = {};
  if (query.includes("MyBmsPermissions")) data = { myBmsPermissions: ["product.view", "product.edit"] };
  else if (query.includes("query ProductPromotions")) data = { bmsPromotionLocations: [], bmsProductPromotions: [] };
  else if (query.includes("query PromotionProducts")) data = { bmsProducts: { items: products.filter((p) => p.sku.includes(variables.search || "")) } };
  else if (query.includes("query ProductPriceTiers")) data = { bmsProductPriceTiers: [] };
  else if (query.includes("mutation UpsertPromotion")) { mutations.push(variables.input); data = { bmsUpsertProductPromotion: { id: rule.id, ...variables.input } }; }
  else if (query.includes("query PosBootstrap")) data = { bmsPosSession: {
    device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", scanner: { mode: "OFF" } },
    location: { id: "FAKE-location", name: "Gift promotion test", branchCode: "MAIN" },
    shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt: new Date().toISOString() },
    cashiers: [cashier], approvers: [], store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
    surface: "retail", businessArchetype: "retail", vat: { registered: false, priceIncludesVat: true, rate: 7, calendarEra: "BE", cashRounding: "NONE" },
  } };
  else if (query.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
  else if (query.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: products } };
  else if (query.includes("query MobilePosScan")) {
    const p = products.find((p) => p.sku === variables.code);
    data = { bmsPosScan: { sku: p.sku, size: "M", productName: p.name, receiptName: p.name, baseQty: 1,
      packCode: "BASE", unitName: "ชิ้น", packPrice: p.price, basePrice: p.price, available: 100,
      stockTracked: true, serialTracked: false, scaleBarcode: null, imageUrl: null, priceTiers: [], promotion: rule, modifiers: [], packs: [] } };
  }
  else if (query.includes("query DesktopBenefitsPreview")) data = { bmsPosMemberPreview: { status: "READY", netTotal: 200, amountDue: 200, totalDiscount: 0,
    tierDiscount: 0, couponDiscount: 0, pointsDiscount: 0, pointsUsed: 0, loyaltyEnabled: false, member: null } };
  else if (query.includes("mutation")) throw new Error(`Unexpected mutation ${query.slice(0, 100)}`);
  return route.fulfill({ json: { data } });
});
const page = await ctx.newPage();
page.setDefaultTimeout(25_000);
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`${base}/admin/promotions`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByPlaceholder("ค้นสินค้าจาก SKU หรือชื่อ").fill("FAKE-A");
  await page.getByPlaceholder("ค้นสินค้าจาก SKU หรือชื่อ").press("Enter");
  await page.getByRole("combobox", { name: "เลือกสินค้า", exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("FAKE-A · Test purchase A", { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
  // Searching again must not discard the selected purchase or its variants.
  await page.getByPlaceholder("ค้นสินค้าจาก SKU หรือชื่อ").fill("NO-MATCH");
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/graphql") && r.request().postData()?.includes("NO-MATCH")),
    page.getByPlaceholder("ค้นสินค้าจาก SKU หรือชื่อ").press("Enter"),
  ]);
  await page.locator("#kind").press("ArrowDown");
  await page.locator(".ant-select-dropdown:visible").getByText("ซื้อ A แถม B (คนละสินค้า)", { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
  await page.locator("#buySize").press("ArrowDown");
  await page.locator(".ant-select-dropdown:visible").getByText("M · Medium", { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
  await page.locator("#giftSku").fill("FAKE-B");
  await page.locator(".ant-select-dropdown:visible").getByText("FAKE-B · Test gift B", { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
  await page.locator("#giftSku").fill("NO-MATCH");
  await page.locator("#giftSku").press("Escape");
  await page.locator("#giftSku").blur();
  await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
  await page.locator("#giftSize").press("ArrowDown");
  await page.locator(".ant-select-dropdown:visible").getByText("M · Medium", { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
  await page.locator("#buyQty").fill("2");
  await page.locator("#getQty").fill("1");
  await page.locator("#getQty").press("Tab");
  await page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
  await page.screenshot({ path: `${output}/admin-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/admin-mobile.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByRole("button", { name: "บันทึกโปร", exact: true }).click();
  await page.getByText("บันทึกโปรแล้ว", { exact: true }).waitFor();
  assert.equal(mutations.length, 1);
  assert.deepEqual([mutations[0].kind, mutations[0].productSku, mutations[0].giftSku, mutations[0].buySize, mutations[0].giftSize, mutations[0].buyQty, mutations[0].getQty],
    ["BUY_A_GET_B", "FAKE-A", "FAKE-B", "M", "M", 2, 1]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/pos/app`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await page.getByRole("button", { name: /Test purchase A/ }).click();
  const purchase = page.locator("article").filter({ hasText: "Test purchase A" });
  await purchase.getByRole("button", { name: "+", exact: true }).click();
  const gift = page.getByRole("region", { name: "ของแถมตามโปรโมชัน" });
  await gift.getByRole("button").click();
  await page.locator("article").filter({ hasText: "Test gift B" }).waitFor();
  await page.locator("aside").filter({ hasText: "บิลปัจจุบัน" }).getByText("฿200.00", { exact: true }).first().waitFor();
  await page.screenshot({ path: `${output}/pos-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await gift.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/pos-mobile.png` });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await purchase.getByRole("button", { name: "−", exact: true }).click();
  await page.locator("aside").filter({ hasText: "บิลปัจจุบัน" }).getByText("฿130.00", { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: admin saves A/B variants; POS adds real gift, totals 200 then 130 after lost threshold; desktop/mobile screenshots; no sale submitted");
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  console.error(await page.locator("main").last().innerText().catch(() => "No main"));
  throw error;
} finally { await browser.close(); }
