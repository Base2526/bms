import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BMS_SMOKE_URL || 'http://localhost:3194';
const output = '.test-output/connection-browser-results';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    for (const path of ['/pos/app', '/pos/restaurant']) {
      for (const scenario of ['html', 'unavailable', 'denied', 'network', 'floor']) {
        if (scenario === 'floor' && path !== '/pos/restaurant') continue;
        if (process.env.BMS_SMOKE_SCENARIO && scenario !== process.env.BMS_SMOKE_SCENARIO) continue;
        if (process.env.BMS_SMOKE_PATH && path !== process.env.BMS_SMOKE_PATH) continue;
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        // This smoke exercises HTTP recovery without a live subscription gateway.
        await context.routeWebSocket('**/*', socket => socket.close({ code: 1013, reason: 'Fixture gateway unavailable' }));
        await context.addCookies([{ name: 'lang', value: 'th', url: base }]);
        await context.addInitScript(() => {
          window.bmsDesktop = { isDesktop: true, getDeviceToken: async () => 'FAKE-token',
            getStorageNamespace: async () => 'FAKE-connection-errors',
            getAppInfo: async () => ({ version: '0.2.14-pilot.10', platform: 'win32', arch: 'x64' }) };
        });
        await context.route('**/api/**', async route => {
          const url = new URL(route.request().url());
          if (url.pathname.endsWith('/ticket')) return route.fulfill({ status: 503, json: { error: 'fixture realtime unavailable' } });
          if (url.pathname === '/api/graphql' || url.pathname === '/api/pos/session') {
            if (scenario === 'floor') return route.fulfill({ json: {
              device: { id: 'FAKE-device', code: 'POS-01', name: 'Fixture' }, location: null, shift: null,
              cashiers: [], approvers: [], kitchenOperators: [], businessArchetype: 'restaurant', vat: {},
            } });
            if (scenario === 'network') return route.abort('failed');
            if (scenario === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>PRIVATE_PROXY_BODY</html>' });
            return route.fulfill({ status: scenario === 'denied' ? 403 : 503, json: {} });
          }
          if (url.pathname === '/api/pos/restaurant/floor') return route.fulfill({ json: scenario === 'floor' ? {} : { areas: [], tables: [] } });
          if (url.pathname === '/api/pos/restaurant/waitlist') return route.fulfill({ json: { entries: [] } });
          if (url.pathname === '/api/pos/restaurant/menu') return route.fulfill({ json: { items: [] } });
          if (url.pathname === '/api/pos/kitchen/tickets') return route.fulfill({ json: { tickets: [] } });
          return route.fulfill({ json: {} }); // no request reaches a real business backend
        });
        const page = await context.newPage();
        const pageErrors = [];
        const consoleErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', entry => { if (entry.type() === 'error') consoleErrors.push(entry.text()); });
        try {
          await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
          const text = scenario === 'html' || scenario === 'floor' ? 'POS_PROTOCOL'
            : scenario === 'denied' ? 'ไม่มีสิทธิ์'
              : scenario === 'network' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'
                : path === '/pos/app' ? 'POS_SERVER' : 'เซิร์ฟเวอร์ไม่ตอบ';
          await page.getByText(text, { exact: false }).first().waitFor({ timeout: 25000 });
          if (path === '/pos/app') {
            await page.getByRole('heading', { name: 'โหลดข้อมูลเครื่องขายไม่สำเร็จ' }).waitFor();
            assert.equal(await page.locator('[class*="DesktopPosRenderer_spinner"]').count(), 0);
          }
          if (scenario === 'floor') {
            assert.equal(await page.getByText('ยังไม่มีผังโต๊ะของสาขานี้', { exact: true }).count(), 0);
            await page.getByText('ยังอ่านข้อมูลโต๊ะและบิลไม่ได้', { exact: true }).first().waitFor();
          }
          assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE_PROXY_BODY'));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          assert.deepEqual(pageErrors, []);
          await page.screenshot({ path: `${output}/${path.split('/').pop()}-${width}-${scenario}.png`, fullPage: true });
          console.log(`PASS ${path} ${width}px ${scenario}: visible recovery message, no raw body, no live API calls`);
        } catch (error) {
          console.error(JSON.stringify({ path, width, scenario, pageErrors, consoleErrors }));
          await page.screenshot({ path: `${output}/failure-${width}-${scenario}.png`, fullPage: true });
          throw error;
        } finally { await context.close(); }
      }
    }
  }
} finally { await browser.close(); }
