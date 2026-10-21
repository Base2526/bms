import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { PosConnectionError, posErrorConnectionStatus } from "../packages/pos-client-core/src/operation.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/components/pos-desktop/DesktopPosRenderer.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("  const refreshDesktopContent = useCallback");
assert.ok(start >= 0);
const handler = source.slice(start, source.indexOf("\n  useEffect(", start));
const compiled = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(options: { initial?: string; busy?: boolean; submitting?: boolean; pending?: boolean; token?: string | null } = {}) {
  let connection = options.initial ?? "online", refreshing = false, reads = 0, catalogReads = 0, serviceReads = 0, signals = 0;
  const connections: string[] = [], errors: string[] = [], notices: string[] = [];
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const request = new Promise((yes, no) => { resolve = yes; reject = no; });
  const refreshingRef = { current: false };
  const attempt = { current: options.pending ? { payload: { input: { idempotencyKey: "original-key" } } } : null };
  const deps = {
    useCallback: (fn: unknown) => fn,
    tokenRef: { current: options.token === undefined ? "FAKE-token" : options.token },
    contentRefreshingRef: refreshingRef, busy: options.busy ?? false,
    saleSubmittingRef: { current: options.submitting ?? false }, saleAttemptRef: attempt,
    setNotice: (value: string) => notices.push(value),
    setContentRefreshing: (value: boolean) => { refreshing = value; },
    setConnection: (value: string) => { connection = value; connections.push(value); },
    posGraphqlRequest: () => { reads++; return request; }, POS_BOOTSTRAP_QUERY: "bootstrap",
    setBootstrap: () => {}, query: "draft-query", cashier: { id: "FAKE-cashier" }, pin: "1234",
    loadCatalog: async () => { catalogReads++; }, refreshDesktopServiceCalls: async () => { serviceReads++; },
    setFailedStoreLogoUrl: () => {}, setContentRefreshSignal: () => { signals++; },
    posErrorConnectionStatus, setError: (value: string) => errors.push(value), messageOf: (error: Error) => error.message,
  };
  const refresh = new Function(...Object.keys(deps), `${compiled}; return refreshDesktopContent;`)(...Object.values(deps));
  return {
    refresh, resolve: () => resolve({ bmsPosSession: {} }), reject, connections, errors, notices, attempt,
    state: () => ({ connection, refreshing, reads, catalogReads, serviceReads, signals, locked: refreshingRef.current }),
  };
}

test("refresh keeps last observed online/offline state until a response and coalesces duplicate clicks", async () => {
  for (const initial of ["online", "offline"]) {
    const h = harness({ initial });
    const first = h.refresh();
    assert.equal(h.state().connection, initial);
    assert.equal(h.state().refreshing, true);
    assert.deepEqual(h.connections, []);
    await h.refresh();
    assert.equal(h.state().reads, 1);
    h.resolve();
    await first;
    assert.deepEqual(h.state(), { connection: "online", refreshing: false, reads: 1, catalogReads: 1, serviceReads: 1, signals: 1, locked: false });
    assert.deepEqual(h.errors, []);
  }
});

test("business/local failures never fake a reconnect; transport failures still report offline and release refresh", async () => {
  for (const [error, expected] of [
    [Object.assign(new Error("forbidden"), { code: "FORBIDDEN", httpStatus: 403 }), "online"],
    [new Error("local failure"), "online"],
    [new PosConnectionError("network failed"), "offline"],
    [Object.assign(new Error("gateway timeout"), { httpStatus: 504 }), "offline"],
  ] as const) {
    const h = harness();
    const work = h.refresh();
    h.reject(error);
    await work;
    assert.equal(h.state().connection, expected);
    assert.equal(h.state().refreshing, false);
    assert.equal(h.state().locked, false);
    assert.equal(h.state().catalogReads, 0);
    assert.equal(h.state().signals, 0);
    assert.equal(h.errors.length, 1);
    assert.ok(!h.connections.includes("checking"));
  }
});

test("refresh cannot interrupt a pending sale, a submitted sale or another operation", async () => {
  for (const options of [{ busy: true }, { submitting: true }, { pending: true }, { token: null }]) {
    const h = harness(options);
    const original = h.attempt.current;
    await h.refresh();
    assert.equal(h.state().reads, 0);
    assert.equal(h.state().refreshing, false);
    assert.deepEqual(h.connections, []);
    assert.equal(h.attempt.current, original);
    assert.equal(h.notices.length, options.token === null ? 0 : 1);
  }
});

test("initial connection checking and native refresh shortcut remain wired separately", () => {
  assert.match(source, /const bootstrapDevice = useCallback\(async \(\) => \{\s*setConnection\("checking"\)/);
  assert.match(source, /onRefreshRequested\(\(\) => \{ void refreshDesktopContent\(\); \}\)/);
  assert.match(source, /contentRefreshing \? "กำลังอัปเดตข้อมูล…" : ""/);
  assert.equal((source.match(/"กำลังอัปเดตข้อมูล…"/g) ?? []).length, 1);
});
