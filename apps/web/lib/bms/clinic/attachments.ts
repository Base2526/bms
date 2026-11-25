import { createHash } from "node:crypto";
import { ClinicError, auditClinicRead, auditClinicWrite, boundedText, clinicTx, requireClinician, uuid } from "./access";

const MAX_BYTES = 2 * 1024 * 1024;

function validFile(content: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") return content.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png") return content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mimeType === "image/jpeg") return content[0] === 255 && content[1] === 216 && content[content.length-2] === 255 && content[content.length-1] === 217;
  return false;
}

export async function uploadClinicAttachment(input: {
  tenantId: string; actorId: string; encounterId: unknown;
  fileName: unknown; mimeType: unknown; content: Buffer;
}): Promise<string> {
  const encounterId = uuid(input.encounterId);
  const fileName = boundedText(input.fileName, 120, 1).replace(/[\\/\r\n\u0000-\u001f]/g, "_");
  if (!Buffer.isBuffer(input.content) || input.content.length < 1 || input.content.length > MAX_BYTES
    || typeof input.mimeType !== "string" || !validFile(input.content, input.mimeType))
    throw new ClinicError("INVALID_ATTACHMENT");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinician(client, input.tenantId, input.actorId);
    const encounter = await client.query<{ patient_id: string }>(
      `SELECT patient_id FROM bms_clinic_encounters WHERE tenant_id=$1 AND id=$2 AND practitioner_id=$3`,
      [input.tenantId, encounterId, input.actorId]
    );
    if (!encounter.rows[0]) throw new ClinicError("ENCOUNTER_ACCESS_DENIED", 403);
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    const row = await client.query<{ id: string }>(
      `INSERT INTO bms_clinic_attachments
        (tenant_id,encounter_id,file_name,mime_type,byte_size,sha256,content,uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [input.tenantId, encounterId, fileName, input.mimeType, input.content.length, sha256,
        input.content, input.actorId]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.attachment.upload", row.rows[0].id, "CLINIC_ATTACHMENT", { encounterId });
    return row.rows[0].id;
  });
}

export async function listClinicAttachments(input: { tenantId: string; actorId: string; encounterId: unknown }) {
  const encounterId = uuid(input.encounterId);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    const encounter = await client.query<{ patient_id: string }>(
      `SELECT patient_id FROM bms_clinic_encounters WHERE tenant_id=$1 AND id=$2
        AND EXISTS (SELECT 1 FROM bms_clinic_staff s WHERE s.tenant_id=$1
          AND s.user_id=$3 AND s.active AND (
            (s.access_role='CLINICIAN' AND practitioner_id=$3) OR
            (s.access_role='NURSE' AND EXISTS (SELECT 1 FROM bms_clinic_care_team ct
              WHERE ct.tenant_id=$1 AND ct.encounter_id=$2 AND ct.user_id=$3 AND ct.active))
          ))`,
      [input.tenantId, encounterId, input.actorId]
    );
    if (!encounter.rows[0]) throw new ClinicError("ENCOUNTER_ACCESS_DENIED", 403);
    const files = await client.query(
      `SELECT id,file_name,mime_type,byte_size,sha256,uploaded_at
         FROM bms_clinic_attachments WHERE tenant_id=$1 AND encounter_id=$2
        ORDER BY uploaded_at,id LIMIT 100`, [input.tenantId, encounterId]
    );
    await auditClinicRead(client, input.tenantId, input.actorId,
      "CLINIC_ATTACHMENT_LIST", encounterId, encounter.rows[0].patient_id);
    return files.rows;
  });
}

export async function readClinicAttachment(input: { tenantId: string; actorId: string; attachmentId: unknown }) {
  const attachmentId = uuid(input.attachmentId);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    const file = await client.query<{
      file_name: string; mime_type: string; content: Buffer; patient_id: string;
    }>(`SELECT f.file_name,f.mime_type,f.content,e.patient_id
          FROM bms_clinic_attachments f JOIN bms_clinic_encounters e
            ON e.tenant_id=f.tenant_id AND e.id=f.encounter_id
         WHERE f.tenant_id=$1 AND f.id=$2
           AND EXISTS (SELECT 1 FROM bms_clinic_staff s WHERE s.tenant_id=e.tenant_id
             AND s.user_id=$3 AND s.active AND (
               (s.access_role='CLINICIAN' AND e.practitioner_id=$3) OR
               (s.access_role='NURSE' AND EXISTS (SELECT 1 FROM bms_clinic_care_team ct
                 WHERE ct.tenant_id=e.tenant_id AND ct.encounter_id=e.id AND ct.user_id=$3 AND ct.active))
             ))`,
      [input.tenantId, attachmentId, input.actorId]
    );
    if (!file.rows[0]) throw new ClinicError("ATTACHMENT_NOT_FOUND", 404);
    await auditClinicRead(client, input.tenantId, input.actorId,
      "CLINIC_ATTACHMENT", attachmentId, file.rows[0].patient_id);
    return file.rows[0];
  });
}
