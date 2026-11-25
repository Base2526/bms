import type { PoolClient } from "pg";
import {
  ClinicError, auditClinicRead, auditClinicWrite, boundedText, clinicTx,
  requireClinicRole, requireClinician, uuid,
} from "./access";

const NOTE_FIELDS = [
  "chiefComplaint", "history", "allergies", "vitals", "examination",
  "diagnosis", "treatmentPlan", "medicationPlan", "referral",
] as const;
export type ClinicRecord = Partial<Record<typeof NOTE_FIELDS[number], string>>;

export function validateClinicRecord(value: unknown, requireComplete: boolean): ClinicRecord {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new ClinicError("INVALID_CLINICAL_RECORD");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !NOTE_FIELDS.includes(key as typeof NOTE_FIELDS[number])))
    throw new ClinicError("INVALID_CLINICAL_FIELD");
  const result: ClinicRecord = {};
  for (const key of NOTE_FIELDS) {
    if (source[key] != null) result[key] = boundedText(source[key], key === "history" ? 8000 : 4000);
  }
  if (requireComplete && ["chiefComplaint", "examination", "diagnosis", "treatmentPlan"]
    .some((key) => !result[key as keyof ClinicRecord])) throw new ClinicError("CLINICAL_RECORD_INCOMPLETE");
  if (!Object.values(result).some(Boolean)) throw new ClinicError("CLINICAL_RECORD_EMPTY");
  return result;
}

async function requirePatientCareAccess(client: PoolClient, tenantId: string, userId: string, patientId: string): Promise<void> {
  const access = await client.query(
    `SELECT 1 FROM bms_clinic_staff s
      WHERE s.tenant_id=$1 AND s.user_id=$3 AND s.active AND (
        (s.access_role='CLINICIAN' AND (
          EXISTS (SELECT 1 FROM bms_clinic_encounters e
                   WHERE e.tenant_id=$1 AND e.patient_id=$2 AND e.practitioner_id=$3)
          OR EXISTS (SELECT 1 FROM bms_clinic_break_glass g
                      WHERE g.tenant_id=$1 AND g.patient_id=$2 AND g.clinician_id=$3
                        AND g.expires_at > now())
        )) OR (s.access_role='NURSE' AND EXISTS (
          SELECT 1 FROM bms_clinic_encounters e JOIN bms_clinic_care_team ct
            ON ct.tenant_id=e.tenant_id AND ct.encounter_id=e.id
           WHERE e.tenant_id=$1 AND e.patient_id=$2 AND ct.user_id=$3 AND ct.active
        ))
      ) LIMIT 1`,
    [tenantId, patientId, userId]
  );
  if (!access.rowCount) throw new ClinicError("PATIENT_CARE_ACCESS_DENIED", 403);
}

export async function requestClinicEmergencyAccess(input: {
  tenantId: string; actorId: string; patientId: unknown; reason: unknown; confirmation: unknown;
}): Promise<{ id: string; expiresAt: string }> {
  const patientId = uuid(input.patientId);
  const reason = boundedText(input.reason, 500, 20);
  if (input.confirmation !== "CONFIRM EMERGENCY CLINICAL ACCESS")
    throw new ClinicError("CONFIRMATION_REQUIRED");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinician(client, input.tenantId, input.actorId);
    const patient = await client.query(`SELECT 1 FROM bms_clinic_patients WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, patientId]);
    if (!patient.rowCount) throw new ClinicError("PATIENT_NOT_FOUND", 404);
    const row = await client.query<{ id: string; expires_at: Date }>(
      `INSERT INTO bms_clinic_break_glass
        (tenant_id,patient_id,clinician_id,reason,expires_at)
       VALUES ($1,$2,$3,$4,now()+interval '15 minutes') RETURNING id,expires_at`,
      [input.tenantId, patientId, input.actorId, reason]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.emergency_access.granted", row.rows[0].id, "CLINIC_BREAK_GLASS", { patientId });
    return { id: row.rows[0].id, expiresAt: row.rows[0].expires_at.toISOString() };
  });
}

export async function openClinicEncounter(input: {
  tenantId: string; actorId: string; appointmentId: unknown;
}): Promise<{ id: string; status: "CREATED" | "REPLAYED" }> {
  const appointmentId = uuid(input.appointmentId);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinician(client, input.tenantId, input.actorId);
    const appointment = await client.query<{
      patient_id: string; location_id: string; practitioner_id: string; status: string;
    }>(`SELECT patient_id,location_id,practitioner_id,status FROM bms_clinic_appointments
           WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [input.tenantId, appointmentId]);
    const row = appointment.rows[0];
    if (!row) throw new ClinicError("APPOINTMENT_NOT_FOUND", 404);
    if (row.practitioner_id !== input.actorId) throw new ClinicError("CLINICIAN_NOT_ASSIGNED", 403);
    if (row.status !== "CHECKED_IN" && row.status !== "COMPLETED")
      throw new ClinicError("APPOINTMENT_NOT_CHECKED_IN", 409);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM bms_clinic_encounters WHERE tenant_id=$1 AND appointment_id=$2`,
      [input.tenantId, appointmentId]
    );
    if (existing.rows[0]) return { id: existing.rows[0].id, status: "REPLAYED" };
    const created = await client.query<{ id: string }>(
      `INSERT INTO bms_clinic_encounters
         (tenant_id,patient_id,location_id,appointment_id,practitioner_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.tenantId, row.patient_id, row.location_id, appointmentId, input.actorId]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.encounter.open", created.rows[0].id, "CLINIC_ENCOUNTER");
    return { id: created.rows[0].id, status: "CREATED" };
  });
}

