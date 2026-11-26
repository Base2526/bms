/** Run only against the disposable synthetic clinic_pilot_test fixture after applying 10.141/10.142. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = require("pg");
const enabled = process.env.BMS_CLINIC_FIXTURE_DB === "1";

function pool() {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_PORT, "5544");
  assert.equal(process.env.POSTGRES_DB, "clinic_pilot_test");
  return new Pool({ host: "127.0.0.1", port: 5544, database: "clinic_pilot_test",
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, max: 3 });
}

test("clinic migration: tenant isolation, overlap, immutable note and role grants", { skip: !enabled }, async () => {
  const db = pool();
  const client = await db.connect();
  const a = randomUUID(), b = randomUUID();
  const clinicianA = randomUUID(), clinicianB = randomUUID();
  const roomA = randomUUID(), roomB = randomUUID();
  const patientA = randomUUID(), patientA2 = randomUUID(), patientB = randomUUID();
  try {
    await client.query("BEGIN");
    const tables = ["bms_clinic_patients", "bms_clinic_appointments", "bms_clinic_appointment_reschedules", "bms_clinic_encounters",
      "bms_clinic_signed_notes", "bms_clinic_attachments", "bms_clinic_charge_sheets"];
    for (const name of tables) {
      const policy = await client.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass`, [name]);
      assert.deepEqual(policy.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
      const grant = await client.query(`SELECT has_table_privilege('bms_app',$1,'SELECT') AS read,
        has_table_privilege('bms_app',$1,'INSERT') AS insert`, [name]);
      assert.deepEqual(grant.rows[0], { read: true, insert: true });
    }
    const noteGrants = await client.query(`SELECT has_table_privilege('bms_app','bms_clinic_signed_notes','UPDATE') AS update,
      has_table_privilege('bms_app','bms_clinic_signed_notes','DELETE') AS delete`);
    assert.deepEqual(noteGrants.rows[0], { update: false, delete: false });
    await client.query(`INSERT INTO bms_tenants(id) VALUES ($1),($2)`, [a,b]);
    await client.query(`INSERT INTO users(id,tenant_id,name) VALUES ($1,$2,'A'),($3,$4,'B')`,
      [clinicianA,a,clinicianB,b]);
    await client.query(`INSERT INTO bms_locations(id,tenant_id,name) VALUES ($1,$2,'A'),($3,$4,'B')`,
      [roomA,a,roomB,b]);
    await client.query(`INSERT INTO bms_clinic_patients(id,tenant_id,hn,full_name,created_by)
      VALUES ($1,$2,'HN-000001','Same Name',$3),($4,$2,'HN-000002','Same Name',$3),
             ($5,$6,'HN-000001','Same Name',$7)`,
      [patientA,a,clinicianA,patientA2,patientB,b,clinicianB]);
    await client.query("SAVEPOINT rls_test");
    await client.query("SET LOCAL ROLE bms_app");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM bms_clinic_patients`)).rows[0].n, 0);
    await client.query(`SELECT set_config('bms.tenant_id',$1,true)`, [a]);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM bms_clinic_patients`)).rows[0].n, 2);
    await client.query(`SELECT set_config('bms.tenant_id',$1,true)`, [b]);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM bms_clinic_patients`)).rows[0].n, 1);
    await client.query("ROLLBACK TO SAVEPOINT rls_test");
    await client.query("SAVEPOINT tenant_fk_test");
    await assert.rejects(client.query(`INSERT INTO bms_clinic_patient_contacts
      (tenant_id,patient_id,full_name,relationship,verified_by)
      VALUES ($1,$2,'Synthetic Parent','PARENT',$3)`, [a,patientB,clinicianA]),
      (error: any) => error.code === "23503");
    await client.query("ROLLBACK TO SAVEPOINT tenant_fk_test");
    const insertAppointment = async (patientId: string, key: string, start: string, end: string) => client.query(
      `INSERT INTO bms_clinic_appointments
       (tenant_id,location_id,patient_id,practitioner_id,room_code,starts_at,ends_at,request_key,request_hash,created_by)
       VALUES ($1,$2,$3,$4,'A',$5,$6,$7,$8,$4) RETURNING id`,
      [a,roomA,patientId,clinicianA,start,end,key,"a".repeat(64)]
    );
    const first = await insertAppointment(patientA, "clinic-first", "2026-12-01T09:00:00+07:00", "2026-12-01T10:00:00+07:00");
    await client.query(`INSERT INTO bms_clinic_appointment_reschedules
      (tenant_id,appointment_id,request_key,request_hash,requested_by)
      VALUES ($1,$2,'move-once',$3,$4)`, [a,first.rows[0].id,"a".repeat(64),clinicianA]);
    await client.query("SAVEPOINT reschedule_rls_test");
    await client.query("SET LOCAL ROLE bms_app");
    await client.query(`SELECT set_config('bms.tenant_id',$1,true)`, [b]);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM bms_clinic_appointment_reschedules`)).rows[0].n, 0);
    await client.query(`SELECT set_config('bms.tenant_id',$1,true)`, [a]);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM bms_clinic_appointment_reschedules`)).rows[0].n, 1);
    await client.query(`INSERT INTO bms_clinic_appointment_reschedules
      (tenant_id,appointment_id,request_key,request_hash,requested_by)
      VALUES ($1,$2,'role-insert',$3,$4)`, [a,first.rows[0].id,"c".repeat(64),clinicianA]);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM bms_clinic_appointment_reschedules`)).rows[0].n, 2);
    const commandGrant = await client.query(`SELECT
      has_table_privilege('bms_app','bms_clinic_appointment_reschedules','UPDATE') AS update,
      has_table_privilege('bms_app','bms_clinic_appointment_reschedules','DELETE') AS delete`);
    assert.deepEqual(commandGrant.rows[0], { update: false, delete: false });
    await client.query("ROLLBACK TO SAVEPOINT reschedule_rls_test");
    await client.query("SAVEPOINT reschedule_fk_test");
    await assert.rejects(client.query(`INSERT INTO bms_clinic_appointment_reschedules
      (tenant_id,appointment_id,request_key,request_hash,requested_by)
      VALUES ($1,$2,'cross-tenant',$3,$4)`, [b,first.rows[0].id,"b".repeat(64),clinicianB]),
      (error: any) => error.code === "23503");
    await client.query("ROLLBACK TO SAVEPOINT reschedule_fk_test");
    await client.query("SAVEPOINT reschedule_key_test");
    await assert.rejects(client.query(`INSERT INTO bms_clinic_appointment_reschedules
      (tenant_id,appointment_id,request_key,request_hash,requested_by)
      VALUES ($1,$2,'move-once',$3,$4)`, [a,first.rows[0].id,"b".repeat(64),clinicianA]),
      (error: any) => error.code === "23505");
    await client.query("ROLLBACK TO SAVEPOINT reschedule_key_test");
    await client.query("SAVEPOINT overlap_test");
    await assert.rejects(insertAppointment(patientA2, "clinic-second", "2026-12-01T09:30:00+07:00", "2026-12-01T10:30:00+07:00"),
      (error: any) => error.code === "23P01");
    await client.query("ROLLBACK TO SAVEPOINT overlap_test");
    await client.query(`UPDATE bms_clinic_appointments SET status='CANCELLED' WHERE id=$1`, [first.rows[0].id]);
    await insertAppointment(patientA2, "clinic-second", "2026-12-01T09:30:00+07:00", "2026-12-01T10:30:00+07:00");
    const encounter = await client.query(`INSERT INTO bms_clinic_encounters
      (tenant_id,patient_id,location_id,practitioner_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [a,patientA,roomA,clinicianA]);
    const note = await client.query(`INSERT INTO bms_clinic_signed_notes
      (tenant_id,encounter_id,note_kind,content,signed_by)
      VALUES ($1,$2,'PRIMARY','{"diagnosis":"synthetic"}'::jsonb,$3) RETURNING id`,
      [a,encounter.rows[0].id,clinicianA]);
    await client.query("SAVEPOINT immutable_test");
    await assert.rejects(client.query(`UPDATE bms_clinic_signed_notes SET content='{}' WHERE id=$1`, [note.rows[0].id]),
      /immutable/i);
    await client.query("ROLLBACK TO SAVEPOINT immutable_test");
    await client.query(`UPDATE bms_clinic_encounters
      SET status='SIGNED',signed_by=$2,signed_at=now(),version=version+1 WHERE id=$1`,
      [encounter.rows[0].id,clinicianA]);
    await client.query("SAVEPOINT signed_encounter_test");
    await assert.rejects(client.query(`UPDATE bms_clinic_encounters
      SET draft_record='{"diagnosis":"overwritten"}'::jsonb WHERE id=$1`, [encounter.rows[0].id]),
      /immutable/i);
    await client.query("ROLLBACK TO SAVEPOINT signed_encounter_test");
    await client.query(`INSERT INTO bms_products(tenant_id,sku,vat_category,price)
      VALUES ($1,'SYNTHETIC-SERVICE','N',100)`, [a]);
    await client.query(`INSERT INTO bms_product_variants(tenant_id,product_sku,code)
      VALUES ($1,'SYNTHETIC-SERVICE','STD')`, [a]);
    const sheet = await client.query(`INSERT INTO bms_clinic_charge_sheets(tenant_id,encounter_id)
      VALUES ($1,$2) RETURNING id`, [a,encounter.rows[0].id]);
    await client.query(`INSERT INTO bms_clinic_charge_lines
      (tenant_id,sheet_id,line_no,product_sku,size,qty,reviewed_unit_price,reviewed_vat_category)
      VALUES ($1,$2,1,'SYNTHETIC-SERVICE','STD',1,100,'N')`, [a,sheet.rows[0].id]);
    await client.query(`UPDATE bms_clinic_charge_sheets
      SET status='READY',reviewed_by=$2,reviewed_at=now() WHERE id=$1`, [sheet.rows[0].id,clinicianA]);
    await client.query("SAVEPOINT reviewed_line_test");
    await assert.rejects(client.query(`UPDATE bms_clinic_charge_lines
      SET qty=2 WHERE sheet_id=$1`, [sheet.rows[0].id]), /immutable/i);
    await client.query("ROLLBACK TO SAVEPOINT reviewed_line_test");
    await client.query("ROLLBACK");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release(); await db.end();
  }
});

test("concurrent booking of one room commits at most once", { skip: !enabled }, async () => {
  const db = pool();
  const setup = await db.connect();
  const tenantId = randomUUID(), clinicianA = randomUUID(), clinicianB = randomUUID();
  const locationId = randomUUID(), patientId = randomUUID();
  try {
    await setup.query("BEGIN");
    await setup.query(`INSERT INTO bms_tenants(id) VALUES ($1)`, [tenantId]);
    await setup.query(`INSERT INTO users(id,tenant_id,name) VALUES ($1,$3,'A'),($2,$3,'B')`,
      [clinicianA,clinicianB,tenantId]);
    await setup.query(`INSERT INTO bms_locations(id,tenant_id,name) VALUES ($1,$2,'Synthetic')`,
      [locationId,tenantId]);
    await setup.query(`INSERT INTO bms_clinic_patients(id,tenant_id,hn,full_name,created_by)
      VALUES ($1,$2,'HN-000001','Synthetic Patient',$3)`, [patientId,tenantId,clinicianA]);
    await setup.query("COMMIT");
  } finally { setup.release(); }
  const first = await db.connect(), second = await db.connect();
  const book = (client: any, clinicianId: string, key: string) => client.query(
    `INSERT INTO bms_clinic_appointments
      (tenant_id,location_id,patient_id,practitioner_id,room_code,starts_at,ends_at,
       request_key,request_hash,created_by)
     VALUES ($1,$2,$3,$4,'ROOM-1','2026-12-02T09:00:00+07:00',
       '2026-12-02T10:00:00+07:00',$5,$6,$4)`,
    [tenantId,locationId,patientId,clinicianId,key,"a".repeat(64)]
  );
  try {
    await first.query("BEGIN");
    await first.query("SET LOCAL ROLE bms_app");
    await first.query(`SELECT set_config('bms.tenant_id',$1,true)`, [tenantId]);
    await book(first, clinicianA, "concurrent-a");
    await second.query("BEGIN");
    await second.query("SET LOCAL ROLE bms_app");
    await second.query(`SELECT set_config('bms.tenant_id',$1,true)`, [tenantId]);
    let settled = false;
    const competing = book(second, clinicianB, "concurrent-b");
    competing.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(settled, false, "the competing insert should wait on the first transaction");
    await first.query("COMMIT");
    await assert.rejects(competing, (error: any) => error.code === "23P01");
    await second.query("ROLLBACK");
    const count = await first.query(`SELECT count(*)::int AS n FROM bms_clinic_appointments
      WHERE tenant_id=$1 AND room_code='ROOM-1'`, [tenantId]);
    assert.equal(count.rows[0].n, 1);
  } finally {
    await first.query("ROLLBACK").catch(() => undefined);
    await second.query("ROLLBACK").catch(() => undefined);
    first.release(); second.release(); await db.end();
  }
});
