// Local browser smoke with synthetic data and intercepted API calls. No business writes.
// BMS_PLAYWRIGHT_PACKAGE=/path/to/playwright node scripts/pos-language-browser-smoke.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE ||
  "playwright");
const origin = process.env.BMS_POS_SMOKE_ORIGIN || "http://localhost:3000";
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname),
  "Use a local dev server"
);
const out = fileURLToPath(
  new URL("../.test-output/pos-language/", import.meta.url)
);
mkdirSync(out, { recursive: true });
async function languageRace(page, choose, current) {
  await page.evaluate(() => {
    window.smokeOriginalSave = window.bmsDesktop.setLanguage;
    window.smokePendingSaves = [];
    window.bmsDesktop.setLanguage = (language) => new Promise((resolve) => {
      window.smokePendingSaves.push({ language, resolve });
    });
  });
  await choose("th");
  await choose("en");
  await page.evaluate(() => {
    window.smokeEmitLanguage("th");
    window.smokePendingSaves[0].resolve({ ok: false });
  });
  assert.equal(await current(), "en", "Old save events must not replace the latest selection");
  await page.evaluate(() => window.smokePendingSaves[1].resolve({ ok: true }));
  assert.doesNotMatch(await page.locator("body").innerText(), /could not (?:be saved|save preference)/i);
  await page.evaluate(() => { window.bmsDesktop.setLanguage = window.smokeOriginalSave; });
  await choose("en");
}
const posLanguage = (page) => page.getByRole("group", { name: /^(Language|ภาษา)$/ });
const choosePosLanguage = (page, language) => posLanguage(page)
  .getByRole("button", { name: language === "en" ? "English" : "ไทย" }).click();
