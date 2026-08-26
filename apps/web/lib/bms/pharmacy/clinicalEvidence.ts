// =============================================================
// หลักฐานทางคลินิกของเคสหน้าร้าน (9.25)
// -------------------------------------------------------------
// เก็บ 3 อย่างต่อเคส: รูปใบสั่งยา, เลขอ้างอิงใบสั่งยา, บันทึกการให้คำแนะนำ
// เก็บไว้จนกว่าจะมีคนลบ (ไม่มีตัวหมดอายุ) และการลบเป็น soft delete เพื่อให้
// ยังตรวจย้อนได้ว่าใครลบอะไรออกไป
//
// **file_id ห้ามหลุดออกไปฝั่ง client** — `/api/files/[id]` ไม่มี auth และ id
// เป็นเลขเรียง ใครก็เดาได้ รูปใบสั่งยาจึงต้องออกทาง
// /api/bms/pharmacy/evidence/[id]/file ที่ตรวจ session + สิทธิ์ + tenant เท่านั้น
// =============================================================

import type { PoolClient } from "pg";
import { query, getClient } from "@/lib/db";
import { beginTenantTx } from "../tenant";

export const PHARMACY_EVIDENCE_KINDS = [
  "PRESCRIPTION_IMAGE",
  "PRESCRIPTION_REF",
  "COUNSELING_NOTE",
] as const;
export type PharmacyEvidenceKind = (typeof PHARMACY_EVIDENCE_KINDS)[number];

