import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import jwt from '../apps/web/node_modules/jsonwebtoken/index.js';
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BMS_SMOKE_URL || 'http://localhost:3007';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
// The local server must use the same test-only JWT secret and a disposable DB
// with users(id='1', is_platform_admin=true) for the real server layout guard.
// All browser APIs and WebSockets below are mocked; no catalogue mutation reaches DB.
// BMS_ALLOW_FAKE_SEED=1 enables the read-only auth/retirement checks below.
assert.ok(process.env.BMS_SMOKE_JWT_SECRET, 'provide the isolated local server test secret');
const adminToken = jwt.sign({ id: '1', role: 'Administrator', email: 'fake@example.test' },
  process.env.BMS_SMOKE_JWT_SECRET, { expiresIn: '10m' });
const output = '.test-output/monthly-package-browser';
await mkdir(output, { recursive: true });
assert.equal((await fetch(`${base}/api/dev/fake/package`)).status, 401);
const staffToken = jwt.sign({ id: '2', role: 'Administrator' }, process.env.BMS_SMOKE_JWT_SECRET, { expiresIn: '10m' });
assert.equal((await fetch(`${base}/api/dev/fake/package`, { headers: { cookie: `ADMIN_COOKIE=${staffToken}` } })).status, 403);
const retired = await fetch(`${base}/api/dev/fake/bms-ai-usage`, { method: 'POST', headers: { cookie: `ADMIN_COOKIE=${adminToken}` } });
assert.equal(retired.status, 410);
assert.equal((await retired.json()).code, 'LEGACY_AI_USAGE_RETIRED');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const lang of ['th', 'en']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.routeWebSocket('**', socket => {
      socket.onMessage(message => {
        const payload = JSON.parse(String(message));
        if (payload.type === 'connection_init') socket.send(JSON.stringify({ type: 'connection_ack' }));
        if (payload.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      });
    });
    await context.addCookies([{ name: 'ADMIN_COOKIE', value: adminToken, url: base }, { name: 'lang', value: lang, url: base }]);
    let previewInput, savedInput;
    const plan = { code: 'free', name: 'Free', price_monthly: 0, price_yearly: 0, max_products: 100, max_channels: 1,
      max_branches: 1, max_devices: 1, max_orders_month: -1, max_users: 2, ai_credits_monthly: 100,
      ai_credits_next_monthly: null, ai_credits_change_at: null, feature_keys: [] };
    let fakeProvisionInput;
    let tenantFetches = 0;
    let fakeProductUsage = 99;
    await context.route(/\/(?:api\/|graphql)/, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { isAuthenticated: true,
        admin: { id: 1, role: 'Administrator', email: 'fake@example.test', language: lang } } });
      if (path === '/api/dev/fake/package') return route.fulfill({ json: {
        plan, plans: [plan, { ...plan, code: 'pro', name: 'Pro', price_monthly: 990, price_yearly: 9900 }, { ...plan, code: 'growth', name: 'Growth', price_monthly: 1990, price_yearly: 19900 }, { ...plan, code: 'business', name: 'Business', price_monthly: 4900, price_yearly: 49000 }],
        products: { used: fakeProductUsage, limit: 100, remaining: 100 - fakeProductUsage },
        users: { used: 1, limit: 2, remaining: 1 }, devices: { used: 1, limit: 1, remaining: 0 }, capacities: [],
      } });
      if (path === '/api/dev/fake/bms-products') {
        assert.deepEqual(route.request().postDataJSON(), { tenantId: 'FAKE', count: 1 });
        fakeProductUsage = 100;
        return route.fulfill({ json: { created: [{ sku: 'FAKE-ONE', name: 'Fixture', tags: [] }] } });
      }
      if (path === '/api/dev/fake/provision-shop') {
        fakeProvisionInput = route.request().postDataJSON();
        fakeProductUsage = 99;
        return route.fulfill({ json: { tenant: { id: 'NEW', name: 'New fixture', slug: 'test-fixture', plan: fakeProvisionInput.planCode },
          admin: { email: 'fixture@example.test', password: 'fake-browser-only' }, summary: { staff: 5, products: 500, posDevices: 3 } } });
      }
      if (path === '/api/dev/fake/provision-demo-shops') {
        assert.equal(route.request().postDataJSON().planCode, 'pro');
        fakeProductUsage = 98;
        return route.fulfill({ json: { created: [{ key: 'fashion', businessArchetype: 'fashion',
          tenant: { id: 'FAKE', name: 'Fixture', slug: 'fake', plan: 'free' },
          summary: { staff: 2, products: 98, posDevices: 1 } }] } });
      }
      if (!['/api/graphql', '/graphql'].includes(path)) return route.fulfill({ json: {} });
      const { query: q, variables } = route.request().postDataJSON();
      if (q.includes('bmsTenants')) tenantFetches += 1;
      if (q.includes('bmsPreviewPlanCatalogChange')) {
        previewInput = variables.input;
        return route.fulfill({ json: { data: { bmsPreviewPlanCatalogChange: { code: 'free', version: 1,
          affectedTenants: 1, featureGrantedTenants: 0, featureRevokedTenants: 0,
          grantedFeatures: [], revokedFeatures: [], previewToken: 'FAKE-preview' } } } });
      }
      if (q.includes('mutation')) {
        assert.ok(q.includes('bmsUpdatePlanCatalog'), 'only the mocked catalogue save is allowed');
        assert.equal(variables.confirmed, true);
        assert.equal(variables.previewToken, 'FAKE-preview');
        savedInput = variables.input;
        return route.fulfill({ json: { data: { bmsUpdatePlanCatalog: { code: 'free', version: 2 } } } });
      }
      return route.fulfill({ json: { data: {
        bmsIsPlatformAdmin: true, myBmsPermissions: ['billing.view', 'settings.manage'],
        bmsStoreProfile: { businessArchetype: 'retail' }, bmsKitchenBoardEnabled: false,
        bmsWastageEnabled: false, bmsPackToolsConfigured: false, bmsActingTenant: null,
        bmsChannelHealthCount: 0, bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0, bmsRestockReadyCount: 0,
        bmsMe: { id: '1', email: 'fake@example.test', tenant: { id: 'FAKE', name: 'Fixture', slug: 'fake' } },
        bmsTenants: [{ id: 'FAKE', name: 'Fixture', slug: 'fake', active: true }],
        bmsAiLimitNotifications: { unreadCount: 0, items: [] }, bmsAiConfig: { has_key: false, model: 'fixture' },
        bmsAiUsage: { billingMode: 'PLAN_POINTS', count: 0, limit: 100, remaining: 100, unlimited: false,
          planCode: 'free', planName: 'Free', requestCount: 0, sharedRequests: 0, byokRequests: 0,
          blockedRequests: 0, grantedCredits: 100, bonusCredits: 0, adjustedCredits: 0, billableCredits: 0,
          providerCalls: 0, actualCostUsd: null, unpricedProviderCalls: 0, inputTokens: 0, outputTokens: 0,
          creditStatus: 'NORMAL', resetsAt: '2026-10-31T17:00:00Z' },
        bmsBilling: { plan, usage: { products: 0, channels: 2, orders_month: 0, users: 1 }, plans: [plan] },
        bmsEntitlements: { capacities: ['branches', 'devices', 'channels'].map(resource => ({
          resource, used: resource === 'channels' ? 2 : 1, limit: 1, source: 'PLAN', canAdd: false })) },
        bmsFeatureAccess: [], bmsAiCreditLedger: [], bmsAiUsageBreakdown: [],
        bmsPlatformReferences: { source: 'DATABASE', countries: [], currencies: [], timezones: [], unresolved: [] },
        bmsPlanCatalog: [{ code: 'free', name: 'Free', priceMonthly: 0, priceYearly: 0, maxProducts: 100, maxChannels: 1,
          maxOrdersMonth: -1, maxUsers: 2, maxBranches: 1, maxDevices: 1, maxAiMessagesMonth: 100,
          aiCreditsMonthly: 100, featureKeys: [], version: 1, updatedAt: null }],
      } } });
    });
    const page = await context.newPage();
    if (process.env.BMS_SMOKE_DEBUG === '1') {
      page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (!path.startsWith('/_next/')) console.log(request.method(), path);
      });
      page.on('response', response => {
        if (response.status() >= 400) console.log(response.status(), new URL(response.url()).pathname);
      });
    }
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const layout = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    try {
      await page.goto(`${base}/admin/master-data`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: lang === 'th' ? 'แพ็กเกจ' : 'Plans', exact: true }).click();
      await page.getByRole('button', { name: lang === 'th' ? 'แก้ไข' : 'Edit', exact: true }).click();
      const modal = page.locator('.ant-modal-content');
      await modal.locator('#aiCreditsMonthly').fill('777');
      assert.equal(await modal.locator('#maxAiMessagesMonth, #maxOrdersMonth').count(), 0);
      await modal.getByText(lang === 'th' ? /ทุกแพ็กเกจมีออเดอร์ไม่จำกัด/ : /Orders are unlimited on every plan/).waitFor();
      await page.waitForFunction(() => {
        const dialog = document.querySelector('.ant-modal');
        return dialog && getComputedStyle(dialog).opacity === '1' && !dialog.className.includes('zoom');
      });
      await layout();
      await page.screenshot({ path: `${output}/catalog-${lang}-${width}.png` });
      await modal.getByRole('button', { name: lang === 'th' ? 'ดูผลกระทบ' : 'Preview impact', exact: true }).click();
      await page.locator('.ant-modal-confirm').waitFor();
      assert.equal(previewInput.maxOrdersMonth, -1);
      assert.equal(previewInput.aiCreditsMonthly, 777);
      assert.equal(previewInput.maxAiMessagesMonth, 777);
      await page.locator('.ant-modal-confirm .ant-btn-primary').click();
      await page.locator('.ant-modal-confirm').waitFor({ state: 'hidden' });
      assert.deepEqual(savedInput, previewInput);
      await page.goto(`${base}/admin/billing`, { waitUntil: 'domcontentloaded' });
      await page.getByText(lang === 'th' ? /สำหรับร้านใหม่ ระบบบังคับเพดาน/ : /For new shops, branch, POS-device/).waitFor();
      await layout();
      await page.screenshot({ path: `${output}/billing-${lang}-${width}.png` });
      await page.goto(`${base}/admin/manual`, { waitUntil: 'domcontentloaded' });
      await page.getByText(lang === 'th' ? /ข้อมูลกลางแพลตฟอร์มกำหนดโควตา AI point/ : /Platform master data uses one monthly AI point/).waitFor();
      await layout();
      await page.goto(`${base}/admin/dev/fake`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('fake-package').getByText(/99\/100/).waitFor();
      assert.equal(await page.locator('button').filter({ hasText: /^Create$/ }).isDisabled(), true);
      await page.getByRole('spinbutton').fill('1');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByTestId('fake-package').getByText(/100\/100/).waitFor();
      assert.equal(await page.locator('button').filter({ hasText: /^Create$/ }).isDisabled(), true);
      const packageSelect = page.getByRole('combobox', { name: lang === 'th' ? 'แพ็กเกจร้านใหม่' : 'New shop package' }).first();
      await packageSelect.press('ArrowDown');
      await page.locator('.ant-select-item-option').filter({ hasText: /^Pro$/ }).click();
      const beforeProvisionTenants = tenantFetches;
      await page.getByRole('button', { name: lang === 'th' ? 'สร้างร้านทดสอบ' : 'Create test shop', exact: true }).click();
      await page.locator('.ant-modal-content').getByText('pro', { exact: true }).waitFor();
      assert.equal(fakeProvisionInput.planCode, 'pro');
      await page.locator('.ant-modal-footer').getByRole('button', { name: lang === 'th' ? 'ปิด' : 'Close', exact: true }).click();
      await page.locator('.ant-modal').waitFor({ state: 'hidden' });
      await page.getByTestId('fake-package').getByText(/99\/100/).waitFor();
      assert.ok(tenantFetches > beforeProvisionTenants, 'new shops refresh the tenant picker');
      const beforeScenarioTenants = tenantFetches;
      await page.locator('.ant-select').filter({ has: page.getByText(lang === 'th' ? 'เลือกร้านสถานการณ์ที่ต้องการสร้าง' : 'Select a scenario shop to create', { exact: true }) }).getByRole('combobox').press('ArrowDown');
      await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
      await page.getByRole('button', { name: lang === 'th' ? 'สร้างร้านที่เลือก' : 'Create selected shop', exact: true }).click();
      await page.getByTestId('fake-package').getByText(/98\/100/).waitFor();
      assert.ok(tenantFetches > beforeScenarioTenants, 'reseed refreshes the tenant picker');
      await page.keyboard.press('Escape');
      await layout();
      await page.screenshot({ path: `${output}/fake-${lang}-${width}.png`, fullPage: true });
      await page.getByTestId('fake-package').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/fake-quota-${lang}-${width}.png` });
      assert.deepEqual(errors, []);
      console.log(`PASS ${lang} ${width}: catalogue, Billing, manual and package-aware fake generator`);
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${lang}-${width}.png` });
      console.log((await page.locator('body').innerText()).slice(-5000));
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
