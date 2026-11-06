import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".test-output/public-learning-header-search-browser";
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"]) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([
      { name: "lang", value: lang, url: base },
      { name: "theme", value: "light", url: base },
    ]);
    await context.addInitScript(() => localStorage.setItem("pdpa_consent_v1", JSON.stringify({ value: "reject", at: new Date().toISOString() })));
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === "/api/auth/me") return route.fulfill({ json: { isAuthenticated: false, user: null, admin: null } });
      if (url.pathname.endsWith("/graphql")) return route.fulfill({ json: { data: {} } });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.continue();
    });

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(30000);
    try {
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
      const trigger = page.locator("[data-public-learning-search-trigger]");
      await trigger.waitFor();
      await page.screenshot({ path: `${output}/header-${lang}-${width}.png`, fullPage: true });
      await trigger.click();
      const dialog = page.locator(".jachoei-mobile-search-card");
      await dialog.waitFor();
      assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      await trigger.click();
      await dialog.waitFor();
      await page.screenshot({ path: `${output}/dialog-${lang}-${width}.png`, fullPage: true });
      const query = lang === "th" ? "เพิ่มสินค้ายังไง" : "How do I add a product?";
      await dialog.locator("input").fill(query);
      await dialog.locator("input").press("Enter");
      const expectedPath = lang === "th" ? "/th/learn" : "/en/learn";
      await page.waitForURL(url => url.pathname === expectedPath && url.searchParams.get("q") === query);
      await page.getByText(lang === "th" ? /^ผลการค้นหา · [1-9]/ : /^Search results · [1-9]/).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator("[data-public-learning-search-trigger]").click();
      const storedHistory = page.locator(`[data-search-history-item="${query}"]`);
      await storedHistory.waitFor();
      assert.equal(await storedHistory.innerText(), query);
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem("bmsPublicLearningSearchHistory") || "[]")),
        [query],
      );
      await page.screenshot({ path: `${output}/history-${lang}-${width}.png` });
      await page.getByRole("button", { name: lang === "th" ? "ล้างประวัติการค้นหา" : "Clear search history" }).click();
      await page.locator("[data-search-history]").waitFor({ state: "detached" });
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem("bmsPublicLearningSearchHistory") || "[]")),
        [],
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${lang}-${width}.png`, fullPage: true });
      console.log(`PASS ${lang}/${width}: public search opens localized results, persists visible history, and has no overflow`);
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