const currentPosLanguage = async (page) =>
  await posLanguage(page).getByRole("button", { name: "English" }).getAttribute("aria-pressed") === "true" ? "en" : "th";
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const setup = await browser.newPage({
      viewport: { width: 1100, height: 760 },
    });
    setup.setDefaultTimeout(20000);
    const errors = [];
    setup.on("pageerror", (e) => errors.push(e.message));
    await setup.addInitScript(() => {
      let language = localStorage.getItem("smoke-language") || "th";
      let changed = () => {};
      window.smokeEmitLanguage = (value) => changed(value);
      window.bmsDesktop = {
        getLanguage: async () => language,
        setLanguage: async (value) => {
          language = value;
          localStorage.setItem("smoke-language", value);
          changed(value);
          return { ok: true };
        },
        onLanguageChanged: (fn) => {
          changed = fn;
          return () => {};
        },
        getAppInfo: async () => ({
          version: "test",
          clientLabel: "macOS Client",
          secureStorageReady: true,
        }),
        getSetupAdminTarget: async () => ({ kind: "local" }),
        openSetupAdmin: async () => ({ ok: true, kind: "local" }),
        pair: async () => ({ ok: false, error: "test" }),
      };
    });
    await setup.goto(
      new URL("../apps/desktop/renderer/setup.html", import.meta.url).href
    );
    await setup.locator("#admin-link-row:not([hidden])").waitFor();
    await setup.locator("#server-url").fill("https://example.test");
    await setup.locator("#pairing-input").fill("FAKE pairing input");
    await setup.locator("#language").selectOption("en");
    await setup
      .getByRole("heading", { name: "Connect your register" })
      .waitFor();
    await setup
      .getByText("Create from local back office", { exact: true })
      .waitFor();
    await languageRace(setup, (language) => setup.locator("#language").selectOption(language),
      () => setup.locator("#language").inputValue());
    assert.equal(
      await setup.locator("#server-url").inputValue(),
      "https://example.test"
    );
    assert.equal(
      await setup.locator("#pairing-input").inputValue(),
      "FAKE pairing input"
    );
    await setup.screenshot({
      path: out + "/setup-en-desktop.png",
      fullPage: true,
    });
    await setup.reload();
    await setup
      .getByRole("heading", { name: "Connect your register" })
      .waitFor();
    await setup.setViewportSize({ width: 390, height: 844 });
    await setup.screenshot({
      path: out + "/setup-en-mobile.png",
      fullPage: true,
    });
    assert.equal(
      await setup.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    assert.deepEqual(errors, []);
    await setup.close();
    const registerContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await registerContext.newPage();
    page.setDefaultTimeout(20000);
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.addInitScript(() => {
      let language = "th";
      const listeners = new Set();
      window.smokeEmitLanguage = (value) => { for (const fn of listeners) fn(value); };
      window.bmsDesktop = {
        isDesktop: true,
        getDeviceToken: async () => "pos_FAKE_i18n_test",
        getStorageNamespace: async () => "FAKE-language",
        getLanguage: async () => language,
        setLanguage: async (value) => {
          language = value;
          for (const fn of listeners) fn(value);
          return { ok: true };
        },
        onLanguageChanged: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        getAppInfo: async () => ({
          version: "0.0.0-test",
          platform: "darwin",
          clientLabel: "Test",
          secureStorageReady: true,
        }),
        onRefreshRequested: () => () => {},
      };
    });
    const cashier = {
      id: "FAKE-cashier",
      name: "Test operator",
      role: "Cashier",
      hasPin: true,
      posOnly: true,
      isPharmacist: false,
    };
    const session = {
      surface: "RETAIL_POS",
      businessArchetype: "board_game_cafe",
      device: {
        id: "FAKE-device",
        code: "TEST",
        name: "Test register",
        scanner: {
          mode: "KEYBOARD_WEDGE",
          prefixKey: "",
          suffixKey: "Enter",
          maxGapMs: 80,
        },
      },
      location: {
        id: "FAKE-branch",
        name: "Test shop",
        branchCode: "00000",
        pickupQueue: {
          enabled: false,
          autoHideMinutes: 10,
          showPreparing: false,
        },
      },
      shift: {
        id: "FAKE-shift",
        status: "OPEN",
        locationId: "FAKE-branch",
        deviceId: "FAKE-device",
        openingFloat: 0,
      },
      shiftReturnSummary: {
        returnCount: 0,
        returnTotal: 0,
        settledTotal: 0,
        pendingTotal: 0,
        pendingCount: 0,
      },
      cashiers: [cashier],
      approvers: [],
      store: { name: "Test shop", receiptLanguageMode: "th" },
      vat: {
        registered: false,
        priceIncludesVat: true,
        rate: 7,
        calendarEra: "CE",
        cashRounding: "NONE",
      },
    };
    const hit = {
      sku: "FAKE-PRODUCT",
      size: "STD",
      productName: "Fixture product",
      receiptName: "Fixture product",
      baseQty: 1,
      packCode: "",
      unitName: "unit",
      packPrice: 25,
      basePrice: 25,
      available: 50,
      stockTracked: true,
      serialTracked: false,
      scaleBarcode: false,
      imageUrl: null,
      barcode: null,
      priceTiers: [],
      promotion: null,
      modifiers: [],
      packs: [],
    };
    await page.context().route("**/api/**", async (route) => {
      const req = route.request();
      if (req.url().includes("/api/pos/pickup-queue")) return route.fulfill({
        json: { entries: [{ label: "A042", status: "READY", calledAt: null, readyAt: null }],
          settings: { enabled: true, showPreparing: true, branchName: "สาขาทดสอบ", voiceMode: "OFF" },
          serverTime: new Date().toISOString() },
      });
      if (req.url().includes("/api/pos/board-game")) return route.fulfill({
        json: { floor: { areas: [{ id: "FAKE-area", name: "โซนทดสอบ", sortOrder: 0 }],
          tables: [{ id: "FAKE-table", areaId: "FAKE-area", code: "T1", name: "โต๊ะทดสอบ", seats: 4, sortOrder: 0, blocked: false, openSession: null }] },
          rates: [{ id: "FAKE-rate", code: "GENERAL", name: "อัตราทดสอบ", customerType: "GENERAL", pricePerHour: 60, minimumMinutes: 0, roundingMinutes: 1, graceMinutes: 0, sortOrder: 0, active: true }],
          library: [], serviceCalls: [], waitlist: { entries: [], tables: [], waitingCount: 0, calledCount: 0,
            confirmedReservationCount: 0, requestedReservationCount: 0, waitingGuests: 0, longestWaitMinutes: 0 } },
      });
      if (req.url().includes("/api/pos/session"))
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(session),
        });
      if (!req.url().endsWith("/api/graphql"))
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false }),
        });
      let data = {};
      let body;
      try {
        body = req.postDataJSON();
      } catch {}
      const q = body?.query || "";
      if (q.includes("query PosBootstrap")) data = { bmsPosSession: session };
      else if (q.includes("mutation VerifyPosCashier"))
        data = { bmsPosVerifyCashier: cashier };
      else if (q.includes("query MobilePosCatalog"))
        data = {
          bmsPosCatalogSearch: {
            items: [
              {
                sku: hit.sku,
                name: hit.productName,
                price: 25,
                availability: "AVAILABLE",
                availableTotal: 50,
                imageUrl: null,
                availableSizes: [{ size: "STD", available: 50, price: 25 }],
              },
            ],
          },
        };
      else if (q.includes("query MobilePosScan")) data = { bmsPosScan: hit };
      else if (q.includes("bmsPosCheckoutPreview"))
        data = {
          bmsPosCheckoutPreview: {
            status: "READY",
            subtotal: 25,
            netTotal: 25,
            amountDue: 25,
            pointsUsed: 0,
            pointsEarned: 0,
            discountTotal: 0,
          },
        };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    });
    await page.goto(origin + "/pos/app");
    assert.equal(await page.locator('select[aria-label="Language / ภาษา"]').count(), 0);
    await page.getByRole("button", { name: "ตั้งค่าเครื่อง" }).click();
    await choosePosLanguage(page, "en");
    await page.getByRole("heading", { name: "Enter employee PIN" }).waitFor();
    await languageRace(page, (language) => choosePosLanguage(page, language),
      () => currentPosLanguage(page));
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.locator("input[type=password]").fill("1234");
    await page.screenshot({
      path: out + "/login-en-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: out + "/login-en-mobile.png",
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Sell", exact: true }).click();
    await page.getByText("Fixture product", { exact: true }).first().waitFor();
    await page.getByText("Fixture product", { exact: true }).first().click();
    await page.screenshot({ path: out + "/register-en.png", fullPage: true });
    const billLine = page.locator('aside[class*="checkoutPane"]')
      .getByText("Fixture product", { exact: true });
    assert.equal(await billLine.count(), 1, "Product is in the current bill");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.screenshot({ path: out + "/settings-en-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: out + "/settings-en-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await choosePosLanguage(page, "th");
    await page.getByRole("button", { name: "ขาย", exact: true }).click();
    assert.equal(await billLine.count(), 1);
    await page.getByRole("button", { name: "ตั้งค่า", exact: true }).click();
    await choosePosLanguage(page, "en");
    await page.getByRole("button", { name: "Sell", exact: true }).click();
    assert.equal(await billLine.count(), 1);
    await page.getByRole("button", { name: "Return", exact: true }).click();
    await page
      .getByRole("heading", { name: "Search past bills", exact: true })
      .waitFor()
      .catch(async (e) => {
        await page.screenshot({
          path: out + "/returns-failure.png",
          fullPage: true,
        });
        console.log(await page.locator("body").innerText());
        throw e;
      });
    await page.screenshot({
      path: out + "/returns-en-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: out + "/returns-en-mobile.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Board game", exact: true }).click();
    await page.getByText("โต๊ะทดสอบ", { exact: true }).waitFor();
    await page.locator("summary").filter({ hasText: "Advance bookings" }).click();
    await page.getByRole("grid", { name: "Booking calendar" }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: out + `/boardgame-en-${width}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    // Utility windows intentionally have no desktop credential bridge.
    const display = await page.context().newPage();
    display.setDefaultTimeout(20000);
    display.on("pageerror", (e) => pageErrors.push(e.message));
    await display.goto(origin + "/pos/display");
    await display.getByText("Thank you for visiting", { exact: true }).waitFor();
    const queue = await page.context().newPage();
    queue.setDefaultTimeout(20000);
    queue.on("pageerror", (e) => pageErrors.push(e.message));
    await queue.addInitScript(() => localStorage.setItem("bms.pos.deviceToken", "pos_FAKE_i18n_test"));
    await queue.goto(origin + "/pos/queue-board");
    await queue.getByText("A042", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await choosePosLanguage(page, "th");
    await display.getByText("ขอบคุณที่ใช้บริการ", { exact: true }).waitFor();
    await queue.getByText("คิวรับของ", { exact: true }).waitFor();
    await choosePosLanguage(page, "en");
    await display.getByText("Thank you for visiting", { exact: true }).waitFor();
    await queue.getByText("Pickup queue", { exact: true }).waitFor();
    assert.equal(await display.evaluate(() => Boolean(window.bmsDesktop)), false);
    await queue.getByText("สาขาทดสอบ", { exact: true }).waitFor();
    for (const width of [1440, 390]) {
      for (const [name, utility] of [["customer", display], ["queue", queue]]) {
        await utility.setViewportSize({ width, height: 1000 });
        await utility.screenshot({ path: out + `/${name}-en-${width}.png` });
        assert.equal(await utility.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
    await display.close();
    await queue.close();
    session.businessArchetype = "restaurant";
    await page.goto(origin + "/pos/restaurant");
    await page
      .getByRole("heading", { name: "BMS Restaurant", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "ตั้งค่าเครื่องขาย", exact: true }).click();
    await choosePosLanguage(page, "en");
    assert.equal(await currentPosLanguage(page), "en");
    await page.screenshot({ path: out + "/restaurant-en-mobile.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: out + "/restaurant-en-desktop.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    assert.deepEqual(pageErrors, []);
    console.log(
      "PASS: shell persistence and pairing drafts; register PIN/cart survives TH/EN; board-game, customer, queue, returns and restaurant at desktop/mobile widths; cross-window language sync and stale-save protection; no page errors"
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
