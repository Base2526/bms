// Local API fixture for the real admin floor route. No DB or business mutation.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { parse } from '../apps/web/node_modules/graphql/index.js';

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE
  || new URL('../apps/web/node_modules/playwright/index.mjs', import.meta.url).href);
const base = process.env.BMS_SMOKE_URL || 'http://127.0.0.1:3194';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const anonymous = await fetch(`${base}/api/bms/kiosk-desktop-releases?locationId=11111111-1111-4111-8111-111111111111`);
assert.equal(anonymous.status, 401, 'real release API must reject an anonymous browser before fixture routing');
await mkdir('.test-output/restaurant-kiosk-admin-browser', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const { width, lang } of [{ width: 1440, lang: 'th' },
    { width: 390, lang: 'th' }, { width: 390, lang: 'en' }]) {
    let releaseMode = 'published';
    const releaseId = '11111111-1111-4111-8111-111111111111';
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.href.includes('/api/bms/kiosk-desktop-releases/')) {
          window.__kioskFixtureDownload = { href: this.href, filename: this.download };
          return;
        }
        return original.call(this);
      };
    });
    await context.addCookies([{ name: 'ADMIN_COOKIE', value: 'FAKE-kiosk-admin-fixture', url: base },
      { name: 'lang', value: lang, url: base }]);
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
      if (path === '/api/bms/kiosk-desktop-releases') {
        if (releaseMode === 'error') return route.fulfill({ status: 503, json: { code: 'RELEASE_UNAVAILABLE' } });
        if (releaseMode === 'denied') return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } });
        return route.fulfill({ json: { canPublish: lang === 'en', release: releaseMode === 'none' ? null : {
          id: releaseId, version: '0.1.0-pilot.2', channel: 'pilot', status: 'PUBLISHED',
          filename: 'BMS-Kiosk-Setup-0.1.0-pilot.2-x64.exe', sizeBytes: 12345678,
          sha256: 'a'.repeat(64), signatureStatus: 'VALID', minimumOs: 'Windows 10 x64',
          releaseNotes: 'Fixture release notes', publishedAt: '2026-11-27T00:00:00.000Z',
        } } });
      }
      if (path === '/api/admin/kiosk-desktop-releases') return route.fulfill({ json: { releases: [
        { id: '22222222-2222-4222-8222-222222222222', version: '0.1.0-pilot.1',
          channel: 'pilot', status: 'DRAFT', signatureStatus: 'INVALID' },
      ] } });
      if (path === `/api/bms/kiosk-desktop-releases/${releaseId}/download`) {
        return route.fulfill({ status: 200, headers: {
          'Content-Disposition': 'attachment; filename="BMS-Kiosk-Setup-0.1.0-pilot.2-x64.exe"',
          'Content-Type': 'application/vnd.microsoft.portable-executable',
        }, body: route.request().method() === 'HEAD' ? '' : 'fake installer fixture' });
      }
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
    await page.getByText(lang === 'en' ? 'Customer ordering screen' : 'จอสั่งอาหารหน้าร้าน').waitFor();
    await page.getByText(lang === 'en' ? '2 pending requests' : '2 คำขอรอตรวจ').waitFor();
    await page.getByText(lang === 'en' ? 'Kiosk screen · maintenance PIN' : 'จอ Kiosk · PIN ดูแลเครื่อง').waitFor();
    await page.getByText(lang === 'en' ? 'Locked' : 'ล็อกชั่วคราว').waitFor();
    await page.getByText(lang === 'en' ? 'Not set' : 'ยังไม่ตั้ง').waitFor();
    const downloadButton = page.getByRole('button', { name: lang === 'en'
      ? 'Download BMS Kiosk for Windows x64' : 'ดาวน์โหลด BMS Kiosk สำหรับ Windows x64' });
    await downloadButton.waitFor();
    await page.getByText('Fixture release notes').waitFor();
    if (lang === 'en') {
      await page.getByText('Platform release management').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Publish to branch' }).isDisabled(), true);
    }
    await downloadButton.click();
    await page.waitForFunction(() => Boolean(window.__kioskFixtureDownload));
    const selectedDownload = await page.evaluate(() => window.__kioskFixtureDownload);
    assert.equal(selectedDownload.filename, 'BMS-Kiosk-Setup-0.1.0-pilot.2-x64.exe');
    assert.ok(selectedDownload.href.includes(`/api/bms/kiosk-desktop-releases/${releaseId}/download?locationId=FAKE-branch`));
    assert.equal(await page.getByRole('link', { name: lang === 'en' ? 'Open kiosk work in POS' : 'เปิดงานจอสั่งอาหารใน POS' }).getAttribute('href'), '/pos/restaurant?screen=kiosk');
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth + 2), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `.test-output/restaurant-kiosk-admin-browser/floor-${width}-${lang}.png`, fullPage: true });
    releaseMode = 'none';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(lang === 'en' ? 'No installer has been published for this branch.' : 'ยังไม่มีไฟล์ติดตั้งที่เผยแพร่สำหรับสาขานี้').waitFor();
    await page.screenshot({ path: `.test-output/restaurant-kiosk-admin-browser/install-empty-${width}-${lang}.png`, fullPage: true });
    releaseMode = 'error';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(lang === 'en' ? 'Installer status is unavailable.' : 'อ่านสถานะไฟล์ติดตั้งไม่ได้').waitFor();
    await page.screenshot({ path: `.test-output/restaurant-kiosk-admin-browser/install-error-${width}-${lang}.png`, fullPage: true });
    releaseMode = 'denied';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(lang === 'en' ? 'You cannot view installers for this branch.' : 'ไม่มีสิทธิ์ดูไฟล์ติดตั้งของสาขานี้').waitFor();
    await page.screenshot({ path: `.test-output/restaurant-kiosk-admin-browser/install-denied-${width}-${lang}.png`, fullPage: true });
    await page.getByRole('button', { name: lang === 'en' ? 'Change PIN' : 'เปลี่ยน PIN' }).click();
    await page.getByText(lang === 'en' ? 'Set kiosk maintenance PIN' : 'ตั้ง PIN ดูแลเครื่อง Kiosk').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `.test-output/restaurant-kiosk-admin-browser/maintenance-pin-${width}-${lang}.png`, fullPage: true });
    console.log(`admin floor kiosk fixture ${width}px ${lang} OK`);
    await context.close();
  }
} finally { await browser.close(); }
