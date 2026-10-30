// Run against a development/staging page. API writes are mocked; this is UI coverage only.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.BMS_SMOKE_URL || 'http://localhost:3007/retail-local';
const directory = '.test-output/retail-local-commercial-browser';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const lang of ['th', 'en']) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'lang', value: lang, url }]);
    const page = await context.newPage();
    let submissions = 0;
    let status = 201;
    await page.route('**/api/public/retail-local/lead', async route => {
      const body = route.request().postDataJSON();
      assert.equal(body.consent, true);
      assert.equal(body.locale, lang);
      submissions++;
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: status === 201 }) });
    });
    const localizedUrl = new URL(url);
    localizedUrl.pathname = `/${lang}${localizedUrl.pathname.replace(/^\/(th|en)(?=\/)/, '')}`;
    await page.goto(localizedUrl.href, { waitUntil: 'networkidle' });
    await page.locator('#pricing').waitFor();
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    const button = page.getByRole('button', { name: lang === 'th' ? 'ส่งข้อมูลติดต่อ' : 'Submit contact details', exact: true });
    await button.click();
    assert.equal(submissions, 0);
    await page.getByLabel('LINE ID', { exact: true }).fill('smoke-test');
    await page.getByRole('checkbox').check();
    await button.click();
    await page.getByText(lang === 'th' ? 'บันทึกข้อมูลแล้ว' : 'Details saved', { exact: true }).waitFor();
    assert.equal(submissions, 1);
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    status = 503;
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByLabel('LINE ID', { exact: true }).fill('smoke-test');
    await page.getByRole('checkbox').check();
    await button.click();
    await page.getByText(lang === 'th' ? 'ส่งไม่สำเร็จ ตรวจเบอร์/LINE และลองใหม่ภายหลัง คุณยังดาวน์โหลดได้' : 'Could not submit. Check phone/LINE and retry later. Downloads remain available.', { exact: true }).waitFor();
    assert.equal(submissions, 2);
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    assert.ok(dimensions.content <= dimensions.viewport + 1, JSON.stringify(dimensions));
    await page.screenshot({ path: `${directory}/${lang}-${width}.png`, fullPage: true });
    console.log(`PASS ${lang} ${width}: no overflow, consent, success, failure, reset`);
    await context.close();
  }
} finally { await browser.close(); }
