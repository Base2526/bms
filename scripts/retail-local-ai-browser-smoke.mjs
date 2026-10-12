import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BMS_SMOKE_URL || 'http://localhost:3017';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = '.test-output/retail-local-ai-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const lang of ['th', 'en']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: 'ADMIN_COOKIE', value: 'FAKE-browser-fixture', url: base }, { name: 'lang', value: lang, url: base }]);
    let hasKey = false, billingQueries = 0, actualCost = 1.2345;
    await context.route(/\/(?:api\/|graphql)/, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { isAuthenticated: true, admin: { id: 1, role: 'Administrator', email: 'fake@example.test', name: 'FAKE admin', language: lang } } });
      if (!['/api/graphql', '/graphql'].includes(path)) return route.fulfill({ json: {} });
      const { query: q } = route.request().postDataJSON();
      if (q.includes('bmsBilling')) billingQueries++;
      if (q.includes('bmsSetAiKey(')) { hasKey = true; return route.fulfill({ json: { data: { bmsSetAiKey: true } } }); }
      if (q.includes('mutation') && q.includes('bmsRemoveAiKey')) { hasKey = false; return route.fulfill({ json: { data: { bmsRemoveAiKey: true } } }); }
      await route.fulfill({ json: { data: {
        myBmsPermissions: ['assistant.use', 'report.view', 'billing.view'], bmsIsPlatformAdmin: false,
        bmsStoreProfile: { businessArchetype: 'retail' }, bmsKitchenBoardEnabled: false, bmsWastageEnabled: false, bmsPackToolsConfigured: false,
        bmsActingTenant: null, bmsChannelHealthCount: 0, bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0, bmsRestockReadyCount: 0,
        bmsMe: { id: '1', email: 'fake@example.test', tenant: { id: 'FAKE', slug: 'fake' } },
        bmsMyTenant: { id: 'FAKE', slug: 'fake', name: 'FAKE Local' }, bmsChannels: [], bmsChannelHealth: [],
        bmsAiConfig: { has_key: hasKey, api_key_masked: hasKey ? 'FAKE***' : null, model: 'claude-haiku-4-5', provider: 'anthropic' },
        bmsAiUsage: { __typename: 'BmsAiUsage', billingMode: hasKey ? 'LOCAL_OWN_KEY' : 'LOCAL_UNCONFIGURED',
          connectionProvider: hasKey ? 'anthropic' : null, connectionModel: hasKey ? 'claude-haiku-4-5' : null,
          count: 0, limit: -1, remaining: -1, unlimited: true, grantedCredits: 0, bonusCredits: 0, adjustedCredits: 0,
          planCode: 'retail-local', planName: 'Retail Local', tenantId: 'FAKE', yearMonth: '2026-10', resetsAt: '2026-10-31T17:00:00Z',
          requestCount: 12, providerCalls: 25, inputTokens: 12000, outputTokens: 600, actualCostUsd: actualCost, unpricedProviderCalls: 1, creditStatus: 'NORMAL' },
        bmsAiUsageBreakdown: [{ feature: 'staff_assistant', requests: 12, providerCalls: 25, inputTokens: 12000, outputTokens: 600, actualCostUsd: 1.2345, unpricedProviderCalls: 1 }],
        bmsAiLimitNotifications: { unreadCount: 0, items: [] },
      } } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const ownLabel = lang === 'th' ? 'AI ใช้คีย์ของคุณ' : 'AI uses your key';
    const noKeyLabel = lang === 'th' ? 'ยังไม่ได้เชื่อมต่อ AI' : 'AI not configured';
    const checkReport = async label => {
      await page.getByText(label, { exact: true }).first().waitFor();
      await page.getByText('$1.2345', { exact: true }).waitFor();
      const text = await page.locator('body').innerText();
      assert.doesNotMatch(text, /point|credit|1,990|Business|Billing & Plan|AI ไม่จำกัด|Unlimited AI/i);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    };
    try {
      await page.goto(`${base}/admin/billing`, { waitUntil: 'domcontentloaded' });
      await checkReport(noKeyLabel);
      await page.screenshot({ path: `${output}/unconfigured-${lang}-${width}.png`, fullPage: true });
      await page.getByRole('link', { name: lang === 'th' ? 'ตั้งค่า AI' : 'AI settings', exact: true }).click();
      await page.getByLabel('API Key', { exact: true }).fill('FAKE-test-key');
      await page.getByRole('button', { name: lang === 'th' ? 'บันทึก AI Key' : 'Save AI key', exact: true }).click();
      await page.getByText(ownLabel, { exact: true }).first().waitFor();
      assert.equal(hasKey, true);
      await page.goto(`${base}/admin/billing`, { waitUntil: 'domcontentloaded' });
      await checkReport(ownLabel);
      await page.getByText('anthropic · claude-haiku-4-5', { exact: true }).waitFor();
      await page.screenshot({ path: `${output}/own-key-${lang}-${width}.png`, fullPage: true });
      await page.getByRole('link', { name: lang === 'th' ? 'ตั้งค่า AI' : 'AI settings', exact: true }).click();
      await page.getByRole('button', { name: lang === 'th' ? /ลบ$/ : /Delete$/ }).click();
      await page.getByText(noKeyLabel, { exact: true }).first().waitFor();
      assert.equal(hasKey, false);
      await page.goto(`${base}/admin/billing`, { waitUntil: 'domcontentloaded' });
      await checkReport(noKeyLabel);
      actualCost = 0.00000001;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText('$0.00000001', { exact: true }).waitFor();
      assert.equal(billingQueries, 0, 'Local never queries the paid cloud catalog');
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${lang}-${width}.png`, fullPage: true });
      console.log((await page.locator('body').innerText()).slice(-5000), errors);
      throw error;
    } finally { await context.close(); }
  }
  console.log('PASS Retail Local th/en desktop/mobile: unconfigured, saved/deleted key refresh, no cloud plan/point UI, metered report; mocked API only');
} finally { await browser.close(); }
