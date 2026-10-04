import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = require('typescript');
const source = await readFile(new URL('../apps/web/components/pos/BoardGamePanel.tsx', import.meta.url), 'utf8');
const start = source.lastIndexOf('  useEffect(() => {', source.indexOf('const q = memberQuery.trim();'));
const effect = source.slice(start, source.indexOf('  const rates = useMemo(', start));
const compiled = ts.transpileModule(effect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function search(query: string, fetch: (url: string, init: RequestInit) => Promise<Response>) {
  const state = { members: [] as unknown[], status: '', error: '' };
  let cleanup: (() => void) | undefined;
  let timer: (() => void) | undefined;
  const deps = {
    memberQuery: query, ready: true, token: 'FAKE-device-token', openingTable: { id: 'FAKE-table' }, memberSearchAttempt: 0,
    setMembers: (members: unknown[]) => { state.members = members; },
    setMemberSearchStatus: (status: string) => { state.status = status; },
    setMemberSearchError: (error: string) => { state.error = error; },
    useEffect: (run: () => (() => void) | undefined) => { cleanup = run(); },
    setTimeout: (run: () => void) => { timer = run; return 1; },
    clearTimeout: () => { timer = undefined; },
    AbortController, fetch,
  };
  new Function(...Object.keys(deps), compiled)(...Object.values(deps));
  return { state, send: () => timer?.(), cancel: () => cleanup?.() };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('member names and phone fragments use the authenticated search route; short queries do not search', async () => {
  for (const query of ['สมาชิก ทดสอบ', '000123']) {
    const h = search(query, async (url, init) => {
      assert.equal(new URL(url, 'https://example.test').searchParams.get('q'), query);
      assert.equal((init.headers as Record<string, string>)['x-pos-device-token'], 'FAKE-device-token');
      return Response.json({ members: [{ customerId: 'FAKE-member' }] });
    });
    h.send(); await settle();
    assert.equal(h.state.status, 'success');
    assert.equal(h.state.members.length, 1);
  }
  const h = search('กข', async () => { throw new Error('must not fetch'); });
  h.send(); await settle();
  assert.equal(h.state.status, 'idle');
});

test('empty results, HTTP errors and malformed responses remain distinct', async () => {
  for (const [response, expected] of [
    [Response.json({ members: [] }), 'success'],
    [Response.json({ error: 'unavailable' }, { status: 500 }), 'error'],
    [Response.json({}, { status: 401 }), 'error'],
    [Response.json({}), 'error'],
  ] as const) {
    const h = search('FAKE', async () => response);
    h.send(); await settle();
    assert.equal(h.state.status, expected);
    assert.equal(Boolean(h.state.error), expected === 'error');
  }
});

test('late responses cannot restore members after changing the query or closing the table form', async () => {
  let finish!: (response: Response) => void;
  const h = search('OLD', () => new Promise(resolve => { finish = resolve; }));
  h.send(); h.cancel();
  finish(Response.json({ members: [{ customerId: 'FAKE-old' }] }));
  await settle();
  assert.deepEqual(h.state.members, []);
  assert.notEqual(h.state.status, 'success');
});
