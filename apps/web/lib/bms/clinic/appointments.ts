import { createHash } from "node:crypto";
import {
  ClinicError, auditClinicRead, auditClinicWrite, boundedText, clinicTx,
  isoInstant, requireClinicRole, requireClinician, uuid,
} from "./access";

export type ClinicAppointment = {
  id: string; patientId: string; patientHn: string; patientName: string;
  locationId: string; practitionerId: string; roomCode: string;
  startsAt: string; endsAt: string; status: string;
};

function appointmentFromRow(row: Record<string, any>): ClinicAppointment {
  return {
    id: row.id, patientId: row.patient_id, patientHn: row.hn,
    patientName: row.full_name, locationId: row.location_id,
    practitionerId: row.practitioner_id, roomCode: row.room_code,
    startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(),
    status: row.status,
  };
}

export async function createClinicAppointment(input: {
  tenantId: string; actorId: string; patientId: unknown; locationId: unknown;
  practitionerId: unknown; roomCode: unknown; startsAt: unknown; endsAt: unknown;
  requestKey: unknown;
}): Promise<{ status: "CREATED" | "REPLAYED"; appointment: ClinicAppointment }> {
  const patientId = uuid(input.patientId);
  const locationId = uuid(input.locationId);
  const practitionerId = uuid(input.practitionerId);
  const roomCode = boundedText(input.roomCode, 40, 1).toUpperCase();
  const startsAt = isoInstant(input.startsAt);
  const endsAt = isoInstant(input.endsAt);
  const requestKey = boundedText(input.requestKey, 160, 8);
  if (endsAt.getTime() <= startsAt.getTime() || endsAt.getTime() - startsAt.getTime() > 12 * 3600_000)
    throw new ClinicError("INVALID_APPOINTMENT_WINDOW");
  const requestHash = createHash("sha256").update(JSON.stringify([
    patientId, locationId, practitionerId, roomCode, startsAt.toISOString(), endsAt.toISOString(),
  ])).digest("hex");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["REGISTRAR", "CLINICIAN"]);
    await requireClinician(client, input.tenantId, practitionerId);
    const location = await client.query(`SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$2 AND active`,
      [input.tenantId, locationId]);
    if (!location.rowCount) throw new ClinicError("LOCATION_NOT_FOUND", 404);
    const patient = await client.query(`SELECT 1 FROM bms_clinic_patients WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, patientId]);
    if (!patient.rowCount) throw new ClinicError("PATIENT_NOT_FOUND", 404);
    let inserted;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO bms_clinic_appointments
           (tenant_id,location_id,patient_id,practitioner_id,room_code,starts_at,ends_at,
            request_key,request_hash,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_id,request_key) DO NOTHING RETURNING id`,
        [input.tenantId, locationId, patientId, practitionerId, roomCode,
          startsAt, endsAt, requestKey, requestHash, input.actorId]
      );
    } catch (error: any) {
      if (error?.code === "23P01") throw new ClinicError("APPOINTMENT_CONFLICT", 409);
      throw error;
    }
    const row = await client.query<Record<string, any>>(
      `SELECT a.*,p.hn,p.full_name FROM bms_clinic_appointments a
         JOIN bms_clinic_patients p ON p.tenant_id=a.tenant_id AND p.id=a.patient_id
        WHERE a.tenant_id=$1 AND a.request_key=$2`, [input.tenantId, requestKey]
    );
    if (!row.rows[0] || row.rows[0].request_hash !== requestHash) throw new ClinicError("REQUEST_KEY_CONFLICT", 409);
    if (inserted.rows[0]) {
      await auditClinicWrite(client, input.tenantId, input.actorId,
        "clinic.appointment.create", inserted.rows[0].id, "CLINIC_APPOINTMENT");
    }
    return { status: inserted.rows[0] ? "CREATED" : "REPLAYED", appointment: appointmentFromRow(row.rows[0]) };
  });
}

export async function listClinicAppointments(input: {
  tenantId: string; actorId: string; locationId: unknown; from: unknown; to: unknown;
}): Promise<ClinicAppointment[]> {
  const locationId = uuid(input.locationId);
  const from = isoInstant(input.from);
  const to = isoInstant(input.to);
  if (to <= from || to.getTime() - from.getTime() > 31 * 86400_000) throw new ClinicError("INVALID_DATE_RANGE");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["REGISTRAR", "NURSE", "CLINICIAN"]);
    const rows = await client.query<Record<string, any>>(
      `SELECT a.*,p.hn,p.full_name FROM bms_clinic_appointments a
         JOIN bms_clinic_patients p ON p.tenant_id=a.tenant_id AND p.id=a.patient_id
        WHERE a.tenant_id=$1 AND a.location_id=$2 AND a.starts_at >= $3 AND a.starts_at < $4
        ORDER BY a.starts_at,a.id LIMIT 500`,
      [input.tenantId, locationId, from, to]
    );
    await auditClinicRead(client, input.tenantId, input.actorId, "CLINIC_APPOINTMENT_LIST", locationId);
    return rows.rows.map(appointmentFromRow);
  });
}

