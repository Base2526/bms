import { applyPosLanguage } from '../src/i18n/catalog';
import { PosConnectionError, runWithOperationTimeout } from '../src/lib/operation';

// 2026-11-24 recheck: the shared 15-second wrapper rejected with hardcoded Thai
// ("เซิร์ฟเวอร์ไม่ตอบภายใน 15 วินาที" / "การรอคำตอบถูกยกเลิก"), and that text reached alerts and the
// offline queue's stored error in English mode.
afterEach(() => applyPosLanguage('th'));

test('a timed-out operation explains itself in the cashier language', async () => {
  applyPosLanguage('en');
  await expect(runWithOperationTimeout(() => new Promise<never>(() => undefined), 20))
    .rejects.toMatchObject({ code: 'POS_TIMEOUT', message: 'Server did not respond within 1 seconds' });
  applyPosLanguage('th');
  await expect(runWithOperationTimeout(() => new Promise<never>(() => undefined), 20))
    .rejects.toMatchObject({ code: 'POS_TIMEOUT', message: 'เซิร์ฟเวอร์ไม่ตอบภายใน 1 วินาที' });
});

test('a cancelled wait is reported in the cashier language and keeps its code', async () => {
  applyPosLanguage('en');
  const controller = new AbortController();
  const pending = runWithOperationTimeout(() => new Promise<never>(() => undefined), 5_000, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'POS_CANCELLED', message: 'Waiting for a response was cancelled' });
  await expect(pending).rejects.toBeInstanceOf(PosConnectionError);
});

test('a successful operation and other errors pass through unchanged', async () => {
  applyPosLanguage('en');
  await expect(runWithOperationTimeout(async () => 'FAKE-ok', 1_000)).resolves.toBe('FAKE-ok');
  const other = new Error('ไม่มีสิทธิ์ FAKE');
  await expect(runWithOperationTimeout(async () => { throw other; }, 1_000)).rejects.toBe(other);
});
