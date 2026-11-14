import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import sharp from "sharp";

import { getClient, query } from "@/lib/db";
import { readStoredFile, writeWebFileStream } from "@/lib/storage";
import { getStorageDriver } from "@/lib/storageDrivers";
import { beginTenantTx } from "./tenant";

export const DELIVERY_DISPUTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function normalizeDeliveryDisputeImage(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > DELIVERY_DISPUTE_IMAGE_MAX_BYTES) {
    throw new Error("DELIVERY_DISPUTE_EVIDENCE_INVALID");
  }
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000 });
    const metadata = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) {
      throw new Error("INVALID_IMAGE");
    }
    return await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp().toBuffer();
  } catch {
    throw new Error("DELIVERY_DISPUTE_EVIDENCE_INVALID");
  }
}

async function assertEditableDispute(tenantId: string, disputeId: string) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query<{ status: string }>(
      `SELECT status FROM bms_delivery_disputes WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
      [tenantId, disputeId],
    );
    if (!result.rowCount) throw new Error("DELIVERY_DISPUTE_NOT_FOUND");
    if (!["DRAFT", "SUBMITTED", "UNDER_REVIEW"].includes(result.rows[0].status)) {
      throw new Error("DELIVERY_DISPUTE_EVIDENCE_CLOSED");
    }
    const count = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM bms_delivery_dispute_evidence
        WHERE tenant_id=$1 AND dispute_id=$2`,
      [tenantId, disputeId],
    );
    if (Number(count.rows[0].n) >= 10) throw new Error("DELIVERY_DISPUTE_EVIDENCE_LIMIT");
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function uploadDeliveryDisputeEvidence(input: {
  tenantId: string; actorUserId: string; disputeId: string; bytes: Buffer;
}) {
  if (!UUID_RE.test(input.disputeId)) {
    throw new Error("DELIVERY_DISPUTE_EVIDENCE_INVALID");
  }
  const normalized = await normalizeDeliveryDisputeImage(input.bytes);

  await assertEditableDispute(input.tenantId, input.disputeId);
  const pending = await writeWebFileStream(
    Readable.from(normalized), `delivery-dispute-evidence-${randomUUID()}.webp`, "image/webp",
  );
  let fileId: number | null = null;
  try {
    const file = (await query<{ id: number }>(
      `INSERT INTO files(filename,original_name,mimetype,size,checksum,relpath,visibility,tenant_id)
       VALUES($1,$2,'image/webp',$3,$4,$5,'private',$6) RETURNING id`,
      [pending.filename, pending.original_name, pending.size, pending.checksum, pending.relpath, input.tenantId],
    )).rows[0];
    fileId = Number(file.id);
    const client = await getClient();
    try {
      await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
      const dispute = await client.query<{ status: string }>(
        `SELECT status FROM bms_delivery_disputes WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [input.tenantId, input.disputeId],
      );
      if (!dispute.rowCount) throw new Error("DELIVERY_DISPUTE_NOT_FOUND");
      if (!["DRAFT", "SUBMITTED", "UNDER_REVIEW"].includes(dispute.rows[0].status)) {
        throw new Error("DELIVERY_DISPUTE_EVIDENCE_CLOSED");
      }
      const count = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM bms_delivery_dispute_evidence
          WHERE tenant_id=$1 AND dispute_id=$2`,
        [input.tenantId, input.disputeId],
      );
      if (Number(count.rows[0].n) >= 10) throw new Error("DELIVERY_DISPUTE_EVIDENCE_LIMIT");
      await client.query(
        `INSERT INTO bms_delivery_dispute_evidence(tenant_id,dispute_id,file_id) VALUES($1,$2,$3)`,
        [input.tenantId, input.disputeId, fileId],
      );
      await client.query(
        `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
         VALUES($1,$2,'delivery.dispute_evidence_added',$3,$4::jsonb)`,
        [input.tenantId, input.actorUserId, input.disputeId, JSON.stringify({ fileId })],
      );
      await client.query("COMMIT");
      return { fileId };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally { client.release(); }
  } catch (error) {
    try {
      const orphan = fileId === null || (await query(
        `UPDATE files f SET deleted_at=now(),updated_at=now()
          WHERE f.id=$1 AND f.tenant_id=$2 AND f.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM bms_delivery_dispute_evidence e
              WHERE e.tenant_id=$2 AND e.file_id=f.id)
          RETURNING f.id`,
        [fileId, input.tenantId],
      )).rowCount;
      if (orphan) await getStorageDriver().delete(pending.relpath);
    } catch {
      // A lost commit response may mean the evidence exists; retain bytes if orphanhood is unclear.
    }
    throw error;
  }
}

export async function readDeliveryDisputeEvidence(tenantId: string, fileId: number) {
  if (!Number.isSafeInteger(fileId) || fileId < 1) throw new Error("DELIVERY_DISPUTE_EVIDENCE_NOT_FOUND");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const linked = await client.query(
      `SELECT 1 FROM bms_delivery_dispute_evidence
        WHERE tenant_id=$1 AND file_id=$2`,
      [tenantId, fileId],
    );
    if (!linked.rowCount) throw new Error("DELIVERY_DISPUTE_EVIDENCE_NOT_FOUND");
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
  const file = (await query<{ relpath: string }>(
    `SELECT relpath FROM files WHERE id=$1 AND tenant_id=$2
      AND deleted_at IS NULL AND visibility='private' AND mimetype='image/webp'`,
    [fileId, tenantId],
  )).rows[0];
  if (!file) throw new Error("DELIVERY_DISPUTE_EVIDENCE_NOT_FOUND");
  return readStoredFile(file.relpath);
}