export async function saveClinicDraft(input: {
  tenantId: string; actorId: string; encounterId: unknown;
  expectedVersion: unknown; record: unknown;
}): Promise<number> {
  const encounterId = uuid(input.encounterId);
  const record = validateClinicRecord(input.record, false);
  const version = Number(input.expectedVersion);
  if (!Number.isInteger(version) || version < 1) throw new ClinicError("INVALID_VERSION");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinician(client, input.tenantId, input.actorId);
    const changed = await client.query<{ version: number }>(
      `UPDATE bms_clinic_encounters SET draft_record=$4::jsonb,version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND practitioner_id=$3 AND status='OPEN' AND version=$5
        RETURNING version`,
      [input.tenantId, encounterId, input.actorId, JSON.stringify(record), version]
    );
    if (!changed.rows[0]) throw new ClinicError("ENCOUNTER_VERSION_CONFLICT", 409);
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.encounter.draft_saved", encounterId, "CLINIC_ENCOUNTER", { version: changed.rows[0].version });
    return changed.rows[0].version;
  });
}

export async function signClinicEncounter(input: {
  tenantId: string; actorId: string; encounterId: unknown;
  expectedVersion: unknown; confirmation: unknown;
}): Promise<string> {
  const encounterId = uuid(input.encounterId);
  const version = Number(input.expectedVersion);
  if (input.confirmation !== "SIGN CLINICAL RECORD") throw new ClinicError("CONFIRMATION_REQUIRED");
  if (!Number.isInteger(version) || version < 1) throw new ClinicError("INVALID_VERSION");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinician(client, input.tenantId, input.actorId);
    const row = await client.query<{
      practitioner_id: string; status: string; version: number;
      draft_record: unknown; appointment_id: string | null;
    }>(`SELECT practitioner_id,status,version,draft_record,appointment_id
          FROM bms_clinic_encounters WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tenantId, encounterId]);
    const encounter = row.rows[0];
    if (!encounter) throw new ClinicError("ENCOUNTER_NOT_FOUND", 404);
    if (encounter.practitioner_id !== input.actorId) throw new ClinicError("CLINICIAN_NOT_ASSIGNED", 403);
    if (encounter.status !== "OPEN" || encounter.version !== version) throw new ClinicError("ENCOUNTER_VERSION_CONFLICT", 409);
    const record = validateClinicRecord(encounter.draft_record, true);
    const note = await client.query<{ id: string }>(
      `INSERT INTO bms_clinic_signed_notes
         (tenant_id,encounter_id,note_kind,content,signed_by)
       VALUES ($1,$2,'PRIMARY',$3::jsonb,$4) RETURNING id`,
      [input.tenantId, encounterId, JSON.stringify(record), input.actorId]
    );
    await client.query(
      `UPDATE bms_clinic_encounters
         SET status='SIGNED',draft_record='{}'::jsonb,version=version+1,
             signed_by=$3,signed_at=now(),updated_at=now()
       WHERE tenant_id=$1 AND id=$2`, [input.tenantId, encounterId, input.actorId]
    );
    if (encounter.appointment_id) {
      await client.query(
        `UPDATE bms_clinic_appointments SET status='COMPLETED',updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='CHECKED_IN'`,
        [input.tenantId, encounter.appointment_id]
      );
    }
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.encounter.signed", encounterId, "CLINIC_ENCOUNTER", { noteId: note.rows[0].id });
    return note.rows[0].id;
  });
}

export async function addClinicAddendum(input: {
  tenantId: string; actorId: string; encounterId: unknown; parentNoteId: unknown;
  reason: unknown; record: unknown; confirmation: unknown;
}): Promise<string> {
  const encounterId = uuid(input.encounterId);
  const parentNoteId = uuid(input.parentNoteId);
  const reason = boundedText(input.reason, 500, 5);
  const record = validateClinicRecord(input.record, false);
  if (input.confirmation !== "SIGN CLINICAL ADDENDUM") throw new ClinicError("CONFIRMATION_REQUIRED");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinician(client, input.tenantId, input.actorId);
    const encounter = await client.query<{ practitioner_id: string; status: string }>(
      `SELECT practitioner_id,status FROM bms_clinic_encounters WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [input.tenantId, encounterId]
    );
    if (!encounter.rows[0]) throw new ClinicError("ENCOUNTER_NOT_FOUND", 404);
    if (encounter.rows[0].practitioner_id !== input.actorId) throw new ClinicError("CLINICIAN_NOT_ASSIGNED", 403);
    if (encounter.rows[0].status !== "SIGNED") throw new ClinicError("ENCOUNTER_NOT_SIGNED", 409);
    const parent = await client.query(
      `SELECT 1 FROM bms_clinic_signed_notes WHERE tenant_id=$1 AND encounter_id=$2 AND id=$3`,
      [input.tenantId, encounterId, parentNoteId]
    );
    if (!parent.rowCount) throw new ClinicError("NOTE_NOT_FOUND", 404);
    const added = await client.query<{ id: string }>(
      `INSERT INTO bms_clinic_signed_notes
         (tenant_id,encounter_id,note_kind,parent_note_id,amendment_reason,content,signed_by)
       VALUES ($1,$2,'ADDENDUM',$3,$4,$5::jsonb,$6) RETURNING id`,
      [input.tenantId, encounterId, parentNoteId, reason, JSON.stringify(record), input.actorId]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.encounter.addendum_signed", encounterId, "CLINIC_ENCOUNTER", { noteId: added.rows[0].id });
    return added.rows[0].id;
  });
}

