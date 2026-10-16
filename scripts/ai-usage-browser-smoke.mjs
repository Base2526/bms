import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BMS_SMOKE_URL || 'http://localhost:3007';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'local mock-only smoke test');
const output = '.test-output/ai-usage-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const lang of ['th', 'en']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: 'ADMIN_COOKIE', value: 'FAKE-browser-fixture', url: base }, { name: 'lang', value: lang, url: base }]);
    let count = 10, reads = 0, unlimited = false, warning = 0, creditBlocked = false, noticeRead = false;
    let platformAdmin = false, grantMutations = 0, finiteBusiness = false, legacyCapacity = true;
    const errors = [];
    const plan = { code: 'free', name: 'FAKE Free', price_monthly: 0, max_products: 100, max_channels: 1, max_branches:1, max_devices:1, max_orders_month: -1, max_users: 2, ai_credits_monthly: 100, ai_credits_next_monthly: null, ai_credits_change_at: null, feature_keys: [] };
    await context.route(/\/(?:api\/|graphql)/, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { isAuthenticated: true, admin: { id: 1, role: 'Administrator', email: 'fake@example.test', name: 'FAKE admin', language: lang } } });
      if (!['/api/graphql', '/graphql'].includes(path)) return route.fulfill({ json: {} });
      const { query: q } = route.request().postDataJSON();
      if (q.includes('mutation') && /bmsChangePlan\(|bmsAdjustAiCredits\(/.test(q)) {
        grantMutations++;
        return route.fulfill({ json: { data: { bmsChangePlan: true, bmsAdjustAiCredits: true } } });
      }
      if (q.includes('bmsReadAiLimitNotification(')) {
        noticeRead = true;
        return route.fulfill({ json: { data: { bmsReadAiLimitNotification: true } } });
      }
      if (q.includes('bmsWorkAssistant(')) {
        count++;
        return route.fulfill({ json: { data: { bmsWorkAssistant: { reply: 'FAKE verified answer', proposals: [], trace: [] } } } });
      }
      if (q.includes('bmsAiUsage')) reads++;
      const budget = { sharedBudgetLimitUsd: -1, sharedBudgetSpentUsd: 150.1234, sharedBudgetReservedUsd: 0, sharedBudgetRemainingUsd: -1, sharedBudgetBlocked: false, sharedBudgetUnaccountedCalls: 1 };
      const businessPlan = { ...plan, code: 'business', name: 'FAKE Business', price_monthly: 1990, max_products: -1, max_users: 20, max_branches:5,max_devices:10,max_channels:-1,feature_keys: ['REPORT_SCHEDULE','RETENTION_ENGINE'],
        ai_credits_monthly: finiteBusiness ? 5000 : -1, ai_credits_next_monthly: finiteBusiness ? null : 5000,
        ai_credits_change_at: finiteBusiness ? null : '2026-10-31T17:00:00.000Z' };
      const plans = [plan, { ...plan, code: 'pro', name: 'FAKE Pro', price_monthly: 599, max_products: -1, max_users: 5, max_devices:3,max_channels:3,ai_credits_monthly: 1000, feature_keys: ['REPORT_SCHEDULE'] }, businessPlan];
      const limit = finiteBusiness ? 5000 : 100;
      const data = {
        bmsEntitlements: { capacities:['branches','devices','channels'].map(resource=>({resource,used:2,limit:legacyCapacity?-1:1,source:legacyCapacity?'LEGACY':'PLAN',canAdd:legacyCapacity})) },
        bmsTenants:[],
        bmsPackageMetrics:{available:true,from:'2026-09-16',to:'2026-10-16',untrackedTenants:1,
          cohorts:[{kind:'SIGNUP',shops:10,converted:2,conversionRate:0.2},{kind:'BASELINE',shops:5,converted:1,conversionRate:0.2}],
          costs:[{tenantId:'FAKE-SHOP',source:'shared',providerCalls:4,unpricedProviderCalls:1,knownCostUsd:0.125},
            {tenantId:'FAKE-SHOP',source:'byok',providerCalls:1,unpricedProviderCalls:1,knownCostUsd:null}]},
        bmsFeatureAccess: [{ feature: 'REPORT_SCHEDULE', minimumPlan: 'pro', allowed: true, source: 'LEGACY' }, { feature: 'RETENTION_ENGINE', minimumPlan: 'business', allowed: true, source: 'LEGACY' }],
        bmsAiLimitNotifications: { unreadCount: warning || creditBlocked ? noticeRead ? 0 : 1 : 0,
          items: warning || creditBlocked ? [{ id: '11111111-1111-4111-8111-111111111111', dimension: 'CREDITS', level: creditBlocked ? 'PAUSED' : `WARNING_${warning}`, yearMonth: '2026-10', isRead: noticeRead, createdAt: '2026-10-09T00:00:00Z' }] : [] },
        myBmsPermissions: ['assistant.use', 'report.view', 'billing.view'], bmsIsPlatformAdmin: platformAdmin,
        bmsStoreProfile: { businessArchetype: 'retail' }, bmsKitchenBoardEnabled: false, bmsWastageEnabled: false, bmsPackToolsConfigured: false,
        bmsActingTenant: null, bmsChannelHealthCount: 0, bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0, bmsRestockReadyCount: 0,
        bmsMe: { id: '1', email: 'fake@example.test', tenant: { id: 'FAKE', slug: 'fake' } },
        bmsAiConfig: { has_key: false, model: 'claude-haiku-4-5' },
        bmsAiUsage: { __typename: 'BmsAiUsage', billingMode: 'PLAN_POINTS', count: unlimited ? 0 : count, limit: unlimited ? -1 : limit, remaining: unlimited ? -1 : limit-count, unlimited,
          tenantId: 'FAKE', yearMonth: '2026-10', resetsAt: '2026-10-31T17:00:00Z', creditStatus: creditBlocked ? 'PAUSED_CREDITS' : warning ? `WARNING_${warning}` : 'NORMAL',
          sharedBudgetStatus: 'NORMAL', sharedBudgetRequiredUsd: 0,
          planCode: unlimited || finiteBusiness ? 'business' : 'free', planName: unlimited || finiteBusiness ? 'Business' : 'Free', requestCount: count, sharedRequests: count, byokRequests: 0,
          blockedRequests: 0, grantedCredits: unlimited ? 0 : limit, bonusCredits: 0, adjustedCredits: 0, billableCredits: unlimited ? 0 : count,
          providerCalls: count*2, actualCostUsd: budget.sharedBudgetSpentUsd, unpricedProviderCalls: 1, inputTokens: 12000, outputTokens: 600, ...budget },
        bmsBilling: { plan: unlimited || finiteBusiness ? businessPlan : plan,
          usage: { products: 1, channels: 1, orders_month: 1, users: 1 }, plans },
        bmsAiCreditLedger: [], bmsAiUsageBreakdown: [],
        bmsPublicPlans: plans,
      };
      await route.fulfill({ json: { data } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(`${base}/admin/assistant`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      if (width === 1440) await page.getByText(lang === 'th' ? 'เหลือ 90 / 100 point' : '90 / 100 points left', { exact: true }).waitFor();
      const before = reads;
      await page.getByRole('textbox').last().fill('FAKE test usage');
      await page.getByRole('textbox').last().press('Enter');
      await page.getByText('FAKE verified answer', { exact: true }).waitFor();
      if (width === 1440) await page.getByText(lang === 'th' ? 'เหลือ 89 / 100 point' : '89 / 100 points left', { exact: true }).waitFor();
      assert.ok(reads > before, 'the real Apollo operation refreshes active quota');
      await page.screenshot({ path: `${output}/assistant-${lang}-${width}.png`, fullPage: true });
      const refreshStatus = () => page.getByRole('button', { name: lang === 'th' ? 'รีเฟรชสถานะ AI' : 'Refresh AI status', exact: true }).click();
      warning = 80; count = 80;
      await refreshStatus();
      await page.getByText(lang === 'th' ? 'AI point: ใช้ถึง 80%' : 'AI points: 80% used', { exact: true }).waitFor();
      warning = 90; count = 90;
      await refreshStatus();
      await page.getByText(lang === 'th' ? 'AI point: ใช้ถึง 90%' : 'AI points: 90% used', { exact: true }).waitFor();
      await page.getByRole('button', { name: lang === 'th' ? 'แจ้งเตือน AI' : 'AI notifications', exact: true }).click();
      await page.getByRole('button', { name: lang === 'th' ? 'อ่านแล้ว' : 'Mark as read', exact: true }).click();
      await page.getByRole('button', { name: lang === 'th' ? 'อ่านแล้ว' : 'Mark as read', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(noticeRead, true);
      await page.screenshot({ path: `${output}/notices-${lang}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: lang === 'th' ? 'แจ้งเตือน AI' : 'AI notifications', exact: true }).click();
      warning = 0; creditBlocked = true; count = 100;
      await refreshStatus();
      await page.getByText(lang === 'th' ? 'AI point: point หมด' : 'AI points: Points exhausted', { exact: true }).waitFor();
      creditBlocked = false;
      unlimited = true;
      await page.goto(`${base}/admin/billing`, { waitUntil: 'domcontentloaded' });
      if (width === 1440) await page.getByText(lang === 'th' ? 'AI ไม่จำกัด' : 'Unlimited AI', { exact: true }).waitFor();
      await page.getByText('150.1234', { exact: false }).first().waitFor();
      await page.getByText(lang === 'th' ? 'วันที่ 1 เวลา 00:00 น. (เวลาไทย)' : '1st of each month, 00:00 Thailand time', { exact: true }).first().waitFor();
      await page.getByText('1,000 AI points', { exact: true }).waitFor();
      assert.equal(await page.getByTestId('plan-ai-change').count(), 2);
      assert.match(await page.getByTestId('plan-ai-change').first().innerText(), /5,000.*00:00/);
      assert.equal(await page.getByText(lang === 'th' ? 'จัดการ AI point' : 'Manage AI points', { exact: true }).count(), 0);
      const contactButtons = page.getByRole('button', { name: lang === 'th' ? 'ติดต่อผู้ดูแลแพลตฟอร์ม' : 'Contact platform administrator', exact: true });
      assert.equal(await contactButtons.count(), 2);
      for (const button of await contactButtons.all()) assert.equal(await button.isDisabled(), true);
      assert.equal(grantMutations, 0);
      assert.doesNotMatch(await page.locator('body').innerText(), /-1 AI points|0 \/ -1|total -1|ทั้งหมด -1|\$100|Budget \$/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'no page overflow');
      await page.screenshot({ path: `${output}/billing-${lang}-${width}.png`, fullPage: true });
      platformAdmin = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText(lang === 'th' ? 'จัดการ AI point' : 'Manage AI points', { exact: true }).waitFor();
      await page.getByRole('button', { name: lang === 'th' ? 'เลือกแพ็กเกจนี้' : 'Choose this plan', exact: true }).first().click();
      const confirmation = page.getByRole('dialog');
      await confirmation.waitFor();
      assert.match(await confirmation.innerText(), /FAKE Free.*0 THB\/month.*100 point\/month/s);
      assert.equal(grantMutations, 0, 'opening confirmation does not grant a plan');
      await confirmation.getByRole('button', { name: /^(OK|ตกลง)$/ }).click();
      await confirmation.waitFor({ state: 'hidden' });
      assert.equal(grantMutations, 1);
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await page.getByText(lang === 'th' ? '100 point/เดือน' : '100 points/month', { exact: true }).waitFor();
      await page.getByText(lang === 'th' ? '1,000 point/เดือน' : '1,000 points/month', { exact: true }).waitFor();
      await page.getByText(lang === 'th' ? 'AI ไม่จำกัด' : 'Unlimited AI', { exact: true }).waitFor();
      assert.equal(await page.getByTestId('plan-ai-change').count(), 1);
      await page.screenshot({ path: `${output}/landing-pending-${lang}-${width}.png`, fullPage: true });
      unlimited = false; finiteBusiness = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText(lang === 'th' ? '5,000 point/เดือน' : '5,000 points/month', { exact: true }).waitFor();
      assert.equal(await page.getByTestId('plan-ai-change').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      await page.screenshot({ path: `${output}/landing-finite-${lang}-${width}.png`, fullPage: true });
      await page.goto(`${base}/admin/billing`, { waitUntil: 'domcontentloaded' });
      await page.getByText('5,000 AI points', { exact: true }).waitFor();
      assert.equal(await page.getByTestId('plan-ai-change').count(), 0);
      await page.screenshot({ path: `${output}/billing-finite-${lang}-${width}.png`, fullPage: true });
      await page.getByText(lang==='th'?'โควตารายการที่ลงทะเบียน':'Registered capacity',{exact:true}).waitFor();
      assert.match(await page.locator('body').innerText(),/LEGACY/);
      legacyCapacity=false;finiteBusiness=false;
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByText(/: 2 \/ 1/).first().waitFor();
      assert.equal(await page.getByText(/: 2 \/ 1/).count(),3);
      await page.screenshot({path:`${output}/capacity-plan-${lang}-${width}.png`,fullPage:true});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      await page.goto(`${base}/admin/tenants`,{waitUntil:'domcontentloaded'});
      await page.getByText('$0.125000',{exact:true}).waitFor();
      await page.getByText(lang==='th'?'ไม่ทราบ':'Unknown',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'metrics has no page overflow');
      await page.screenshot({path:`${output}/package-metrics-${lang}-${width}.png`,fullPage:true});
      await page.goto(`${base}/admin/manual`, { waitUntil: 'domcontentloaded' });
      await page.getByText(lang === 'th' ? /แพ็กเกจ Cloud: Free 100 SKU/ : /Cloud packages: Free 100 SKUs/).waitFor();
      assert.deepEqual(errors, []);
    } catch (e) {
      await page.screenshot({ path: `${output}/failure-${lang}-${width}.png`, fullPage: true });
      console.log((await page.locator('body').innerText()).slice(-4500), errors);
      throw e;
    } finally { await context.close(); }
  }
  console.log('PASS assistant/Billing/landing/manual: th/en desktop/mobile, pending and finite Business, Bangkok schedule, point warnings, quota refresh and platform-admin confirmation; mock API only');
} finally { await browser.close(); }
