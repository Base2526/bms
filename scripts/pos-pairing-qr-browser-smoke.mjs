// Local UI fixtures only. Never issues a real device token or contacts a remote server.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { decode } from '../apps/mobile/node_modules/fast-png/lib/index.js';
const require = createRequire(import.meta.url);
const { RGBLuminanceSource, BinaryBitmap, HybridBinarizer, QRCodeReader } = require('../apps/web/node_modules/@zxing/library');
const { parse } = require('../apps/web/node_modules/graphql');
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BMS_SMOKE_URL || 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Run only against a local dev server');
const output = '.test-output/pos-pairing-qr';
await mkdir(output, { recursive: true });
const token = `pos_${'FAKE'.repeat(10)}abc`;
const device = { id: '1', locationId: '1', code: 'FAKE-POS', name: 'Fixture register', registeredPosNo: null, receiptPrefix: 'F', scannerMode: 'FOCUS', scannerPrefixKey: 'F9', scannerSuffixKey: 'Enter', scannerMaxGapMs: 50, active: true, lastSeenAt: null };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const scenario of [
    { origin: 'https://shop.example.test', width: 1440, allowed: true },
    { origin: 'https://shop.example.test', width: 390, allowed: true },
    { origin: 'https://shop.example.test', width: 320, allowed: true },
    { origin: 'https://shop.example.test', width: 390, allowed: true, deviceOnly: true },
    { origin: base, width: 390, allowed: true },
    { origin: 'https://shop.example.test', width: 1440, allowed: false },
    { origin: 'https://shop.example.test', width: 1440, allowed: true, failFirst: true },
    { origin: 'https://shop.example.test', width: 390, allowed: true, failFirst: 'empty' },
    { origin: 'https://shop.example.test', width: 390, allowed: true, failFirst: 'invalid' },
  ]) {
    const { origin, width, allowed } = scenario;
    const permissions = allowed ? scenario.deviceOnly ? ['pos.device.manage'] : ['pos.device.manage', 'product.view', 'pos.staff.manage'] : [];
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    await context.addCookies([{ name: 'ADMIN_COOKIE', value: 'FAKE-browser-fixture', url: origin }]);
    await context.routeWebSocket('**/*', socket => socket.close());
    let issued = 0;
    let releaseIssue;
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { isAuthenticated: true, admin: { id: 1, email: 'fake@example.test', role: 'Administrator', language: 'th' } } });
      if (url.pathname.endsWith('/graphql')) {
        const { query = '', variables = {} } = request.postDataJSON() ?? {};
        if (/mutation/.test(query)) {
          assert.ok(allowed && query.includes('bmsIssuePosDeviceToken'), 'Unexpected mutation');
          issued++;
          if (scenario.failFirst && issued === 1) return route.fulfill({ json:
            scenario.failFirst === 'empty' ? { data: { bmsIssuePosDeviceToken: null } } :
            scenario.failFirst === 'invalid' ? { data: { bmsIssuePosDeviceToken: { token: 'pos_incomplete' } } } :
            { errors: [{ message: 'FAKE issuance failure' }] },
          });
          await new Promise(resolve => { releaseIssue = resolve; });
          return route.fulfill({ json: { data: { bmsIssuePosDeviceToken: { token } } } });
        }
        if (query.includes('query PosSetup')) {
          const operation = parse(query).definitions.find(node => node.kind === 'OperationDefinition');
          for (const field of operation.selectionSet.selections) {
            if (field.kind !== 'Field') continue;
            const include = field.directives.find(node => node.name.value === 'include');
            if (include && !variables[include.arguments[0].value.name.value]) continue;
            const permission = { bmsLocations: 'product.view', bmsPosDevices: 'pos.device.manage', bmsPosStaff: 'pos.staff.manage', bmsPosDeviceDiagnostics: 'support.logs.view' }[field.name.value];
            assert.ok(!permission || permissions.includes(permission), `Unauthorized GraphQL field: ${field.name.value}`);
          }
        }
        return route.fulfill({ json: { data: { myBmsPermissions: permissions, bmsMe: null, ...(variables.includeLocations ? { bmsLocations: [{ id: '1', name: 'Fixture branch', branchCode: 'F', isHeadOffice: true }] } : {}), ...(variables.includeDevices ? { bmsPosDevices: [device] } : {}), ...(variables.includeStaff ? { bmsPosStaff: [] } : {}) } } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      assert.equal(request.method(), 'GET');
      // Display the local app under a fixture HTTPS origin so the QR uses a realistic mobile host.
      try {
        return await route.fulfill({ response: await route.fetch({ url: base + url.pathname + url.search, headers: { ...request.headers(), host: new URL(base).host, cookie: 'ADMIN_COOKIE=FAKE-browser-fixture' } }) });
      } catch (error) {
        if (!/disposed|closed/i.test(error.message)) throw error;
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/admin/pos-devices', { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (!allowed) {
      await page.getByText(/ไม่มีสิทธิ์ดูหน้านี้/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'ออก token', exact: true }).count(), 0);
    } else {
      await page.getByRole('button', { name: 'ออก token', exact: true }).click({ timeout: 120000 });
      await page.getByRole('button', { name: 'ออกใหม่', exact: true }).click();
      if (scenario.failFirst) {
        await page.getByText(/ยังไม่ได้รับ token ที่ใช้ได้/).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(issued, 1, 'Do not silently retry credential rotation');
        await page.getByRole('button', { name: /ออก token/ }).click();
        await page.getByRole('button', { name: 'ออกใหม่', exact: true }).click();
      }
      // Hold the network response while the operator repeats the issue action.
      await page.waitForFunction(() => document.querySelector('.ant-btn-loading') !== null);
      await page.getByRole('button', { name: /ออก token/ }).evaluate(button => { button.click(); button.click(); });
      const issueDeadline = Date.now() + 5000;
      while (!releaseIssue && Date.now() < issueDeadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(releaseIssue, 'Expected a pending issuance request');
      releaseIssue();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      if (origin.startsWith('https:')) {
        const qr = dialog.locator('.ant-qrcode');
        await qr.waitFor();
        await page.waitForFunction(() => {
          const modal = document.querySelector('.ant-modal');
          return modal && !/zoom/.test(modal.className) && document.querySelector('.ant-qrcode')?.getBoundingClientRect().width >= 255;
        });
        const png = decode(await qr.screenshot({ path: `${output}/qr-${width}.png` }));
        const luminance = new Uint8ClampedArray(png.width * png.height);
        for (let i = 0; i < luminance.length; i++) luminance[i] = (png.data[i * png.channels] + 2 * png.data[i * png.channels + 1] + png.data[i * png.channels + 2]) / 4;
        const decoded = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, png.width, png.height)))).getText();
        assert.equal(decoded, `bmspos://pair?t=${token}&h=${encodeURIComponent(origin)}`);
        const box = await qr.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width, 'QR clipped on narrow screen');
      } else {
        await dialog.getByText('ยังสร้าง QR สำหรับมือถือไม่ได้').waitFor();
        assert.equal(await dialog.locator('.ant-qrcode').count(), 0);
      }
      // Clipboard failure/absence must not claim success or produce an unhandled rejection.
      for (const mode of ['denied', 'missing']) {
        await page.evaluate(mode => Object.defineProperty(navigator, 'clipboard', {
          configurable: true, value: mode === 'missing' ? undefined : { writeText: async () => { throw new Error('FAKE clipboard denied'); } },
        }), mode);
        await dialog.getByRole('button', { name: 'คัดลอก token', exact: true }).click();
        await page.getByText('คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง').last().waitFor();
        assert.equal(await page.locator('.ant-message-success').count(), 0);
      }
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__fakeClipboard = value; } } }));
      await dialog.getByRole('button', { name: 'คัดลอกลิงก์จับคู่', exact: true }).click();
      await page.getByText('คัดลอกลิงก์แล้ว — เปิดลิงก์นี้บนเครื่องขาย').waitFor();
      assert.equal(await page.evaluate(() => window.__fakeClipboard), `${origin}/pos?t=${token}`);
      await page.screenshot({ path: `${output}/${origin.startsWith('https:') ? 'https' : 'local'}-${width}.png` });
      await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      // Ant Modal destroys children after its closing animation finishes.
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('textarea')).some(node => node.value.includes('pos_FAKE')));
      assert.equal(await page.locator('.ant-qrcode').count(), 0);
      assert.equal(await page.locator('textarea').evaluateAll(nodes => nodes.some(node => node.value.includes('pos_FAKE'))), false);
      assert.equal(issued, scenario.failFirst ? 2 : 1);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, https: origin.startsWith('https:'), allowed, issued, passed: true }));
    await context.close();
  }
} finally { await browser.close(); }
