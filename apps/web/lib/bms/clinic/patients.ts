import {
  ClinicError, auditClinicRead, auditClinicWrite, boundedText, clinicTx,
  isoDate, requireClinicRole, uuid,
} from "./access";

export type ClinicPatientSummary = { id: string; hn: string; fullName: string };
export type ClinicPatient = ClinicPatientSummary & {
  dob: string | null; sex: string; phone: string | null; createdAt: string;
};

export async function registerClinicPatient(input: {
  tenantId: string; actorId: string; fullName: unknown;
  dob?: unknown; sex?: unknown; phone?: unknown;
}): Promise<ClinicPatient> {
  const fullName = boundedText(input.fullName, 200, 2);
  const dob = isoDate(input.dob);
  const sex = input.sex ?? "UNKNOWN";
  if (!["FEMALE", "MALE", "OTHER", "UNKNOWN"].includes(String(sex))) throw new ClinicError("INVALID_SEX");
  const phone = input.phone == null || input.phone === "" ? null : boundedText(input.phone, 40);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["REGISTRAR", "CLINICIAN"]);
    const counter = await client.query<{ allocated: string }>(
      `INSERT INTO bms_clinic_hn_counters (tenant_id,next_no) VALUES ($1,2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_no=bms_clinic_hn_counters.next_no+1
       RETURNING (next_no-1)::text AS allocated`, [input.tenantId]
    );
    const hn = `HN-${counter.rows[0].allocated.padStart(6, "0")}`;
    const row = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO bms_clinic_patients
         (tenant_id,hn,full_name,dob,sex,phone,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at`,
      [input.tenantId, hn, fullName, dob, sex, phone, input.actorId]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.patient.register", row.rows[0].id, "CLINIC_PATIENT");
    return { id: row.rows[0].id, hn, fullName, dob, sex: String(sex), phone,
      createdAt: row.rows[0].created_at.toISOString() };
  });
}

export async function searchClinicPatients(input: {
  tenantId: string; actorId: string; search: unknown;
}): Promise<ClinicPatientSummary[]> {
  const search = boundedText(input.search, 100, 2);
  const escaped = search.replace(/[\\%_]/g, "\\$&");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId,
      ["REGISTRAR", "NURSE", "CLINICIAN", "CASHIER"]);
    const rows = await client.query<{ id: string; hn: string; full_name: string }>(
      `SELECT id,hn,full_name FROM bms_clinic_patients
        WHERE tenant_id=$1 AND (hn ILIKE $2 OR lower(full_name) LIKE lower($3) ESCAPE '\\')
        ORDER BY hn DESC LIMIT 30`,
      [input.tenantId, `${escaped}%`, `%${escaped}%`]
    );
    await auditClinicRead(client, input.tenantId, input.actorId, "CLINIC_PATIENT_SEARCH", "search");
    return rows.rows.map((row) => ({ id: row.id, hn: row.hn, fullName: row.full_name }));
  });
}

export async function readClinicPatient(input: {
  tenantId: string; actorId: string; patientId: unknown;
}): Promise<ClinicPatient> {
  const patientId = uuid(input.patientId);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["REGISTRAR", "NURSE", "CLINICIAN"]);
    const rows = await client.query<{
      id: string; hn: string; full_name: string; dob: string | null; sex: string;
      phone: string | null; created_at: Date;
    }>(
      `SELECT id,hn,full_name,dob::text AS dob,sex,phone,created_at
         FROM bms_clinic_patients WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, patientId]
    );
    if (!rows.rows[0]) throw new ClinicError("PATIENT_NOT_FOUND", 404);
    await auditClinicRead(client, input.tenantId, input.actorId, "CLINIC_PATIENT", patientId);
    const row = rows.rows[0];
    return { id: row.id, hn: row.hn, fullName: row.full_name,
      dob: row.dob, sex: row.sex, phone: row.phone, createdAt: row.created_at.toISOString() };
  });
}

export async function addVerifiedClinicContact(input: {
  tenantId: string; actorId: string; patientId: unknown; fullName: unknown;
  relationship: unknown; phone?: unknown; confirmation: unknown;
}): Promise<string> {
  const patientId = uuid(input.patientId);
  const fullName = boundedText(input.fullName, 200, 2);
  const relationship = input.relationship;
  if (!["PARENT", "GUARDIAN", "OTHER"].includes(String(relationship))) throw new ClinicError("INVALID_RELATIONSHIP");
  if (input.confirmation !== "CONFIRM VERIFIED CONTACT") throw new ClinicError("CONFIRMATION_REQUIRED");
  const phone = input.phone == null || input.phone === "" ? null : boundedText(input.phone, 40);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["REGISTRAR", "CLINICIAN"]);
    const patient = await client.query(`SELECT 1 FROM bms_clinic_patients WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, patientId]);
    if (!patient.rowCount) throw new ClinicError("PATIENT_NOT_FOUND", 404);
    const result = await client.query<{ id: string }>(
      `INSERT INTO bms_clinic_patient_contacts
         (tenant_id,patient_id,full_name,relationship,phone,verified_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.tenantId, patientId, fullName, relationship, phone, input.actorId]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.patient.contact_verified", result.rows[0].id, "CLINIC_PATIENT_CONTACT", { patientId });
    return result.rows[0].id;
  });
}

export async function listClinicContacts(input: {
  tenantId: string; actorId: string; patientId: unknown;
}) {
  const patientId = uuid(input.patientId);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["REGISTRAR", "CLINICIAN"]);
    const rows = await client.query(
      `SELECT id,full_name,relationship,phone,verified_at FROM bms_clinic_patient_contacts
        WHERE tenant_id=$1 AND patient_id=$2 ORDER BY verified_at,id LIMIT 100`,
      [input.tenantId, patientId]
    );
    await auditClinicRead(client, input.tenantId, input.actorId,
      "CLINIC_PATIENT_CONTACTS", patientId, patientId);
    return rows.rows;
  });
}
