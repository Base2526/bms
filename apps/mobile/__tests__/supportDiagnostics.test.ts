import * as Keychain from 'react-native-keychain';
import { exportPosDiagnostics, getPosDiagnosticSummary, recordPosDiagnosticEvent,
  retryPosDiagnosticUpload } from '../src/lib/supportDiagnostics';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn(), setGenericPassword: jest.fn(),
}));

let stored: { username: string; password: string } | null;
const first = { serverUrl: 'https://shop.example.test', token: `pos_${'a'.repeat(43)}` };
const second = { serverUrl: 'https://other.example.test', token: `pos_${'b'.repeat(43)}` };

beforeEach(() => {
  jest.useFakeTimers();
  stored = null;
  (Keychain.getGenericPassword as jest.Mock).mockImplementation(async () => stored || false);
  (Keychain.setGenericPassword as jest.Mock).mockImplementation(async (username, password) => {
    stored = { username, password }; return true;
  });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('offline evidence survives secure storage and never includes a free-text secret', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network failed'));
  recordPosDiagnosticEvent(first, { category: 'pos', action: 'pos.device.verify', status: 'error',
    message: `customer ${first.token} PIN 1234`, context: { route: '/api/pos/session',
      errorCode: 'CUSTOMER_0900000000', nativeCode: '1006', appVersion: first.token } });
  const summary = await getPosDiagnosticSummary(first);
  expect(summary.pending).toBe(1);
  expect(stored?.password).not.toContain(first.token);
  expect(stored?.password).not.toContain('1234');
  expect(stored?.password).not.toContain('0900000000');
  expect(stored?.password).toContain('POS_UNKNOWN_ERROR');
  expect(stored?.password).toContain('1006');
  expect(await exportPosDiagnostics()).not.toContain(first.token);
  expect((await getPosDiagnosticSummary(second)).pending).toBe(0);
});

test('per-event acknowledgement retains rejected evidence', async () => {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const events = JSON.parse(String(init?.body)).events;
    return { ok: true, status: 200, json: async () => ({ results: events.map((event: { eventId: string }, index: number) =>
      ({ index, eventId: event.eventId, status: 'rejected', reason: 'event_too_old' })) }) } as Response;
  });
  recordPosDiagnosticEvent(first, { category: 'pos', action: 'health.failed', status: 'error',
    context: { errorCode: 'POS_TIMEOUT' } });
  expect((await getPosDiagnosticSummary(first)).rejected).toBe(1);
  expect(await exportPosDiagnostics()).toContain('event_too_old');
});

test('a full queue reports the count and time span of missing events', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  for (let index = 0; index < 27; index += 1) {
    recordPosDiagnosticEvent(first, { category: 'pos', action: 'network.MobilePosSale', status: 'error',
      context: { errorCode: 'POS_NETWORK', outcome: 'unknown' } });
  }
  const summary = await getPosDiagnosticSummary(first);
  expect(summary.gaps.reduce((sum, item) => sum + item.count, 0)).toBe(2);
  expect(summary.gaps[0]).toEqual(expect.objectContaining({ reason: 'local_capacity',
    count: 2, from: expect.any(String), to: expect.any(String) }));
  expect(await exportPosDiagnostics()).toContain('local_capacity');
});

test('401 blocks upload without discarding evidence; manual retry can resume', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
    .mockImplementation(async (_url, init) => {
      const events = JSON.parse(String(init?.body)).events;
      return { ok: true, status: 200, json: async () => ({ results: events.map((event: { eventId: string }, index: number) =>
        ({ index, eventId: event.eventId, status: 'accepted' })) }) } as Response;
    });
  recordPosDiagnosticEvent(first, { category: 'pos', action: 'health.failed', status: 'error' });
  expect((await getPosDiagnosticSummary(first)).blockedReason).toBe('token_rejected');
  expect((await getPosDiagnosticSummary(first)).pending).toBe(1);
  await retryPosDiagnosticUpload(first);
  expect((await getPosDiagnosticSummary(first)).pending).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('restart and token rotation keep earlier evidence with its original target', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  recordPosDiagnosticEvent(first, { category: 'pos', action: 'network.MobilePosSale', status: 'error',
    context: { errorCode: 'POS_TIMEOUT', outcome: 'unknown' } });
  expect((await getPosDiagnosticSummary(first)).pending).toBe(1);
  expect((await getPosDiagnosticSummary(second)).pending).toBe(0);
  let fresh: typeof import('../src/lib/supportDiagnostics') | undefined;
  jest.isolateModules(() => { fresh = require('../src/lib/supportDiagnostics'); });
  expect((await fresh!.getPosDiagnosticSummary(first)).pending).toBe(1);
  expect((await fresh!.getPosDiagnosticSummary(second)).pending).toBe(0);
  expect(await fresh!.exportPosDiagnostics()).toContain('POS_TIMEOUT');
});

