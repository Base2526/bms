// =============================================================
// lib/storageDrivers — where uploaded/generated files physically live
// -------------------------------------------------------------
// Every read and write of a stored file goes through one of these drivers, so
// swapping local disk for object storage is a config change instead of an edit
// across the 11 call sites that used to build `path.join(STORAGE_DIR, relpath)`
// themselves.
//
// This matters for running more than one web instance: with `local`, an upload
// handled by instance A is invisible to instance B (payment-slip OCR, report
// download and image serving all read the file back on a *later* request, which
// the load balancer can route anywhere). `local` stays the default so nothing
// changes for a single-instance deployment.
//
// The `relpath` stored in the `files` table is the driver-independent key. It
// is always POSIX-style ("2026/08/11/1699-slip.jpg") — the local driver maps it
// onto the host path separator, the S3 driver uses it as the object key.
// =============================================================

import type { Readable } from "stream";

import { createLocalDriver } from "./local";
import { createS3Driver } from "./s3";

export type StoredStat = { size: number };
export type ByteRange = { start: number; end: number };
export type WriteResult = { size: number; checksum: string };

export interface StorageDriver {
  readonly name: string;
  /** True when a file written by one instance is readable by every other instance. */
  readonly shared: boolean;
  write(relpath: string, body: Buffer): Promise<void>;
  /** Delete an object. Missing objects are treated as already deleted. */
  delete(relpath: string): Promise<void>;
  /** Consume a readable stream into storage, returning its size and sha256. */
  writeStream(relpath: string, stream: NodeJS.ReadableStream): Promise<WriteResult>;
  read(relpath: string): Promise<Buffer>;
  /** Null when the object does not exist — callers turn this into a 404. */
  stat(relpath: string): Promise<StoredStat | null>;
  openStream(relpath: string, range?: ByteRange): Promise<Readable>;
}

/** Normalise any stored path to the driver-independent POSIX form. */
export function toStorageKey(relpath: string): string {
  return String(relpath || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

let cached: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (cached) return cached;

  const kind = (process.env.STORAGE_DRIVER || "local").trim().toLowerCase();

  // Both drivers are imported statically — each only reads its own env when
  // the factory is actually called, so importing the unused one costs nothing
  // and keeps this resolvable by every bundler/runtime in the repo.
  if (kind === "s3") {
    cached = createS3Driver();
  } else if (kind === "local") {
    cached = createLocalDriver();
  } else {
    throw new Error(
      `Unknown STORAGE_DRIVER "${kind}". Supported values: "local", "s3".`
    );
  }

  return cached;
}

/** Test seam — lets a test swap the driver without going through env. */
export function __setStorageDriverForTest(driver: StorageDriver | null): void {
  cached = driver;
}
