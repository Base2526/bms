// Real renderer, simulated device/API responses. No shop writes or native OS certification.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BMS_SMOKE_URL || 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Local renderer only');
const output = '.test-output/costing-clients/browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const [platform, width, height] of [['darwin', 1440, 900], ['win32', 1366, 768], ['linux', 1280, 800], ['darwin', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addCookies([{ name: 'lang', value: 'th', url: base }]);
    await context.addInitScript(platform => {
      window.bmsDesktop = { isDesktop: true, getDeviceToken: async () => 'FAKE-token', getStorageNamespace: async () => 'FAKE-costing',
        getAppInfo: async () => ({ version: '0.2.14-pilot.3', platform, arch: 'x64' }) };
    }, platform);
    const cashier = { id: 'FAKE-cashier', name: 'FAKE Cashier', hasPin: true, role: 'Cashier', posOnly: true, approvals: [] };
    const session = { device: { id: 'FAKE-device', code: 'POS-01', name: 'FAKE register', scanner: { mode: 'OFF' } },
      location: { id: 'FAKE-branch', name: 'FAKE branch', branchCode: 'B2' }, shift: { id: 'FAKE-shift', status: 'OPEN', openingFloat: 0, openedAt: new Date().toISOString() },
      cashiers: [cashier], approvers: [], kitchenOperators: [], store: { name: 'FAKE shop', receiptLanguageMode: 'th', paymentQr: null },
      surface: 'retail', businessArchetype: 'retail', vat: { registered: false, priceIncludesVat: true, rate: 7, cashRounding: 'NONE' } };
    let stage = 0;
    const mutations = [], scans = [], errors = [];
    const hit = size => {
      const price = size === 'S' ? (stage ? 130 : 100) : stage >= 2 ? 250 : 200;
      return { sku: 'FAKE-MENU', size, productName: `Menu ${size}`, receiptName: `Menu ${size}`, packCode: 'BASE', baseQty: 1,
        unitName: 'dish', basePrice: price, packPrice: price, available: 0, stockTracked: false, serialTracked: false, scaleBarcode: null,
        priceTiers: [], modifiers: [], packs: [], imageUrl: null,
        promotion: stage === 2 ? { kind: 'N_FOR_PRICE', buyQty: 2, bundlePrice: 180, buySize: 'S' } : null };
    };
    const preview = input => ({ status: 'READY', subtotal: input.subtotal, netTotal: input.subtotal, amountDue: input.subtotal,
      totalDiscount: 0, tierDiscount: 0, couponDiscount: 0, pointsDiscount: 0, manualDiscount: 0, pointsUsed: 0, loyaltyEnabled: false, member: null });
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      let json = {};
      if (path === '/api/graphql') {
        const q = body?.query || '', v = body?.variables || {};
        let data = {};
        if (q.includes('query PosBootstrap')) data = { bmsPosSession: session };
        else if (q.includes('mutation VerifyPosCashier')) data = { bmsPosVerifyCashier: cashier };
        else if (q.includes('query MobilePosCatalog')) data = { bmsPosCatalogSearch: { items: [] } };
        else if (q.includes('query MobilePosScan')) { scans.push(v); data = { bmsPosScan: hit(v.size || v.code) }; }
        else if (q.includes('query DesktopBenefitsPreview')) data = { bmsPosMemberPreview: preview(v.input) };
        else if (q.includes('mutation')) mutations.push(q);
        json = { data };
      } else if (path === '/api/pos/session') json = session;
      else if (path === '/api/pos/member/preview') json = preview(body);
      else if (path.endsWith('/desktop-update')) json = { status: 'unavailable', releases: [] };
      else if (body && path !== '/api/logs') mutations.push(path);
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => errors.push(error.message));
    const scan = async code => {
      const input = page.getByLabel('สแกนบาร์โค้ดหรือรหัสสินค้า');
      await input.fill(code); await input.press('Enter');
      await page.waitForFunction(() => document.querySelector('input[aria-label="สแกนบาร์โค้ดหรือรหัสสินค้า"]')?.value === '');
    };
    const cash = page.getByLabel('รับเงินมา', { exact: true });
    const expectTotal = async value => {
      await page.waitForFunction(value => Array.from(document.querySelectorAll('label')).find(label => label.textContent.startsWith('รับเงินมา'))?.querySelector('input')?.value === value, value);
      assert.equal(await cash.inputValue(), value);
    };
    try {
      const response = await page.goto(`${base}/pos/app`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      assert.equal(response.status(), 200);
      await page.getByLabel('PIN พนักงาน 4–8 หลัก').fill('1234');
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
      await scan('S'); stage = 1; await scan('S'); await scan('L');
      await page.getByRole('button', { name: /ไปชำระเงิน/ }).click();
      await expectTotal('460'); // The second scan refreshed both S units to the branch price 130.
      stage = 2; scans.length = 0;
      await page.getByRole('button', { name: /ยืนยันรับชำระ/ }).click();
      await page.getByText(/กรุณาตรวจยอดและรับเงินใหม่/).waitFor();
      await expectTotal('430'); // S offer 180 plus L branch price 250, refreshed together.
      assert.equal(scans.length, 2);
      assert.equal(mutations.length, 0, 'Price change must stop settlement for review');
      const rows = page.locator('article').filter({ hasText: /หลังโปร/ });
      assert.match(await rows.filter({ hasText: 'Menu S' }).innerText(), /หลังโปร ฿180\.00/);
      assert.match(await rows.filter({ hasText: 'Menu L' }).innerText(), /หลังโปร ฿250\.00/);
      await page.screenshot({ path: `${output}/${platform}-${width}-offer.png`, fullPage: true });
      stage = 3;
      await page.getByRole('button', { name: /ยืนยันรับชำระ/ }).click();
      await expectTotal('510'); // Expired offer returns to current branch shelf prices.
      assert.equal(mutations.length, 0);
      const bounds = await cash.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'Cash input fits viewport');
      assert.deepEqual(errors, []);
      results.push({ platformMetadata: platform, width, height, passed: true });
    } catch (error) {
      await page.screenshot({ path: `${output}/${platform}-${width}-failure.png`, fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${output}/results.json`, JSON.stringify({ api: 'simulated', nativeOSCertification: false, results }, null, 2));
console.log(JSON.stringify(results));