test('invalid acknowledgement retains pending events; a later gap upload reports lost count', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200,
    json: async () => ({ results: [] }) } as Response);
  recordPosDiagnosticEvent(first, { category: 'pos', action: 'health.failed', status: 'error' });
  expect((await getPosDiagnosticSummary(first)).blockedReason).toBe('invalid_acknowledgement');
  expect((await getPosDiagnosticSummary(first)).pending).toBe(1);
  fetchMock.mockRejectedValue(new Error('offline'));
  for (let index = 0; index < 26; index += 1)
    recordPosDiagnosticEvent(first, { category: 'pos', action: 'health.failed', status: 'error' });
  expect((await getPosDiagnosticSummary(first)).gaps.reduce((sum, item) => sum + item.count, 0)).toBe(2);
  let sawGap = false;
  fetchMock.mockImplementation(async (_url, init) => {
    const events = JSON.parse(String(init?.body)).events;
    if (events[0].action === 'pos.diagnostic_gap') {
      sawGap = true;
      expect(events[0].context.droppedCount).toBe(2);
    }
    return { ok: true, status: 200, json: async () => ({ results: events.map((event: { eventId: string }, index: number) =>
      ({ index, eventId: event.eventId, status: 'accepted' })) }) } as Response;
  });
  await retryPosDiagnosticUpload(first);
  await retryPosDiagnosticUpload(first);
  expect(sawGap).toBe(true);
  expect((await getPosDiagnosticSummary(first)).pending).toBe(0);
});

test('secure storage failure is visible and export retains volatile evidence in this process', async () => {
  (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  recordPosDiagnosticEvent(first, { category: 'pos', action: 'health.failed', status: 'error',
    message: 'PIN 1234' });
  const summary = await getPosDiagnosticSummary(first);
  expect(summary.storageError).toBe(true);
  expect(summary.pending).toBe(1);
  expect(await exportPosDiagnostics()).not.toContain('1234');
});

test('pairing probe evidence stays local until that target is verified', async () => {
  let fresh: typeof import('../src/lib/supportDiagnostics') | undefined;
  jest.isolateModules(() => { fresh = require('../src/lib/supportDiagnostics'); });
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const events = JSON.parse(String(init?.body)).events;
    return { ok: true, status: 200, json: async () => ({ results: events.map((event: { eventId: string }, index: number) =>
      ({ index, eventId: event.eventId, status: 'accepted' })) }) } as Response;
  });
  fresh!.recordPosDiagnosticEvent(first, { category: 'pos', action: 'pos.device.verify', status: 'error',
    context: { errorCode: 'POS_NETWORK' } });
  expect((await fresh!.getPosDiagnosticSummary(first)).pending).toBe(1);
  expect(fetchMock).not.toHaveBeenCalled();
  await fresh!.retryPosDiagnosticUpload(first); // called by a verified health check
  expect((await fresh!.getPosDiagnosticSummary(first)).pending).toBe(0);
});

test('opening an old secure queue persists the retention gap and strips legacy text', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  recordPosDiagnosticEvent(first, { category: 'pos', action: 'health.failed', status: 'error' });
  await getPosDiagnosticSummary(first);
  const saved = JSON.parse(stored!.password);
  const key = Object.keys(saved.targets)[0];
  saved.targets[key].events[0].occurredAt = new Date(Date.now() - 31 * 86400_000).toISOString();
  saved.targets[key].events[0].message = 'PIN 1234';
  saved.targets[key].events[0].context.authorization = 'Bearer secret';
  stored!.password = JSON.stringify(saved);
  let fresh: typeof import('../src/lib/supportDiagnostics') | undefined;
  jest.isolateModules(() => { fresh = require('../src/lib/supportDiagnostics'); });
  const summary = await fresh!.getPosDiagnosticSummary(first);
  expect(summary.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'local_retention', count: 1 })]));
  expect(stored!.password).not.toContain('PIN 1234');
  expect(stored!.password).not.toContain('Bearer secret');
});