export async function transitionClinicAppointment(input: {
  tenantId: string; actorId: string; appointmentId: unknown;
  action: "CHECK_IN" | "CANCEL" | "NO_SHOW";
}): Promise<void> {
  const appointmentId = uuid(input.appointmentId);
  const next = { CHECK_IN: "CHECKED_IN", CANCEL: "CANCELLED", NO_SHOW: "NO_SHOW" }[input.action];
  if (!next) throw new ClinicError("INVALID_ACTION");
  await clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["REGISTRAR", "CLINICIAN"]);
    const row = await client.query<{ status: string }>(
      `SELECT status FROM bms_clinic_appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [input.tenantId, appointmentId]
    );
    if (!row.rows[0]) throw new ClinicError("APPOINTMENT_NOT_FOUND", 404);
    if (row.rows[0].status !== "CONFIRMED") throw new ClinicError("INVALID_APPOINTMENT_STATE", 409);
    await client.query(
      `UPDATE bms_clinic_appointments SET status=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, appointmentId, next]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      `clinic.appointment.${input.action.toLowerCase()}`, appointmentId, "CLINIC_APPOINTMENT");
  });
}

export async function rescheduleClinicAppointment(input: {
  tenantId: string; actorId: string; appointmentId: unknown;
  practitionerId: unknown; roomCode: unknown; startsAt: unknown; endsAt: unknown;
  requestKey: unknown;
}): Promise<"RESCHEDULED" | "REPLAYED"> {
  const appointmentId = uuid(input.appointmentId);
  const practitionerId = uuid(input.practitionerId);
  const roomCode = boundedText(input.roomCode, 40, 1).toUpperCase();
  const startsAt = isoInstant(input.startsAt);
  const endsAt = isoInstant(input.endsAt);
  const requestKey = boundedText(input.requestKey, 160, 8);
  if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 12 * 3600_000)
    throw new ClinicError("INVALID_APPOINTMENT_WINDOW");
  const requestHash = createHash("sha256").update(JSON.stringify([
    appointmentId, practitionerId, roomCode, startsAt.toISOString(), endsAt.toISOString(),
  ])).digest("hex");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["REGISTRAR", "CLINICIAN"]);
    await requireClinician(client, input.tenantId, practitionerId);
    const current = await client.query<{
      status: string; practitioner_id: string; room_code: string; starts_at: Date; ends_at: Date;
    }>(`SELECT status,practitioner_id,room_code,starts_at,ends_at
          FROM bms_clinic_appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tenantId, appointmentId]);
    const row = current.rows[0];
    if (!row) throw new ClinicError("APPOINTMENT_NOT_FOUND", 404);
    const prior = await client.query<{ request_hash: string }>(
      `SELECT request_hash FROM bms_clinic_appointment_reschedules
        WHERE tenant_id=$1 AND request_key=$2`, [input.tenantId, requestKey]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new ClinicError("REQUEST_KEY_CONFLICT", 409);
      return "REPLAYED";
    }
    if (row.status !== "CONFIRMED") throw new ClinicError("INVALID_APPOINTMENT_STATE", 409);
    const recordRequest = async () => {
      const inserted = await client.query(
        `INSERT INTO bms_clinic_appointment_reschedules
           (tenant_id,appointment_id,request_key,request_hash,requested_by)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,request_key) DO NOTHING RETURNING request_key`,
        [input.tenantId, appointmentId, requestKey, requestHash, input.actorId]
      );
      if (!inserted.rowCount) throw new ClinicError("REQUEST_KEY_CONFLICT", 409);
    };
    if (row.practitioner_id === practitionerId && row.room_code === roomCode
      && row.starts_at.getTime() === startsAt.getTime() && row.ends_at.getTime() === endsAt.getTime()) {
      await recordRequest();
      return "REPLAYED";
    }
    try {
      await client.query(
        `UPDATE bms_clinic_appointments
            SET practitioner_id=$3,room_code=$4,starts_at=$5,ends_at=$6,updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, appointmentId, practitionerId, roomCode, startsAt, endsAt]
      );
    } catch (error: any) {
      if (error?.code === "23P01") throw new ClinicError("APPOINTMENT_CONFLICT", 409);
      throw error;
    }
    await recordRequest();
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.appointment.rescheduled", appointmentId, "CLINIC_APPOINTMENT");
    return "RESCHEDULED";
  });
}
