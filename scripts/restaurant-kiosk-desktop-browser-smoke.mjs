// Local-only visual fixture for bundled Desktop Kiosk staff screens. No backend call.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE
  || new URL('../apps/web/node_modules/playwright/index.mjs', import.meta.url).href);
const file = pathToFileURL(resolve('apps/kiosk-desktop/renderer/shell.html')).href;
const output = '.test-output/kiosk-desktop-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const { name, width, height } of [
    { name: 'portrait', width: 1080, height: 1920 },
    { name: 'landscape', width: 1920, height: 1080 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      window.__state = JSON.parse(sessionStorage.getItem('fixtureState') || '{"view":"setup","reason":"NETWORK","canMaintain":false}');
      window.bmsKiosk = {
        getState: async () => window.__state,
        validate: async ({ url }) => {
          await new Promise(resolve => setTimeout(resolve, 200));
          if (url.includes('wrong-branch')) return { ok: false, code: 'WRONG_BRANCH' };
          if (url.includes('redis-down')) return { ok: false, code: 'REDIS_UNAVAILABLE' };
          return url.includes('evil.test') ? { ok: false, code: 'INVALID_URL' }
            : { ok: true, storeName: 'FAKE Restaurant', locationName: 'FAKE Branch' };
        },
        activate: async () => ({ ok: true }),
        verifyPin: async pin => ({ ok: pin === '123456', code: pin === '999999' ? 'LOCKED'
          : pin === '888888' ? 'NETWORK' : pin === '777777' ? 'RATE_LIMITED'
            : pin === '666666' ? 'REDIS_UNAVAILABLE' : 'INVALID_PIN' }),
        cancelMaintenance: async () => ({ ok: true }),
        retry: async () => ({ ok: false, code: 'NETWORK' }),
        openMaintenance: async () => ({ ok: true }),
      };
    });
    const page = await context.newPage();
    await page.goto(file);
    await page.getByRole('heading', { name: 'ติดตั้ง URL ของสาขา' }).waitFor();
    const keys = await page.evaluate(() => ({ th: Object.keys(copy.th).sort(), en: Object.keys(copy.en).sort() }));
    assert.deepEqual(keys.th, keys.en, 'Desktop shell Thai/English keys must match');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/setup-${name}.png` });
    await page.locator('#kiosk-url').fill('https://evil.test/kiosk/' + 'a'.repeat(43));
    await page.getByRole('button', { name: 'ตรวจ URL และสาขา' }).click();
    await page.screenshot({ path: `${output}/loading-${name}.png` });
    await page.getByText('URL ไม่ถูกต้องหรือไม่ได้รับอนุญาต').waitFor();
    await page.screenshot({ path: `${output}/invalid-${name}.png` });
    await page.locator('#kiosk-url').fill('https://wrong-branch.test/kiosk/' + 'a'.repeat(43));
    await page.getByRole('button', { name: 'ตรวจ URL และสาขา' }).click();
    await page.getByText('กรุณาให้พนักงานตรวจสาขาและติดตั้ง URL ของสาขานี้').waitFor();
    await page.screenshot({ path: `${output}/wrong-branch-${name}.png` });
    await page.locator('#kiosk-url').fill('https://redis-down.test/kiosk/' + 'a'.repeat(43));
    await page.getByRole('button', { name: 'ตรวจ URL และสาขา' }).click();
    await page.getByText('กรุณาติดต่อพนักงาน ระบบยังตรวจความถี่คำขอไม่ได้').waitFor();
    await page.screenshot({ path: `${output}/redis-setup-${name}.png` });
    await page.locator('#kiosk-url').fill(`https://bms.jachoei.com/kiosk/${'a'.repeat(43)}`);
    await page.locator('#device-token').fill('FAKE-CREDENTIAL');
    await page.getByRole('button', { name: 'ตรวจ URL และสาขา' }).click();
    await page.getByText('FAKE Restaurant · FAKE Branch').waitFor();
    await page.getByRole('button', { name: 'ตรวจสอบและเปิดจอลูกค้า' }).waitFor();
    await page.screenshot({ path: `${output}/verified-${name}.png` });
    await page.getByRole('button', { name: 'TH · EN' }).first().click();
    await page.getByRole('heading', { name: 'Install the branch URL' }).waitFor();
    await page.evaluate(() => sessionStorage.setItem('fixtureState', JSON.stringify({ view: 'pin', reason: 'NETWORK', canMaintain: true })));
    await page.reload();
    await page.getByRole('heading', { name: 'PIN ผู้ดูแลจอ' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'maintenance-pin');
    await page.screenshot({ path: `${output}/pin-${name}.png` });
    await page.locator('#maintenance-pin').fill('000000');
    await page.getByRole('button', { name: 'ปลดล็อกการตั้งค่า' }).click();
    await page.getByText('PIN ไม่ถูกต้อง').waitFor();
    await page.screenshot({ path: `${output}/pin-wrong-${name}.png` });
    await page.locator('#maintenance-pin').fill('999999');
    await page.getByRole('button', { name: 'ปลดล็อกการตั้งค่า' }).click();
    await page.getByText('ใส่ PIN ผิดหลายครั้ง เครื่องถูกล็อกชั่วคราว').waitFor();
    await page.screenshot({ path: `${output}/pin-locked-${name}.png` });
    await page.locator('#maintenance-pin').fill('888888');
    await page.getByRole('button', { name: 'ปลดล็อกการตั้งค่า' }).click();
    await page.getByText('ตรวจ PIN ไม่ได้ กรุณาตรวจเครือข่าย').waitFor();
    await page.screenshot({ path: `${output}/pin-network-${name}.png` });
    await page.locator('#maintenance-pin').fill('777777');
    await page.getByRole('button', { name: 'ปลดล็อกการตั้งค่า' }).click();
    await page.getByText('ลอง PIN ถี่เกินไป กรุณารอสักครู่').waitFor();
    await page.screenshot({ path: `${output}/pin-rate-${name}.png` });
    await page.locator('#maintenance-pin').fill('666666');
    await page.getByRole('button', { name: 'ปลดล็อกการตั้งค่า' }).click();
    await page.getByText('ระบบจำกัดการลอง PIN ไม่พร้อม กรุณาติดต่อพนักงาน').waitFor();
    await page.screenshot({ path: `${output}/pin-redis-${name}.png` });
    await page.evaluate(() => sessionStorage.setItem('fixtureState', JSON.stringify({ view: 'recovery', reason: 'NETWORK', canMaintain: true })));
    await page.reload();
    await page.getByRole('heading', { name: 'เชื่อมต่อไม่ได้ในขณะนี้' }).waitFor();
    await page.screenshot({ path: `${output}/offline-${name}.png` });
    await page.evaluate(() => sessionStorage.setItem('fixtureState', JSON.stringify({ view: 'recovery', reason: 'REVOKED', canMaintain: true })));
    await page.reload();
    await page.getByRole('heading', { name: 'เครื่องนี้ถูกปิดใช้งาน' }).waitFor();
    await page.screenshot({ path: `${output}/recovery-${name}.png` });
    await page.evaluate(() => sessionStorage.setItem('fixtureState', JSON.stringify({ view: 'recovery', reason: 'BINDING', canMaintain: true })));
    await page.reload();
    await page.getByRole('heading', { name: 'URL ใช้ไม่ได้' }).waitFor();
    await page.screenshot({ path: `${output}/url-rotated-${name}.png` });
    await page.evaluate(() => sessionStorage.setItem('fixtureState', JSON.stringify({ view: 'recovery', reason: 'SERVER', canMaintain: true })));
    await page.reload();
    await page.getByRole('heading', { name: 'บริการไม่พร้อมชั่วคราว' }).waitFor();
    await page.screenshot({ path: `${output}/server-${name}.png` });
    await page.evaluate(() => sessionStorage.setItem('fixtureState', JSON.stringify({ view: 'recovery', reason: 'CRASH', canMaintain: true })));
    await page.reload();
    await page.getByRole('heading', { name: 'หน้าจอสั่งอาหารหยุดทำงาน' }).waitFor();
    await page.screenshot({ path: `${output}/crash-${name}.png` });
    await page.evaluate(() => sessionStorage.setItem('fixtureState', JSON.stringify({ view: 'recovery', reason: 'STORAGE', canMaintain: false })));
    await page.reload();
    await page.getByRole('heading', { name: 'อ่านข้อมูลเครื่องไม่ได้' }).waitFor();
    assert.equal(await page.locator('#open-maintenance').isHidden(), true);
    await page.screenshot({ path: `${output}/storage-${name}.png` });
    for (const [reason, heading, screenshot] of [
      ['WRONG_BRANCH', 'URL เป็นของสาขาอื่น', 'wrong-branch-recovery'],
      ['PIN_CHANGED', 'PIN ดูแลจอถูกเปลี่ยน', 'pin-changed'],
      ['NO_PIN', 'ยังไม่ได้ตั้ง PIN ดูแลจอ', 'no-pin'],
      ['TIMEOUT', 'ตรวจสอบนานเกินไป', 'timeout'],
      ['REDIS_UNAVAILABLE', 'ระบบจำกัดคำขอไม่พร้อม', 'redis-recovery'],
      ['RATE_LIMITED', 'ส่งคำขอถี่เกินไป', 'rate-recovery'],
    ]) {
      await page.evaluate((code) => sessionStorage.setItem('fixtureState', JSON.stringify({
        view: 'recovery', reason: code, canMaintain: true,
      })), reason);
      await page.reload();
      await page.getByRole('heading', { name: heading }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${output}/${screenshot}-${name}.png` });
    }
    console.log(`kiosk desktop browser ${name} ${width}x${height} OK`);
    await context.close();
  }
} finally { await browser.close(); }
