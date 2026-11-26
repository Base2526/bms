import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("a delayed reschedule retry cannot undo a later move", async () => {
  const appointmentId = "11111111-1111-4111-8111-111111111111";
  const practitionerId = "22222222-2222-4222-8222-222222222222";
  const state = {
    status: "CONFIRMED", practitioner_id: practitionerId, room_code: "A",
    starts_at: new Date("2026-12-01T02:00:00Z"), ends_at: new Date("2026-12-01T03:00:00Z"),
  };
  const commands = new Map<string, string>();
  const client = { query: async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM bms_clinic_appointments") && sql.includes("FOR UPDATE")) return { rows: [{ ...state }] };
    if (sql.includes("FROM bms_clinic_appointment_reschedules")) {
      const hash = commands.get(String(params[1]));
      return { rows: hash ? [{ request_hash: hash }] : [] };
    }
    if (sql.includes("UPDATE bms_clinic_appointments")) {
      state.practitioner_id = String(params[2]); state.room_code = String(params[3]);
      state.starts_at = params[4] as Date; state.ends_at = params[5] as Date;
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("INSERT INTO bms_clinic_appointment_reschedules")) {
      commands.set(String(params[2]), String(params[3]));
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const mocks: Record<string, unknown> = {
    "node:crypto": require("node:crypto"),
    "./access": {
      ClinicError: class ClinicError extends Error { constructor(public code: string, public status = 400) { super(code); } },
      auditClinicRead: async () => undefined, auditClinicWrite: async () => undefined,
      boundedText: (value: string) => value.trim(), isoInstant: (value: string) => new Date(value),
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
  const move = (key: string, hour: number) => module.exports.rescheduleClinicAppointment({
    tenantId: "tenant-a", actorId: "registrar-a", appointmentId, practitionerId,
    roomCode: "A", startsAt: `2026-12-01T${String(hour).padStart(2, "0")}:00:00Z`,
    endsAt: `2026-12-01T${String(hour + 1).padStart(2, "0")}:00:00Z`, requestKey: key,
  });
  assert.equal(await move("move-to-ten", 10), "RESCHEDULED");
  assert.equal(await move("move-to-eleven", 11), "RESCHEDULED");
  assert.equal(await move("move-to-ten", 10), "REPLAYED");
  assert.equal(state.starts_at.toISOString(), "2026-12-01T11:00:00.000Z");
  await assert.rejects(move("move-to-ten", 12), /REQUEST_KEY_CONFLICT/);
});
