import assert from 'node:assert/strict';
import test from 'node:test';
import { describePosConnectionFailure } from '../packages/pos-client-core/src/connectionFailure.ts';
import { isDecidedRejection, runWithOperationTimeout } from '../packages/pos-client-core/src/operation.ts';
import { posGraphqlRequest, PosGraphqlError } from '../apps/web/lib/pos/mobileFlowGraphql.ts';
import { readPosJson } from '../apps/web/lib/pos/response.ts';
import { describeTransportFailure } from '../apps/web/lib/pos/failureMessage.ts';
test('a malformed GraphQL code is classified without coercing an untrusted object', () => {
  assert.equal(describePosConnectionFailure({ httpStatus: 200, extensions: { code: { toString: null } } }).kind, 'protocol');
});

for (const [status, kind] of [[401, 'authentication'], [403, 'permission'], [429, 'rate_limit'],
  [500, 'server'], [502, 'server'], [504, 'timeout'], [404, 'version']] as const) {
  test(`HTTP ${status} has an actionable, safe ${kind} message`, () => {
    const result = describePosConnectionFailure({ httpStatus: status, message: 'SECRET token PIN SQL' }, true);
    assert.equal(result.kind, kind);
    assert.ok(result.message.includes(`HTTP ${status}`));
    assert.ok(!result.message.includes('SECRET'));
    assert.equal(result.outcome, status >= 500 ? 'unknown' : 'rejected');
  });
}
test('a read timeout is not an uncertain sale; offline status cannot prove a write was unsent', () => {
  assert.equal(describePosConnectionFailure({ code: 'POS_TIMEOUT' }).outcome, 'read_failed');
  assert.match(describePosConnectionFailure({ code: 'POS_TIMEOUT' }).message, /ข้อมูลล่าสุด/);
  assert.match(describeTransportFailure(0, false, 'POST'), /ยังไม่รู้/);
  assert.doesNotMatch(describeTransportFailure(0, false, 'POST'), /ยังไม่ถูกส่ง/);
});
test('mixed GraphQL outcomes and network failures retain the original idempotency key', () => {
  const graphQLErrors = [{ extensions: { code: 'FORBIDDEN' } }, { extensions: { code: 'INTERNAL_SERVER_ERROR' } }];
  assert.equal(isDecidedRejection({ graphQLErrors }), false);
  assert.equal(isDecidedRejection({ graphQLErrors: graphQLErrors.slice(0, 1), networkError: new Error() }), false);
});
test('external cancellation rejects even a non-aborting transport and does not start pre-aborted work', async () => {
  const controller = new AbortController();
  const pending = runWithOperationTimeout(() => new Promise(() => {}), 1000, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error: any) => error.code === 'POS_CANCELLED');
  await assert.rejects(runWithOperationTimeout(() => { assert.fail('must not send'); }, 1000, controller.signal));
});

test('Desktop classifies malformed GraphQL, proxy errors and unknown mutations without leaking bodies', async t => {
  const cases = [
    { status: 200, body: '<html>SECRET</html>', code: 'INVALID_RESPONSE', message: /POS_PROTOCOL/ },
    { status: 200, body: JSON.stringify({ errors: 'SECRET' }), code: 'INVALID_RESPONSE', message: /POS_PROTOCOL/ },
    { status: 503, body: 'SECRET', code: 'INTERNAL_SERVER_ERROR', message: /POS_SERVER/ },
    { status: 500, body: JSON.stringify({ errors: [{ message: 'not decided', extensions: { code: 'FORBIDDEN' } }] }), code: 'INTERNAL_SERVER_ERROR', message: /POS_SERVER/ },
    { status: 200, body: JSON.stringify({ errors: [{ message: 'SECRET SQL', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }), code: 'INTERNAL_SERVER_ERROR', message: /POS_SERVER/ },
  ];
  for (const item of cases) {
    t.mock.method(globalThis, 'fetch', async () => new Response(item.body, { status: item.status }));
    await assert.rejects(posGraphqlRequest('FAKE', 'mutation Save { save }'), (error: any) => {
      assert.ok(error instanceof PosGraphqlError);
      assert.equal(error.code, item.code);
      assert.match(error.message, item.message);
      assert.match(error.message, /ยังยืนยันไม่ได้/);
      assert.doesNotMatch(error.message, /SECRET/);
      return true;
    });
    t.mock.restoreAll();
  }
});
test('Desktop preserves business messages, metadata and successful business rejection data', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ errors: [
    { message: 'PIN ไม่ถูกต้อง', extensions: { code: 'FORBIDDEN', reason: 'INVALID_PIN' } },
  ] }), { status: 200 }));
  await assert.rejects(posGraphqlRequest('FAKE', 'mutation Verify { verify }'), /PIN ไม่ถูกต้อง/);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: { sale: { status: 'INSUFFICIENT' } } })));
  assert.deepEqual(await posGraphqlRequest('FAKE', 'mutation Save { save }'), { sale: { status: 'INSUFFICIENT' } });
});
test('restaurant JSON adapter rejects HTML 200 and preserves a server business rejection', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>SECRET</html>'));
  await assert.rejects(readPosJson('/fixture', { method: 'POST' }), /POS_PROTOCOL/);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ status: 'INSUFFICIENT' }), { status: 409 }));
  const result = await readPosJson('/fixture', { method: 'POST' });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.status, 'INSUFFICIENT');
});
test('missing restaurant board arrays are a protocol error, not an empty board or render crash', async t => {
  for (const body of [{}, { areas: null, tables: [] }, { areas: [null], tables: [] }]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
    await assert.rejects(readPosJson('/api/pos/restaurant/floor'), /POS_PROTOCOL/);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ areas: [], tables: [] })));
  assert.deepEqual((await readPosJson('/api/pos/restaurant/floor')).body, { areas: [], tables: [] });
});
