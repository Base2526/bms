import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type QueueBoardTransition = "FADE" | "SLIDE" | "CUT";
export type QueueBoardMediaItem = {
  fileId: number;
  url: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
};
export type QueueBoardMediaSettings = {
  version: number;
  timezone: string;
  enabled: boolean;
  defaultFileId: number | null;
  defaultUrl: string | null;
  intervalSeconds: number;
  transition: QueueBoardTransition;
  items: QueueBoardMediaItem[];
};
export type QueueBoardMediaInput = {
  expectedVersion: number;
  enabled: boolean;
  defaultFileId: number | null;
  intervalSeconds: number;
  transition: QueueBoardTransition;
  items: Array<Pick<QueueBoardMediaItem, "fileId" | "active" | "startsAt" | "endsAt">>;
};

export class QueueBoardMediaError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}

const fileUrl = (id: number) => `/api/files/${id}`;
const iso = (value: unknown): string | null => value ? new Date(String(value)).toISOString() : null;
const schedulePattern = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/;

function normalizeSchedule(value: unknown): string | null {
  if (value == null || value === "") return null;
  const match = typeof value === "string" ? schedulePattern.exec(value) : null;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (!match || !Number.isFinite(parsed)) throw new QueueBoardMediaError("วันเริ่มหรือวันสิ้นสุดไม่ถูกต้อง");
  const offset = match[7] === "Z" ? 0 : (match[7][0] === "+" ? 1 : -1)
    * (Number(match[7].slice(1, 3)) * 60 + Number(match[7].slice(4, 6)));
  const local = new Date(parsed + offset * 60_000);
  if (local.getUTCFullYear() !== Number(match[1]) || local.getUTCMonth() + 1 !== Number(match[2])
    || local.getUTCDate() !== Number(match[3]) || local.getUTCHours() !== Number(match[4])
    || local.getUTCMinutes() !== Number(match[5]) || local.getUTCSeconds() !== Number(match[6])) {
    throw new QueueBoardMediaError("วันเริ่มหรือวันสิ้นสุดไม่ถูกต้อง");
  }
  return new Date(parsed).toISOString();
}

export const EMPTY_QUEUE_BOARD_MEDIA: QueueBoardMediaSettings = {
  version: 0, timezone: "Asia/Bangkok", enabled: false, defaultFileId: null, defaultUrl: null,
  intervalSeconds: 8, transition: "FADE", items: [],
};

export function normalizeQueueBoardMediaInput(input: QueueBoardMediaInput): QueueBoardMediaInput {
  if (!input || typeof input !== "object" || typeof input.enabled !== "boolean"
    || !Array.isArray(input.items) || input.items.length > 8) throw new QueueBoardMediaError("รายการสื่อจอคิวไม่ถูกต้อง (สูงสุด 8 รูป)");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new QueueBoardMediaError("กรุณาโหลดการตั้งค่าใหม่");
  const intervalSeconds = input.intervalSeconds;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 4 || intervalSeconds > 30) {
    throw new QueueBoardMediaError("เวลาเปลี่ยนรูปต้องอยู่ระหว่าง 4-30 วินาที");
  }
  if (!["FADE", "SLIDE", "CUT"].includes(input.transition)) throw new QueueBoardMediaError("เอฟเฟกต์เปลี่ยนรูปไม่ถูกต้อง");
  const defaultFileId = input.defaultFileId;
  if (defaultFileId !== null && (!Number.isSafeInteger(defaultFileId) || defaultFileId <= 0)) {
    throw new QueueBoardMediaError("รูปเริ่มต้นไม่ถูกต้อง");
  }
  const seen = new Set<number>();
  const items = input.items.map((item) => {
    const fileId = item?.fileId;
    if (!Number.isSafeInteger(fileId) || fileId <= 0 || seen.has(fileId) || typeof item.active !== "boolean") {
      throw new QueueBoardMediaError("รายการรูปซ้ำหรือไม่ถูกต้อง");
    }
    seen.add(fileId);
    const startsAt = normalizeSchedule(item.startsAt);
    const endsAt = normalizeSchedule(item.endsAt);
    if (startsAt && endsAt && endsAt <= startsAt) throw new QueueBoardMediaError("วันสิ้นสุดต้องหลังวันเริ่ม");
    return { fileId, active: item.active, startsAt, endsAt };
  });
  return { expectedVersion: input.expectedVersion, enabled: input.enabled, defaultFileId, intervalSeconds,
    transition: input.transition, items };
}

async function readInTx(client: PoolClient, tenantId: string, locationId: string): Promise<QueueBoardMediaSettings> {
  const branch = await client.query(
    `SELECT l.queue_board_media_enabled, l.queue_board_default_file_id, l.queue_board_media_version,
            l.queue_board_media_interval_seconds, l.queue_board_media_transition,
            COALESCE(NULLIF(p.timezone, ''), 'Asia/Bangkok') AS timezone
       FROM bms_locations l LEFT JOIN bms_store_profile p ON p.tenant_id = l.tenant_id
      WHERE l.tenant_id = $1 AND l.id = $2`, [tenantId, locationId]);
  if (!branch.rows[0]) throw new QueueBoardMediaError("ไม่พบสาขานี้", 404);
  const row = branch.rows[0];
  const files = await client.query(
    `SELECT m.file_id, m.active, m.starts_at, m.ends_at
       FROM bms_queue_board_media m
      WHERE m.tenant_id = $1 AND m.location_id = $2
      ORDER BY m.sort_order`, [tenantId, locationId]);
  const items = files.rows.map((item) => ({ fileId: Number(item.file_id), url: fileUrl(Number(item.file_id)),
      active: item.active === true, startsAt: iso(item.starts_at), endsAt: iso(item.ends_at) }));
  const defaultId = row.queue_board_default_file_id == null ? null : Number(row.queue_board_default_file_id);
  return {
    version: Number(row.queue_board_media_version ?? 0),
    timezone: String(row.timezone ?? "Asia/Bangkok"),
    enabled: row.queue_board_media_enabled === true,
    defaultFileId: defaultId,
    defaultUrl: null,
    intervalSeconds: Number(row.queue_board_media_interval_seconds ?? 8),
    transition: row.queue_board_media_transition ?? "FADE",
    items,
  };
}

