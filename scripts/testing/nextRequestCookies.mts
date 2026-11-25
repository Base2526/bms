// =============================================================
// Request-cookie scope for DB contracts that call real App Router route handlers.
// -------------------------------------------------------------
// Next 14 exposed `next/dist/client/components/request-async-storage.external.js`; Next 16 removed
// it. `cookies()` from `next/headers` now needs BOTH a work store (`workAsyncStorage`) and a
// `request` work-unit store (`workUnitAsyncStorage`), otherwise it throws "called outside a request
// scope". This helper supplies the smallest pair of stores that lets a route read the cookies a test
// chooses, without starting a Next server.
//
// Next keeps these stores on a shared AsyncLocalStorage that must exist before its modules load.
// =============================================================
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";

(globalThis as any).AsyncLocalStorage ??= AsyncLocalStorage;

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external.js");

export type RequestCookieReader = { get(name: string): { value: string } | undefined };

export function runWithRequestCookies<T>(cookies: RequestCookieReader, fn: () => T): T {
  return workAsyncStorage.run({ route: "/contract-test" }, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies }, fn)
  );
}
