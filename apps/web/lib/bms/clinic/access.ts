import { getClient } from "@/lib/db";
import type { PoolClient } from "pg";
import { beginTenantTx } from "../tenant";
import { insertAuditInTx } from "../audit";
import { insertSecurityEventInTx } from "../securityEvents";

export type ClinicRole = "REGISTRAR" | "NURSE" | "CLINICIAN" | "CASHIER";
export const CLINIC_ROLES: ClinicRole[] = ["REGISTRAR", "NURSE", "CLINICIAN", "CASHIER"];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ClinicError extends Error {
  constructor(public code: string, public status: number = 400) { super(code); }
}

/** No tenant is enabled by migration, archetype, or an administrator's role. */
export function assertClinicPilotEnabled(tenantId: string): void {
  const allowlist = process.env.BMS_CLINIC_PILOT_TENANTS ?? "";
  if (!allowlist.split(",").some((entry) => entry.trim().toLowerCase() === tenantId.toLowerCase())) {
    throw new ClinicError("CLINIC_PILOT_DISABLED", 404);
  }
}

export function boundedText(value: unknown, max: number, min = 0): string {
  if (typeof value !== "string") throw new ClinicError("INVALID_TEXT");
  const text = value.trim();
  if (text.length < min || text.length > max) throw new ClinicError("INVALID_TEXT");
  return text;
}

export function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new ClinicError("INVALID_ID");
  return value;
}

export function isoInstant(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new ClinicError("INVALID_TIME");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ClinicError("INVALID_TIME");
  return date;
}

export function isoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ClinicError("INVALID_DATE");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ClinicError("INVALID_DATE");
  return value;
}

