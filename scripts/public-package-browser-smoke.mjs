import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BMS_SMOKE_URL || 'http://127.0.0.1:3007';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));

const plans = [
  ['free', 'Free', 0, 0, 100, 2, 1, 1, 1, 100, []],
  ['pro', 'Pro', 990, 9_900, 5_000, 5, 1, 3, 3, 1_000, ['REPORT_SCHEDULE']],
  ['growth', 'Growth', 1_990, 19_900, 15_000, 15, 3, 6, 5, 2_500, ['REPORT_SCHEDULE']],
  ['business', 'Business', 4_900, 49_000, 50_000, 40, 5, 10, 10, 5_000, ['REPORT_SCHEDULE', 'RETENTION_ENGINE']],
  ['enterprise', 'Enterprise Factory', 29_900, 329_000, 200_000, 150, 10, 50, 20, 10_000, ['REPORT_SCHEDULE', 'RETENTION_ENGINE']],
].map(([code, name, price_monthly, price_yearly, max_products, max_users, max_branches, max_devices,
  max_channels, ai_credits_monthly, feature_keys]) => ({
  code, name, price_monthly, price_yearly, max_products, max_users, max_branches, max_devices,
  max_channels, max_orders_month: -1, ai_credits_monthly, ai_credits_next_monthly: null,
  ai_credits_change_at: null, feature_keys,
}));

const output = '.test-output/public-package-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const lang of ['th', 'en']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: 'lang', value: lang, url: base }]);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async payload => { window.__lastSharedPackage = payload; },
      });
    });
    await context.route(/\/(?:api\/|graphql)/, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { isAuthenticated: false } });
      if (path === '/api/public/app-downloads') return route.fulfill({ json: {} });
      if (path === '/api/graphql' || path === '/graphql') {
        return route.fulfill({ json: { data: { bmsPublicPlans: plans } } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${base}/#pricing`, { waitUntil: 'domcontentloaded' });
      const comparisonName = lang === 'th' ? 'เปรียบเทียบแพ็กเกจ BMS' : 'Compare BMS plans';
      const region = page.getByRole('region', { name: comparisonName });
      const table = page.getByRole('table', { name: comparisonName });
      await table.getByText('Growth', { exact: true }).waitFor({ state: 'attached' });
      await table.getByText('Enterprise Factory', { exact: true }).waitFor({ state: 'attached' });
      await region.evaluate(element => { element.scrollLeft = element.scrollWidth; });
      assert.match(await table.innerText(), /29[,.]?900/);
      assert.match(await table.innerText(), /19[,.]?900/);
      const contact = table.getByRole('link', { name: lang === 'th' ? 'ติดต่อฝ่ายขาย' : 'Contact sales' });
      assert.equal(await contact.getAttribute('href'), 'https://line.me/R/ti/p/%40168tnlzi');
      assert.equal(await contact.getAttribute('target'), '_blank');
      assert.equal(await contact.getAttribute('rel'), 'noreferrer');
      await page.getByText(lang === 'th'
        ? /Enterprise Factory ต้องประเมิน workload.*สัญญาขั้นต่ำ 12 เดือน/
        : /Enterprise Factory requires a workload assessment.*minimum 12-month contract/).waitFor();
      const download = page.getByRole('link', { name: lang === 'th' ? 'ดาวน์โหลด PDF ล่าสุด' : 'Download latest PDF' });
      assert.equal(await download.getAttribute('href'), `/api/public/packages/pdf?lang=${lang}`);
      await page.getByRole('button', { name: lang === 'th' ? 'แชร์แพ็กเกจล่าสุด' : 'Share latest packages' }).click();
      assert.equal(await page.evaluate(() => window.__lastSharedPackage?.url), `${base}/#pricing`);
      await page.getByText(lang === 'th' ? 'แชร์แล้ว' : 'Shared', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      if (width === 390) {
        assert.equal(await table.evaluate(element => element.scrollWidth > element.parentElement.clientWidth), true);
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/pricing-${lang}-${width}.png`, fullPage: true });
      console.log(`PASS ${lang} ${width}: public package table, Enterprise CTA and responsive layout`);
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${lang}-${width}.png`, fullPage: true });
      console.log((await page.locator('body').innerText()).slice(-3000));
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
