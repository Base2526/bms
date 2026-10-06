import Busboy from "busboy";
import { createHash } from "crypto";
import fs from "fs";
import { mkdir, mkdtemp, rm } from "fs/promises";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

import {
  assertManagedRuntimeUploadFilename,
  managedRuntimeReleaseRoot,
  ManagedRuntimeReleaseError,
  publishManagedRuntimeRelease,
  type ManagedRuntimeReleaseSummary,
  type UploadedRuntimeFile,
} from "./managedRuntimeReleases";

const DEFAULT_MAX_COMPONENT_BYTES = 16 * 1024 * 1024 * 1024;
const DEFAULT_MAX_RELEASE_BYTES = 32 * 1024 * 1024 * 1024;
const DEFAULT_UPLOAD_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const MANIFEST_MAX_BYTES = 1024 * 1024;
const CHECKSUMS_MAX_BYTES = 256 * 1024;
const MAX_FILES = 16;
const ALLOWED_FIELDS = new Set(["releaseVersion", "platformTarget"]);

type MultipartHeaders = Record<string, string | string[] | undefined>;

function maxComponentBytes(): number {
  const configured = Number(process.env.BMS_RETAIL_LOCAL_COMPONENT_MAX_BYTES || "");
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_COMPONENT_BYTES;
}

function maxReleaseBytes(): number {
  const configured = Number(process.env.BMS_RETAIL_LOCAL_RELEASE_SET_MAX_BYTES || "");
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_RELEASE_BYTES;
}

function uploadIdleTimeoutMs(): number {
  const configured = Number(process.env.BMS_RETAIL_LOCAL_UPLOAD_IDLE_TIMEOUT_MS || "");
  return Number.isSafeInteger(configured) && configured >= 1_000 && configured <= 30 * 60 * 1000
    ? configured
    : DEFAULT_UPLOAD_IDLE_TIMEOUT_MS;
}

function maxFileBytes(filename: string): number {
  if (filename === "release.jws.json") return MANIFEST_MAX_BYTES;
  if (filename === "SHA256SUMS") return CHECKSUMS_MAX_BYTES;
  return maxComponentBytes();
}

function uploadError(error: unknown): ManagedRuntimeReleaseError {
  return error instanceof ManagedRuntimeReleaseError
    ? error
    : new ManagedRuntimeReleaseError(error instanceof Error ? error.message : "managed runtime upload failed");
}