export async function clinicTx<T>(tenantId: string, actorId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  assertClinicPilotEnabled(tenantId);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const branches = await client.query<{ id: string }>(
      `SELECT id FROM bms_locations WHERE tenant_id=$1 AND active ORDER BY id LIMIT 2`, [tenantId]
    );
    if (branches.rows.length !== 1) throw new ClinicError("CLINIC_SINGLE_BRANCH_REQUIRED", 409);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** RBAC is checked by the adapter; this additional gate also constrains Administrator. */
export async function requireClinicRole(client: PoolClient, tenantId: string, userId: string, roles: ClinicRole[]): Promise<ClinicRole> {
  const result = await client.query<{ access_role: ClinicRole }>(
    `SELECT access_role FROM bms_clinic_staff
      WHERE tenant_id=$1 AND user_id=$2 AND active AND access_role=ANY($3::text[])
      ORDER BY CASE access_role WHEN 'CLINICIAN' THEN 0 WHEN 'NURSE' THEN 1 ELSE 2 END LIMIT 1`,
    [tenantId, userId, roles]
  );
  if (!result.rows[0]) throw new ClinicError("CLINIC_ACCESS_DENIED", 403);
  return result.rows[0].access_role;
}

export async function requireClinician(client: PoolClient, tenantId: string, userId: string): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM bms_clinic_staff
      WHERE tenant_id=$1 AND user_id=$2 AND access_role='CLINICIAN'
        AND active AND length(btrim(coalesce(licence_no,''))) >= 3 LIMIT 1`,
    [tenantId, userId]
  );
  if (!result.rowCount) throw new ClinicError("CLINICIAN_REQUIRED", 403);
}

export async function auditClinicWrite(client: PoolClient, tenantId: string, actorId: string,
  action: string, target: string, targetKind: string, meta: Record<string, unknown> = {}): Promise<void> {
  await insertAuditInTx(client, {
    tenantId, actor: actorId, actorKind: "STAFF", actorUserId: actorId,
    action, target, targetKind, source: "CLINIC_PILOT", meta,
  });
}

export async function auditClinicRead(client: PoolClient, tenantId: string, actorId: string,
  targetKind: string, targetId: string, patientId?: string): Promise<void> {
  await insertSecurityEventInTx(client, {
    tenantId, actorUserId: actorId, event: "access.sensitive_read",
    outcome: "SUCCESS", source: "CLINIC_PILOT",
    meta: { targetKind, targetId, ...(patientId ? { patientId } : {}) },
  });
}

export async function grantClinicStaff(input: {
  tenantId: string; actorId: string; userId: string; role: ClinicRole;
  active: boolean; licenceNo?: string | null; confirmation: string;
}): Promise<void> {
  const userId = uuid(input.userId);
  if (!CLINIC_ROLES.includes(input.role)) throw new ClinicError("INVALID_ROLE");
  if (typeof input.active !== "boolean") throw new ClinicError("INVALID_ACTIVE");
  if (input.confirmation !== "CONFIRM CLINIC STAFF ACCESS") throw new ClinicError("CONFIRMATION_REQUIRED");
  const licence = input.role === "CLINICIAN" ? boundedText(input.licenceNo, 80, 3) : null;
  await clinicTx(input.tenantId, input.actorId, async (client) => {
    const user = await client.query(`SELECT 1 FROM users WHERE tenant_id=$1 AND id=$2`, [input.tenantId, userId]);
    if (!user.rowCount) throw new ClinicError("STAFF_NOT_FOUND", 404);
    await client.query(
      `INSERT INTO bms_clinic_staff (tenant_id,user_id,access_role,active,licence_no,granted_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id,user_id,access_role) DO UPDATE
         SET active=EXCLUDED.active,licence_no=EXCLUDED.licence_no,
             granted_by=EXCLUDED.granted_by,granted_at=now()`,
      [input.tenantId, userId, input.role, input.active, licence, input.actorId]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.staff.access_set", userId, "CLINIC_STAFF", { role: input.role, active: input.active });
  });
}

export async function clinicBootstrap(tenantId: string, actorId: string, includeUsers: boolean) {
  return clinicTx(tenantId, actorId, async (client) => {
    const location = await client.query<{ id: string; name: string }>(
      `SELECT id,name FROM bms_locations WHERE tenant_id=$1 AND active LIMIT 1`, [tenantId]
    );
    const roles = await client.query<{ access_role: ClinicRole }>(
      `SELECT access_role FROM bms_clinic_staff WHERE tenant_id=$1 AND user_id=$2 AND active`,
      [tenantId, actorId]
    );
    if (!includeUsers && roles.rows.length === 0) throw new ClinicError("CLINIC_ACCESS_DENIED", 403);
    const canSchedule = includeUsers || roles.rows.some((row) =>
      row.access_role === "REGISTRAR" || row.access_role === "CLINICIAN");
    const canAssignNurse = includeUsers || roles.rows.some((row) => row.access_role === "CLINICIAN");
    const practitioners = canSchedule ? await client.query<{ id: string; name: string }>(
      `SELECT u.id,coalesce(u.name,u.email) AS name FROM bms_clinic_staff s
         JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id
        WHERE s.tenant_id=$1 AND s.access_role='CLINICIAN' AND s.active
        ORDER BY name,id LIMIT 100`, [tenantId]
    ) : null;
    const nurses = canAssignNurse ? await client.query<{ id: string; name: string }>(
      `SELECT u.id,coalesce(u.name,u.email) AS name FROM bms_clinic_staff s
         JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id
        WHERE s.tenant_id=$1 AND s.access_role='NURSE' AND s.active
        ORDER BY name,id LIMIT 100`, [tenantId]
    ) : null;
    const users = includeUsers ? await client.query<{ id: string; name: string }>(
      `SELECT id,coalesce(name,email) AS name FROM users WHERE tenant_id=$1 ORDER BY name,id LIMIT 200`,
      [tenantId]
    ) : null;
    const staff = includeUsers ? await client.query<{
      user_id: string; name: string; access_role: ClinicRole; active: boolean; licence_no: string | null;
    }>(`SELECT s.user_id,coalesce(u.name,u.email) AS name,s.access_role,s.active,s.licence_no
          FROM bms_clinic_staff s JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id
         WHERE s.tenant_id=$1 ORDER BY name,s.access_role LIMIT 200`, [tenantId]) : null;
    await auditClinicRead(client, tenantId, actorId, "CLINIC_STAFF_BOOTSTRAP", "staff");
    return { location: location.rows[0], roles: roles.rows.map((row) => row.access_role),
      practitioners: practitioners?.rows ?? [], nurses: nurses?.rows ?? [], users: users?.rows ?? [],
      staff: staff?.rows ?? [] };
  });
}

export async function listClinicAccessEvents(input: { tenantId: string; actorId: string; patientId: unknown }) {
  const patientId = uuid(input.patientId);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    const patient = await client.query(`SELECT 1 FROM bms_clinic_patients WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, patientId]);
    if (!patient.rowCount) throw new ClinicError("PATIENT_NOT_FOUND", 404);
    const events = await client.query(
      `SELECT actor_user_id,event,outcome,source,created_at
         FROM bms_security_events WHERE tenant_id=$1 AND event='access.sensitive_read'
           AND (meta->>'patientId'=$2 OR (meta->>'targetKind'='CLINIC_PATIENT' AND meta->>'targetId'=$2))
         ORDER BY created_at DESC,id DESC LIMIT 100`,
      [input.tenantId, patientId]
    );
    await auditClinicRead(client, input.tenantId, input.actorId, "CLINIC_ACCESS_HISTORY", patientId);
    return events.rows;
  });
}
