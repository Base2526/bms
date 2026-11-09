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
    const displays = [
      { id: "FAKE-cashier-display", label: "จอแคชเชียร์", primary: true, cashier: true, width: 1440, height: 900, scaleFactor: 1, rotation: 0 },
      { id: "FAKE-external-display", label: "จอที่ 2", primary: false, cashier: false, width: 1920, height: 1080, scaleFactor: 1, rotation: 0 },
    ];
    const customerDisplay = { mode: "off", targetDisplayId: null, activeDisplayId: null, open: false, preview: false,
      cashierDisplayId: displays[0].id, displays, targetAvailable: true, positioningLimited: false, conflict: false };
    const queueDisplay = { ...customerDisplay };
    window.bmsDesktop = {
      isDesktop: true,
      getDeviceToken: async () => missingToken ? null : "FAKE-token",
      getStorageNamespace: async () => "FAKE-unpair-smoke",
      getCustomerDisplayState: async () => customerDisplay,
      getQueueDisplayState: async () => queueDisplay,
      setCustomerDisplayConfig: async () => ({ ok: true, state: customerDisplay }),
      setQueueDisplayConfig: async () => ({ ok: true, state: queueDisplay }),
      setExternalDisplayRole: async () => ({ ok: true, state: { customer: customerDisplay, queue: queueDisplay } }),
      identifyDisplays: async () => ({ ok: true }),
      openCustomerDisplayPreview: async () => ({ ok: true, state: customerDisplay }),
      closeCustomerDisplayPreview: async () => ({ ok: true, state: customerDisplay }),
      openQueueDisplayPreview: async () => ({ ok: true, state: queueDisplay }),
      closeQueueDisplayPreview: async () => ({ ok: true, state: queueDisplay }),
      onCustomerDisplayStateChanged: () => () => {},
      onQueueDisplayStateChanged: () => () => {},
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
    if (!missingToken) {
      const managedDisplays = page.locator("[data-managed-display-settings]");
      await managedDisplays.waitFor();
      await page.getByRole("heading", { name: "จอภายนอก", exact: true }).scrollIntoViewIfNeeded();
      const layout = await managedDisplays.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const cardRects = Array.from(element.querySelectorAll("[data-display-role]"), (card) => {
          const cardRect = card.getBoundingClientRect();
          return { top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom, left: cardRect.left };
        });
        const controlGaps = Array.from(element.querySelectorAll("[data-display-role]"), (card) => {
          const select = card.querySelector(".pos-display-select")?.getBoundingClientRect();
          const button = card.querySelector(".pos-display-preview-button")?.getBoundingClientRect();
          return select && button ? button.top - select.bottom : -1;
        });
        return { cards: element.querySelectorAll("[data-display-role]").length,
          cardRects, controlGaps,
          left: rect.left, right: rect.right, viewport: innerWidth,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      assert.equal(layout.cards, 2, `${surface}: customer and queue display cards stay visible`);
      assert.ok(layout.controlGaps.every((gap) => gap >= 12),
        `${surface}: display selector and test action keep breathing room`);
      if (width >= 768) {
        assert.ok(Math.abs(layout.cardRects[0].top - layout.cardRects[1].top) <= 1,
          `${surface}: display cards align side by side on desktop`);
        assert.ok(layout.cardRects[0].right < layout.cardRects[1].left,
          `${surface}: desktop display cards keep a visible gutter`);
      } else {
        assert.ok(Math.abs(layout.cardRects[0].left - layout.cardRects[1].left) <= 1,
          `${surface}: display cards align in one mobile column`);
        assert.ok(layout.cardRects[0].bottom < layout.cardRects[1].top,
          `${surface}: mobile display cards keep a visible gap`);
      }
      assert.ok(layout.left >= -1 && layout.right <= layout.viewport + 1, `${surface}: display settings fit the viewport`);
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${surface}: display settings have no horizontal overflow`);
      await page.screenshot({ path: `${output}/${surface}-settings-${width}.png`, fullPage: true });
    }
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
