import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { safePosAttemptId } from '../packages/pos-client-core/src/connectionFailure.ts';
import { isAllowedPosDiagnosticAction, safePosDiagnosticErrorCode, safePosDiagnosticReason,
  safePosDiagnosticRoute } from '../packages/pos-client-core/src/diagnosticOperations.ts';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = require('typescript') as typeof import('typescript');

function loadBrowserQueue() {
  const source = readFileSync(path.join(root, 'apps/web/lib/supportActivity.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  const mocks: Record<string, unknown> = {
    '@pos-core/connectionFailure': { safePosAttemptId },
    '@pos-core/diagnosticOperations': { isAllowedPosDiagnosticAction, safePosDiagnosticErrorCode,
      safePosDiagnosticReason, safePosDiagnosticRoute },
  };
  new Function('require', 'module', 'exports', js)((name: string) => {
    assert.ok(name in mocks, `unexpected dependency ${name}`);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}

test('browser POS ring reports capacity loss, sanitizes evidence and keeps per-item rejections', async () => {
  const priorWindow = (globalThis as any).window;
  const priorFetch = globalThis.fetch;
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: { getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => { local.set(key, value); }, removeItem: (key: string) => local.delete(key) },
    sessionStorage: { getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => { session.set(key, value); } },
  };
  try {
    const queue = loadBrowserQueue();
    for (let index = 0; index < 1002; index += 1) queue.recordSupportActivity('pos-device-1', {
      category: 'pos', action: 'restaurant.api.failed', status: 'error', message: 'PIN 1234 card 4111',
      headers: { Authorization: 'Bearer hidden-token' },
      context: { route: '/api/pos/restaurant/checks?phone=0890000000', errorCode: 'CUSTOMER_0890000000',
        durationMs: 20, online: false },
    } as any);
    assert.deepEqual(queue.localSupportEvidenceSummary('pos-device-1'), {
      pending: 1000, rejected: 0, dropped: 3, storageError: false,
    });
    const saved = [...local.values()][0];
    assert.doesNotMatch(saved, /PIN 1234|card 4111|0890000000|CUSTOMER_089|hidden-token|Authorization/);
    assert.match(saved, /pos\.diagnostic_gap/);
    assert.match(saved, /local_capacity/);

    let calls = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init.body));
      return Response.json({ results: body.events.map((event: { eventId: string }, index: number) => ({
        eventId: event.eventId, index, status: calls === 1 && index === 0 ? 'rejected' : 'accepted',
        reason: calls === 1 && index === 0 ? 'event_too_old' : undefined,
      })) });
    }) as typeof fetch;
    assert.equal(await queue.flushSupportActivity('pos-device-1'), 999);
    assert.equal(queue.localSupportEvidenceSummary('pos-device-1').rejected, 1);
    assert.equal(queue.localSupportEvidenceSummary('pos-device-1').pending, 0);
    assert.ok(calls >= 10);
    for (let index = 0; index < 1001; index += 1) queue.recordSupportActivity('pos-device-1', {
      category: 'pos', action: 'restaurant.api.failed', status: 'error',
    });
    assert.ok(queue.localSupportEvidenceSummary('pos-device-1').dropped >= 4,
      'rotating a rejected gap marker must retain its missing-count evidence');
  } finally {
    (globalThis as any).window = priorWindow;
    globalThis.fetch = priorFetch;
  }
});

test('browser queue retains evidence when the server acknowledgement is malformed', async () => {
  const priorWindow = (globalThis as any).window;
  const priorFetch = globalThis.fetch;
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: { getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => { local.set(key, value); }, removeItem: (key: string) => local.delete(key) },
    sessionStorage: { getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => { session.set(key, value); } },
  };
  try {
    const queue = loadBrowserQueue();
    queue.recordSupportActivity('pos-device-2', { category: 'pos', action: 'restaurant.api.failed', status: 'error' });
    globalThis.fetch = (async () => Response.json({ results: [] })) as typeof fetch;
    await assert.rejects(queue.flushSupportActivity('pos-device-2'), /ยืนยันผล/);
    assert.equal(queue.localSupportEvidenceSummary('pos-device-2').pending, 1);
  } finally {
    (globalThis as any).window = priorWindow;
    globalThis.fetch = priorFetch;
  }
});

test('browser storage failure is visible and cannot interrupt POS diagnostic recording', () => {
  const priorWindow = (globalThis as any).window;
  (globalThis as any).window = {
    localStorage: { getItem() { throw new Error('storage unavailable'); },
      setItem() { throw new Error('storage unavailable'); } },
    sessionStorage: { getItem() { throw new Error('storage unavailable'); } },
  };
  try {
    const queue = loadBrowserQueue();
    assert.doesNotThrow(() => queue.recordSupportActivity('pos-device-3', {
      category: 'pos', action: 'restaurant.api.failed', status: 'error',
    }));
    assert.equal(queue.localSupportEvidenceSummary('pos-device-3').storageError, true);
  } finally { (globalThis as any).window = priorWindow; }
});

test('browser admin activity strips legacy paths, free text and unexpected context before upload', async () => {
  const priorWindow = (globalThis as any).window;
  const priorFetch = globalThis.fetch;
  const local = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: { getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => { local.set(key, value); }, removeItem: (key: string) => local.delete(key) },
    sessionStorage: { getItem: () => null, setItem() {} },
  };
  try {
    const queue = loadBrowserQueue();
    local.set('bms.support.activity.v2.admin-user', JSON.stringify([{
      eventId: '11111111-1111-4111-8111-111111111111', occurredAt: new Date().toISOString(),
      sessionId: 'legacy-session', category: 'navigation', action: 'ui.route_view', status: 'success',
      message: 'old customer 0890000000', context: { route: '/admin/customers/0890000000',
        previousRoute: '/admin/orders/secret', customerName: 'John Smith' },
    }]));
    assert.equal(queue.localSupportEventCount('admin-user'), 1);
    queue.recordSupportActivity('admin-user', { category: 'ui', action: 'ui.window_error', status: 'error',
      message: 'customer 0890000000', context: { route: '/admin/customers/0890000000?token=secret',
        errorName: 'John Smith', headers: 'Authorization: Bearer secret', body: 'card 4111' } } as any);
    const saved = [...local.values()][0];
    assert.doesNotMatch(saved, /0890000000|John Smith|Authorization|Bearer|secret|card 4111/);
    assert.match(saved, /"route":"\/admin"/);
    let payload = '';
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      payload = String(init.body);
      const events = JSON.parse(payload).events;
      return Response.json({ results: events.map((event: { eventId: string }, index: number) => ({
        eventId: event.eventId, index, status: 'accepted',
      })) });
    }) as typeof fetch;
    assert.equal(await queue.flushSupportActivity('admin-user'), 2);
    assert.doesNotMatch(payload, /0890000000|John Smith|Authorization|Bearer|secret|card 4111/);
  } finally {
    (globalThis as any).window = priorWindow;
    globalThis.fetch = priorFetch;
  }
});
