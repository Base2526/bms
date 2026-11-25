// =============================================================
// A cashier PIN never travels in a URL.
// -------------------------------------------------------------
// GET /api/pos/ar, /api/pos/shift-report and /api/pos/store-credit read `?pin=` from the query
// string, and the web register/restaurant screens built those URLs. Query strings land in reverse
// proxy access logs, browser history and error reports, so a four-to-six digit PIN that unlocks
// credit sales, shift figures and store credit was being written to logs. POST routes already keep
// the PIN in the body (see app/api/pos/board-game/route.ts). Found 2026-11-24 (REST sweep).
//
// GET routes now take the PIN from the `x-pos-cashier-pin` header and ignore `?pin=`.
// =============================================================
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

import { loadWithStubs } from "./testing/webhookHarness.mts";

const ROUTES = [
  { file: "apps/web/app/api/pos/ar/route.ts", query: "customerId=FAKE-customer" },
  { file: "apps/web/app/api/pos/shift-report/route.ts", query: "" },
  { file: "apps/web/app/api/pos/store-credit/route.ts", query: "code=FAKE-CODE" },
];

function load(file: string, pins: string[]) {
  return loadWithStubs(file, {
    "next/server": { NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) } },
    "@/lib/bms/posApprovals": { posPermissionDeniedMessage: async () => "FAKE-denied" },
    "@/lib/bms/pos": {
      authenticatePosDevice: async (token: string) => (token === "FAKE-device" ? { tenantId: "FAKE-tenant", id: "FAKE-device-id", locationId: "FAKE-location" } : null),
      verifyCashierPin: async (_tenant: string, userId: string, pin: string) => { pins.push(pin); return { ok: true, userId }; },
      // Deny after the PIN check so the contract never reaches report/AR/store-credit services.
      cashierHasPermission: async () => false,
    },
    "@/lib/bms/ar": {},
    "@/lib/bms/storeCredit": {},
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  });
}

function request(query: string, headers: Record<string, string>) {
  const url = new URL(`http://localhost/api/pos/x?${query}`);
  return { headers: new Headers({ "x-pos-device-token": "FAKE-device", ...headers }), nextUrl: url, url: url.href };
}

for (const route of ROUTES) {
  test(`${route.file.split("/api/")[1]} reads the PIN from the header, never the query string`, async () => {
    const pins: string[] = [];
    const { GET } = load(route.file, pins);
    const base = [route.query, "cashierUserId=FAKE-cashier"].filter(Boolean).join("&");

    const fromHeader = await GET(request(base, { "x-pos-cashier-pin": "135790" }));
    assert.deepEqual(pins, ["135790"], "the header PIN must be the one verified");
    assert.equal(fromHeader.status, 403, "stub permission denial proves the PIN check ran");

    pins.length = 0;
    const fromQuery = await GET(request(`${base}&pin=246802`, {}));
    assert.deepEqual(pins, [], "a PIN in the query string must not be read or verified");
    assert.equal(fromQuery.status, 400);
  });
}

// String-aware comment stripper so an explanatory comment cannot satisfy or fail the scan.
function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") { out += next ?? ""; i += 1; } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { while (i < source.length && source[i] !== "\n") i += 1; out += "\n"; continue; }
    if (ch === "/" && next === "*") { const end = source.indexOf("*/", i + 2); i = end === -1 ? source.length : end + 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}

function walk(dir: URL): URL[] {
  return readdirSync(dir).flatMap((name) => {
    const child = new URL(name, dir);
    if (statSync(child).isDirectory()) return walk(new URL(`${name}/`, dir));
    return /\.(tsx?|mts)$/.test(name) ? [child] : [];
  });
}

test("POS screens never put a PIN into a URL", () => {
  const roots = [
    new URL("../apps/web/app/(pos)/", import.meta.url),
    new URL("../apps/web/components/pos-desktop/", import.meta.url),
  ];
  const offenders: string[] = [];
  let scanned = 0;
  for (const file of roots.flatMap(walk)) {
    scanned += 1;
    const source = stripComments(readFileSync(file, "utf8"));
    // Only URLSearchParams receivers count: FormData/JSON bodies of POST requests are not URLs.
    const urlParamNames = [...source.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*new\s+URLSearchParams\b/g)].map((m) => m[1]);
    const setsPin = urlParamNames.some((name) =>
      new RegExp(`\\b${name}\\.(?:set|append)\\(\\s*["'](?:pin|cashierPin)["']`).test(source));
    if (/URLSearchParams\(\s*\{[^}]*\bpin\b/i.test(source) || setsPin
      || /[?&](?:pin|cashierPin)=/.test(source)) offenders.push(decodeURIComponent(file.pathname.split("/apps/web/")[1]));
  }
  assert.ok(scanned > 10, `expected to scan the POS screens, scanned ${scanned}`);
  assert.deepEqual(offenders, []);
});
