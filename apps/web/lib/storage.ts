// apps/web/lib/storage.ts
// -------------------------------------------------------------
// Public API for stored files. Physical placement is decided by the driver in
// lib/storageDrivers (`local` by default, `s3` for multi-instance deploys) —
// nothing outside this module should build a filesystem path from `relpath`.
//
// `relpath` in the `files` table is the driver-independent key and keeps the
// same YYYY/MM/DD/<timestamp>-<name> shape it always had, so switching drivers
// is a copy of the existing tree into a bucket, not a data migration.
// -------------------------------------------------------------
import crypto from "crypto";
import type { Readable } from "stream";
import { query } from "@/lib/db";
import { getStorageDriver, toStorageKey } from "@/lib/storageDrivers";
import type { ByteRange, StoredStat } from "@/lib/storageDrivers";
import { STORAGE_DIR as LOCAL_STORAGE_DIR } from "@/lib/storageDrivers/local";

/**
 * @deprecated Only meaningful for the `local` driver. Use readStoredFile /
 * openStoredFileStream / statStoredFile instead of joining paths yourself.
 */
export const STORAGE_DIR = LOCAL_STORAGE_DIR;

export type StoredFileRow = {
  id: number;
  filename: string;
  original_name: string | null;
  mimetype: string | null;
  size: number;
  checksum: string;
  relpath: string;
  created_at: string;
  updated_at: string;
};

/** คีย์โฟลเดอร์ย่อยตามวันที่: YYYY/MM/DD */
export function dateKeyPrefix(): string {
  const now = new Date();
  return [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("/");
}

/** ทำชื่อไฟล์ให้ปลอดภัย */
export function makeSafeName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(0, 180);
}

function buildKey(rawName: string): { key: string; storedName: string } {
  const storedName = `${Date.now()}-${makeSafeName(rawName || "file.bin")}`;
  return { key: `${dateKeyPrefix()}/${storedName}`, storedName };
}

/**
 * public  = /api/files/[id] เสิร์ฟให้ทุกคนโดยไม่ต้องล็อกอิน (รูปสินค้าหน้าร้าน,
 *           ไฟล์ของฟีเจอร์ชุมชนเดิม)
 * private = route นั้นต้องมี session (สลิปโอนเงิน, ไฟล์แนบ Inbox, รายงาน)
 *
 * ค่าปริยายของคอลัมน์ในฐาน (9.26) คือ private — โค้ดใหม่ที่ลืมระบุจะได้ของที่
 * ปลอดภัยกว่า ไม่ใช่หลุดออกไป
 */
export type FileVisibility = "public" | "private";

async function insertFileRow(params: {
  storedName: string;
  originalName: string | null;
  mimetype: string | null;
  size: number;
  checksum: string;
  key: string;
  visibility: FileVisibility;
  /** ร้านเจ้าของไฟล์ (9.27) — null = ไม่ผูกร้าน (ไฟล์ของฟีเจอร์ชุมชนเดิม) */
  tenantId?: string | null;
}): Promise<StoredFileRow> {
  const { rows } = await query(
    `INSERT INTO files (filename, original_name, mimetype, size, checksum, relpath, visibility, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, filename, original_name, mimetype, size, checksum, relpath, created_at, updated_at`,
    [
      params.storedName,
      params.originalName,
      params.mimetype,
      params.size,
      params.checksum,
      params.key,
      params.visibility,
      params.tenantId ?? null,
    ]
  );
  return rows[0] as StoredFileRow;
}

/** รับ Web File → เซฟผ่าน storage driver → คืนข้อมูล row ในตาราง files */
export async function persistWebFile(
  file: File,
  renameTo?: string,
  visibility: FileVisibility = "private",
  tenantId?: string | null
): Promise<StoredFileRow> {
  const buf = Buffer.from(await file.arrayBuffer());
  const checksum = crypto.createHash("sha256").update(buf).digest("hex");
  const { key, storedName } = buildKey(renameTo || file.name || "file.bin");

  await getStorageDriver().write(key, buf);

  return insertFileRow({
    storedName,
    originalName: file.name || null,
    mimetype: file.type || null,
    size: buf.length,
    checksum,
    key,
    visibility,
    tenantId,
  });
}

