/** Disposable synthetic clinic_pilot_test fixture only; checks the real bounded list SQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = require("pg");
const ts = require("typescript") as typeof import("typescript");
const enabled = process.env.BMS_CLINIC_FIXTURE_DB === "1";

test("a 501-appointment month is bounded and marked incomplete under tenant RLS", { skip: !enabled }, async () => {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_PORT, "5544");
  assert.equal(process.env.POSTGRES_DB, "clinic_pilot_test");
  const db = new Pool({ host: "127.0.0.1", port: 5544, database: "clinic_pilot_test",
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  const client = await db.connect();
  const tenantId = randomUUID(), otherTenantId = randomUUID();
  const registrarId = randomUUID(), clinicianId = randomUUID(), locationId = randomUUID(), patientId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO bms_tenants(id) VALUES ($1),($2)`, [tenantId, otherTenantId]);
    await client.query(`INSERT INTO users(id,tenant_id,name) VALUES
      ($1,$3,'Synthetic Registrar'),($2,$3,'Synthetic Clinician')`,
    [registrarId, clinicianId, tenantId]);
    await client.query(`INSERT INTO bms_locations(id,tenant_id,name) VALUES ($1,$2,'Synthetic Clinic')`,
      [locationId, tenantId]);
    await client.query(`INSERT INTO bms_clinic_staff(tenant_id,user_id,access_role,granted_by)
      VALUES ($1,$2,'REGISTRAR',$2)`, [tenantId, registrarId]);
    await client.query(`INSERT INTO bms_clinic_patients(id,tenant_id,hn,full_name,created_by)
      VALUES ($1,$2,'HN-000001','Synthetic Patient',$3)`, [patientId, tenantId, registrarId]);
    await client.query(`INSERT INTO bms_clinic_appointments
      (tenant_id,location_id,patient_id,practitioner_id,room_code,starts_at,ends_at,
       request_key,request_hash,created_by)
      SELECT $1,$2,$3,$4,'ROOM-A',
        '2026-12-01T00:00:00Z'::timestamptz + (n * interval '10 minutes'),
        '2026-12-01T00:10:00Z'::timestamptz + (n * interval '10 minutes'),
        'calendar-' || n::text,repeat('a',64),$5
      FROM generate_series(0,500) AS n`, [tenantId, locationId, patientId, clinicianId, registrarId]);
    await client.query("SET LOCAL ROLE bms_app");
    await client.query(`SELECT set_config('bms.tenant_id',$1,true)`, [tenantId]);

    const mocks: Record<string, unknown> = {
      "node:crypto": require("node:crypto"),
      "./access": {
        ClinicError: class ClinicError extends Error { constructor(public code: string) { super(code); } },
        auditClinicRead: async () => undefined, auditClinicWrite: async () => undefined,
        boundedText: (value: string) => value, isoInstant: (value: string) => new Date(value),
        uuid: (value: string) => value,
        clinicTx: async (_tenantId: string, _actorId: string, fn: (dbClient: unknown) => Promise<unknown>) => fn(client),
        requireClinicRole: async (_dbClient: unknown, scopeTenantId: string, actorId: string) => {
          const role = await client.query(`SELECT 1 FROM bms_clinic_staff
            WHERE tenant_id=$1 AND user_id=$2 AND access_role='REGISTRAR' AND active`,
          [scopeTenantId, actorId]);
          if (!role.rowCount) throw new Error("CLINIC_ACCESS_DENIED");
        },
        requireClinician: async () => undefined,
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
    const result = await module.exports.listClinicAppointments({ tenantId, actorId: registrarId, locationId,
      from: "2026-12-01T00:00:00Z", to: "2027-01-01T00:00:00Z" });
    assert.equal(result.appointments.length, 500);
    assert.equal(result.truncated, true);
    assert.equal(result.appointments[0].patientName, "Synthetic Patient");
    await client.query(`SELECT set_config('bms.tenant_id',$1,true)`, [otherTenantId]);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM bms_clinic_appointments`)).rows[0].n, 0);
    await assert.rejects(module.exports.listClinicAppointments({ tenantId: otherTenantId, actorId: registrarId,
      locationId, from: "2026-12-01T00:00:00Z", to: "2027-01-01T00:00:00Z" }),
    /CLINIC_ACCESS_DENIED/);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await db.end();
  }
});
