import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const sharp = createRequire(new URL("../apps/web/package.json", import.meta.url))("sharp");

// Run against the real Next route with isolated browser-only fixtures. No shop data is written.
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const baseUrl = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
const output = "apps/desktop/dist-smoke/desktop-update";
await mkdir(output, { recursive: true });
const cashier = { id: "FAKE-cashier", name: "kid", email: "fake@example.invalid", hasPin: true, role: "Cashier", isPharmacist: false, posOnly: true };
const release = { id: "FAKE-release", platform: "macos-arm64", version: "0.2.15", downloadUrl: "/api/retail-local/download/FAKE-release", minOs: "macOS 13+", releaseNotes: "ปรับปรุงการพิมพ์ใบเสร็จ\nเพิ่มความเสถียรของจอลูกค้า" };
const bootstrap = {
  device: { id: "FAKE-device", code: "POS-01", name: "FAKE register", registeredPosNo: "002", scanner: { mode: "OFF", prefixKey: "", suffixKey: "Enter", maxGapMs: 50 } },
  location: { id: "FAKE-location", name: "Rainny Perfume 2 บางขุนเทียน", branchCode: "MAIN" },
  shift: { id: "FAKE-shift", status: "OPEN", openingFloat: 0, openedAt: new Date().toISOString() },
  cashiers: [cashier], approvers: [], store: { name: "FAKE shop", receiptLanguageMode: "th", paymentQr: null },
  surface: "retail", businessArchetype: "retail",
  vat: { registered: false, priceIncludesVat: true, rate: 7, calendarEra: "BE", cashRounding: "NONE" },
};

