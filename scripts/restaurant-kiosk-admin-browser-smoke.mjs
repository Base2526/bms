// Local API fixture for the real admin floor route. No DB or business mutation.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { parse } from '../apps/web/node_modules/graphql/index.js';

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE
  || new URL('../apps/web/node_modules/playwright/index.mjs', import.meta.url).href);
const base = process.env.BMS_SMOKE_URL || 'http://127.0.0.1:3194';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
await mkdir('.test-output/restaurant-kiosk-admin-browser', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.addCookies([{ name: 'ADMIN_COOKIE', value: 'FAKE-kiosk-admin-fixture', url: base },
      { name: 'lang', value: 'th', url: base }]);
    const errors = [];
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { isAuthenticated: true,
        admin: { id: 'FAKE-admin', role: 'Administrator', name: 'Fixture manager' } } });
      if (path === '/api/realtime/ticket') return route.fulfill({ json: { ticket: 'FAKE' } });
      if (path === '/api/bms/restaurant-kiosk-devices') return route.fulfill({ json: { devices: [
        { id: 'FAKE-device-active', locationId: 'FAKE-branch', label: 'จอหน้าร้าน', active: true,
          hasPin: true, pinSetAt: '2026-11-26T10:00:00.000Z',
          pinLockedUntil: '2099-01-01T00:00:00.000Z', createdAt: '2026-11-26T09:00:00.000Z' },
        { id: 'FAKE-device-revoked', locationId: 'FAKE-branch', label: 'จอเก่า', active: false,
          hasPin: false, pinSetAt: null, pinLockedUntil: null, createdAt: '2026-11-20T09:00:00.000Z' },
      ] } });
      if (path !== '/api/graphql') return route.fulfill({ json: {} });
      const data = {};
      for (const definition of parse(route.request().postDataJSON().query).definitions) {
        if (definition.kind !== 'OperationDefinition') continue;
        assert.notEqual(definition.operation, 'mutation');
        for (const field of definition.selectionSet.selections) {
          if (field.kind !== 'Field') continue;
          const name = field.name.value;
          const alias = field.alias?.value || name;
          data[alias] = null;
          if (name === 'myBmsPermissions') data[alias] = ['restaurant.floor.manage'];
          if (name === 'bmsStoreProfile') data[alias] = { businessArchetype: 'restaurant' };
          if (name === 'bmsRestaurantFloorLocations') data[alias] = [{ id: 'FAKE-branch', name: 'สาขาทดสอบ', active: true }];
          if (name === 'bmsRestaurantFloorAdmin') data[alias] = { publishTableDetails: false, areas: [], tables: [] };
          if (name === 'bmsRestaurantKioskAdminState') data[alias] = { active: true, pendingCount: 2 };
        }
      }
      return route.fulfill({ json: { data } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(`${base}/admin/restaurant-floor`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    assert.equal(response.status(), 200);
    await page.getByText('จอสั่งอาหารหน้าร้าน').waitFor();
    await page.getByText('2 คำขอรอตรวจ').waitFor();
    await page.getByText('จอ Kiosk · PIN ดูแลเครื่อง').waitFor();
    await page.getByText('ล็อกชั่วคราว').waitFor();
    await page.getByText('ยังไม่ตั้ง').waitFor();
    assert.equal(await page.getByRole('link', { name: 'เปิดงานจอสั่งอาหารใน POS' }).getAttribute('href'), '/pos/restaurant?screen=kiosk');
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth + 2), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `.test-output/restaurant-kiosk-admin-browser/floor-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'เปลี่ยน PIN' }).click();
    await page.getByText('ตั้ง PIN ดูแลเครื่อง Kiosk').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `.test-output/restaurant-kiosk-admin-browser/maintenance-pin-${width}.png`, fullPage: true });
    console.log(`admin floor kiosk fixture ${width}px OK`);
    await context.close();
  }
} finally { await browser.close(); }
