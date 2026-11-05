import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Real routes and styles, isolated API/native-bridge fixtures; never removes a real pairing.
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const baseUrl = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
const output = "apps/desktop/dist-smoke/unpair";
await mkdir(output, { recursive: true });
const failure = "ลบข้อมูลจับคู่ไม่สำเร็จ ข้อมูลเดิมยังอยู่ กรุณาตรวจสิทธิ์เข้าถึงไฟล์แล้วลองใหม่";
const cashier = { id: "FAKE-cashier", name: "FAKE cashier", email: "fake@example.invalid", hasPin: true, role: "Cashier", isPharmacist: false, posOnly: true };

async function checkSurface(surface, width, missingToken = false) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.addCookies([{ name: "lang", value: "th", url: baseUrl }, { name: "theme", value: "light", url: baseUrl }]);
  await context.addInitScript(({ failure, missingToken }) => {
    window.unpairAttempts = 0;
    window.bmsDesktop = {
      isDesktop: true,
      getDeviceToken: async () => missingToken ? null : "FAKE-token",
      getStorageNamespace: async () => "FAKE-unpair-smoke",
      unpair: async () => {
        window.unpairAttempts++;
        return { ok: false, error: failure };
      },
    };
  }, { failure, missingToken });
  const restaurant = surface === "restaurant";
  const session = {
    device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", registeredPosNo: "002", scanner: { mode: "OFF", prefixKey: "", suffixKey: "Enter", maxGapMs: 50 } },
    location: { id: "FAKE-location", name: "FAKE branch", branchCode: "MAIN" },
    shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt: new Date().toISOString() },
    cashiers: [cashier], approvers: [], kitchenOperators: [], purchaseReceivers: [],
    store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
    surface: restaurant ? "restaurant" : "retail", businessArchetype: restaurant ? "restaurant" : "retail",
    vat: { registered: false, priceIncludesVat: true, rate: 7, calendarEra: "BE", cashRounding: "NONE" },
  };
  await context.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/graphql") {
      const query = route.request().postDataJSON()?.query || "";
      let data = {};
      if (query.includes("query PosBootstrap")) data = { bmsPosSession: session };
      if (query.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
      if (query.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: [] } };
      return route.fulfill({ json: { data } });
    }
    if (path === "/api/pos/session") return route.fulfill({ json: session });
    if (path === "/api/pos/restaurant/floor") return route.fulfill({ json: { areas: [], tables: [] } });
    if (path === "/api/pos/restaurant/waitlist") return route.fulfill({ json: { entries: [], waitingCount: 0, calledCount: 0, waitingGuests: 0 } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const entry = surface === "compact" ? "/pos/app" : restaurant ? "/pos/restaurant?screen=settings" : "/pos?tab=settings";
    await page.goto(`${baseUrl}${entry}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    if (surface === "compact" && !missingToken) {
      await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
      await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
      await page.getByRole("button", { name: "ตั้งค่า", exact: true }).click();
    }
    const unpair = page.getByRole("button", { name: missingToken
      ? surface === "compact" ? "เปิดหน้าจับคู่เครื่อง" : "ตั้งค่าแอปใหม่"
      : "เลิกจับคู่เครื่องนี้", exact: true });
    await unpair.waitFor();
    const storage = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /bms\.pos\.local|operator/i.test(key))));
    const before = await storage();
    await unpair.click();
    const alert = page.getByRole("alert").filter({ hasText: failure });
    await alert.waitFor({ state: "visible" });
    await alert.scrollIntoViewIfNeeded();
    const box = await alert.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `${surface}: error must fit the screen`);
    assert.equal(new URL(page.url()).pathname, new URL(`${baseUrl}${entry}`).pathname);
    assert.deepEqual(await storage(), before, `${surface}: failed unpair must preserve saved state`);
    if (surface === "compact" && !missingToken) await page.locator('summary[aria-label="เมนูพนักงาน FAKE cashier"]').waitFor();
    await unpair.click();
    assert.equal(await page.evaluate(() => window.unpairAttempts), 2, "failure must permit retry");
    await alert.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${surface}-${missingToken ? "unpaired-" : ""}${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ surface, width, missingToken, failureVisible: true, savedStatePreserved: true, retryAvailable: true }));
  } catch (error) {
    await page.screenshot({ path: `${output}/failure-${surface}-${width}.png`, fullPage: true });
    console.error(JSON.stringify({ surface, width, attempts: await page.evaluate(() => window.unpairAttempts), pageErrors: errors }));
    throw error;
  } finally { await context.close(); }
}

async function checkManual(lang, width) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
  await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-fixture", url: baseUrl }, { name: "lang", value: lang, url: baseUrl }]);
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/auth/me"
      ? { isAuthenticated: true, admin: { id: "FAKE", role: "Administrator", name: "FAKE", language: lang } }
      : path.endsWith("/graphql") ? { data: { myBmsPermissions: [] } } : {} });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    assert.equal((await page.goto(`${baseUrl}/admin/manual`, { waitUntil: "domcontentloaded" })).status(), 200);
    const guidance = page.getByText(lang === "th" ? "หาก Desktop เลิกจับคู่ไม่สำเร็จ" : "If Desktop cannot remove pairing", { exact: false }).first();
    await guidance.waitFor();
    await guidance.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/manual-${lang}-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ manual: lang, width, recoveryGuidanceVisible: true }));
  } finally { await context.close(); }
}

try {
  for (const surface of ["retail", "compact", "restaurant"]) {
    for (const width of [1440, 390]) await checkSurface(surface, width);
  }
  for (const surface of ["retail", "compact"]) for (const width of [1440, 390]) await checkSurface(surface, width, true);
  for (const lang of ["th", "en"]) for (const width of [1440, 390]) await checkManual(lang, width);
} finally { await browser.close(); }
