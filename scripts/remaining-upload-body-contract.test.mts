import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readBoundedBodyBytes, readBoundedFormData } from "../apps/web/lib/bms/webhookBody.ts";
import { loadWithStubs } from "./testing/webhookHarness.mts";
import { publicErrorMessage } from "../apps/web/lib/publicErrorMessage.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("remaining upload routes bound bytes before multipart parsing", () => {
  for (const path of [
    "apps/web/app/api/board-game/bookings/[token]/payment/route.ts",
    "apps/web/app/api/bms/pharmacy/evidence/upload/route.ts",
    "apps/web/app/api/pos/pharmacy-evidence/route.ts",
    "apps/web/app/api/bms/fish-intake/import/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /readBoundedFormData\(req,\s*MAX_REQUEST_BYTES\)/, path);
    assert.doesNotMatch(source, /req\.formData\(\)/, path);
  }
  const pos = read("apps/web/app/api/pos/pharmacy-evidence/route.ts");
  assert.match(pos, /readBoundedBodyBytes\(req, MAX_JSON_BYTES\)/);
  assert.doesNotMatch(pos, /req\.json\(\)/);
  for (const path of ["apps/web/Caddyfile.server", "apps/web/Caddyfile.local"]) {
    const source = read(path);
    for (const route of [
      "/api/board-game/bookings/*/payment", "/api/pos/pharmacy-evidence",
      "/api/bms/pharmacy/evidence/upload", "/api/bms/fish-intake/import",
    ]) assert.ok(source.includes(route), `${path}: ${route}`);
    // Caddy MB is decimal; its outer cap must not reject an app-allowed MiB body.
    assert.match(source, /request_body @boardGameDeposit \{\s*max_size 10MB\s*\}/);
    assert.match(source, /request_body @clinicalAndFishUpload \{\s*max_size 12MB\s*\}/);
  }
});

test("absent or forged Content-Length cannot bypass streaming body limits", async () => {
  for (const declared of [undefined, "1", "not-a-number"]) {
    const headers = new Headers(declared ? { "content-length": declared } : {});
    const source = {
      headers,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(5));
          controller.enqueue(new Uint8Array(5));
          controller.close();
        },
      }),
    };
    assert.deepEqual(await readBoundedBodyBytes(source, 8),
      { ok: false, status: 413, error: "payload too large" });
  }
});

test("bounded multipart still accepts two ordinary files", async () => {
  const form = new FormData();
  form.set("first", new Blob(["a"], { type: "text/plain" }), "a.txt");
  form.set("second", new Blob(["b"], { type: "text/plain" }), "b.txt");
  const request = new Request("http://localhost/upload", { method: "POST", body: form });
  const parsed = await readBoundedFormData(request, 4096);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal((parsed.form.get("first") as File).name, "a.txt");
  assert.equal((parsed.form.get("second") as File).name, "b.txt");
});

test("each upload route returns 413 before storage or business work for chunked oversized input", async () => {
  const unexpected = () => { throw new Error("business work must not run"); };
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: ResponseInit) => Response.json(body, options) } },
    "sharp": unexpected,
    "@/lib/bms/webhookBody": { readBoundedBodyBytes, readBoundedFormData },
    "@/lib/log/routeError": { withRouteErrorLog: (_label: string, handler: unknown) => handler },
    "@/lib/publicErrorMessage": { publicErrorMessage },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/storage": { persistWebFile: unexpected, buildFileUrlById: unexpected },
    "@/lib/bms/boardGameWaitlist": {
      getPublicBoardGameReservationUploadContext: unexpected,
      submitPublicBoardGameReservationDeposit: unexpected,
    },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: true, tenantId: "test-tenant" }) },
    "@/lib/bms/pharmacy/clinicalEvidence": { PHARMACY_EVIDENCE_KINDS: [], addClinicalEvidence: unexpected },
    "@/lib/bms/pos": {
      authenticatePosDevice: async () => ({ tenantId: "test-tenant" }),
      cashierHasPermission: unexpected, verifyCashierPin: unexpected,
    },
    "@/lib/bms/permissions": { requirePermission: unexpected },
    "@/lib/bms/fishIntake": { FishIntakeError: class extends Error {}, saveFishIntake: unexpected, validateFishIntake: unexpected },
    "@/lib/bms/fishImport": { FishImportError: class extends Error {}, listFishImportSheets: unexpected, parseFishImportWorkbook: unexpected },
  };
  const routes = [
    "apps/web/app/api/board-game/bookings/[token]/payment/route.ts",
    "apps/web/app/api/bms/pharmacy/evidence/upload/route.ts",
    "apps/web/app/api/pos/pharmacy-evidence/route.ts",
    "apps/web/app/api/bms/fish-intake/import/route.ts",
  ];
  for (const route of routes) {
    const { POST } = loadWithStubs(route, modules);
    const request = {
      headers: new Headers({ "content-type": "multipart/form-data; boundary=test", "content-length": "1" }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6 * 1024 * 1024));
          controller.enqueue(new Uint8Array(6 * 1024 * 1024));
          controller.close();
        },
      }),
    };
    const result = await POST(request, { params: Promise.resolve({ token: "test-token" }) });
    assert.equal(result.status, 413, route);
  }
});
