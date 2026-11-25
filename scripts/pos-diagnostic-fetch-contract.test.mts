import assert from 'node:assert/strict';
import test from 'node:test';
import * as connection from '../packages/pos-client-core/src/connectionFailure.ts';
import * as operations from '../packages/pos-client-core/src/diagnosticOperations.ts';
import { loadWithStubs } from './testing/webhookHarness.mts';

function setup(fetchImpl: typeof fetch, active?: { token: string }) {
  const previousFetch = globalThis.fetch;
  const previousWindow = (globalThis as any).window;
  const diagnostics: any[] = [];
  (globalThis as any).window = { location: { href: 'https://shop.example/pos', origin: 'https://shop.example' },
    bmsDesktop: { recordDiagnostic: async (event: unknown) => { diagnostics.push(event); return { ok: true }; },
      ...(active ? { getDeviceToken: async () => active.token } : {}) } };
  globalThis.fetch = fetchImpl;
  const module = loadWithStubs('apps/web/lib/pos/diagnosticFetch.ts', {
    '@pos-core/connectionFailure': connection,
    '@pos-core/diagnosticOperations': operations,
  });
  return { fetch: module.posDiagnosticFetch as typeof fetch, diagnostics,
    restore() { globalThis.fetch = previousFetch; (globalThis as any).window = previousWindow; } };
}

test('a sale transport rejection keeps the original error and idempotency key while recording only coded evidence', async () => {
  const failure = new TypeError('Network request failed for https://private.example?token=secret');
  const body = JSON.stringify({ idempotencyKey: 'sale-original-key', pin: '1234' });
  let sentBody: unknown;
  const h = setup(async (_input, init) => { sentBody = init?.body; throw failure; });
  try {
    await assert.rejects(h.fetch('/api/pos/sale?customer=private', { method: 'POST',
      headers: { 'x-pos-device-token': 'secret-token' }, body }), error => error === failure);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sentBody, body);
    assert.equal(h.diagnostics.length, 1);
    assert.equal(h.diagnostics[0].route, '/api/pos/sale');
    assert.equal(h.diagnostics[0].code, 'POS_NETWORK');
    assert.equal(h.diagnostics[0].outcome, 'unknown');
    assert.equal(h.diagnostics[0].serverResponded, false);
    assert.ok(connection.safePosAttemptId(h.diagnostics[0].correlationId));
    assert.doesNotMatch(JSON.stringify(h.diagnostics), /1234|secret|private|customer|idempotencyKey/);
  } finally { h.restore(); }
});

test('HTTP failures carry status, and only an echoed attempt proves server receipt', async () => {
  for (const [status, code, outcome] of [[401, 'POS_AUTHENTICATION', 'rejected'],
    [403, 'POS_PERMISSION', 'rejected'], [408, 'POS_TIMEOUT', 'unknown'],
    [429, 'POS_RATE_LIMIT', 'rejected'], [503, 'POS_SERVER', 'unknown']] as const) {
    let requestAttempt: string | null = null;
    const h = setup(async (_input, init) => {
      requestAttempt = new Headers(init?.headers).get('x-pos-attempt-id');
      return new Response('{}', { status, headers: status === 503 ? {} : { 'x-pos-attempt-id': requestAttempt! } });
    });
    try {
      const response = await h.fetch('/api/pos/sale', { method: 'POST',
        headers: { 'x-pos-device-token': 'secret-token' } });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(response.status, status);
      assert.equal(h.diagnostics[0].code, code);
      assert.equal(h.diagnostics[0].httpStatus, status);
      assert.equal(h.diagnostics[0].outcome, outcome);
      assert.equal(h.diagnostics[0].correlationId, requestAttempt);
      assert.equal(h.diagnostics[0].serverResponded, status !== 503);
    } finally { h.restore(); }
  }
});

