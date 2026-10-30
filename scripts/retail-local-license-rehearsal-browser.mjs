// Isolated labelled DB only. Real login, UI, HTTP, Go signatures and PostgreSQL; no API mocks.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localState, localClient, repo, output } from './testing/retail-local-commercial-local.mjs';
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const state = await localState();
const db = localClient(state);
await db.connect();
// Only reset the two synthetic identities in the dedicated labelled test Redis.
const redisInfo = spawnSync('docker', ['inspect', 'bms-retail-commercial-redis-test'], { encoding: 'utf8', windowsHide: true });
assert.equal(redisInfo.status, 0);
assert.equal(JSON.parse(redisInfo.stdout)[0].Config.Labels['bms.purpose'], 'retail-local-commercial-test');
const require = createRequire(path.join(repo, 'apps/web/package.json'));
const Redis = require('ioredis');
const redis = new Redis('redis://127.0.0.1:56390');
try {
  for (const kind of ['platform', 'staff']) {
    const hash = createHash('sha256').update(`retail-commercial-${kind}@example.invalid`).digest('hex').slice(0, 24);
    await redis.del(`ratelimit:auth:admin-login:identity:${hash}`);
  }
} finally { await redis.quit(); }
const url = 'http://localhost:3011';
const marker = `FAKE-rehearsal-${randomUUID()}`;
const runRoot = path.join(output, marker);
await mkdir(runRoot, { recursive: true });
const binary = path.join(runRoot, 'bms-runtime-agent.exe');
const build = spawnSync('go', ['build', '-o', binary, '.'], { cwd: path.join(repo, 'apps/retail-local-agent'), encoding: 'utf8', windowsHide: true });
assert.equal(build.status, 0, build.stderr);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const pass = name => { results.push(name); console.log(`PASS ${name}`); };
let licenseId;
let licenseCode;
const originalLanguage = (await db.query('SELECT language FROM users WHERE id=$1', [state.adminId])).rows[0].language;
const sessions = {};
async function context(kind, lang = 'en', width = 1280) {
  const c = await browser.newContext({ viewport: { width, height: 1000 }, ...(sessions[kind] ? { storageState: sessions[kind] } : {}) });
  c.setDefaultTimeout(15000);
  await c.addCookies([{ name: 'lang', value: lang, url }]);
  if (kind) {
    if (kind === 'platform') await db.query('UPDATE users SET language=$1 WHERE id=$2 AND fake_test=true', [lang, state.adminId]);
    if (sessions[kind]) return c;
    const r = await c.request.post(`${url}/api/graphql`, { data: {
      query: 'mutation Login($input: LoginInput!) { loginAdmin(input: $input) { ok } }',
      variables: { input: { email: `retail-commercial-${kind}@example.invalid`, password: state.userPassword } },
    } });
    assert.equal((await r.json()).data?.loginAdmin?.ok, true);
    sessions[kind] = await c.storageState();
  }
  return c;
}
async function post(c, route, data, expected = 200, token) {
  const response = await c.request.post(`${url}${route}`, { data,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
  assert.equal(response.status(), expected, `HTTP ${route}`);
  return response.json();
}
async function issuedCode(page) {
  const dialog = page.getByRole('dialog', { name: 'Save this activation code now', exact: true });
  await dialog.waitFor();
  const text = await dialog.innerText();
  const code = /bmsla_[A-Za-z0-9_-]+/.exec(text)?.[0];
  assert.ok(code, 'Code shown once in issue dialog');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  return code; // Secrets stay in memory; never log or screenshot this dialog.
}
async function record(host, eventType = 'INSTALLATION_REGISTERED') {
  const root = path.join(runRoot, host);
  const r = spawnSync(binary, ['license-record', '-root', root, '-event', eventType,
    '-license-id', licenseCode, '-target', 'windows-11-x64', '-release-version', '1.0.0-rehearsal'],
  { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, 'Go evidence recording succeeds');
  const lines = (await readFile(path.join(root, 'license-evidence/ledger.jsonl'), 'utf8')).trim().split('\n');
  return JSON.parse(lines.at(-1));
}
async function installations() {
  return (await db.query('SELECT installation_id,status FROM bms_retail_local_license_installations WHERE license_id=$1 ORDER BY installation_id', [licenseId])).rows;
}
try {
  const admin = await context('platform');
  const anonymous = await context();
  const staff = await context('staff');
  const page = await admin.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${url}/admin/retail-local-licenses`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Issue license$/ }).click();
  const issue = page.getByRole('dialog', { name: 'Issue a license', exact: true });
  await issue.getByLabel('Customer / reference', { exact: true }).fill(marker);
  await issue.getByRole('button', { name: 'OK', exact: true }).click();
  const firstCode = await issuedCode(page);
  const license = (await db.query('SELECT * FROM bms_retail_local_licenses WHERE customer_reference=$1', [marker])).rows[0];
  assert.ok(license);
  licenseId = license.id;
  licenseCode = license.license_code;
  assert.equal(license.license_type, 'TRIAL');
  assert.equal(license.commercial_status, 'TRIAL_ACTIVE');
  assert.equal(new Date(license.trial_expires_at) - new Date(license.trial_started_at), 30 * 86400000);
  const base = `/api/admin/retail-local/licenses/${licenseId}`;
  const transfer = { action: 'TRANSFER', installationId: randomUUID(), fromInstallationId: randomUUID(), confirmation: 'TRANSFER-LICENSE-INSTALLATION' };
  for (const c of [anonymous, staff]) {
    const status = c === anonymous ? 401 : 403;
    await post(c, '/api/admin/retail-local/licenses', { customerReference: marker }, status);
    for (const suffix of ['/activation', '/commercial', '/resolve']) await post(c, base + suffix, transfer, status);
    assert.equal((await c.request.get(url + base)).status(), status);
  }
  await post(admin, base + '/activation', {}, 400);
  await post(admin, base + '/resolve', { ...transfer, confirmation: '' }, 400);
  await post(admin, base + '/commercial', { action: 'CONVERT_TO_PAID', operationId: randomUUID(), reason: 'FAKE rehearsal' }, 400);
  pass('UI issues a 30-day Trial; real sessions enforce 401/403 and confirmation');

  const requestId = randomUUID();
  const activationBody = { activationCode: firstCode, requestId, currentLicenseCode: licenseCode };
  const activated = await post(anonymous, '/api/bms/retail-local/activate', activationBody);
  const replay = await post(anonymous, '/api/bms/retail-local/activate', activationBody);
  assert.ok(replay.ingestionToken === activated.ingestionToken, 'Activation retry returns the same credential');
  await post(anonymous, '/api/bms/retail-local/activate', { ...activationBody, requestId: randomUUID() }, 409);
  const oldHost = await record('source');
  await post(anonymous, '/api/bms/retail-local/license-evidence', oldHost, 202, activated.ingestionToken);
  const duplicate = await post(anonymous, '/api/bms/retail-local/license-evidence', oldHost, 200, activated.ingestionToken);
  assert.equal(duplicate.duplicate, true);
  await post(anonymous, '/api/bms/retail-local/license-evidence', { ...oldHost, signature: 'A'.repeat(86) }, 400, activated.ingestionToken);
  assert.equal((await installations())[0].status, 'ACTIVE');
  pass('Activation is one-use and retry-safe; real Go evidence accepted, duplicate deduplicated, bad signature denied');

  await post(admin, base + '/commercial', { action: 'MARK_PAYMENT_REVIEW', operationId: randomUUID(),
    reason: 'FAKE rehearsal: payment pending manual verification', confirmation: 'MARK-RETAIL-LOCAL-PAYMENT-REVIEW' });
  const reviewing = await post(anonymous, '/api/bms/retail-local/license-status',
    { installationId: oldHost.event.installationId }, 200, activated.ingestionToken);
  assert.equal(reviewing.commercialStatus, 'PAYMENT_REVIEW');
  await page.reload({ waitUntil: 'networkidle' });
  const row = page.getByRole('row').filter({ hasText: marker });
  await row.getByRole('button', { name: /Manage$/ }).click();
  const manage = page.getByRole('dialog');
  await manage.locator('.ant-select-selector').click();
  await page.getByTitle('Convert to paid', { exact: true }).click();
  const reason = 'FAKE rehearsal: simulated payment verified; no money received';
  await manage.getByLabel('Reason (recorded in audit)', { exact: true }).fill(reason);
  const convertedResponse = page.waitForResponse(r => r.url().endsWith(base + '/commercial') && r.request().method() === 'POST');
  await manage.getByRole('button', { name: 'OK', exact: true }).click();
  const converted = await convertedResponse;
  assert.equal(converted.status(), 200);
  const conversionBody = converted.request().postDataJSON();
  await manage.waitFor({ state: 'hidden' });
  assert.equal((await post(admin, base + '/commercial', conversionBody)).replayed, true);
  await post(admin, base + '/commercial', { ...conversionBody, reason: 'different reason' }, 409);
  const paid = (await db.query('SELECT * FROM bms_retail_local_licenses WHERE id=$1', [licenseId])).rows[0];
  assert.equal(paid.license_type, 'PAID');
  assert.equal(paid.commercial_status, 'PAID_ACTIVE');
  assert.equal(paid.license_code, licenseCode);
  assert.ok(paid.converted_at);
  assert.deepEqual(await installations(), [{ installation_id: oldHost.event.installationId, status: 'ACTIVE' }]);
  const events = (await db.query("SELECT actor_id,reason FROM bms_retail_local_license_commercial_events WHERE license_id=$1 AND action='CONVERT_TO_PAID'", [licenseId])).rows;
  assert.deepEqual(events, [{ actor_id: state.adminId, reason }]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM bms_retail_local_trial_followups WHERE license_id=$1 AND status='PENDING'", [licenseId])).rows[0].n, 0);
  pass('UI converts Trial to Paid without replacing license/installation; one actor/reason audit and cancelled follow-ups');

  await row.getByRole('button', { name: 'Activation', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue new code', exact: true }).click();
  const replacementCode = await issuedCode(page);
  assert.ok(replacementCode !== firstCode, 'Replacement has a new code');
  const replacement = await post(anonymous, '/api/bms/retail-local/activate', { activationCode: replacementCode, requestId: randomUUID(), currentLicenseCode: licenseCode });
  assert.ok(replacement.ingestionToken !== activated.ingestionToken, 'Replacement has a new token');
  const newHost = await record('destination', 'TRANSFER_REQUESTED');
  assert.notEqual(newHost.event.installationId, oldHost.event.installationId);
  assert.notEqual(newHost.devicePublicKey, oldHost.devicePublicKey);
  const received = await post(anonymous, '/api/bms/retail-local/license-evidence', newHost, 202, replacement.ingestionToken);
  assert.equal(received.reviewRequired, true);
  const resolveBody = { ...transfer, installationId: newHost.event.installationId, fromInstallationId: oldHost.event.installationId };
  await post(admin, base + '/resolve', { ...resolveBody, action: 'APPROVE', confirmation: 'APPROVE-LICENSE-INSTALLATION' }, 409);
  const beforeTransfer = await installations();
  await post(admin, base + '/resolve', { ...resolveBody, fromInstallationId: randomUUID() }, 409);
  assert.deepEqual(await installations(), beforeTransfer);
  pass('Replacement uses fresh identity/key/token; excess installation requires review; invalid source rolls back');

  for (const lang of ['en', 'th']) for (const width of [1280, 390]) {
    const c = await context('platform', lang, width);
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', error => errors.push(error.message));
    await p.goto(`${url}/admin/retail-local-licenses`, { waitUntil: 'networkidle' });
    await p.getByRole('row').filter({ hasText: marker }).getByRole('button', { name: lang === 'th' ? 'รายละเอียด' : 'Details', exact: true }).click();
    await p.getByRole('button', { name: lang === 'th' ? 'ย้ายมายังเครื่องนี้' : 'Transfer to this installation', exact: true }).click();
    const dialog = p.getByRole('dialog', { name: lang === 'th' ? 'ยืนยันย้ายเครื่อง' : 'Confirm installation transfer', exact: true });
    await dialog.locator('.ant-select-selector').click();
    await p.getByTitle(oldHost.event.installationId, { exact: true }).click();
    await dialog.getByText(lang === 'th' ? 'ยืนยันย้ายเครื่อง' : 'Confirm installation transfer', { exact: true }).click();
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await p.screenshot({ path: path.join(output, `license-transfer-${lang}-${width}.png`), animations: 'disabled' });
    if (lang === 'th' && width === 390) {
      const response = p.waitForResponse(r => r.url().endsWith(base + '/resolve') && r.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'ตกลง', exact: true }).click();
      assert.equal((await response).status(), 200);
      await dialog.waitFor({ state: 'hidden' });
      await p.getByText('TRANSFERRED', { exact: true }).waitFor();
      await p.screenshot({ path: path.join(output, 'license-transfer-complete.png'), animations: 'disabled' });
    } else await dialog.getByRole('button', { name: lang === 'th' ? 'ยกเลิก' : 'Cancel', exact: true }).click();
    assert.deepEqual(errors, []);
    await c.close();
  }
  const verifyContext = await context('platform', 'en');
  const verifyPage = await verifyContext.newPage();
  await verifyPage.goto(`${url}/admin/manual`, { waitUntil: 'networkidle' });
  assert.equal(await verifyPage.getByText(/For a replacement awaiting review/).count(), 1);
  await verifyPage.setViewportSize({ width: 390, height: 900 });
  assert.equal(await verifyPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await verifyContext.close();
  assert.deepEqual((await installations()).sort((a, b) => a.status.localeCompare(b.status)), [
    { installation_id: newHost.event.installationId, status: 'ACTIVE' },
    { installation_id: oldHost.event.installationId, status: 'TRANSFERRED' },
  ]);
  const review = (await db.query('SELECT status,resolution,resolved_by FROM bms_retail_local_license_reviews WHERE license_id=$1', [licenseId])).rows;
  assert.deepEqual(review, [{ status: 'RESOLVED', resolution: 'TRANSFER', resolved_by: state.adminId }]);
  pass('Transfer confirmation renders at Thai/English desktop/mobile; actual UI transfer resolves review with actor');

  for (const [host, token, expected] of [['source', activated.ingestionToken, 'TRANSFERRED'], ['destination', replacement.ingestionToken, 'ACTIVE']]) {
    const heartbeat = await record(host, 'RUNTIME_SEEN');
    await post(anonymous, '/api/bms/retail-local/license-evidence', heartbeat, 202, token);
    const status = await post(anonymous, '/api/bms/retail-local/license-status', { installationId: heartbeat.event.installationId }, 200, token);
    assert.equal(status.licenseType, 'PAID');
    assert.equal(status.commercialStatus, 'PAID_ACTIVE');
    assert.equal((await installations()).find(i => i.installation_id === heartbeat.event.installationId).status, expected);
    assert.doesNotMatch(JSON.stringify(status), /ingestionToken|customer_reference|token_hash/);
  }
  assert.deepEqual(pageErrors, []);
  pass('Post-transfer signed heartbeats preserve old TRANSFERRED/new ACTIVE and Paid status; no credentials in status');
} finally {
  // Find our marker even if the UI failed immediately after committing creation.
  const ids = (await db.query('SELECT id FROM bms_retail_local_licenses WHERE customer_reference=$1', [marker])).rows.map(r => r.id);
  for (const id of ids) {
    for (const table of ['bms_retail_local_license_reviews', 'bms_retail_local_license_events',
      'bms_retail_local_license_installations', 'bms_retail_local_trial_followups',
      'bms_retail_local_license_commercial_events', 'bms_retail_local_license_bootstrap_tokens',
      'bms_retail_local_license_tokens']) await db.query(`DELETE FROM ${table} WHERE license_id=$1`, [id]);
    await db.query('DELETE FROM bms_retail_local_licenses WHERE id=$1', [id]);
  }
  await db.query('UPDATE users SET language=$1 WHERE id=$2 AND fake_test=true', [originalLanguage, state.adminId]);
  await browser.close();
  await db.end();
  await writeFile(path.join(output, 'license-rehearsal-result.json'), JSON.stringify({ date: new Date().toISOString(), passedGroups: results, cleanedLicenses: ids.length, complete: results.length === 6 }, null, 2));
  console.log(`Cleaned ${ids.length} synthetic license(s); ${results.length}/6 groups passed. No deployment.`);
}
