import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Local fixtures only");
const output = ".test-output/restaurant-public-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const pdfManifest = [];
try {
  for (const lang of ["th", "en"]) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    await context.addCookies([{ name: "lang", value: lang, url: base }, { name: "theme", value: "light", url: base }]);
    await context.addInitScript(() => localStorage.setItem("pdpa_consent_v1", JSON.stringify({ value: "reject", at: new Date().toISOString() })));
    let admin = false;
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname === "/api/auth/me") return route.fulfill({ json: admin
        ? { isAuthenticated: true, admin: { id: "FAKE", name: "FAKE Manager", role: "Administrator", language: lang } }
        : { isAuthenticated: false, user: null, admin: null } });
      if (url.pathname.endsWith("/graphql")) return route.fulfill({ json: { data: { myBmsPermissions: [] } } });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto(`${base}/restaurant`);
    assert.equal(response.status(), 200);
    const guide = page.locator("[data-restaurant-guide]");
    await guide.waitFor();
    await guide.locator('a[href="/shop-signup"]').waitFor();
    assert.ok((await page.locator('link[rel="canonical"]').getAttribute("href")).endsWith("/restaurant"));
    assert.ok(await page.locator('meta[name="description"]').getAttribute("content"));
    assert.ok(await guide.locator('a[href*="line.me"]').count() >= 1);
    const categories = guide.locator('[role="group"] button');
    const groups = { 1: 0, 2: 0, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 0, 9: 1, 10: 2, 11: 3 };
    for (let id = 1; id <= 11; id++) {
      await categories.nth(groups[id]).click();
      await guide.locator(`[data-flow-id="${id}"]`).click();
      await page.waitForFunction(id => location.hash === `#flow-${id}`, id);
      const svg = guide.locator('svg[role="img"]');
      await svg.waitFor();
      assert.ok(await svg.locator("text").count() > 10);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => {
        const svg = document.querySelector('[data-restaurant-guide] svg');
        return [...svg.querySelectorAll("text")].every(text => {
          const r = text.getBBox(), v = svg.viewBox.baseVal;
          return r.x >= -1 && r.x + r.width <= v.width + 1 && r.y >= -1 && r.y + r.height <= v.height + 1;
        });
      });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow: ${lang}/${width}/flow-${id}`);
      if (width === 390) assert.ok(await guide.locator('[role="region"]').evaluate(el => el.scrollWidth > el.clientWidth), "Mobile retains scrollable full diagram");
      else assert.ok(await guide.locator('[role="region"]').evaluate(el =>
        Math.abs(el.querySelector("svg").getBoundingClientRect().width - el.clientWidth) <= 1),
      `Overview fills desktop panel: flow-${id}`);
      await page.emulateMedia({ media: "print" });
      await page.waitForFunction(() => {
        const root = document.querySelector('[data-restaurant-print]');
        return root && getComputedStyle(root).display === "block";
      });
      assert.ok(await page.locator('[data-restaurant-print] > section').count() > 1);
      assert.equal(await guide.isVisible(), false, "Screen chrome is excluded from print");
      assert.ok(await page.locator('[data-restaurant-print] > section').evaluateAll(pages => pages.every(section => {
        const parts = [...section.children];
        return parts.every(el => el.scrollHeight <= el.clientHeight + 2)
          && section.scrollHeight <= section.clientHeight + 2;
      })), `Print page overflow ${lang}/${id}`);
      if (width === 1440) {
        const path = `${output}/${lang}-flow-${id}.pdf`;
        pdfManifest.push({ path, pages: await page.locator('[data-restaurant-print] > section').count() });
        await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
      }
      await page.emulateMedia({ media: "screen" });
    }
    await page.goBack();
    await page.waitForFunction(() => location.hash === "#flow-10");
    await guide.locator("#flow-10").waitFor();
    await page.goto(`${base}/restaurant#flow-2`);
    await guide.locator("#flow-2").waitFor();
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: async text => { window.copiedFlowLink = text; } } }));
    await guide.locator('[data-copy-flow]').click();
    assert.equal(await page.evaluate(() => window.copiedFlowLink), `${base}/restaurant#flow-2`);
    await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true,
      value: async data => { window.sharedFlow = data; } }));
    await guide.locator('[data-share-flow]').click();
    assert.equal(await page.evaluate(() => window.sharedFlow.url), `${base}/restaurant#flow-2`);
    await page.evaluate(() => { window.copiedFlowLink = null; Object.defineProperty(navigator, "share", { configurable: true,
      value: async () => { throw new DOMException("FAKE cancelled", "AbortError"); } }); });
    await guide.locator('[data-share-flow]').click();
    assert.equal(await page.evaluate(() => window.copiedFlowLink), null, "Cancelling share must not copy");
    await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: undefined }));
    await guide.locator('[data-share-flow]').click();
    assert.equal(await page.evaluate(() => window.copiedFlowLink), `${base}/restaurant#flow-2`);
    await page.evaluate(() => { window.print = () => { window.flowPrintCalled = true; }; });
    await guide.locator('[data-print-flow]').click();
    await page.waitForFunction(() => window.flowPrintCalled === true);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: async () => { throw new Error("FAKE clipboard denied"); } } }));
    await guide.locator('[data-copy-flow]').click();
    assert.match(await guide.locator('[role="status"]').innerText(), lang === "th" ? /URL/ : /address bar/);
    await guide.locator('[data-flow-id="1"]').click();
    await guide.locator('[data-flow-id="2"]').click();
    const svg = guide.locator('svg[role="img"]'), before = await svg.evaluate(el => el.getBoundingClientRect().width);
    await guide.locator("select").selectOption("1.5");
    assert.ok(await svg.evaluate(el => el.getBoundingClientRect().width) > before);
    await guide.locator("select").selectOption("fit");
    await guide.locator("details summary").click();
    assert.ok(await guide.locator("details[open] li").count() > 10);
    await guide.locator("details summary").click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/${lang}-${width}-page.png`, fullPage: true });
    await page.screenshot({ path: `${output}/${lang}-${width}-preview.png` });
    await guide.locator("#flow-2").screenshot({ path: `${output}/${lang}-${width}-diagram.png` });
    await context.addCookies([{ name: "theme", value: "dark", url: base }]);
    await page.evaluate(() => localStorage.setItem("theme", "dark"));
    admin = true;
    await page.reload();
    await guide.locator('a[href="/admin/dashboard"]').waitFor();
    assert.equal(await guide.locator('a[href="/shop-signup"]').count(), 0);
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await guide.locator("#flow-2").screenshot({ path: `${output}/${lang}-${width}-dark.png` });
    await page.goto(base);
    assert.equal(await page.locator('[data-restaurant-print]').count(), 0, "Print portal cleans up after navigation");
    await page.locator('main a[href="/restaurant"]').first().waitFor();
    assert.ok(await page.locator('footer a[href="/restaurant"]').count() >= 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Homepage overflow");
    assert.deepEqual(errors, [], `Browser exceptions: ${lang}/${width}`);
    await context.close();
    console.log(`PASS ${lang} ${width}px: 11 diagrams, history, deep link, zoom, transcript, theme, session CTA, navigation`);
  }
  await writeFile(`${output}/pdf-manifest.json`, JSON.stringify(pdfManifest, null, 2));
} finally { await browser.close(); }