export async function assignClinicNurse(input: {
  tenantId: string; actorId: string; encounterId: unknown; nurseUserId: unknown;
  active: unknown; confirmation: unknown;
}): Promise<void> {
  const encounterId = uuid(input.encounterId);
  const nurseUserId = uuid(input.nurseUserId);
  if (typeof input.active !== "boolean") throw new ClinicError("INVALID_ACTIVE");
  if (input.confirmation !== "CONFIRM CARE TEAM ACCESS") throw new ClinicError("CONFIRMATION_REQUIRED");
  await clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinician(client, input.tenantId, input.actorId);
    const encounter = await client.query<{ practitioner_id: string }>(
      `SELECT practitioner_id FROM bms_clinic_encounters WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [input.tenantId, encounterId]
    );
    if (!encounter.rows[0]) throw new ClinicError("ENCOUNTER_NOT_FOUND", 404);
    if (encounter.rows[0].practitioner_id !== input.actorId) throw new ClinicError("CLINICIAN_NOT_ASSIGNED", 403);
    await requireClinicRole(client, input.tenantId, nurseUserId, ["NURSE"]);
    await client.query(
      `INSERT INTO bms_clinic_care_team (tenant_id,encounter_id,user_id,active,assigned_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id,encounter_id,user_id) DO UPDATE
         SET active=EXCLUDED.active,assigned_by=EXCLUDED.assigned_by,assigned_at=now()`,
      [input.tenantId, encounterId, nurseUserId, input.active, input.actorId]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.care_team.access_set", encounterId, "CLINIC_ENCOUNTER", { userId: nurseUserId, active: input.active });
  });
}

export async function readClinicEncounter(input: {
  tenantId: string; actorId: string; encounterId: unknown;
}): Promise<Record<string, unknown>> {
  const encounterId = uuid(input.encounterId);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    const encounter = await client.query<Record<string, unknown>>(
      `SELECT id,patient_id,location_id,appointment_id,practitioner_id,status,
              draft_record,version,signed_by,signed_at,created_at
         FROM bms_clinic_encounters WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, encounterId]
    );
    const row = encounter.rows[0];
    if (!row) throw new ClinicError("ENCOUNTER_NOT_FOUND", 404);
    await requirePatientCareAccess(client, input.tenantId, input.actorId, String(row.patient_id));
    const notes = await client.query(
      `SELECT id,note_kind,parent_note_id,amendment_reason,content,signed_by,signed_at
         FROM bms_clinic_signed_notes WHERE tenant_id=$1 AND encounter_id=$2
        ORDER BY signed_at,id LIMIT 100`, [input.tenantId, encounterId]
    );
    await auditClinicRead(client, input.tenantId, input.actorId, "CLINIC_ENCOUNTER", encounterId, String(row.patient_id));
    return { ...row, notes: notes.rows };
  });
}

export async function listClinicPatientEncounters(input: {
  tenantId: string; actorId: string; patientId: unknown;
}): Promise<Array<Record<string, unknown>>> {
  const patientId = uuid(input.patientId);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requirePatientCareAccess(client, input.tenantId, input.actorId, patientId);
    const rows = await client.query(
      `SELECT id,appointment_id,practitioner_id,status,signed_at,created_at
         FROM bms_clinic_encounters WHERE tenant_id=$1 AND patient_id=$2
        ORDER BY created_at DESC,id DESC LIMIT 100`,
      [input.tenantId, patientId]
    );
    await auditClinicRead(client, input.tenantId, input.actorId, "CLINIC_PATIENT_HISTORY", patientId, patientId);
    return rows.rows;
  });
}
