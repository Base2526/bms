import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3100";
const output = ".test-output/twenty-baht-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=user-gesture-required"] });
try {
  for (const lang of ["th", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: "lang", value: lang, url: base }]);
    await context.route("**/api/auth/me", (route) => route.fulfill({ json: { user: null, admin: null, isAuthenticated: false } }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [width, height] of [[1440, 900], [768, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      const response = await page.goto(`${base}/${lang}/learn/twenty-baht-shop`, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      assert.equal(await page.locator("h1").count(), 1);
      assert.match(await page.locator("h1").innerText(), lang === "th" ? /20 บาท/ : /Twenty-baht/);
      assert.equal(await page.locator('meta[name="robots"]').getAttribute("content").then((value) => value.includes("noindex")), true);
      const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(size.scroll <= size.width + 1, `${lang} ${width}: horizontal overflow ${size.scroll}`);
      if (width < 851) assert.ok((await page.getByRole("banner").boundingBox()).height <= 64);
      await page.screenshot({ path: `${output}/${lang}-${width}-top.png` });
      await page.screenshot({ path: `${output}/${lang}-${width}.png`, fullPage: true });
    }
    await page.goto(`${base}/${lang}/learn`, { waitUntil: "networkidle" });
    assert.ok(await page.locator(`a[href="/${lang}/learn/twenty-baht-shop"]`).count() >= 2, "home card and sidebar link");
    await page.goto(`${base}/${lang}/learn?q=${encodeURIComponent(lang === "th" ? "ร้าน 20 บาท" : "twenty baht")}`, { waitUntil: "networkidle" });
    assert.ok(await page.locator(`a[href="/${lang}/learn/twenty-baht-shop"]`).count() >= 2, "search result and sidebar link");
    await page.goto(`${base}/${lang}/learn/twenty-baht-shop`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: lang === "th" ? /เล่นพร้อมเสียง/ : /Play with audio/ }).click();
    if (lang === "th") {
      await page.waitForFunction(() => {
        const element = document.querySelector("audio[data-twenty-narration]");
        return element && !element.paused && element.currentTime > 0.3;
      });
      const source = await page.locator("audio[data-twenty-narration]").getAttribute("src");
      assert.match(source, /^\/audio\/twenty-baht-shop\/th\/.*\.mp3$/);
      assert.equal((await page.request.get(`${base}${source}`)).status(), 200);
      await page.getByRole("button", { name: lang === "th" ? "หยุดชั่วคราว" : "Pause" }).click();
      assert.equal(await page.locator("audio[data-twenty-narration]").evaluate((audio) => audio.paused), true);
      await page.getByRole("button", { name: "เล่นต่อ" }).click();
      await page.waitForFunction(() => !document.querySelector("audio[data-twenty-narration]").paused);
      await page.waitForFunction(() => [...document.querySelectorAll("#overview strong")].some((element) => element.textContent?.includes("2/5")), null, { timeout: 10000 });
    }
    await page.getByRole("button", { name: lang === "th" ? "ขยายแผนภาพ" : "Expand diagram" }).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(errors.length, 0, errors.join("\n"));
    await context.close();
  }
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const page = await noJs.newPage();
  await page.goto(`${base}/th/learn/twenty-baht-shop`);
  assert.equal(await page.getByRole("heading", { level: 3 }).count() >= 11, true);
  await noJs.close();
  for (const sitemap of ["/sitemap.xml", "/learn/sitemap.xml"]) {
    const response = await browser.newPage();
    const xml = await (await response.request.get(`${base}${sitemap}`)).text();
    assert.ok(!xml.includes("twenty-baht-shop"), `${sitemap}: noindex pilot must stay out of sitemap`);
    await response.close();
  }
  console.log(`Twenty-baht browser smoke passed. Screenshots: ${output}`);
} finally { await browser.close(); }