export async function parseAndPublishManagedRuntimeRelease(
  source: NodeJS.ReadableStream,
  requestHeaders: MultipartHeaders,
): Promise<ManagedRuntimeReleaseSummary> {
  const root = managedRuntimeReleaseRoot();
  const incomingRoot = path.join(root, ".incoming");
  await mkdir(incomingRoot, { recursive: true, mode: 0o700 });
  const stagingDirectory = await mkdtemp(path.join(incomingRoot, "runtime-release-"));
  const fields: Record<string, string> = {};
  const files: UploadedRuntimeFile[] = [];
  const names = new Set<string>();
  const writes: Promise<void>[] = [];
  let failure: ManagedRuntimeReleaseError | null = null;
  let published = false;
  let totalBytes = 0;

  const fail = (error: ManagedRuntimeReleaseError) => { failure ??= error; };
  let parser: ReturnType<typeof Busboy>;
  try {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(requestHeaders)) {
      if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
    }
    parser = Busboy({
      headers,
      limits: {
        fileSize: maxComponentBytes(),
        files: MAX_FILES,
        fields: ALLOWED_FIELDS.size,
        parts: MAX_FILES + ALLOWED_FIELDS.size + 1,
        fieldSize: 256,
      },
    });
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw uploadError(error);
  }

  parser.on("field", (name, value, info) => {
    if (!ALLOWED_FIELDS.has(name) || Object.prototype.hasOwnProperty.call(fields, name)) {
      fail(new ManagedRuntimeReleaseError(`field ${name} ไม่รองรับหรือซ้ำ`));
      return;
    }
    if (info.valueTruncated) {
      fail(new ManagedRuntimeReleaseError(`${name} ยาวเกินไป`));
      return;
    }
    fields[name] = value;
  });

  parser.on("file", (fieldName, stream, info) => {
    if (fieldName !== "files") {
      fail(new ManagedRuntimeReleaseError(`file field ${fieldName} ไม่รองรับ`));
      stream.resume();
      return;
    }
    let filename: string;
    try {
      filename = assertManagedRuntimeUploadFilename(info.filename);
    } catch (error) {
      fail(uploadError(error));
      stream.resume();
      return;
    }
    if (names.has(filename)) {
      fail(new ManagedRuntimeReleaseError(`ชื่อไฟล์ซ้ำ: ${filename}`));
      stream.resume();
      return;
    }
    names.add(filename);
    const fullPath = path.join(stagingDirectory, filename);
    const hash = createHash("sha256");
    const fileLimit = maxFileBytes(filename);
    let size = 0;
    let truncated = false;
    stream.once("limit", () => {
      truncated = true;
      fail(new ManagedRuntimeReleaseError(`${filename} ใหญ่เกิน ${maxComponentBytes()} bytes`, 413));
    });
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > fileLimit) {
          const error = new ManagedRuntimeReleaseError(`${filename} ใหญ่เกิน ${fileLimit} bytes`, 413);
          fail(error);
          callback(error);
          return;
        }
        totalBytes += buffer.length;
        if (totalBytes > maxReleaseBytes()) {
          const error = new ManagedRuntimeReleaseError(`release ทั้งชุดใหญ่เกิน ${maxReleaseBytes()} bytes`, 413);
          fail(error);
          callback(error);
          return;
        }
        hash.update(buffer);
        callback(null, buffer);
      },
    });
    const write = pipeline(stream as any, meter, fs.createWriteStream(fullPath, { flags: "wx", mode: 0o600 }))
      .then(() => {
        if (!truncated) files.push({ filename, fullPath, size, sha256: hash.digest("hex") });
      })
      .catch((error) => fail(uploadError(error)));
    writes.push(write);
  });

  parser.once("filesLimit", () => fail(new ManagedRuntimeReleaseError(`รองรับไม่เกิน ${MAX_FILES} ไฟล์`)));
  parser.once("fieldsLimit", () => fail(new ManagedRuntimeReleaseError("metadata fields มากเกินไป")));
  parser.once("partsLimit", () => fail(new ManagedRuntimeReleaseError("multipart parts มากเกินไป")));

  try {
    await new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        source.removeListener("data", refreshTimeout);
        source.removeListener("error", abort);
        source.removeListener("aborted", aborted);
      };
      const finish = () => { cleanup(); resolve(); };
      const abort = (error: unknown) => { cleanup(); reject(error); };
      const aborted = () => abort(new ManagedRuntimeReleaseError("upload ถูกยกเลิก"));
      const refreshTimeout = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => abort(new ManagedRuntimeReleaseError("upload ไม่มีข้อมูลนานเกินกำหนด", 408)), uploadIdleTimeoutMs());
      };
      parser.once("close", finish);
      parser.once("error", abort);
      source.once("error", abort);
      source.once("aborted", aborted);
      source.on("data", refreshTimeout);
      refreshTimeout();
      source.pipe(parser);
    });
    await Promise.all(writes);
    if (failure) throw failure;
    if (!files.length) throw new ManagedRuntimeReleaseError("ไม่พบไฟล์ release");
    const result = await publishManagedRuntimeRelease({
      stagingDirectory,
      files,
      releaseVersion: fields.releaseVersion || "",
      platformTarget: fields.platformTarget || "",
    });
    published = true;
    return result;
  } catch (error) {
    if (typeof (source as any).destroy === "function") (source as any).destroy();
    if (!parser.destroyed) parser.destroy(uploadError(error));
    throw uploadError(error);
  } finally {
    if (!published) await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