test('HTML 200 and recovery are recorded without altering responses or leaking the body', async () => {
  let count = 0;
  const h = setup(async (_input, init) => {
    count += 1;
    const attempt = new Headers(init?.headers).get('x-pos-attempt-id');
    return count === 1
      ? new Response('<html>PRIVATE_CARD_BODY</html>', { status: 200, headers: { 'content-type': 'text/html' } })
      : new Response('{}', { status: 200, headers: { 'content-type': 'application/json',
        'x-pos-attempt-id': attempt! } });
  });
  try {
    const malformed = await h.fetch('/api/pos/scan?code=private', { headers: { 'x-pos-device-token': 'target-one' } });
    assert.equal(await malformed.text(), '<html>PRIVATE_CARD_BODY</html>');
    await h.fetch('/api/pos/sale', { headers: { 'x-pos-device-token': 'target-one' } });
    await h.fetch('/api/pos/scan', { headers: { 'x-pos-device-token': 'target-one' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.diagnostics.map(row => row.code), ['POS_PROTOCOL', 'POS_RECOVERED']);
    assert.equal(h.diagnostics[1].serverResponded, true);
    assert.doesNotMatch(JSON.stringify(h.diagnostics), /PRIVATE_CARD_BODY|target-one|target-two|private/);
  } finally { h.restore(); }
});

test('a new device target cannot inherit the previous target outage or read throttle', async () => {
  let count = 0;
  const h = setup(async () => { count += 1; return new Response('{}', { status: count < 3 ? 503 : 200 }); });
  try {
    await h.fetch('/api/pos/scan', { headers: { 'x-pos-device-token': 'old-target' } });
    await h.fetch('/api/pos/scan', { headers: { 'x-pos-device-token': 'new-target' } });
    await h.fetch('/api/pos/scan', { headers: { 'x-pos-device-token': 'third-target' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.diagnostics.map(row => row.code), ['POS_SERVER', 'POS_SERVER']);
    assert.doesNotMatch(JSON.stringify(h.diagnostics), /old-target|new-target|third-target/);
  } finally { h.restore(); }
});

test('an in-flight old target response cannot be journalled under the new target', async () => {
  let releaseOld!: (response: Response) => void;
  const oldResponse = new Promise<Response>(resolve => { releaseOld = resolve; });
  let count = 0;
  const h = setup(async () => ++count === 1 ? oldResponse : new Response('{}', { status: 200 }));
  try {
    const pending = h.fetch('/api/pos/sale', { method: 'POST',
      headers: { 'x-pos-device-token': 'old-target' } });
    await h.fetch('/api/pos/scan', { headers: { 'x-pos-device-token': 'new-target' } });
    releaseOld(new Response('{}', { status: 503 }));
    assert.equal((await pending).status, 503);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.diagnostics, []);
  } finally { h.restore(); }
});

test('token rotation without another request cannot attribute an old transport failure to the new pairing', async () => {
  const active = { token: 'old-target' };
  const failure = new TypeError('network request failed');
  const h = setup(async () => { active.token = 'new-target'; throw failure; }, active);
  try {
    await assert.rejects(h.fetch('/api/pos/sale', { method: 'POST',
      headers: { 'x-pos-device-token': 'old-target' } }), error => error === failure);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.diagnostics, []);
  } finally { h.restore(); }
});

test('browser deadline records a read timeout without an HTTP status or raw error', async () => {
  const h = setup(async () => { throw Object.assign(new Error('private URL token=secret'), { name: 'TimeoutError' }); });
  try {
    await assert.rejects(h.fetch('/api/pos/session', { headers: { 'x-pos-device-token': 'secret' } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.diagnostics[0].code, 'POS_TIMEOUT');
    assert.equal(h.diagnostics[0].outcome, 'read_failed');
    assert.equal(h.diagnostics[0].httpStatus, undefined);
    assert.doesNotMatch(JSON.stringify(h.diagnostics), /private|secret|token=/);
  } finally { h.restore(); }
});
