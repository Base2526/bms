import assert from "node:assert/strict";

// Run against a local, throwaway web server. Read-only browser navigation; no shop account needed.
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
const slugs = [
  "bms-overview", "shop-signup-verification", "sign-in-account", "shop-profile-setup", "dashboard-first-read",
  "shop-team-users", "channel-setup-overview", "channel-line-oa", "channel-meta-messaging", "channel-tiktok-inbound",
  "channel-web-chat", "opening-payments-products", "pos-pin-readiness", "verify-inbox-channels",
  "logs-diagnostics-guide", "opening-checklist",
];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"]) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      await context.addCookies([{ name: "lang", value: lang, url: base }]);
      const page = await context.newPage();
      const errors = [];
      const tenantCalls = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => { if (/\/api\/bms\//.test(request.url())) tenantCalls.push(request.url()); });
      const home = await page.goto(`${base}/${lang}/learn`, { waitUntil: "domcontentloaded" });
      assert.equal(home.status(), 200);
      assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
      assert.ok(await page.locator(`header nav a[href$="/${lang}/learn/getting-started"]`).count(), `${lang}/${width}: missing course navigation`);
      const pathLink = page.locator(`main a[href$="/${lang}/learn/getting-started"]:visible`).first();
      assert.ok(await pathLink.isVisible(), `${lang}/${width}: missing start path`);
      await pathLink.click();
      await page.waitForURL(`**/${lang}/learn/getting-started`);
      assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
      for (const [i, slug] of slugs.entries()) {
        const response = await page.goto(`${base}/${lang}/learn/guides/${slug}?track=getting-started`, { waitUntil: "domcontentloaded" });
        assert.equal(response.status(), 200, `${lang}/${width}/${slug}`);
        assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1, `${lang}/${width}/${slug}`);
        assert.ok(await page.locator("#prepare").count());
        assert.ok(await page.locator("#steps").count());
        assert.ok(await page.locator("#example").count());
        assert.ok(await page.locator("#verify").count());
        assert.ok(await page.locator("#limits").count());
        if (slug === "shop-profile-setup") {
          const workLink = page.locator('a[href*="/admin/login?next=%2Fadmin%2Fsettings"]');
          await workLink.waitFor();
          assert.ok(await workLink.isVisible(), `${lang}/${width}: signed-out task link`);
        }
        if (i > 0) assert.ok(await page.locator(`nav[class*="pager"] a[href*="/${slugs[i - 1]}?"]`).count(), `${slug}: previous`);
        if (i < slugs.length - 1) assert.ok(await page.locator(`nav[class*="pager"] a[href*="/${slugs[i + 1]}?"]`).count(), `${slug}: next`);
        const body = await page.locator("main").innerText();
        assert.doesNotMatch(body, /guide_links\.|undefined|(?:Bearer\s+[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,})/);
        assert.doesNotMatch(await page.content(), /(?:LINE_CHANNEL_SECRET|FACEBOOK_APP_SECRET|TIKTOK_CHANNEL_SECRET|session_token)\s*[=:]\s*["'][^"']+/i);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, `${lang}/${width}/${slug}: horizontal overflow ${overflow}`);
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      assert.ok((await page.getByRole("heading", { level: 1 }).innerText()).length > 3);
      const search = await page.goto(`${base}/${lang}/learn?q=TikTok`, { waitUntil: "domcontentloaded" });
      assert.equal(search.status(), 200);
      assert.ok(await page.locator('main a[href*="/channel-tiktok-inbound"]').count(), `${lang}/${width}: search missed TikTok`);
      await page.goto(`${base}/${lang}/learn?track=getting-started`, { waitUntil: "domcontentloaded" });
      assert.equal(await page.locator('main a[class*="card"][href*="/learn/guides/"]').count(), slugs.length, `${lang}/${width}: course filter`);
      for (const path of ["/learn/no-such-track", "/learn/guides/no-such-lesson"]) {
        const missing = await page.goto(`${base}/${lang}${path}`, { waitUntil: "domcontentloaded" });
        assert.equal(missing.status(), 404, `${lang}/${width}${path}`);
      }
      assert.deepEqual(tenantCalls, [], `${lang}/${width}: public lesson queried tenant API`);
      assert.deepEqual(errors, [], `${lang}/${width}: browser errors`);
      await context.close();
      console.log(`PASS ${lang} ${width}px: 16 articles, path, search, reload, 404, public-only`);
    }
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const [path, slug] of [["/shop-signup", "shop-signup-verification"], ["/admin/login", "sign-in-account"]]) {
    const response = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    assert.equal(response.status(), 200);
    assert.ok(await page.locator(`a[href*="/learn/guides/${slug}"]`).count(), `${path}: help link absent`);
  }
  await page.goto(`${base}/admin/settings`, { waitUntil: "domcontentloaded" });
  assert.match(page.url(), /\/admin\/login\?next=%2Fadmin%2Fsettings/, "anonymous Settings access must redirect to login");
  await context.close();
  console.log("PASS anonymous signup/login guide entry points and admin redirect");
} finally {
  await browser.close();
}
