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
    let count = 10, reads = 0, unlimited = false, blocked = false, warning = 0, creditBlocked = false, noticeRead = false;
    const errors = [];
    const plan = { code: 'free', name: 'FAKE Free', price_monthly: 0, max_products: 100, max_channels: 2, max_orders_month: 100, max_users: 3, ai_credits_monthly: 1000 };
    await context.route(/\/(?:api\/|graphql)/, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me') return route.fulfill({ json: { isAuthenticated: true, admin: { id: 1, role: 'Administrator', email: 'fake@example.test', name: 'FAKE admin', language: lang } } });
      if (!['/api/graphql', '/graphql'].includes(path)) return route.fulfill({ json: {} });
      const { query: q } = route.request().postDataJSON();
      if (q.includes('bmsReadAiLimitNotification(')) {
        noticeRead = true;
        return route.fulfill({ json: { data: { bmsReadAiLimitNotification: true } } });
      }
      if (q.includes('bmsWorkAssistant(')) {
        count++;
        return route.fulfill({ json: { data: { bmsWorkAssistant: { reply: 'FAKE verified answer', proposals: [], trace: [] } } } });
      }
      if (q.includes('bmsAiUsage')) reads++;
      const budget = { sharedBudgetLimitUsd: 100, sharedBudgetSpentUsd: blocked ? 99 : 12.3456, sharedBudgetReservedUsd: blocked ? 1 : 2, sharedBudgetRemainingUsd: blocked ? 0 : 85.6544, sharedBudgetBlocked: blocked, sharedBudgetUnaccountedCalls: 0 };
      const data = {
        bmsAiLimitNotifications: { unreadCount: warning || blocked ? noticeRead ? 0 : 1 : 0,
          items: warning || blocked ? [{ id: '11111111-1111-4111-8111-111111111111', dimension: 'BUDGET', level: blocked ? 'PAUSED' : `WARNING_${warning}`, yearMonth: '2026-10', isRead: noticeRead, createdAt: '2026-10-09T00:00:00Z' }] : [] },
        myBmsPermissions: ['assistant.use', 'report.view', 'billing.view'], bmsIsPlatformAdmin: false,
        bmsStoreProfile: { businessArchetype: 'retail' }, bmsKitchenBoardEnabled: false, bmsWastageEnabled: false, bmsPackToolsConfigured: false,
        bmsActingTenant: null, bmsChannelHealthCount: 0, bmsInboxUnreadCount: 0, bmsMyMentionsUnreadCount: 0, bmsRestockReadyCount: 0,
        bmsMe: { id: '1', email: 'fake@example.test', tenant: { id: 'FAKE', slug: 'fake' } },
        bmsAiConfig: { has_key: false, model: 'claude-haiku-4-5' },
        bmsAiUsage: { __typename: 'BmsAiUsage', count: unlimited ? 0 : count, limit: unlimited ? -1 : 1000, remaining: unlimited ? -1 : 1000-count, unlimited,
          tenantId: 'FAKE', yearMonth: '2026-10', resetsAt: '2026-11-01T00:00:00Z', creditStatus: creditBlocked ? 'PAUSED_CREDITS' : 'NORMAL',
          sharedBudgetStatus: blocked ? 'PAUSED_BUDGET' : warning ? `WARNING_${warning}` : 'NORMAL', sharedBudgetRequiredUsd: blocked ? 6.25 : 0,
          planCode: unlimited ? 'business' : 'free', planName: unlimited ? 'Business' : 'Free', requestCount: count, sharedRequests: count, byokRequests: 0,
          blockedRequests: 0, grantedCredits: unlimited ? 0 : 1000, bonusCredits: 0, adjustedCredits: 0, billableCredits: unlimited ? 0 : count,
          providerCalls: count*2, actualCostUsd: budget.sharedBudgetSpentUsd, unpricedProviderCalls: 1, inputTokens: 12000, outputTokens: 600, ...budget },
        bmsBilling: { plan: unlimited ? { ...plan, code: 'business', name: 'FAKE Business', ai_credits_monthly: -1 } : plan,
          usage: { products: 1, channels: 1, orders_month: 1, users: 1 }, plans: [plan] },
        bmsAiCreditLedger: [], bmsAiUsageBreakdown: [],
      };
      await route.fulfill({ json: { data } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(`${base}/admin/assistant`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      if (width === 1440) await page.getByText('10/1000 ' + (lang === 'th' ? 'เครดิต' : 'credits'), { exact: true }).waitFor();
      const before = reads;
      await page.getByRole('textbox').last().fill('FAKE test usage');
      await page.getByRole('textbox').last().press('Enter');
      await page.getByText('FAKE verified answer', { exact: true }).waitFor();
      if (width === 1440) await page.getByText('11/1000 ' + (lang === 'th' ? 'เครดิต' : 'credits'), { exact: true }).waitFor();
      assert.ok(reads > before, 'the real Apollo operation refreshes active quota');
      await page.screenshot({ path: `${output}/assistant-${lang}-${width}.png`, fullPage: true });
      const refreshStatus = () => page.getByRole('button', { name: lang === 'th' ? 'รีเฟรชสถานะ AI' : 'Refresh AI status', exact: true }).click();
      warning = 80;
      await refreshStatus();
      await page.getByText(lang === 'th' ? 'วงเงินต้นทุน AI ส่วนกลาง: ใช้ถึง 80%' : 'Shared AI cost budget: 80% used', { exact: true }).waitFor();
      warning = 90;
      await refreshStatus();
      await page.getByText(lang === 'th' ? 'วงเงินต้นทุน AI ส่วนกลาง: ใช้ถึง 90%' : 'Shared AI cost budget: 90% used', { exact: true }).waitFor();
      await page.getByRole('button', { name: lang === 'th' ? 'แจ้งเตือน AI' : 'AI notifications', exact: true }).click();
      await page.getByRole('button', { name: lang === 'th' ? 'อ่านแล้ว' : 'Mark as read', exact: true }).click();
      await page.getByRole('button', { name: lang === 'th' ? 'อ่านแล้ว' : 'Mark as read', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(noticeRead, true);
      await page.screenshot({ path: `${output}/notices-${lang}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: lang === 'th' ? 'แจ้งเตือน AI' : 'AI notifications', exact: true }).click();
      warning = 0; creditBlocked = true;
      await refreshStatus();
      await page.getByText(lang === 'th' ? 'เครดิต AI ส่วนกลาง: เครดิตหมด' : 'Shared AI credits: Credits exhausted', { exact: true }).waitFor();
      creditBlocked = false;
      unlimited = true;
      await page.goto(`${base}/admin/billing`, { waitUntil: 'domcontentloaded' });
      await page.getByText(/\$100.*Business|Business.*\$100/).first().waitFor();
      await page.getByText(/85.6544/).first().waitFor();
      assert.doesNotMatch(await page.locator('body').innerText(), /-1 AI Credits|0 \/ -1|total -1|ทั้งหมด -1/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'no page overflow');
      await page.screenshot({ path: `${output}/billing-${lang}-${width}.png`, fullPage: true });
      if (width === 390) {
        await page.getByText(/85.6544/).first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/budget-mobile-${lang}.png` });
      }
      blocked = true;
      await page.getByRole('button', { name: /Refresh/, exact: false }).last().click();
      await refreshStatus();
      await page.getByText(/99.0000/).first().waitFor();
      if (width === 1440) await page.locator('a.bms-sider-quiet[href="/admin/billing"]').waitFor();
      await page.getByText(lang === 'th' ? 'วงเงินต้นทุน AI ส่วนกลาง: วงเงินไม่พอสำหรับคำขอที่ถูกปฏิเสธ' : 'Shared AI cost budget: Insufficient budget for the refused request', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'blocked state fits mobile');
      await page.screenshot({ path: `${output}/blocked-${lang}-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
    } catch (e) {
      await page.screenshot({ path: `${output}/failure-${lang}-${width}.png`, fullPage: true });
      console.log((await page.locator('body').innerText()).slice(-4500), errors);
      throw e;
    } finally { await context.close(); }
  }
  console.log('PASS actual assistant/sidebar/Billing: th/en desktop/mobile, refresh, Business cap, 80/90 warnings, credit/budget pause, owner bell and read acknowledgement; mock API only');
} finally { await browser.close(); }
