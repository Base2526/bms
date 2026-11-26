import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("clinic REST denies unauthorised requests and derives tenant and actor from the session", async () => {
  const calls: unknown[][] = [];
  let permissionGranted = false;
  let clinicPermission = true;
  class ClinicError extends Error {
    constructor(public code: string, public status = 400) { super(code); }
  }
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number; headers?: unknown }) =>
      Response.json(body, { status: options?.status ?? 200, headers: options?.headers as HeadersInit }) } },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async (permission: string | null) => {
      calls.push(["auth", permission]);
      return permissionGranted ? { ok: true, tenantId: "server-tenant", adminId: "server-actor",
        admin: { role: "Administrator" }, ctx: { scope: "admin" } } : { ok: false, status: 403 };
    } },
    "@/lib/bms/permissions": { myPermissions: async () => {
      calls.push(["permissions"]);
      return clinicPermission ? ["clinic.billing.manage"] : ["order.view"];
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    "@/lib/bms/clinic/access": {
      ClinicError,
      clinicBootstrap: async (...args: unknown[]) => { calls.push(["bootstrap", ...args]); return { roles: [] }; },
      grantClinicStaff: async (...args: unknown[]) => { calls.push(["grant", ...args]); },
      listClinicAccessEvents: async () => [],
    },
    "@/lib/bms/clinic/patients": {
      addVerifiedClinicContact: async () => null, listClinicContacts: async () => [],
      readClinicPatient: async () => null, registerClinicPatient: async () => null,
      searchClinicPatients: async () => [],
    },
    "@/lib/bms/clinic/appointments": {
      createClinicAppointment: async (input: unknown) => { calls.push(["appointment", input]); return { status: "CREATED" }; },
      listClinicAppointments: async () => [], rescheduleClinicAppointment: async (input: unknown) => {
        calls.push(["reschedule", input]); return "RESCHEDULED";
      },
      transitionClinicAppointment: async () => null,
    },
    "@/lib/bms/clinic/encounters": {
      addClinicAddendum: async () => null, assignClinicNurse: async () => null,
      listClinicPatientEncounters: async () => [], openClinicEncounter: async () => null,
      readClinicEncounter: async () => { throw new ClinicError("PATIENT_CARE_ACCESS_DENIED", 403); },
      requestClinicEmergencyAccess: async () => null, saveClinicDraft: async () => null,
      signClinicEncounter: async () => null,
    },
    "@/lib/bms/clinic/billing": {
      createClinicChargeOrder: async () => null, readClinicChargeSheet: async () => null,
      reviewClinicChargeSheet: async () => null, saveClinicChargeSheet: async () => null,
      listBillableClinicEncounters: async (input: unknown) => {
        calls.push(["billable", input]); return { encounters: [], truncated: false };
      },
    },
    "@/lib/bms/clinic/attachments": { listClinicAttachments: async () => [] },
  };
  const source = readFileSync(path.join(root, "apps/web/app/api/bms/clinic/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `unexpected clinic route import ${name}`);
    return mocks[name];
  }, module, module.exports);
  const get = module.exports.GET as (request: { nextUrl: URL }) => Promise<Response>;
  const post = module.exports.POST as (request: Request) => Promise<Response>;
  const makePost = (body: unknown) => new Request("https://bms.example.invalid/api/bms/clinic", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

  let response = await get({ nextUrl: new URL("https://bms.example.invalid/api/bms/clinic?action=bootstrap") });
  assert.equal(response.status, 403);
  assert.deepEqual(calls, [["auth", null]]);
  calls.length = 0;
  response = await post(makePost({ action: "createAppointment", tenantId: "forged" }));
  assert.equal(response.status, 403);
  assert.deepEqual(calls, [["auth", "clinic.appointment.manage"]]);
  calls.length = 0;

  permissionGranted = true;
  clinicPermission = false;
  response = await get({ nextUrl: new URL("https://bms.example.invalid/api/bms/clinic?action=bootstrap") });
  assert.equal(response.status, 403);
  assert.deepEqual(calls, [["auth", null], ["permissions"]]);
  calls.length = 0;
  clinicPermission = true;
  response = await get({ nextUrl: new URL("https://bms.example.invalid/api/bms/clinic?action=bootstrap") });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["auth", null], ["permissions"],
    ["bootstrap", "server-tenant", "server-actor", true]]);
  calls.length = 0;
  response = await get({ nextUrl: new URL("https://bms.example.invalid/api/bms/clinic?action=billableEncounters&search=HN-000001&tenantId=forged") });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["auth", "clinic.billing.manage"],
    ["billable", { tenantId: "server-tenant", actorId: "server-actor", search: "HN-000001" }]]);
  calls.length = 0;
  response = await post(makePost({ action: "createAppointment", tenantId: "forged", actorId: "forged",
    patientId: "patient", locationId: "location", practitionerId: "practitioner",
    roomCode: "A", startsAt: "2026-12-01T02:00:00Z", endsAt: "2026-12-01T03:00:00Z",
    requestKey: "stable-key" }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], ["auth", "clinic.appointment.manage"]);
  assert.equal(calls[1]?.[0], "appointment");
  assert.deepEqual(calls[1]?.[1], {
    tenantId: "server-tenant", actorId: "server-actor", patientId: "patient", locationId: "location",
    practitionerId: "practitioner", roomCode: "A", startsAt: "2026-12-01T02:00:00Z",
    endsAt: "2026-12-01T03:00:00Z", requestKey: "stable-key",
  });
  calls.length = 0;
  response = await post(makePost({ action: "rescheduleAppointment", tenantId: "forged",
    appointmentId: "appointment", practitionerId: "practitioner", roomCode: "A",
    startsAt: "2026-12-01T03:00:00Z", endsAt: "2026-12-01T04:00:00Z",
    requestKey: "stable-reschedule-key" }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["auth", "clinic.appointment.manage"], ["reschedule", {
    tenantId: "server-tenant", actorId: "server-actor", appointmentId: "appointment",
    practitionerId: "practitioner", roomCode: "A", startsAt: "2026-12-01T03:00:00Z",
    endsAt: "2026-12-01T04:00:00Z", requestKey: "stable-reschedule-key",
  }]]);
  calls.length = 0;
  response = await get({ nextUrl: new URL("https://bms.example.invalid/api/bms/clinic?action=encounter&encounterId=synthetic") });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { status: "PATIENT_CARE_ACCESS_DENIED" });
  assert.deepEqual(calls, [["auth", "clinic.record.read"]]);
  calls.length = 0;
  response = await post(makePost({ action: "unknown" }));
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
  response = await post(new Request("https://bms.example.invalid/api/bms/clinic", {
    method: "POST", body: "x".repeat(32_769),
  }));
  assert.equal(response.status, 413);
  assert.deepEqual(calls, []);
});
