// =============================================================
// Local filesystem driver — the historical (and still default) behaviour.
// Byte-for-byte the same layout as before the driver seam existed, so an
// existing STORAGE_DIR keeps working with no migration.
// =============================================================

import path from "path";
import fs from "fs";
import { mkdir, readFile, writeFile, stat as fsStat, unlink } from "fs/promises";
import crypto from "crypto";
import { Readable } from "stream";

import type { ByteRange, StorageDriver, StoredStat, WriteResult } from "./index";
import { toStorageKey } from "./index";

export const STORAGE_DIR = process.env.STORAGE_DIR || "/app/storage";

/**
 * Map a stored key onto a host path, refusing anything that escapes
 * STORAGE_DIR. Keys come from the `files` table rather than user input, but a
 * traversal here would read arbitrary host files, so it is checked anyway.
 */
function resolveWithin(relpath: string): string {
  const key = toStorageKey(relpath);
  const full = path.resolve(STORAGE_DIR, key);
  const root = path.resolve(STORAGE_DIR);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`storage path escapes STORAGE_DIR: ${relpath}`);
  }
  return full;
}

export function createLocalDriver(): StorageDriver {
  return {
    name: "local",
    shared: false,

    async write(relpath: string, body: Buffer): Promise<void> {
      const full = resolveWithin(relpath);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body);
    },

    async delete(relpath: string): Promise<void> {
      try {
        await unlink(resolveWithin(relpath));
      } catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
      }
    },

    async writeStream(relpath, stream): Promise<WriteResult> {
      const full = resolveWithin(relpath);
      await mkdir(path.dirname(full), { recursive: true });

      const hash = crypto.createHash("sha256");
      let size = 0;

      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(full);
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

      return { size, checksum: hash.digest("hex") };
    },

    async read(relpath: string): Promise<Buffer> {
      return readFile(resolveWithin(relpath));
    },

    async stat(relpath: string): Promise<StoredStat | null> {
      try {
        const s = await fsStat(resolveWithin(relpath));
        if (!s.isFile()) return null;
        return { size: s.size };
      } catch (err: any) {
        if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return null;
        throw err;
      }
    },

    async openStream(relpath: string, range?: ByteRange): Promise<Readable> {
      const full = resolveWithin(relpath);
      return range
        ? fs.createReadStream(full, { start: range.start, end: range.end })
        : fs.createReadStream(full);
    },
  };
}
