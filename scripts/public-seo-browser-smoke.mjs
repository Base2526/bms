import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BMS_SMOKE_URL || 'http://127.0.0.1:3114';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local smoke only');
const fakeId = 'G-BMSSEOQA';
const output = '.test-output/public-seo-browser';
const consentKey = 'bms_analytics_consent_v2';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const timings = [];
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', ...options });
  await ctx.addCookies([{ name: 'theme', value: 'light', url: base }]);
  await ctx.routeWebSocket('**/*', socket => socket.close());
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { isAuthenticated: false, user: null, admin: null } });
    if (url.pathname.endsWith('/graphql')) return route.fulfill({ json: { data: { myBmsPermissions: [] } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return ctx;
}
const commands = page => page.evaluate(() => (window.bmsAnalyticsLayer || []).map(args => Array.from(args)));
async function openPreferences(page) {
  await page.locator('.bms-footer-bottom button').click();
  await page.locator('.bms-pdpa-bar').waitFor();
}
try {
  for (const lang of ['th', 'en']) for (const width of [1440, 390]) {
    const ctx = await context({ viewport: { width, height: 1000 } });
    await ctx.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ value: 'reject', at: new Date().toISOString() })), { key: consentKey });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const path of ['restaurant', 'cost-pricing', 'about', 'ai-business-system', 'learn/guides/restaurant-service', 'privacy']) {
      const response = await page.goto(`${base}/${lang}/${path}`);
      assert.equal(response.status(), 200);
      await page.locator('h1').waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.locator('html').getAttribute('lang'), lang);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} overflows ${width}`);
      assert.equal(await page.locator('script[data-bms-analytics]').count(), 0);
      if (['restaurant', 'cost-pricing'].includes(path)) {
        const answers = page.locator('[data-public-answers]');
        assert.equal(await answers.locator('details').count(), 4);
        await answers.locator('summary').nth(1).click();
        assert.ok(await answers.locator('details').nth(1).getAttribute('open') !== null);
        await answers.screenshot({ path: `${output}/${lang}-${path}-${width}.png` });
      }
      if (path.startsWith('learn/')) {
        assert.ok(await page.locator('a[href="/pos/restaurant"]').count() > 0);
        assert.equal(await page.locator(`a[href^="/${lang}/pos"]`).count(), 0);
      }
      timings.push({ lang, width, path, navigation: await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return { responseMs: nav.responseEnd, domContentLoadedMs: nav.domContentLoadedEventEnd };
      }) });
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log('[seo-browser] PASS 24 bilingual desktop/mobile page renders, FAQ interactions and POS links');

  if (process.env.BMS_SEO_VISUAL_ONLY === '1') { await browser.close(); process.exit(0); }

  const ctx = await context();
  let tagRequests = 0;
  // The fake tag exercises our queue/lifecycle without contacting Google or collecting visitors.
  await ctx.route('https://www.googletagmanager.com/gtag/js?**', route => {
    assert.equal(new URL(route.request().url()).searchParams.get('id'), fakeId);
    tagRequests++;
    return route.fulfill({ contentType: 'application/javascript', body: 'window.__fakeGoogleLoaded = true;' });
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/th/cost-pricing?utm_source=chatgpt.com&email=private@example.test#secret`);
  await page.locator('.bms-pdpa-bar').waitFor();
  assert.equal(tagRequests, 0);
  await page.locator('.bms-pdpa-secondary').click();
  assert.equal(tagRequests, 0);
  await openPreferences(page);
  await page.locator('.bms-pdpa-primary').click();
  await page.waitForFunction(() => (window.bmsAnalyticsLayer || []).some(args => args[1] === 'page_view'));
  assert.equal(tagRequests, 1);
  let sent = await commands(page);
  const config = sent.find(args => args[0] === 'config')[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(sent.find(args => args[1] === 'page_view')[2].discovery_source, 'chatgpt');
  assert.equal(sent.find(args => args[1] === 'page_view')[2].page_location, `${base}/th/cost-pricing`);
  assert.doesNotMatch(JSON.stringify(sent), /private@example|#secret|email=/);
  await page.locator('[data-cost-input="0"]').fill('12345');
  assert.deepEqual(await commands(page), sent, 'calculator input must not create telemetry');
  const before = sent.filter(args => args[1] === 'page_view').length;
  await page.locator('.bms-footer a[href="/th/about"]').click();
  await page.waitForURL('**/th/about');
  await page.waitForFunction(n => (window.bmsAnalyticsLayer || []).filter(args => args[1] === 'page_view').length > n, before);
  assert.equal(tagRequests, 1, 'SPA navigation must reuse the tag');
  sent = await commands(page);
  assert.equal(sent.filter(args => args[1] === 'page_view').at(-1)[2].discovery_source, 'chatgpt');
  await page.locator('.bms-footer a[href="/th/demo"]').click();
  await page.waitForURL('**/th/demo');
  assert.ok((await commands(page)).some(args => args[1] === 'public_cta_click' && args[2].cta_action === 'demo_open'));
  await page.evaluate(() => { document.cookie = 'bms_analytics_test=1;path=/'; });
  await openPreferences(page);
  await page.locator('.bms-pdpa-secondary').click();
  assert.equal(await page.evaluate(id => window[`ga-disable-${id}`], fakeId), true);
  assert.ok(!(await page.evaluate(() => document.cookie)).includes('bms_analytics_test'));
  const rejected = await commands(page);
  await page.locator('.bms-footer a[href="/th/about"]').click();
  await page.waitForURL('**/th/about');
  assert.deepEqual(await commands(page), rejected, 'rejection must stop subsequent events');
  // Cross-tab opt-in and withdrawal are applied without a reload.
  const other = await ctx.newPage();
  await other.goto(`${base}/th/about`);
  await openPreferences(other);
  await other.locator('.bms-pdpa-primary').click();
  await page.waitForFunction(id => window[`ga-disable-${id}`] === false, fakeId);
  await openPreferences(other);
  await other.locator('.bms-pdpa-secondary').click();
  await page.waitForFunction(id => window[`ga-disable-${id}`] === true, fakeId);
  await openPreferences(page);
  await page.locator('.bms-pdpa-primary').click();
  await page.waitForFunction(id => window[`ga-disable-${id}`] === false, fakeId);
  const beforeExpiry = await commands(page);
  await page.evaluate(() => {
    const future = Date.now() + 181 * 24 * 60 * 60 * 1000;
    Date.now = () => future;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(id => window[`ga-disable-${id}`] === true, fakeId);
  assert.deepEqual(await commands(page), beforeExpiry, 'expired consent must not emit another event');
  await ctx.close();
  console.log('[seo-browser] PASS opt-in, sanitized payloads, SPA page views, CTA intent, revoke, expiry and cross-tab sync');

  const slow = await context();
  let pendingTag, resolveTag;
  const tagIntercepted = new Promise(resolve => { resolveTag = resolve; });
  await slow.route('https://www.googletagmanager.com/gtag/js?**', route => { pendingTag = route; resolveTag(); });
  const slowPage = await slow.newPage();
  await slowPage.goto(`${base}/en/about`);
  await slowPage.locator('.bms-pdpa-primary').click();
  await tagIntercepted;
  assert.ok(pendingTag, 'the tag load must be in flight');
  await openPreferences(slowPage);
  await slowPage.locator('.bms-pdpa-secondary').click();
  await pendingTag.fulfill({ contentType: 'application/javascript', body: '' });
  await slowPage.waitForFunction(() => document.querySelector('script[data-bms-analytics]')?.dataset.loaded === 'true');
  assert.deepEqual(await commands(slowPage), [], 'late tag load must not replay events after withdrawal');
  await openPreferences(slowPage);
  await slowPage.locator('.bms-pdpa-primary').click();
  await slowPage.waitForFunction(() => (window.bmsAnalyticsLayer || []).some(args => args[1] === 'page_view'));
  const priorPrivate = await commands(slowPage);
  // Next patches history.pushState, so this exercises the same pathname subscription without
  // invoking an authenticated workflow or relying on an admin session.
  await slowPage.evaluate(() => history.pushState(null, '', '/admin/dashboard?customer=private'));
  await slowPage.waitForFunction(id => window[`ga-disable-${id}`] === true, fakeId);
  assert.deepEqual(await commands(slowPage), priorPrivate, 'private paths must not become page views');
  await slow.close();
  console.log('[seo-browser] PASS revoke during tag load and private-path suppression');

  for (const mode of ['old-consent', 'dnt', 'gpc', 'blocked-storage']) {
    const ctx = await context();
    let requests = 0;
    await ctx.route('https://www.googletagmanager.com/gtag/js?**', route => { requests++; return route.fulfill({ contentType: 'application/javascript', body: '' }); });
    await ctx.addInitScript(({ mode, key }) => {
      if (mode === 'old-consent') localStorage.setItem('pdpa_consent_v1', JSON.stringify({ value: 'allow', at: new Date().toISOString() }));
      if (mode === 'dnt' || mode === 'gpc') {
        localStorage.setItem(key, JSON.stringify({ value: 'allow', at: new Date().toISOString() }));
        Object.defineProperty(navigator, mode === 'dnt' ? 'doNotTrack' : 'globalPrivacyControl', { get: () => mode === 'dnt' ? '1' : true });
      }
      if (mode === 'blocked-storage') {
        Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
        Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
      }
    }, { mode, key: consentKey });
    const page = await ctx.newPage();
    await page.goto(`${base}/en/about`);
    await page.locator('.bms-footer').waitFor();
    assert.equal(requests, 0, mode);
    if (mode === 'blocked-storage') {
      await page.locator('.bms-pdpa-primary').click();
      await page.waitForFunction(() => (window.bmsAnalyticsLayer || []).some(args => args[1] === 'page_view'));
      assert.equal(requests, 1);
      await openPreferences(page);
      await page.locator('.bms-pdpa-secondary').click();
      assert.equal(await page.evaluate(id => window[`ga-disable-${id}`], fakeId), true);
    }
    await ctx.close();
  }
  console.log('[seo-browser] PASS old permission ignored, DNT/GPC respected, blocked storage remains usable');
  await writeFile(`${output}/navigation-timings.json`, JSON.stringify({ note: 'Local smoke timings, not field Core Web Vitals.', pages: timings }, null, 2));
} finally { await browser.close(); }
