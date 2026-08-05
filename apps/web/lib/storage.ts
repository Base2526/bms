// apps/web/lib/storage.ts
import path from "path";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { createWriteStream } from "fs";     // 👈 เพิ่ม
import crypto from "crypto";
import { query } from "@/lib/db";

export const STORAGE_DIR = process.env.STORAGE_DIR || "/app/storage";

/** แน่ใจว่ามีโฟลเดอร์เก็บไฟล์ */
export function ensureStorage() {
  if (!existsSync(STORAGE_DIR)) {
    // mkdir sync ไม่ได้บน edge/runtime, ใช้ promises ดีกว่า
  }
}

/** โฟลเดอร์ย่อยตามวันที่: STORAGE_DIR/YYYY/MM/DD */
export function dateDir() {
  const now = new Date();
  const p = path.join(
    STORAGE_DIR,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  );
  return p;
}

/** ทำชื่อไฟล์ให้ปลอดภัย */
export function makeSafeName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(0, 180);
}

/** รับ Web File → เซฟลง STORAGE_DIR → คืนข้อมูล row ในตาราง files */
export async function persistWebFile(file: File, renameTo?: string) {
  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  const checksum = crypto.createHash("sha256").update(buf).digest("hex");

  const dir = dateDir();
  await mkdir(dir, { recursive: true });

  const safeName = makeSafeName(renameTo || file.name || "file.bin");
  const ts = Date.now();
  const filename = `${ts}-${safeName}`;
  const full = path.join(dir, filename);

  await writeFile(full, buf);

  // เก็บ path แบบ relative เพื่อย้าย STORAGE_DIR ได้ในอนาคต
  const rel = full.replace(STORAGE_DIR + path.sep, "");

  const { rows } = await query(
    `INSERT INTO files (filename, original_name, mimetype, size, checksum, relpath)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, filename, original_name, mimetype, size, checksum, relpath, created_at, updated_at`,
    [filename, file.name || null, file.type || null, buf.length, checksum, rel]
  );

  return rows[0] as {
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
}

/**
 * รับ upload object จาก graphql-upload (มี createReadStream)
 * → เซฟลง STORAGE_DIR แบบ stream
 */
export async function persistUploadStream(
  upload: {
    filename: string;
    mimetype?: string | null;
    encoding?: string | null;
    createReadStream: () => NodeJS.ReadableStream;
  },
  renameTo?: string
) {
  const dir = dateDir();
  await mkdir(dir, { recursive: true });

  const safeName = makeSafeName(renameTo || upload.filename || "file.bin");
  const ts = Date.now();
  const filename = `${ts}-${safeName}`;
  const full = path.join(dir, filename);

  const hash = crypto.createHash("sha256");
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    const stream = upload.createReadStream();
    const out = createWriteStream(full);

    stream.on("error", (err) => {
      out.destroy();
      reject(err);
    });

    out.on("error", reject);
    out.on("finish", () => resolve());

    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      hash.update(chunk);
    });

    stream.pipe(out);
  });

  const checksum = hash.digest("hex");

  // เก็บ path แบบ relative
  const rel = full.replace(STORAGE_DIR + path.sep, "");

  const { rows } = await query(
    `INSERT INTO files (filename, original_name, mimetype, size, checksum, relpath)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, filename, original_name, mimetype, size, checksum, relpath, created_at, updated_at`,
    [
      filename,
      upload.filename || null,
      upload.mimetype || null,
      size,
      checksum,
      rel,
    ]
  );

  return rows[0] as {
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
}

/**
 * รับ Buffer ที่สร้างขึ้นในเมมโมรี (เช่นไฟล์ report ที่ generate เอง ไม่มี File/stream object
 * ให้ใช้แบบ persistWebFile/persistUploadStream) → เซฟลง STORAGE_DIR เหมือนกัน → คืน row เดียวกัน
 */
export async function persistBuffer(buf: Buffer, filename: string, mimetype: string | null) {
  const checksum = crypto.createHash("sha256").update(buf).digest("hex");

  const dir = dateDir();
  await mkdir(dir, { recursive: true });

  const safeName = makeSafeName(filename || "file.bin");
  const ts = Date.now();
  const storedName = `${ts}-${safeName}`;
  const full = path.join(dir, storedName);

  await writeFile(full, buf);

  const rel = full.replace(STORAGE_DIR + path.sep, "");

  const { rows } = await query(
    `INSERT INTO files (filename, original_name, mimetype, size, checksum, relpath)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, filename, original_name, mimetype, size, checksum, relpath, created_at, updated_at`,
    [storedName, filename || null, mimetype, buf.length, checksum, rel]
  );

  return rows[0] as {
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
}

/** สร้าง URL เสิร์ฟไฟล์ (แบบ REST ผ่าน id) */
export function buildFileUrlById(id: number) {
  return `/api/files/${id}`;
}
