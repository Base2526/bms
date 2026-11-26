/** Disposable synthetic clinic_pilot_test only: exercise the real clinic services against bms_app RLS. */
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

function loadModule(file: string, mocks: Record<string, unknown>): Record<string, any> {
  const source = readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `Unexpected import ${name}`);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}

test("clinic record and attachment access follows active role, care team, expiry and tenant", { skip: !enabled }, async () => {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_PORT, "5544");
  assert.equal(process.env.POSTGRES_DB, "clinic_pilot_test");
  const db = new Pool({ host: "127.0.0.1", port: 5544, database: "clinic_pilot_test",
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, max: 3 });
  const tenantA = randomUUID(), tenantB = randomUUID();
  const clinicianA = randomUUID(), clinicianOther = randomUUID(), nurse = randomUUID();
  const cashier = randomUUID(), clinicianB = randomUUID();
  const locationA = randomUUID(), locationB = randomUUID(), patientA = randomUUID();
  const encounterA = randomUUID();
  const seed = await db.connect();
  try {
    await seed.query("BEGIN");
    await seed.query(`INSERT INTO bms_tenants(id) VALUES ($1),($2)`, [tenantA,tenantB]);
    await seed.query(`INSERT INTO users(id,tenant_id,name) VALUES
      ($1,$6,'Clinician A'),($2,$6,'Other Clinician'),($3,$6,'Nurse'),
      ($4,$6,'Cashier'),($5,$7,'Clinician B')`,
      [clinicianA,clinicianOther,nurse,cashier,clinicianB,tenantA,tenantB]);
    await seed.query(`INSERT INTO bms_locations(id,tenant_id,name) VALUES
      ($1,$3,'Clinic A'),($2,$4,'Clinic B')`, [locationA,locationB,tenantA,tenantB]);
    await seed.query(`INSERT INTO bms_clinic_staff(tenant_id,user_id,access_role,licence_no,granted_by)
      VALUES ($1,$2,'CLINICIAN','SYNTHETIC-LICENCE',$2),
             ($1,$3,'CLINICIAN','SYNTHETIC-LICENCE',$2),
             ($1,$4,'NURSE',NULL,$2),($1,$5,'CASHIER',NULL,$2),
             ($6,$7,'CLINICIAN','SYNTHETIC-LICENCE',$7)`,
      [tenantA,clinicianA,clinicianOther,nurse,cashier,tenantB,clinicianB]);
    await seed.query(`INSERT INTO bms_clinic_patients(id,tenant_id,hn,full_name,created_by)
      VALUES ($1,$2,'HN-000001','Synthetic Patient',$3)`, [patientA,tenantA,clinicianA]);
    await seed.query(`INSERT INTO bms_clinic_encounters(id,tenant_id,patient_id,location_id,practitioner_id)
      VALUES ($1,$2,$3,$4,$5)`, [encounterA,tenantA,patientA,locationA,clinicianA]);
    await seed.query(`INSERT INTO bms_clinic_care_team(tenant_id,encounter_id,user_id,assigned_by)
      VALUES ($1,$2,$3,$4)`, [tenantA,encounterA,nurse,clinicianA]);
    await seed.query("COMMIT");
  } finally { seed.release(); }

  const audits: unknown[][] = [];
  const access = loadModule("apps/web/lib/bms/clinic/access.ts", {
    "@/lib/db": { getClient: () => db.connect() },
    "../tenant": { beginTenantTx: async (client: any, tenantId: string) => {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE bms_app");
      await client.query(`SELECT set_config('bms.tenant_id',$1,true)`, [tenantId]);
    } },
    "../audit": { insertAuditInTx: async (_client: unknown, event: unknown) => { audits.push(["write", event]); } },
    "../securityEvents": { insertSecurityEventInTx: async (_client: unknown, event: unknown) => { audits.push(["read", event]); } },
  });
  const attachments = loadModule("apps/web/lib/bms/clinic/attachments.ts", {
    "node:crypto": require("node:crypto"), "./access": access,
  });
  const encounters = loadModule("apps/web/lib/bms/clinic/encounters.ts", {
    "./access": access,
  });
  const oldFlag = process.env.BMS_CLINIC_PILOT_TENANTS;
  process.env.BMS_CLINIC_PILOT_TENANTS = `${tenantA},${tenantB}`;
  try {
    const content = Buffer.from("%PDF-1.4\nsynthetic only\n");
    const attachmentId = await attachments.uploadClinicAttachment({ tenantId: tenantA,
      actorId: clinicianA, encounterId: encounterA, fileName: "synthetic.pdf",
      mimeType: "application/pdf", content });
    const own = await attachments.readClinicAttachment({ tenantId: tenantA,
      actorId: clinicianA, attachmentId });
    assert.equal(own.content.toString(), content.toString());
    assert.equal((await attachments.listClinicAttachments({ tenantId: tenantA,
      actorId: nurse, encounterId: encounterA })).length, 1);
    assert.equal((await attachments.readClinicAttachment({ tenantId: tenantA,
      actorId: nurse, attachmentId })).file_name, "synthetic.pdf");
    await assert.rejects(attachments.listClinicAttachments({ tenantId: tenantA,
      actorId: cashier, encounterId: encounterA }), /ENCOUNTER_ACCESS_DENIED/);
    await assert.rejects(attachments.readClinicAttachment({ tenantId: tenantA,
      actorId: cashier, attachmentId }), /ATTACHMENT_NOT_FOUND/);
    await assert.rejects(attachments.readClinicAttachment({ tenantId: tenantB,
      actorId: clinicianB, attachmentId }), /ATTACHMENT_NOT_FOUND/);
    await assert.rejects(attachments.uploadClinicAttachment({ tenantId: tenantA,
      actorId: clinicianA, encounterId: encounterA, fileName: "fake.pdf",
      mimeType: "application/pdf", content: Buffer.from("not a PDF") }), /INVALID_ATTACHMENT/);

    assert.equal((await encounters.readClinicEncounter({ tenantId: tenantA,
      actorId: nurse, encounterId: encounterA })).id, encounterA);
    await assert.rejects(encounters.readClinicEncounter({ tenantId: tenantA,
      actorId: clinicianOther, encounterId: encounterA }), /PATIENT_CARE_ACCESS_DENIED/);
    await encounters.requestClinicEmergencyAccess({ tenantId: tenantA, actorId: clinicianOther,
      patientId: patientA, reason: "Synthetic emergency access review", confirmation: "CONFIRM EMERGENCY CLINICAL ACCESS" });
    assert.equal((await encounters.readClinicEncounter({ tenantId: tenantA,
      actorId: clinicianOther, encounterId: encounterA })).id, encounterA);
    await assert.rejects(attachments.readClinicAttachment({ tenantId: tenantA,
      actorId: clinicianOther, attachmentId }), /ATTACHMENT_NOT_FOUND/);

    const change = await db.connect();
    try {
      await change.query(`UPDATE bms_clinic_break_glass
        SET granted_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute'
        WHERE tenant_id=$1 AND patient_id=$2 AND clinician_id=$3`,
      [tenantA,patientA,clinicianOther]);
    } finally { change.release(); }
    await assert.rejects(encounters.readClinicEncounter({ tenantId: tenantA,
      actorId: clinicianOther, encounterId: encounterA }), /PATIENT_CARE_ACCESS_DENIED/);
    await encounters.requestClinicEmergencyAccess({ tenantId: tenantA, actorId: clinicianOther,
      patientId: patientA, reason: "Synthetic emergency access after expiry",
      confirmation: "CONFIRM EMERGENCY CLINICAL ACCESS" });
    const revoke = await db.connect();
    try {
      await revoke.query(`UPDATE bms_clinic_staff SET active=false
        WHERE tenant_id=$1 AND user_id IN ($2,$3)`, [tenantA,nurse,clinicianOther]);
    } finally { revoke.release(); }
    await assert.rejects(encounters.readClinicEncounter({ tenantId: tenantA,
      actorId: nurse, encounterId: encounterA }), /PATIENT_CARE_ACCESS_DENIED/);
    await assert.rejects(encounters.readClinicEncounter({ tenantId: tenantA,
      actorId: clinicianOther, encounterId: encounterA }), /PATIENT_CARE_ACCESS_DENIED/);
    await assert.rejects(attachments.readClinicAttachment({ tenantId: tenantA,
      actorId: nurse, attachmentId }), /ATTACHMENT_NOT_FOUND/);
    assert.ok(audits.some(([kind, event]) => kind === "read" &&
      (event as any).meta?.targetKind === "CLINIC_ATTACHMENT"));
    assert.equal(JSON.stringify(audits).includes("synthetic only"), false);
  } finally {
    if (oldFlag === undefined) delete process.env.BMS_CLINIC_PILOT_TENANTS;
    else process.env.BMS_CLINIC_PILOT_TENANTS = oldFlag;
    await db.end();
  }
});
