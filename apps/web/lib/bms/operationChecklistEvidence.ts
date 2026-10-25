import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import sharp from "sharp";
import { writeWebFileStream, readStoredFile } from "@/lib/storage";
import { getStorageDriver } from "@/lib/storageDrivers";
import {
  checklistTx,
  lockChecklistRun,
  checklistPermission,
  type ChecklistScope,
} from "./operationChecklists";
import {
  editableChecklist,
  rejectChecklist as reject,
  checklistUuid,
} from "./operationChecklistPolicy";

export const CHECKLIST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export async function uploadChecklistEvidence(
  s: ChecklistScope,
  runId: string,
  itemKey: string,
  version: number,
  bytes: Buffer,
) {
  checklistPermission(s, "operations.checklist.execute");
  if (
    !checklistUuid(runId) ||
    !Number.isInteger(version) ||
    !bytes.length ||
    bytes.length > CHECKLIST_IMAGE_MAX_BYTES
  )
    return reject("INVALID_INPUT");
  let normalized: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000 });
    const meta = await image.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) > 1
    )
      return reject("INVALID_INPUT");
    normalized = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp()
      .toBuffer();
  } catch {
    return reject("INVALID_INPUT");
  }
  // Authorize ownership/state before storage I/O; recheck under the write lock afterwards.
  await checklistTx(s, async (c) => {
    const r = await lockChecklistRun(c, s, runId);
    editableChecklist(r.status);
    if (r.version !== version) reject("STALE_VERSION");
    if (r.assigned_to && r.assigned_to !== s.actorId) reject("NOT_ASSIGNED");
    if (!r.snapshot.items.some((x: any) => x.key === itemKey))
      reject("INVALID_INPUT");
  });
  const pending = await writeWebFileStream(
    Readable.from(normalized),
    `operation-evidence-${randomUUID()}.webp`,
    "image/webp",
  );
  try {
    return await checklistTx(s, async (c) => {
      const r = await lockChecklistRun(c, s, runId);
      editableChecklist(r.status);
      if (r.version !== version) return reject("STALE_VERSION");
      if (r.assigned_to && r.assigned_to !== s.actorId)
        return reject("NOT_ASSIGNED");
      const count = Number(
        (
          await c.query(
            `SELECT count(*) n FROM bms_operation_evidence WHERE tenant_id=$1 AND run_id=$2 AND item_key=$3`,
            [s.tenantId, runId, itemKey],
          )
        ).rows[0].n,
      );
      if (count >= 5) return reject("EVIDENCE_LIMIT");
      const f = (
        await c.query(
          `INSERT INTO files(filename,original_name,mimetype,size,checksum,relpath,visibility,tenant_id)
        VALUES($1,$2,'image/webp',$3,$4,$5,'private',$6) RETURNING id`,
          [
            pending.filename,
            pending.original_name,
            pending.size,
            pending.checksum,
            pending.relpath,
            s.tenantId,
          ],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO bms_operation_evidence(tenant_id,run_id,item_key,file_id,created_by) VALUES($1,$2,$3,$4,$5)`,
        [s.tenantId, runId, itemKey, f.id, s.actorId],
      );
      await c.query(
        `INSERT INTO bms_operation_events(tenant_id,run_id,action,actor,note) VALUES($1,$2,'EVIDENCE',$3,$4)`,
        [s.tenantId, runId, s.actorId, itemKey],
      );
      await c.query(
        `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,'operations.evidence',$3,$4::jsonb)`,
        [
          s.tenantId,
          s.actorId,
          runId,
          JSON.stringify({ itemKey, fileId: Number(f.id) }),
        ],
      );
      return { status: "OK", fileId: Number(f.id) };
    });
  } catch (e) {
    await getStorageDriver()
      .delete(pending.relpath)
      .catch(() => {});
    throw e;
  }
}
export async function checklistEvidenceFile(s: ChecklistScope, fileId: number) {
  checklistPermission(s, "operations.checklist.view");
  if (!Number.isSafeInteger(fileId) || fileId < 1) return reject("NOT_FOUND");
  const path = await checklistTx(s, async (c) => {
    const row = (
      await c.query(
        `SELECT e.run_id,f.relpath FROM bms_operation_evidence e JOIN files f ON f.id=e.file_id AND f.tenant_id=e.tenant_id
      WHERE e.tenant_id=$1 AND e.file_id=$2 AND f.deleted_at IS NULL AND f.visibility='private'`,
        [s.tenantId, fileId],
      )
    ).rows[0];
    if (!row) return reject("NOT_FOUND");
    await lockChecklistRun(c, s, row.run_id);
    return row.relpath;
  });
  return readStoredFile(path);
}
