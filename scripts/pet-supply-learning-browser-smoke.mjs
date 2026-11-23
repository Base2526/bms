import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = ".test-output/pet-supply-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"]) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "lang", value: lang, url: base }]);
    await context.route("**/api/auth/me", route => route.fulfill({ json: { user: null, admin: null, isAuthenticated: false } }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`${base}/${lang}/learn`, { waitUntil: "networkidle" });
      const card = page.locator(`main a[class*="businessCard"][href="/${lang}/learn/pet-supply"]`);
      assert.ok(await card.isVisible(), `${lang}/${width}: home card`);
      await card.click();
      await page.waitForURL(`**/${lang}/learn/pet-supply`);
      assert.equal(await page.locator("h1").first().isVisible(), true);
      assert.match(await page.locator("h1").first().innerText(), lang === "th" ? /ร้านขายอาหารสัตว์/ : /Pet supply store/);
      assert.equal(await page.locator(`nav[aria-label="${lang === "th" ? "หมวดคู่มือ" : "Guide categories"}"] a[aria-current="page"][href="/${lang}/learn/pet-supply"]`).count(), 1);
      assert.equal(await page.locator(`a[href="/guides/pos/bms-pos-pet-supply-th.pdf"]`).count(), 1);
      assert.equal(await page.locator(`a[href="/guides/pos/bms-pos-pet-supply-th.docx"]`).count(), 1);
      if (width > 1100) {
        const menu = page.locator('header details[data-learning-header-menu="desktop"]').first();
        await menu.locator("summary").click();
        assert.ok(await menu.locator(`a[href="/${lang}/learn/pet-supply"][aria-current="page"]`).isVisible());
      } else {
        const menu = page.locator('header details[data-learning-header-menu="mobile"]');
        await menu.locator("summary").click();
        assert.ok(await menu.locator(`a[href="/${lang}/learn/pet-supply"][aria-current="page"]`).isVisible());
      }
      const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(horizontal, false, `${lang}/${width}: horizontal overflow`);
      await page.screenshot({ path: `${output}/${lang}-${width}.png`, fullPage: true });
      const firstLesson = page.locator(`main a[href*="/${lang}/learn/guides/pet-supply-start"]`).first();
      await firstLesson.click();
      await page.waitForURL(/pet-supply-start/);
      assert.ok(await page.locator("article ol li").count() >= 4);
      assert.deepEqual(errors, []);
      console.log(`PASS ${lang}/${width}: route, menu state, downloads, lesson and layout`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
