// Real HTTP, login, PostgreSQL and Redis. No mocked APIs. Only the labelled local fixture is allowed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { localState, localClient, repo, output } from './testing/retail-local-commercial-local.mjs';
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(path.join(repo, 'apps/web/package.json'));
const Redis = require('ioredis');
const state = await localState();
const db = localClient(state);
await db.connect();
const redis = new Redis('redis://127.0.0.1:56390');
const url = 'http://localhost:3011';
const runId = randomUUID();
const markers = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let checks = 0;
const pass = message => { checks++; console.log(`PASS ${message}`); };
async function login(context, kind) {
  const response = await context.request.post(`${url}/api/graphql`, {
    data: { query: 'mutation Login($input: LoginInput!) { loginAdmin(input: $input) { ok } }',
      variables: { input: { email: `retail-commercial-${kind}@example.invalid`, password: state.userPassword } } },
  });
  const result = await response.json();
  assert.equal(result.data?.loginAdmin?.ok, true, JSON.stringify(result.errors?.map(e => e.message)));
  const session = await context.request.get(`${url}/api/auth/me`);
  assert.equal((await session.json()).admin?.id, kind === 'platform' ? state.adminId : state.staffId);
}
async function clearLeadWindow() {
  const keys = await redis.keys('ratelimit:retail-local-lead:*');
  if (keys.length) await redis.del(...keys); // dedicated labelled test Redis, never shared dev/prod
}
try {
  const anonymous = await browser.newContext();
  anonymous.setDefaultTimeout(15000);
  assert.equal((await anonymous.request.get(`${url}/api/admin/retail-local/leads`)).status(), 401);
  const staff = await browser.newContext();
  staff.setDefaultTimeout(15000);
  await login(staff, 'staff');
  assert.equal((await staff.request.get(`${url}/api/admin/retail-local/leads`)).status(), 403);
  const staffPage = await staff.newPage();
  await staffPage.goto(`${url}/admin/retail-local-licenses`, { waitUntil: 'networkidle' });
  assert.ok(!staffPage.url().endsWith('/admin/retail-local-licenses'));
  pass('real sessions: anonymous 401; shop Administrator 403; platform page denied');

  for (const lang of ['th', 'en']) for (const width of [1280, 390]) {
    await clearLeadWindow();
    const marker = `FAKE-commercial-${runId}-${lang}-${width}`;
    markers.push(marker);
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Bangkok' });
    context.setDefaultTimeout(15000);
    const page = await context.newPage();
    await page.goto(`${url}/${lang}/retail-local`, { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    await page.getByLabel(lang === 'th' ? 'ชื่อร้าน' : 'Shop name', { exact: true }).fill(marker);
    await page.getByLabel('LINE ID', { exact: true }).fill('fake-contact');
    const submit = page.getByRole('button', { name: lang === 'th' ? 'ส่งข้อมูลติดต่อ' : 'Submit contact details', exact: true });
    await submit.click();
    assert.equal((await db.query('SELECT id FROM bms_retail_local_leads WHERE shop_name=$1', [marker])).rowCount, 0);
    await page.getByRole('checkbox').check();
    const submitted = page.waitForResponse(r => r.url().endsWith('/api/public/retail-local/lead') && r.request().method() === 'POST');
    await submit.click();
    const response = await submitted;
    assert.equal(response.status(), 201);
    // The app uses only the HTTP status; Chrome can leave the unconsumed Fetch body
    // pending in CDP. Verify the JSON envelope below with the real API client.
    assert.match(response.headers()['content-type'], /application\/json/);
    console.log(`Submitted ${lang} ${width}; checking saved message`);
    await page.getByText(lang === 'th' ? 'บันทึกข้อมูลแล้ว' : 'Details saved', { exact: true }).waitFor();
    const lead = (await db.query('SELECT * FROM bms_retail_local_leads WHERE shop_name=$1', [marker])).rows[0];
    assert.ok(lead?.consent_at);
    assert.equal(lead.consent_text_version, 'retail-local-lead-v1');
    assert.equal(lead.locale, lang);
    assert.equal(lead.status, 'NEW');
    await page.locator('#pricing').screenshot({ path: path.join(output, `public-${lang}-${width}.png`) });
    await context.close();

    await db.query('UPDATE users SET language=$1 WHERE id=$2 AND fake_test=true', [lang, state.adminId]);
    const admin = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Bangkok' });
    admin.setDefaultTimeout(15000);
    await admin.addCookies([{ name: 'lang', value: lang, url }]);
    await login(admin, 'platform');
    const screen = await admin.newPage();
    let browserGraphqlRequests = 0;
    const wrongGraphqlPaths = [];
    screen.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/graphql') browserGraphqlRequests++;
      if (pathname === '/graphql') wrongGraphqlPaths.push(pathname);
    });
    await screen.goto(`${url}/admin/retail-local-licenses`, { waitUntil: 'networkidle' });
    await screen.getByRole('tab', { name: lang === 'th' ? 'Lead' : 'Leads', exact: true }).click();
    const row = screen.getByRole('row').filter({ hasText: marker });
    await row.getByRole('button', { name: lang === 'th' ? 'แก้ไข' : 'Edit', exact: true }).click();
    const dialog = screen.getByRole('dialog');
    await dialog.locator('.ant-select-selector').click();
    await screen.getByTitle('CONTACTED', { exact: true }).click();
    await dialog.getByLabel(lang === 'th' ? 'โน้ตภายใน' : 'Internal note', { exact: true }).fill('FAKE follow-up checked');
    await dialog.locator('input[type="datetime-local"]').fill('2026-11-01T10:30');
    const saved = screen.waitForResponse(r => r.url().endsWith(`/api/admin/retail-local/leads/${lead.id}`) && r.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: lang === 'th' ? 'ตกลง' : 'OK', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await dialog.waitFor({ state: 'hidden' });
    await screen.reload({ waitUntil: 'networkidle' });
    await screen.getByRole('tab', { name: lang === 'th' ? 'Lead' : 'Leads', exact: true }).click();
    await screen.getByRole('row').filter({ hasText: marker }).getByText('CONTACTED', { exact: true }).waitFor();
    const changed = (await db.query('SELECT status,note,follow_up_at FROM bms_retail_local_leads WHERE id=$1', [lead.id])).rows[0];
    assert.equal(changed.status, 'CONTACTED');
    assert.equal(changed.note, 'FAKE follow-up checked');
    assert.equal(changed.follow_up_at.toISOString(), '2026-11-01T03:30:00.000Z');
    const audit = (await db.query('SELECT * FROM bms_retail_local_lead_events WHERE lead_id=$1', [lead.id])).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].actor_id, state.adminId);
    assert.equal(audit[0].previous_status, 'NEW'); assert.equal(audit[0].next_status, 'CONTACTED');
    const revisions = (await db.query('SELECT snapshot,revision_id FROM bms_retail_local_leads_revisions WHERE lead_id=$1', [lead.id])).rows;
    assert.equal(revisions.length, 1); assert.equal(revisions[0].snapshot.status, 'NEW'); assert.ok(revisions[0].revision_id);
    assert.equal((await staff.request.patch(`${url}/api/admin/retail-local/leads/${lead.id}`, { headers: { origin: url }, data: { status: 'PAID' } })).status(), 403);
    const dimensions = await screen.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.content <= dimensions.viewport + 1, JSON.stringify(dimensions));
    assert.ok(browserGraphqlRequests > 0, 'Admin chrome must use the real GraphQL endpoint');
    assert.deepEqual(wrongGraphqlPaths, []);
    const chromeCheck = await admin.request.post(`${url}/api/graphql`, { headers: { 'x-scope': 'admin' }, data: { query: 'query { myBmsPermissions bmsAiUsage { billingMode creditStatus } }' } });
    const chromeData = await chromeCheck.json();
    assert.equal(chromeData.errors, undefined, JSON.stringify(chromeData.errors?.map(e => e.message)));
    assert.ok(chromeData.data?.myBmsPermissions?.length > 0);
    await screen.screenshot({ path: path.join(output, `admin-${lang}-${width}.png`), fullPage: true, animations: 'disabled' });
    pass(`${lang} ${width}: real lead insert, consent, admin edit/reload, Bangkok follow-up, audit/revision, denied staff write, no overflow`);
    await admin.close();
  }

  await clearLeadWindow();
  const payload = { consent: true, lineId: 'fake-rate-test', locale: 'th', platform: 'windows' };
  const invalid = await anonymous.request.post(`${url}/api/public/retail-local/lead`, { data: { ...payload, consent: false } });
  assert.equal(invalid.status(), 400);
  await clearLeadWindow();
  for (let n = 0; n < 6; n++) {
    const marker = `FAKE-commercial-${runId}-rate-${n}`; markers.push(marker);
    const response = await anonymous.request.post(`${url}/api/public/retail-local/lead`, { data: { ...payload, shopName: marker } });
    assert.equal(response.status(), n < 5 ? 201 : 429);
    if (n < 5) assert.deepEqual(await response.json(), { ok: true });
    if (n === 5) assert.ok(Number(response.headers()['retry-after']) > 0);
  }
  pass('real API/Redis: consent false rejected; sixth submission rate-limited');
  await staff.close(); await anonymous.close();
  console.log(`Integration checks passed: ${checks}`);
} catch (error) {
  let index = 0;
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: path.join(output, `failure-${index++}.png`), timeout: 3000 }).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
  await clearLeadWindow();
  await redis.quit();
  try {
    await db.query('BEGIN');
    const ids = (await db.query('SELECT id FROM bms_retail_local_leads WHERE shop_name = ANY($1::text[])', [markers])).rows.map(row => row.id);
    for (const table of ['bms_retail_local_lead_events', 'bms_retail_local_leads_revisions']) {
      await db.query(`DELETE FROM ${table} WHERE lead_id = ANY($1::uuid[])`, [ids]);
    }
    await db.query('DELETE FROM bms_retail_local_leads WHERE id = ANY($1::uuid[])', [ids]);
    await db.query('COMMIT');
    console.log(`Cleaned ${ids.length} synthetic leads and their test history from the isolated database.`);
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { await db.end(); }
}