async function hydratePublicImages(tenantId: string, settings: QueueBoardMediaSettings,
  publishedOnly: boolean): Promise<QueueBoardMediaSettings> {
  const ids = [...new Set([...settings.items.map((item) => item.fileId),
    ...(settings.defaultFileId == null ? [] : [settings.defaultFileId])])];
  if (!ids.length) return settings;
  // The ordinary app pool may read files; bms_app inside beginTenantTx may not.
  // This query is explicitly tenant-scoped and returns only eligible public IDs.
  const files = await query<{ id: number }>(
    `SELECT id FROM files WHERE tenant_id = $1 AND id = ANY($2::int[])
       AND deleted_at IS NULL AND visibility = 'public'
       AND mimetype IN ('image/jpeg', 'image/png', 'image/webp')`, [tenantId, ids]);
  const valid = new Set(files.rows.map((row) => Number(row.id)));
  const now = Date.now();
  return {
    ...settings,
    defaultUrl: settings.defaultFileId != null && valid.has(settings.defaultFileId)
      ? fileUrl(settings.defaultFileId) : null,
    items: settings.items.filter((item) => valid.has(item.fileId) && (!publishedOnly ||
      (item.active && (!item.startsAt || Date.parse(item.startsAt) <= now)
        && (!item.endsAt || Date.parse(item.endsAt) > now)))),
  };
}

async function assertBranchAccess(client: PoolClient, tenantId: string, locationId: string, actorId: string) {
  const result = await client.query(
    `SELECT 1 FROM bms_locations l WHERE l.tenant_id = $1 AND l.id = $2
       AND (NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations a
                         WHERE a.tenant_id = $1 AND a.user_id = $3)
         OR EXISTS (SELECT 1 FROM bms_user_allowed_locations a
                     WHERE a.tenant_id = $1 AND a.user_id = $3 AND a.location_id = $2))`,
    [tenantId, locationId, actorId]);
  if (!result.rowCount) throw new Error("FORBIDDEN");
}

export async function getQueueBoardMedia(tenantId: string, locationId: string,
  actorId?: string): Promise<QueueBoardMediaSettings> {
  const client = await getClient();
  let result: QueueBoardMediaSettings;
  try {
    await beginTenantTx(client, tenantId);
    if (actorId) await assertBranchAccess(client, tenantId, locationId, actorId);
    result = await readInTx(client, tenantId, locationId);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return hydratePublicImages(tenantId, result, !actorId);
}

export async function saveQueueBoardMedia(tenantId: string, locationId: string,
  actorId: string, untrusted: QueueBoardMediaInput): Promise<QueueBoardMediaSettings> {
  const input = normalizeQueueBoardMediaInput(untrusted);
  const client = await getClient();
  let saved: QueueBoardMediaSettings;
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    await assertBranchAccess(client, tenantId, locationId, actorId);
    const locked = await client.query(`SELECT queue_board_media_version FROM bms_locations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, locationId]);
    if (Number(locked.rows[0]?.queue_board_media_version) !== input.expectedVersion) {
      throw new QueueBoardMediaError("การตั้งค่าถูกแก้จากอีกหน้าจอ กรุณาโหลดใหม่ก่อนบันทึก", 409);
    }
    const ids = [...new Set([...input.items.map((item) => item.fileId), ...(input.defaultFileId ? [input.defaultFileId] : [])])];
    if (ids.length) {
      const valid = await client.query<{ valid: boolean }>(
        `SELECT public.bms_queue_board_images_valid($1, $2::int[]) AS valid`, [tenantId, ids]);
      if (valid.rows[0]?.valid !== true) throw new QueueBoardMediaError("รูปต้องเป็นไฟล์ภาพสาธารณะของร้านนี้ที่ยังใช้งานได้");
    }
    await client.query(
      `UPDATE bms_locations SET queue_board_media_enabled = $3,
          queue_board_default_file_id = $4, queue_board_media_interval_seconds = $5,
          queue_board_media_transition = $6, queue_board_media_version = queue_board_media_version + 1,
          updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, locationId, input.enabled, input.defaultFileId, input.intervalSeconds, input.transition]);
    await client.query(`DELETE FROM bms_queue_board_media WHERE tenant_id = $1 AND location_id = $2`, [tenantId, locationId]);
    for (const [index, item] of input.items.entries()) {
      await client.query(
        `INSERT INTO bms_queue_board_media
           (tenant_id, location_id, file_id, sort_order, active, starts_at, ends_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tenantId, locationId, item.fileId, index, item.active, item.startsAt, item.endsAt]);
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
       VALUES ($1,$2,'queue_board.media_published',$3,$4::jsonb)`,
      [tenantId, actorId, locationId, JSON.stringify({ enabled: input.enabled,
        defaultFileId: input.defaultFileId, fileIds: input.items.map((item) => item.fileId),
        intervalSeconds: input.intervalSeconds, transition: input.transition })]);
    saved = await readInTx(client, tenantId, locationId);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  // Publication is already committed. The same transaction validated every file,
  // so a second read must not turn a successful write into an apparent failure.
  return { ...saved, defaultUrl: saved.defaultFileId == null ? null : fileUrl(saved.defaultFileId) };
}
