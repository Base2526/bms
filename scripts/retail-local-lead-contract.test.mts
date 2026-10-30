import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateRetailLocalLeadSubmission } from "../apps/web/lib/bms/retailLocalLeads.ts";
import { RetailLocalLeadError } from "../apps/web/lib/bms/retailLocalLeads.ts";
import * as requestBody from "../apps/web/lib/bms/retailLocalRequestBody.ts";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const route = read("apps/web/app/api/public/retail-local/lead/route.ts");
const service = read("apps/web/lib/bms/retailLocalLeads.ts");
const migration = read("db/migrations/10.105__bms_retail_local_leads.sql");
const adminListRoute = read("apps/web/app/api/admin/retail-local/leads/route.ts");
const adminUpdateRoute = read("apps/web/app/api/admin/retail-local/leads/[id]/route.ts");
const licensesPage = read("apps/web/app/(admin)/admin/retail-local-licenses/page.tsx");

function assertPublicLeadContract(routeSource: string, serviceSource: string) {
  assert.match(routeSource, /rateLimit\(`retail-local-lead:\$\{ip\.slice\(0, 128\)\}`, 5, 60 \* 60 \* 1000\)/);
  assert.match(serviceSource, /body\.consent !== true/);
  assert.match(serviceSource, /if \(!phone && !lineId\)/);
  assert.match(serviceSource, /\^0\(\?:\[689\]\\d\{8\}\|\[2-7\]\\d\{7,8\}\)\$/);
  assert.match(routeSource, /NextResponse\.json\(\{ ok: true \}/);
  assert.doesNotMatch(routeSource, /phone|lineId|shopName|contactName/);
}

function assertMigrationContract(source: string) {
  assert.match(source, /-- ROLLBACK/);
  assert.ok(source.includes("CHECK (NULLIF(btrim(phone), '') IS NOT NULL OR NULLIF(btrim(line_id), '') IS NOT NULL)"));
  assert.match(source, /consent_at\s+TIMESTAMPTZ NOT NULL/);
  assert.match(source, /ENABLE ROW LEVEL SECURITY/);
  assert.match(source, /bms_is_current_platform_admin\(\)/);
  assert.match(source, /GRANT SELECT, UPDATE ON public\.bms_retail_local_leads TO bms_app/);
  assert.doesNotMatch(source, /GRANT[^;]*INSERT[^;]*ON public\.bms_retail_local_leads TO bms_app/);
  assert.match(source, /bms_retail_local_leads_revisions/);
  assert.match(source, /bms_retail_local_lead_events/);
}

test("public Retail Local lead submission is consent-gated, bounded and returns no PII", () => {
  assertPublicLeadContract(route, service);
});

test("Retail Local lead storage is platform-protected, revisioned and contact-valid", () => {
  assertMigrationContract(migration);
});

test("Retail Local lead admin routes require a live platform administrator", () => {
  assert.match(adminListRoute, /authorizePlatformAdminRoute\(\)/);
  assert.match(adminUpdateRoute, /authorizePlatformAdminRoute\(\)/);
  assert.match(service, /INSERT INTO bms_retail_local_lead_events/);
  assert.match(service, /await client\.query\("COMMIT"\)/);
});

test("Retail Local license page exposes the platform-only Lead tab", () => {
  assert.match(licensesPage, /RetailLocalLeadsPanel/);
  assert.match(licensesPage, /key: "leads"/);
});

test("mutation: removing explicit consent is detected", () => {
  const mutated = service.replace("if (body.consent !== true)", "if (false)");
  assert.throws(() => assertPublicLeadContract(route, mutated));
});

test("mutation: widening the hourly public limit is detected", () => {
  const mutated = route.replace(", 5, 60 * 60 * 1000)", ", 500, 60 * 60 * 1000)");
  assert.throws(() => assertPublicLeadContract(mutated, service));
});

test("mutation: allowing a lead without phone or LINE is detected", () => {
  const mutated = migration.replace(
    "CHECK (NULLIF(btrim(phone), '') IS NOT NULL OR NULLIF(btrim(line_id), '') IS NOT NULL)",
    "CHECK (TRUE)",
  );
  assert.throws(() => assertMigrationContract(mutated));
});

test("lead validation rejects absent consent, invalid contacts, enums and oversized fields", () => {
  const valid = { consent: true, phone: "0812345678", platform: "windows", locale: "th" };
  for (const consent of [undefined, false, "true", 1]) assert.throws(() => validateRetailLocalLeadSubmission({ ...valid, consent }));
  for (const phone of ["", "123", "081234567890", "abc"]) assert.throws(() => validateRetailLocalLeadSubmission({ ...valid, phone }));
  for (const field of ["shopName", "contactName", "businessType"]) assert.throws(() => validateRetailLocalLeadSubmission({ ...valid, [field]: "x".repeat(121) }));
  assert.throws(() => validateRetailLocalLeadSubmission({ ...valid, platform: "invalid" }));
  assert.throws(() => validateRetailLocalLeadSubmission({ ...valid, locale: "xx" }));
  assert.equal(validateRetailLocalLeadSubmission({ ...valid, phone: "+66 81-234-5678" }).phone, valid.phone);
  assert.equal(validateRetailLocalLeadSubmission({ ...valid, phone: undefined, lineId: "test-shop" }).phone, null);
});

test("lead offer is config-backed and never wraps or controls download links", () => {
  const form = read("apps/web/app/(main)/retail-local/RetailLocalPricing.tsx");
  assert.match(form, /p\.leadOffer/);
  assert.doesNotMatch(form, /consent:\s*true|checked=\{true\}/);
  assert.match(form, /href="\/privacy"/);
  const page = read("apps/web/app/(main)/retail-local/RetailLocalPageClient.tsx");
  assert.match(page, /href=\{directDownload\.url\}/);
  assert.doesNotMatch(page, /consent|leadSubmitted/);
});

test("public handler enforces rate limit, bounded consent validation and a PII-free response", async () => {
  let limited = false; let saved = 0;
  const api = loadWithStubs("apps/web/app/api/public/retail-local/lead/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init: any) => ({ body, ...init }) } },
    "@/lib/log/routeError": { withRouteErrorLog: (_: string, fn: Function) => fn },
    "@/lib/bms/retailLocalRequestBody": requestBody,
    "@/lib/bms/rateLimit": { rateLimit: async (_: string, count: number, window: number) => {
      assert.equal(count, 5); assert.equal(window, 3600000);
      return { ok: !limited, retryAfter: 60 };
    } },
    "@/lib/bms/retailLocalLeads": { RetailLocalLeadError, createRetailLocalLead: async (body: unknown) => { validateRetailLocalLeadSubmission(body); saved++; } },
  });
  const request = (body: unknown) => new Request("https://example.test/api/public/retail-local/lead", { method: "POST", body: JSON.stringify(body) });
  const valid = { consent: true, lineId: "fake-lead", locale: "th", platform: "windows" };
  assert.equal((await api.POST(request({ ...valid, consent: false }))).status, 400);
  assert.equal((await api.POST(request({ ...valid, tenantId: "forged" }))).status, 400);
  assert.equal((await api.POST(request({ ...valid, shopName: "x".repeat(5000) }))).status, 413);
  assert.equal(saved, 0);
  const ok = await api.POST(request(valid));
  assert.equal(ok.status, 201); assert.deepEqual(ok.body, { ok: true });
  limited = true;
  const denied = await api.POST(request(valid));
  assert.equal(denied.status, 429); assert.equal(denied.headers["Retry-After"], "60");
  assert.equal(saved, 1);
});

