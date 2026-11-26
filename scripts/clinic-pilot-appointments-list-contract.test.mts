import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("a crowded clinic calendar reports that its bounded result is incomplete", async () => {
  const calls: unknown[][] = [];
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: `appointment-${index}`, patient_id: `patient-${index}`,
    hn: `HN-${index}`, full_name: `Synthetic Patient ${index}`,
    location_id: "location-a", practitioner_id: "clinician-a", room_code: "A",
    starts_at: new Date("2026-12-01T02:00:00Z"), ends_at: new Date("2026-12-01T03:00:00Z"),
    status: "CONFIRMED",
  }));
  const client = { query: async (sql: string, params: unknown[]) => {
    calls.push([sql, params]);
    return { rows, rowCount: rows.length };
  } };
  const mocks: Record<string, unknown> = {
    "node:crypto": require("node:crypto"),
    "./access": {
      ClinicError: class ClinicError extends Error {},
      auditClinicRead: async () => undefined, auditClinicWrite: async () => undefined,
      boundedText: (value: string) => value, isoInstant: (value: string) => new Date(value),
      uuid: (value: string) => value,
      clinicTx: async (_tenantId: string, _actorId: string, fn: (db: unknown) => Promise<unknown>) => fn(client),
      requireClinicRole: async () => undefined, requireClinician: async () => undefined,
    },
  };
  const source = readFileSync(path.join(root, "apps/web/lib/bms/clinic/appointments.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `Unexpected import ${name}`);
    return mocks[name];
  }, module, module.exports);

  const result = await module.exports.listClinicAppointments({ tenantId: "tenant-a", actorId: "registrar-a",
    locationId: "location-a", from: "2026-12-01T00:00:00Z", to: "2026-12-31T00:00:00Z" });
  assert.equal(result.appointments.length, 500);
  assert.equal(result.truncated, true);
  assert.match(String(calls[0][0]), /LIMIT 501/);
  assert.deepEqual(calls[0][1], ["tenant-a", "location-a", new Date("2026-12-01T00:00:00Z"),
    new Date("2026-12-31T00:00:00Z")]);
});