/**
 * รับ upload object จาก graphql-upload (มี createReadStream)
 * → เซฟผ่าน storage driver
 */
export async function persistUploadStream(
  upload: {
    filename: string;
    mimetype?: string | null;
    encoding?: string | null;
    createReadStream: () => NodeJS.ReadableStream;
  },
  renameTo?: string,
  // เส้นทางนี้คือ GraphQL upload ของฟีเจอร์เดิม (avatar, รูปโพสต์, ไฟล์แชทชุมชน)
  // ซึ่งหน้าเว็บโหลดตรงจาก /api/files โดยไม่มี session — คงเป็น public ไว้
  // ผู้เรียกที่รับไฟล์อ่อนไหวต้องส่ง "private" มาเอง
  visibility: FileVisibility = "public"
): Promise<StoredFileRow> {
  const { key, storedName } = buildKey(renameTo || upload.filename || "file.bin");

  const { size, checksum } = await getStorageDriver().writeStream(
    key,
    upload.createReadStream()
  );

  return insertFileRow({
    storedName,
    originalName: upload.filename || null,
    mimetype: upload.mimetype || null,
    size,
    checksum,
    key,
    visibility,
  });
}

/**
 * รับ Buffer ที่สร้างขึ้นในเมมโมรี (เช่นไฟล์ report ที่ generate เอง ไม่มี File/stream object
 * ให้ใช้แบบ persistWebFile/persistUploadStream) → เซฟผ่าน driver เดียวกัน → คืน row เดียวกัน
 */
export async function persistBuffer(
  buf: Buffer,
  filename: string,
  mimetype: string | null,
  // ผู้ใช้จริงของฟังก์ชันนี้คือไฟล์รายงานที่ generate เอง ซึ่งมี route ดาวน์โหลด
  // ที่ตรวจ tenant อยู่แล้ว — private เป็นค่าปริยายที่ถูกต้อง
  visibility: FileVisibility = "private",
  tenantId?: string | null
): Promise<StoredFileRow> {
  const checksum = crypto.createHash("sha256").update(buf).digest("hex");
  const { key, storedName } = buildKey(filename);

  await getStorageDriver().write(key, buf);

  return insertFileRow({
    storedName,
    originalName: filename || null,
    mimetype,
    size: buf.length,
    checksum,
    key,
    visibility,
    tenantId,
  });
}

/** อ่านไฟล์ทั้งก้อน (ใช้กับไฟล์ที่รู้ว่าเล็ก เช่น สลิป/รายงานที่จะแนบอีเมล) */
export async function readStoredFile(relpath: string): Promise<Buffer> {
  return getStorageDriver().read(toStorageKey(relpath));
}

/** ลบ bytes ผ่าน storage driver; เรียกซ้ำได้เมื่อ object ถูกลบไปแล้ว */
export async function deleteStoredFile(relpath: string): Promise<void> {
  return getStorageDriver().delete(toStorageKey(relpath));
}

/** คืน null เมื่อไฟล์ไม่มีอยู่ (แปลงเป็น 404 ที่ route ได้ตรง ๆ) */
export async function statStoredFile(relpath: string): Promise<StoredStat | null> {
  return getStorageDriver().stat(toStorageKey(relpath));
}

/** เปิด stream สำหรับส่งออก HTTP (รองรับ Range request) */
export async function openStoredFileStream(
  relpath: string,
  range?: ByteRange
): Promise<Readable> {
  return getStorageDriver().openStream(toStorageKey(relpath), range);
}

/** สร้าง URL เสิร์ฟไฟล์ (แบบ REST ผ่าน id) */
export function buildFileUrlById(id: number) {
  return `/api/files/${id}`;
}
