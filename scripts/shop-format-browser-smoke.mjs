// Local-only shop-format smoke. Every GraphQL write is intercepted and kept in memory.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require(process.env.BMS_PLAYWRIGHT_PACKAGE || "playwright");
const origin = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
function interceptWebSockets(context) {
  return context.routeWebSocket(/.*/, socket => socket.onMessage(raw => {
    try {
      if (JSON.parse(String(raw)).type === "connection_init") {
        socket.send(JSON.stringify({ type: "connection_ack" }));
      }
    } catch { /* synthetic UI fixture ignores unrelated frames */ }
  }));
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await interceptWebSockets(context);
    await context.addCookies([{ name: "lang", value: "th", url: origin }]);
    const writes = [];
    const pageErrors = [];
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: false, admin: null,
      } });
      if (path !== "/api/graphql") return route.fulfill({ json: {} });
      const { query = "", variables = {} } = route.request().postDataJSON();
      if (/\bmutation\b/i.test(query)) {
        writes.push({ query, variables });
        assert.match(query, /bmsSignup\(/, "signup smoke may only submit a synthetic signup");
        return route.fulfill({ json: { data: { bmsSignup: { status: "PENDING_VERIFICATION", tenantId: null, slug: null } } } });
      }
      if (query.includes("socialAuthAvailability")) return route.fulfill({ json: {
        data: { socialAuthAvailability: { google: false, facebook: false } },
      } });
      return route.fulfill({ json: { data: {} } });
    });
    const page = await context.newPage();
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`${origin}/shop-signup`, { waitUntil: "load" });
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#password").getAttribute("placeholder"), "อย่างน้อย 8 ตัวอักษร");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.locator("#shopName").fill("FAKE Format Shop");
    await page.locator("#email").fill("fake-format@example.invalid");
    await page.locator("#password").fill("1234567");
    await page.getByRole("button", { name: "สร้างร้านฟรี" }).click();
    await page.waitForTimeout(300);
    assert.equal(writes.length, 0, "weak password must not reach GraphQL");
    await page.locator("#password").fill("12345678");
    await page.locator(".ant-select").filter({ has: page.locator("#businessArchetype") })
      .locator(".ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator(".ant-select-item-option:visible").filter({ hasText: "มินิมาร์ท" }).click();
    await page.getByRole("button", { name: "สร้างร้านฟรี" }).click();
    await page.getByText(/ตรวจสอบอีเมล|ยืนยันอีเมล/).first().waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].variables.businessArchetype, "mini_mart");
    assert.deepEqual(pageErrors, [], `signup errors at ${width}px`);
    console.log(`shop signup ${width}px: invalid password blocked, mini mart submitted once`);
    await context.close();

    const admin = await browser.newContext({ viewport: { width, height: 900 } });
    await interceptWebSockets(admin);
    await admin.addCookies([
      { name: "lang", value: "th", url: origin },
      { name: "ADMIN_COOKIE", value: "FAKE-shop-format-smoke", url: origin },
    ]);
    const adminWrites = [];
    const adminErrors = [];
    await admin.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: true,
        admin: { id: "11111111-1111-4111-8111-111111111111", role: "Administrator", name: "FAKE Admin", language: "th" },
      } });
      if (path !== "/api/graphql") return route.fulfill({ json: {} });
      const { query = "", variables = {} } = route.request().postDataJSON();
      if (/\bmutation\b/i.test(query)) {
        adminWrites.push({ query, variables });
        assert.match(query, /bmsUpsertStoreProfile/);
        assert.doesNotMatch(query, /bmsUpdateMyTenant/);
        return route.fulfill({ json: { data: { bmsUpsertStoreProfile: { about: null } } } });
      }
      return route.fulfill({ json: { data: {
        myBmsPermissions: ["settings.manage"], bmsIsPlatformAdmin: false,
        bmsMyTenant: { id: "22222222-2222-4222-8222-222222222222", name: "FAKE Shop", slug: "fake-shop" },
        bmsChannels: [], bmsChannelHealth: [], bmsActingTenant: null,
        bmsChannelHealthCount: 0, bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0,
        bmsRestockReadyCount: 0,
        bmsMe: { id: "11111111-1111-4111-8111-111111111111", role: "Administrator", tenant: { id: "22222222-2222-4222-8222-222222222222", slug: "fake-shop" } },
        bmsAiConfig: { has_key: false, api_key_masked: null, model: "claude-haiku-4-5", provider: "anthropic" },
        bmsAiUsage: { billingMode: "PLAN_POINTS", count: 0, limit: 100, remaining: 100, unlimited: false, planCode: "free", planName: "Free" },
        bmsAiLimitNotifications: { unreadCount: 0, items: [] },
        bmsStoreProfile: {
          businessArchetype: "mini_mart", businessArchetypeLocked: false, businessType: "general",
          aiLanguage: "th", aiOrderingStyle: "catalog_variant", aiRequiredFields: ["product", "size", "qty"],
          aiInterpretShortReplies: true, aiHandoffAfterFailedTurns: 3, receiptLanguageMode: "th",
          restaurantOrderHours: [], restaurantOrdersPaused: false, restaurantMerchantAbsorbLimit: 2000,
          customerDisplayPromoSlides: [], customerDisplayPromoIntervalSeconds: 8,
          paymentAccounts: [], enabledCarriers: [], shippingMode: "flat", shippingZoneRates: [],
          shippingWeightTiers: [], barcodeMasterContributionEnabled: false,
          country: "TH", currency: "THB", timezone: "Asia/Bangkok",
        },
        bmsMasterBanks: [],
      } } });
    });
    const settings = await admin.newPage();
    settings.on("pageerror", error => adminErrors.push(error.message));
    await settings.goto(`${origin}/admin/settings`, { waitUntil: "domcontentloaded" });
    await settings.getByRole("tab", { name: "ข้อมูลร้าน" }).click();
    assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await settings.locator("#name").fill("FAKE Renamed Shop");
    await settings.getByRole("button", { name: /บันทึกข้อมูลร้าน/ }).click();
    await settings.getByText("บันทึกข้อมูลร้านแล้ว", { exact: true }).waitFor();
    assert.equal(adminWrites.length, 1, "name and profile must use one request");
    assert.equal(adminWrites[0].variables.input.tenantName, "FAKE Renamed Shop");
    assert.equal(adminWrites[0].variables.input.businessArchetype, "mini_mart");
    assert.deepEqual(adminErrors, [], `settings errors at ${width}px`);
    console.log(`shop settings ${width}px: name and profile submitted in one mutation`);
    await admin.close();
  }
} finally {
  await browser.close();
}