test("admin adapters reject unauthenticated/non-platform callers and cross-origin writes before services", async () => {
  let auth: any = { ok: false, status: 401 }; let calls = 0;
  const modules = {
    "next/server": { NextResponse: { json: (body: unknown, init: any = {}) => ({ body, status: init.status ?? 200 }) } },
    "@/lib/log/routeError": { withRouteErrorLog: (_: string, fn: Function) => fn },
    "@/lib/bms/adminRouteAuth": { authorizePlatformAdminRoute: async () => auth },
    "@/lib/bms/retailLocalRequestBody": requestBody,
    "@/lib/bms/retailLocalLeads": { RetailLocalLeadError,
      listRetailLocalLeads: async () => { calls++; return []; },
      updateRetailLocalLead: async (input: any) => { calls++; assert.equal(input.adminId, "server-admin"); return { id: input.id }; } },
  };
  const list = loadWithStubs("apps/web/app/api/admin/retail-local/leads/route.ts", modules);
  const update = loadWithStubs("apps/web/app/api/admin/retail-local/leads/[id]/route.ts", modules);
  const request = (origin = "https://example.test") => Object.assign(new Request("https://example.test/api/admin/retail-local/leads", { method: "PATCH", headers: { origin }, body: JSON.stringify({ status: "CONTACTED" }) }), { nextUrl: new URL("https://example.test/api/admin/retail-local/leads") });
  for (const status of [401, 403]) {
    auth = { ok: false, status };
    assert.equal((await list.GET(request())).status, status);
    assert.equal((await update.PATCH(request(), { params: { id: "fake-id" } })).status, status);
  }
  auth = { ok: true, adminId: "server-admin" };
  assert.equal((await update.PATCH(request("https://other.test"), { params: { id: "fake-id" } })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await list.GET(request())).status, 200);
  assert.equal((await update.PATCH(request(), { params: { id: "fake-id" } })).status, 200);
  assert.equal(calls, 2);
});
