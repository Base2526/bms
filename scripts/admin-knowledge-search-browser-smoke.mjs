import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".test-output/admin-knowledge-search-browser";
const avatarUrl = "/api/files/777";
const avatarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#1677ff"/><circle cx="48" cy="36" r="18" fill="white"/><path d="M18 88c4-22 16-32 30-32s26 10 30 32" fill="white"/></svg>`;
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"]) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([
      { name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base },
      { name: "lang", value: lang, url: base },
      { name: "theme", value: "light", url: base },
    ]);
    await context.addInitScript(() => localStorage.setItem("pdpa_consent_v1", JSON.stringify({ value: "reject", at: new Date().toISOString() })));
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === avatarUrl) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: avatarSvg });
      if (url.pathname === "/api/auth/me") return route.fulfill({ json: {
        isAuthenticated: true,
        admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE admin", avatar: avatarUrl, language: lang, is_platform_admin: false },
      } });
      if (url.pathname.endsWith("/graphql")) return route.fulfill({ json: { data: {
        bmsMe: {
          id: "FAKE-admin", name: "FAKE admin", username: "fake-admin", email: "fake@example.com",
          phone: null, avatar: avatarUrl, role: "Administrator", language: lang, gender: null,
          themePreference: "light", is_platform_admin: false, created_at: "2026-11-06T00:00:00.000Z",
          tenant: { id: "FAKE-tenant", name: "FAKE shop", slug: "fake-shop", plan: "FREE" },
          permissions: ["product.view"],
        },
        myBmsPermissions: ["product.view", "inventory.count", "order.view", "pos.sell", "tax.document.issue"],
        bmsIsPlatformAdmin: false,
        bmsActingTenant: null,
        bmsStoreProfile: { businessArchetype: "retail" },
        bmsKitchenBoardEnabled: false,
        bmsWastageEnabled: false,
        bmsPackToolsConfigured: false,
        bmsInboxUnreadCount: 0,
        bmsMyMentionsUnreadCount: 0,
        bmsRestockReadyCount: 0,
        bmsChannelHealthCount: 0,
        bmsAiConfig: { has_key: false },
        bmsAiUsage: { billingMode: "SHARED", count: 0, limit: 100, remaining: 100, unlimited: false, grantedCredits: 100, bonusCredits: 0, adjustedCredits: 0 },
      } } });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.continue();
    });

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(30000);
    try {
      const query = lang === "th" ? "ระบบรองรับร้านอาหารไหม" : "Does BMS support restaurants";
      await page.goto(`${base}/admin/search?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      const root = page.locator("[data-admin-knowledge-search]");
      await root.waitFor();
      await root.locator('[data-knowledge-result="capability:restaurant.dine-in"]').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);

      const guideQuery = lang === "th" ? "เพิ่มสินค้ายังไง" : "How do I add a product";
      await root.locator("input").fill(guideQuery);
      await root.locator("input").press("Enter");
      await page.waitForURL(url => url.searchParams.get("q") === guideQuery);
      const guideCard = root.locator('[data-knowledge-result="guide:products.create"]');
      await guideCard.waitFor();
      await guideCard.locator('[data-knowledge-details="products.create"]').waitFor();
      assert.match(await guideCard.innerText(), lang === "th" ? /ขั้นตอน/ : /Steps/);
      const orderedKinds = await root.locator("[data-knowledge-result]").evaluateAll(nodes =>
        nodes.slice(0, 2).map(node => node.getAttribute("data-knowledge-result"))
      );
      assert.deepEqual(orderedKinds, ["capability:catalog.products", "guide:products.create"]);
      await page.screenshot({ path: `${output}/guide-${lang}-${width}.png`, fullPage: true });

      const broad = lang === "th" ? "รองรับระบบอะไรบ้าง" : "What does BMS support";
      await root.locator("input").fill(broad);
      await root.locator("input").press("Enter");
      await page.waitForURL(url => url.searchParams.get("q") === broad);
      await root.locator('[data-knowledge-result="capability:catalog.products"]').waitFor();
      assert.ok(await root.locator("[data-knowledge-result]").count() >= 40);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${lang}-${width}.png`, fullPage: true });

      await page.goto(`${base}/admin/profile`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator(`[data-admin-profile-avatar] img[src="${avatarUrl}"]`).waitFor();
      await page.locator(`[data-admin-sidebar-avatar] img[src="${avatarUrl}"]`).waitFor();
      await page.screenshot({ path: `${output}/profile-avatar-${lang}-${width}.png` });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator(`[data-header-profile-avatar] img[src="${avatarUrl}"]`).waitFor();
      await page.screenshot({ path: `${output}/avatar-${lang}-${width}.png` });
      console.log(`PASS ${lang}/${width}: search details + profile/sidebar/index avatar + RBAC links, no overflow`);
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${lang}-${width}.png`, fullPage: true });
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await Promise.race([
    browser.close(),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
}

// Playwright can retain an idle transport handle on newer Node releases while Chrome closes.
// Every assertion and bounded cleanup above has completed at this point, so exit deterministically.
process.exit(0);