async function verifyToolbarIcons(page, label) {
  const icons = page.locator("header .anticon svg");
  for (let index = 0; index < await icons.count(); index++) {
    const icon = icons.nth(index);
    if (!await icon.isVisible()) continue;
    const paint = await icon.evaluate((el) => ({
      name: el.parentElement?.getAttribute("aria-label"),
      fill: getComputedStyle(el).fill,
      stroke: getComputedStyle(el).stroke,
    }));
    assert.notEqual(paint.fill, "none", `${label}: ${paint.name} lost its filled artwork`);
    const { data, info } = await sharp(await icon.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let visiblePixels = 0;
    // Compare with the clear corner of the icon, in either light or dark mode.
    for (let i = 0; i < data.length; i += info.channels) {
      const difference = Math.max(Math.abs(data[i] - data[0]), Math.abs(data[i + 1] - data[1]), Math.abs(data[i + 2] - data[2]));
      if (difference > 40) visiblePixels++;
    }
    assert.ok(visiblePixels >= 20, `${label}: ${paint.name} is blank/faint (${visiblePixels} visible pixels)`);
  }
  const refresh = page.locator("header button:has(.anticon-reload):visible").first();
  await refresh.hover();
  assert.notEqual(await refresh.locator("svg").evaluate((el) => getComputedStyle(el).fill), "none");
  await refresh.focus();
  assert.notEqual(await refresh.locator("svg").evaluate((el) => getComputedStyle(el).fill), "none");
  await refresh.evaluate((el) => el.blur());
  await page.mouse.move(0, 0);
}

async function openRegister({ arch = "arm64", desktop = true, missingInfo = false,
  businessArchetype = "retail", entry = "/pos/app", lang = "th", theme = "light", initialStatus = "available" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
  await context.addCookies([{ name: "lang", value: lang, url: baseUrl }, { name: "theme", value: theme, url: baseUrl }]);
  const session = { ...bootstrap, businessArchetype, surface: businessArchetype === "restaurant" ? "restaurant" : "retail",
    kitchenOperators: [], purchaseReceivers: [],
    location: { ...bootstrap.location, name: businessArchetype === "retail" ? bootstrap.location.name : `FAKE ${businessArchetype}` },
  };
  await context.addInitScript(({ arch, desktop, missingInfo }) => {
    localStorage.setItem("bms.pos.deviceToken", "FAKE-token");
    if (desktop) window.bmsDesktop = {
      isDesktop: true,
      getDeviceToken: async () => "FAKE-token",
      getStorageNamespace: async () => "FAKE-update-smoke",
      ...(missingInfo ? {} : { getAppInfo: async () => ({ version: "0.2.14-pilot.2", platform: "darwin", arch, clientLabel: "macOS Client" }) }),
    };
  }, { arch, desktop, missingInfo });
  let status = initialStatus;
  let checks = 0;
  let downloads = 0;
  const errors = [];
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/retail-local/desktop-update") {
      checks++;
      if (status === "error") return route.fulfill({ status: 503, json: { error: "FAKE offline" } });
      return route.fulfill({ json: { status, releases: status === "available" ? [release] : [] } });
    }
    if (url.pathname.startsWith("/api/retail-local/download/")) {
      downloads++;
      return route.fulfill({ contentType: "text/plain", body: "FAKE installer request; no file installed" });
    }
    if (url.pathname === "/api/graphql") {
      const query = route.request().postDataJSON()?.query || "";
      let data = {};
      if (query.includes("query PosBootstrap")) data = { bmsPosSession: session };
      if (query.includes("mutation VerifyPosCashier")) data = { bmsPosVerifyCashier: cashier };
      if (query.includes("query MobilePosCatalog")) data = { bmsPosCatalogSearch: { items: [] } };
      return route.fulfill({ json: { data } });
    }
    if (url.pathname === "/api/pos/session") return route.fulfill({ json: session });
    if (url.pathname === "/api/pos/restaurant/floor") return route.fulfill({ json: { areas: [], tables: [] } });
    if (url.pathname === "/api/pos/restaurant/waitlist") return route.fulfill({ json: { entries: [], waitingCount: 0, calledCount: 0, waitingGuests: 0 } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const firstCheck = desktop && !missingInfo
    ? page.waitForResponse((response) => response.url().includes("/api/retail-local/desktop-update"), { timeout: 120_000 })
    : null;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}${entry}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  if (entry === "/pos/app") {
    await page.getByLabel("PIN พนักงาน 4–8 หลัก").fill("1234");
    await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  }
  if (businessArchetype === "restaurant") {
    await page.getByRole("heading", { name: "BMS Restaurant", exact: true }).waitFor();
  } else if (entry === "/pos/app") {
    await page.getByRole("button", { name: "รีเฟรชข้อมูล", exact: true }).waitFor();
    if (businessArchetype === "pharmacy") await page.locator(".pos-page--embedded .pos-topbar").waitFor({ state: "attached" });
  } else {
    await page.locator(".pos-topbar").waitFor();
  }
  if (firstCheck) await (await firstCheck).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { context, page, errors, setStatus: (value) => { status = value; }, checks: () => checks, downloads: () => downloads };
}

async function checkAfterFocus(shop) {
  const response = shop.page.waitForResponse((response) => response.url().includes("/api/retail-local/desktop-update"));
  await shop.page.evaluate(() => {
    const previousNow = Date.now;
    Date.now = () => previousNow() + 300_001;
    window.dispatchEvent(new Event("focus"));
  });
  await (await response).finished();
  await shop.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function verifyNoUpdateStates(shop) {
  for (const status of ["unavailable", "up-to-date", "unknown-version", "error"]) {
    shop.setStatus(status);
    await checkAfterFocus(shop);
    assert.equal(await shop.page.locator('summary[aria-label="มีอัปเดตใหม่"], summary[aria-label="อัปเดต BMS POS"]').count(), 0, status);
    assert.equal(await shop.page.getByRole("region", { name: "อัปเดต BMS POS", exact: true }).count(), 0, status);
  }
  shop.setStatus("available");
  await checkAfterFocus(shop);
  await shop.page.locator('summary[aria-label="มีอัปเดตใหม่"]').waitFor();
}

try {
  const run = await openRegister();
  const { page } = run;
  const trigger = page.locator('summary[aria-label="มีอัปเดตใหม่"]');
  await trigger.waitFor();
  await verifyToolbarIcons(page, "retail");
  assert.equal(run.downloads(), 0);
  await page.screenshot({ path: `${output}/header-desktop.png` });
  await trigger.click();
  const panel = page.getByRole("region", { name: "อัปเดต BMS POS", exact: true });
  await panel.getByText("v0.2.15", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/popover-desktop.png` });
  await page.screenshot({ path: `${output}/update-detail.png`, clip: { x: 800, y: 12, width: 632, height: 430 } });
  const checkBounds = async () => {
    const bounds = await panel.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, JSON.stringify(bounds));
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, JSON.stringify(bounds));
    assert.equal(await panel.evaluate((el) => el.scrollWidth > el.clientWidth), false);
  };
  await checkBounds();
  await page.keyboard.press("Escape");
  assert.equal(await panel.isVisible(), false);
  await trigger.click();
  await page.getByText("เลือกสินค้า", { exact: true }).click();
  assert.equal(await panel.isVisible(), false);
  await trigger.click();
  await panel.getByRole("button", { name: "ภายหลัง" }).click();
  assert.equal(await panel.isVisible(), false);
  assert.equal(run.downloads(), 0);
  await trigger.click();
  const popup = page.waitForEvent("popup");
  await panel.getByRole("link", { name: "ดาวน์โหลดอัปเดต" }).click();
  const downloadPage = await popup;
  await downloadPage.waitForLoadState();
  assert.equal(run.downloads(), 1);
  assert.ok(page.url().endsWith("/pos/app"));
  await downloadPage.close();
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await checkBounds();
    const header = page.locator("header").first();
    assert.equal(await page.locator('header[class*="DesktopPosRenderer_topbar"]').count(), 1);
    assert.equal(await header.evaluate((el) => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `${output}/popover-${width}.png` });
  }
  await verifyNoUpdateStates(run);
  assert.deepEqual(run.errors, []);
  await run.context.close();

  const legacy = await openRegister({ arch: null });
  await legacy.page.locator('summary[aria-label="มีอัปเดตใหม่"]').click();
  const legacyPanel = legacy.page.getByRole("region", { name: "อัปเดต BMS POS", exact: true });
  assert.equal(await legacyPanel.getByRole("button", { name: "ดาวน์โหลดอัปเดต" }).isDisabled(), true);
  await legacyPanel.getByLabel("รุ่นเครื่อง").selectOption("FAKE-release");
  assert.equal(await legacyPanel.getByRole("link", { name: "ดาวน์โหลดอัปเดต" }).getAttribute("href"), release.downloadUrl);
  assert.deepEqual(legacy.errors, []);
  await legacy.context.close();

  const missing = await openRegister({ missingInfo: true });
  assert.equal(await missing.page.locator('summary[aria-label="อัปเดต BMS POS"], summary[aria-label="มีอัปเดตใหม่"]').count(), 0);
  assert.equal(missing.checks(), 0);
  await missing.context.close();

  const web = await openRegister({ desktop: false });
  await verifyToolbarIcons(web.page, "browser retail");
  assert.equal(await web.page.locator('summary[aria-label="อัปเดต BMS POS"], summary[aria-label="มีอัปเดตใหม่"]').count(), 0);
  assert.equal(web.checks(), 0);
  await web.context.close();

  for (const businessArchetype of ["pharmacy", "restaurant"]) {
    const shop = await openRegister({ businessArchetype });
    const update = shop.page.locator('summary[aria-label="มีอัปเดตใหม่"]');
    await update.waitFor();
    await verifyToolbarIcons(shop.page, businessArchetype);
    assert.equal(await update.count(), 1, `${businessArchetype}: only one update menu`);
    if (businessArchetype === "restaurant") assert.ok(shop.page.url().endsWith("/pos/restaurant"));
    const shopPanel = shop.page.getByRole("region", { name: "อัปเดต BMS POS", exact: true });
    for (const width of [1440, 390]) {
      await shop.page.setViewportSize({ width, height: 1000 });
      await update.click();
      await shopPanel.getByText("v0.2.15", { exact: true }).waitFor();
      const bounds = await shopPanel.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 1000, `${businessArchetype}: ${JSON.stringify(bounds)}`);
      assert.equal(await shopPanel.evaluate((el) => el.scrollWidth > el.clientWidth), false);
      await shop.page.screenshot({ path: `${output}/${businessArchetype}-${width}.png` });
      await shop.page.keyboard.press("Escape");
      assert.equal(await shopPanel.isVisible(), false);
      await update.click();
      await shopPanel.getByRole("button", { name: "ภายหลัง" }).click();
      assert.equal(await shopPanel.isVisible(), false);
    }
    await shop.page.setViewportSize({ width: 1440, height: 1000 });
    await update.click();
    await shop.page.locator("header").first().click({ position: { x: 8, y: 8 } });
    assert.equal(await shopPanel.isVisible(), false);
    assert.equal(shop.downloads(), 0);
    await update.click();
    const opened = shop.page.waitForEvent("popup");
    await shopPanel.getByRole("link", { name: "ดาวน์โหลดอัปเดต" }).click();
    const installer = await opened;
    await installer.waitForLoadState();
    assert.equal(shop.downloads(), 1);
    await installer.close();
    await shop.page.keyboard.press("Escape");
    if (businessArchetype === "restaurant") {
      for (const tab of ["ผังโต๊ะ", "จอครัว", "ตั้งค่าเครื่องขาย"]) {
        await shop.page.getByRole("button", { name: tab, exact: true }).click();
        if (tab === "ตั้งค่าเครื่องขาย") await shop.page.locator(".pos-page--embedded").waitFor();
        assert.equal(await update.count(), 1, `restaurant ${tab}: update menu persists without duplication`);
        await update.click();
        await shopPanel.getByText("v0.2.15", { exact: true }).waitFor();
        await shop.page.keyboard.press("Escape");
      }
    }
    await verifyNoUpdateStates(shop);
    assert.deepEqual(shop.errors, []);
    await shop.context.close();
  }

  for (const businessArchetype of ["retail", "pharmacy", "restaurant"]) {
    const noUpdate = await openRegister({ businessArchetype, initialStatus: "unavailable" });
    assert.equal(await noUpdate.page.locator('summary[aria-label="มีอัปเดตใหม่"], summary[aria-label="อัปเดต BMS POS"]').count(), 0);
    await noUpdate.page.screenshot({ path: `${output}/${businessArchetype}-no-update.png` });
    noUpdate.setStatus("available");
    await checkAfterFocus(noUpdate);
    await noUpdate.page.locator('summary[aria-label="มีอัปเดตใหม่"]').waitFor();
    assert.deepEqual(noUpdate.errors, []);
    await noUpdate.context.close();
  }

  for (const businessArchetype of ["retail", "pharmacy"]) {
    const standalone = await openRegister({ businessArchetype, entry: "/pos" });
    await standalone.page.locator('summary[aria-label="มีอัปเดตใหม่"]').click();
    const panel = standalone.page.getByRole("region", { name: "อัปเดต BMS POS", exact: true });
    await panel.getByText("v0.2.15", { exact: true }).waitFor();
    await standalone.page.keyboard.press("Escape");
    assert.equal(await panel.isVisible(), false);
    assert.deepEqual(standalone.errors, []);
    await standalone.context.close();
  }

  const restaurantWeb = await openRegister({ businessArchetype: "restaurant", desktop: false });
  assert.equal(await restaurantWeb.page.locator('summary[aria-label="มีอัปเดตใหม่"]').count(), 0);
  assert.equal(restaurantWeb.checks(), 0);
  await restaurantWeb.context.close();
  const english = await openRegister({ businessArchetype: "restaurant", lang: "en", theme: "dark" });
  await english.page.locator('summary[aria-label="Update available"]').waitFor();
  await verifyToolbarIcons(english.page, "restaurant dark");
  await english.page.locator('summary[aria-label="Update available"]').click();
  const englishPanel = english.page.getByRole("region", { name: "BMS POS updates", exact: true });
  await englishPanel.getByRole("link", { name: "Download update", exact: true }).waitFor();
  assert.equal(await englishPanel.evaluate((el) => el.scrollWidth > el.clientWidth), false);
  assert.equal(await englishPanel.evaluate((el) => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)"), false);
  await english.page.screenshot({ path: `${output}/restaurant-dark-en.png` });
  assert.deepEqual(english.errors, []);
  await english.context.close();
  console.log("PASS: retail, pharmacy embedded/standalone, restaurant redirect/floor/kitchen/settings, restaurant browser-only and English dark theme");
  console.log(`PASS: desktop/mobile layout, dismissal, explicit download, retry, latest, legacy architecture, missing bridge and browser-only. Screenshots: ${output}`);
} finally {
  await browser.close();
}