/** รูปที่ client เห็น — ไม่มี file_id โดยตั้งใจ */
export type PharmacyClinicalEvidence = {
  id: string;
  assessmentId: string;
  kind: PharmacyEvidenceKind;
  textValue: string | null;
  fileName: string | null;
  fileMimetype: string | null;
  fileSize: number | null;
  /** null เมื่อไม่ใช่รูป — ชี้ไปที่ route ที่มีการ์ด ไม่ใช่ /api/files/:id */
  fileUrl: string | null;
  source: "pos" | "queue";
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

const MAX_TEXT_LEN = 4000;

function mapRow(row: any): PharmacyClinicalEvidence {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    kind: row.kind,
    textValue: row.text_value ?? null,
    fileName: row.file_name ?? null,
    fileMimetype: row.file_mimetype ?? null,
    fileSize: row.file_size == null ? null : Number(row.file_size),
    fileUrl: row.kind === "PRESCRIPTION_IMAGE"
      ? `/api/bms/pharmacy/evidence/${row.id}/file`
      : null,
    source: row.source,
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    // pg คืน DATE/TIMESTAMPTZ เป็น Date — GraphQL field เป็น String! จึงต้อง
    // toISOString() เองที่นี่ ไม่ใช่ปล่อยให้ serialize เป็น epoch (กับดักข้อ 1)
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

const SELECT_COLUMNS = `e.id, e.assessment_id, e.kind, e.text_value,
        e.file_name, e.file_mimetype, e.file_size, e.source,
        e.created_by, u.name AS created_by_name, e.created_at`;

export async function listClinicalEvidence(
  tenantId: string,
  assessmentId: string
): Promise<PharmacyClinicalEvidence[]> {
  const res = await query(
    `SELECT ${SELECT_COLUMNS}
       FROM bms_pharmacy_clinical_evidence e
       LEFT JOIN users u ON u.id = e.created_by AND u.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1 AND e.assessment_id = $2 AND e.deleted_at IS NULL
      ORDER BY e.created_at DESC, e.id`,
    [tenantId, assessmentId]
  );
  return res.rows.map(mapRow);
}

/**
 * อ่านที่อยู่ไฟล์จริงเพื่อสตรีม — คืน null ถ้าเคสนี้ไม่ใช่ของร้านนี้
 * ผู้เรียกต้องตรวจสิทธิ์มาก่อนแล้ว (route เป็นคนตรวจ ไม่ใช่ที่นี่)
 */
export async function getEvidenceFileForStreaming(
  tenantId: string,
  evidenceId: string
): Promise<{ relpath: string; mimetype: string | null; name: string | null } | null> {
  const res = await query<{ relpath: string; mimetype: string | null; name: string | null }>(
    `SELECT f.relpath, e.file_mimetype AS mimetype, e.file_name AS name
       FROM bms_pharmacy_clinical_evidence e
       JOIN files f ON f.id = e.file_id AND f.deleted_at IS NULL
      WHERE e.tenant_id = $1
        AND e.id = $2
        AND e.kind = 'PRESCRIPTION_IMAGE'
        AND e.deleted_at IS NULL`,
    [tenantId, evidenceId]
  );
  return res.rows[0] ?? null;
}

export type AddEvidenceInput = {
  tenantId: string;
  assessmentId: string;
  kind: PharmacyEvidenceKind;
  /** เฉพาะ PRESCRIPTION_IMAGE */
  file?: { id: number; name: string | null; mimetype: string | null; size: number | null } | null;
  /** เฉพาะ PRESCRIPTION_REF / COUNSELING_NOTE */
  textValue?: string | null;
  actorUserId: string | null;
  source: "pos" | "queue";
};

export type AddEvidenceResult =
  | { status: "ADDED"; evidence: PharmacyClinicalEvidence }
  | { status: "CASE_NOT_FOUND" }
  | { status: "INVALID"; reason: string };

export async function addClinicalEvidence(input: AddEvidenceInput): Promise<AddEvidenceResult> {
  const text = typeof input.textValue === "string" ? input.textValue.trim() : "";
  if (input.kind === "PRESCRIPTION_IMAGE") {
    if (!input.file?.id) return { status: "INVALID", reason: "ต้องแนบไฟล์รูปใบสั่งยา" };
  } else {
    if (!text) return { status: "INVALID", reason: "ต้องกรอกข้อความ" };
    if (text.length > MAX_TEXT_LEN) {
      return { status: "INVALID", reason: `ข้อความยาวเกิน ${MAX_TEXT_LEN} ตัวอักษร` };
    }
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId ?? undefined });
    // เคสต้องเป็นของร้านนี้ — ห้ามเชื่อ assessmentId ที่ client ส่งมาเฉย ๆ
    const owns = await client.query<{ id: string }>(
      `SELECT id FROM bms_pharmacy_assessments
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [input.tenantId, input.assessmentId]
    );
    if (!owns.rowCount) {
      await client.query("ROLLBACK");
      return { status: "CASE_NOT_FOUND" };
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms_pharmacy_clinical_evidence
         (tenant_id, assessment_id, kind, file_id, file_name, file_mimetype, file_size,
          text_value, created_by, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        input.tenantId,
        input.assessmentId,
        input.kind,
        input.kind === "PRESCRIPTION_IMAGE" ? input.file!.id : null,
        input.kind === "PRESCRIPTION_IMAGE" ? input.file!.name : null,
        input.kind === "PRESCRIPTION_IMAGE" ? input.file!.mimetype : null,
        input.kind === "PRESCRIPTION_IMAGE" ? input.file!.size : null,
        input.kind === "PRESCRIPTION_IMAGE" ? null : text,
        input.actorUserId,
        input.source,
      ]
    );
    const evidenceId = inserted.rows[0].id;

    // ร่องรอยอยู่ในทรานแซกชันเดียวกับการเขียน — ห้ามเขียนตามหลัง
    // เก็บแต่ metadata ไม่เก็บเนื้อความ (เป็นข้อมูลสุขภาพ)
    await client.query(
      `INSERT INTO bms_pharmacy_assessment_events
         (tenant_id, assessment_id, actor, action, previous_state, next_state, meta)
       VALUES ($1,$2,$3,'assessment.clinical_evidence_added',NULL,NULL,$4::jsonb)`,
      [
        input.tenantId,
        input.assessmentId,
        input.actorUserId ?? `system:${input.source}`,
        JSON.stringify({ evidenceId, kind: input.kind, source: input.source }),
      ]
    );
    await client.query("COMMIT");

    const row = await query(
      `SELECT ${SELECT_COLUMNS}
         FROM bms_pharmacy_clinical_evidence e
         LEFT JOIN users u ON u.id = e.created_by AND u.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1 AND e.id = $2`,
      [input.tenantId, evidenceId]
    );
    return { status: "ADDED", evidence: mapRow(row.rows[0]) };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** soft delete — ไม่ลบแถวจริง เพื่อให้ยังรู้ว่าใครลบหลักฐานอะไรออกไป */
export async function deleteClinicalEvidence(
  tenantId: string,
  evidenceId: string,
  actorUserId: string | null
): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId ?? undefined });
    const updated = await client.query<{ assessment_id: string; kind: string }>(
      `UPDATE bms_pharmacy_clinical_evidence
          SET deleted_at = now(), deleted_by = $3
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING assessment_id, kind`,
      [tenantId, evidenceId, actorUserId]
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `INSERT INTO bms_pharmacy_assessment_events
         (tenant_id, assessment_id, actor, action, previous_state, next_state, meta)
       VALUES ($1,$2,$3,'assessment.clinical_evidence_deleted',NULL,NULL,$4::jsonb)`,
      [
        tenantId,
        updated.rows[0].assessment_id,
        actorUserId ?? "system",
        JSON.stringify({ evidenceId, kind: updated.rows[0].kind }),
      ]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
