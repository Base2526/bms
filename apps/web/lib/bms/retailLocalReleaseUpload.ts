import Busboy from "busboy";
import { Readable } from "stream";

import {
  deleteStoredFile,
  type PendingStoredFile,
  writeWebFileStream,
} from "@/lib/storage";

const DEFAULT_MAX_RELEASE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_FIELD_BYTES = 16 * 1024;
const ALLOWED_FIELDS = new Set([
  "platform",
  "packageType",
  "version",
  "channel",
  "status",
  "isLatest",
  "minOs",
  "releaseNotes",
]);

export class RetailLocalReleaseUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "RetailLocalReleaseUploadError";
  }
}

export type ParsedRetailLocalReleaseUpload = {
  fields: Record<string, string>;
  storedFile: PendingStoredFile;
};

function maxReleaseBytes(): number {
  const configured = Number(process.env.BMS_RETAIL_LOCAL_RELEASE_MAX_BYTES || "");
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_RELEASE_BYTES;
}

function uploadError(error: unknown): RetailLocalReleaseUploadError {
  if (error instanceof RetailLocalReleaseUploadError) return error;
  return new RetailLocalReleaseUploadError(
    error instanceof Error ? error.message : "release upload failed"
  );
}

/**
 * Parse the multipart envelope without materialising the installer. The file
 * stream is consumed by the configured storage driver while busboy continues
 * parsing the small metadata fields.
 */
export async function parseRetailLocalReleaseUpload(
  request: Request
): Promise<ParsedRetailLocalReleaseUpload> {
  if (!request.body) throw new RetailLocalReleaseUploadError("file is required");

  const fields: Record<string, string> = {};
  const limit = maxReleaseBytes();
  let fileSeen = false;
  let parseFailure: RetailLocalReleaseUploadError | null = null;
  let storedFile: PendingStoredFile | null = null;
  let storedPromise: Promise<PendingStoredFile> | null = null;

  const fail = (error: RetailLocalReleaseUploadError) => {
    parseFailure ??= error;
  };

  let parser: ReturnType<typeof Busboy>;
  try {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    parser = Busboy({
      headers,
      limits: {
        fileSize: limit,
        files: 1,
        fields: ALLOWED_FIELDS.size,
        // Busboy emits partsLimit when the counter reaches (not exceeds) the
        // configured value, so reserve one sentinel beyond 8 fields + 1 file.
        parts: ALLOWED_FIELDS.size + 2,
        fieldSize: MAX_FIELD_BYTES,
      },
    });
  } catch (error) {
    throw new RetailLocalReleaseUploadError(
      error instanceof Error ? error.message : "invalid multipart upload"
    );
  }

  parser.on("field", (name, value, info) => {
    if (!ALLOWED_FIELDS.has(name)) {
      fail(new RetailLocalReleaseUploadError(`unexpected field: ${name}`));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      fail(new RetailLocalReleaseUploadError(`duplicate field: ${name}`));
      return;
    }
    if (info.valueTruncated) {
      fail(new RetailLocalReleaseUploadError(`${name} is too long`));
      return;
    }
    fields[name] = value;
  });

  parser.on("file", (name, file, info) => {
    if (name !== "file" || fileSeen) {
      fail(new RetailLocalReleaseUploadError(name === "file" ? "only one file is allowed" : `unexpected file field: ${name}`));
      file.resume();
      return;
    }

    fileSeen = true;
    file.once("limit", () => {
      fail(new RetailLocalReleaseUploadError(`release file exceeds ${limit} bytes`, 413));
    });
    storedPromise = writeWebFileStream(file, info.filename, info.mimeType, info.filename);
    void storedPromise.catch((error) => {
      fail(uploadError(error));
      // A failed destination may have unpiped itself. Drain the multipart file
      // so busboy can reach `close` and the request terminates cleanly.
      file.resume();
    });
  });

  parser.once("filesLimit", () => fail(new RetailLocalReleaseUploadError("only one file is allowed")));
  parser.once("fieldsLimit", () => fail(new RetailLocalReleaseUploadError("too many metadata fields")));
  parser.once("partsLimit", () => fail(new RetailLocalReleaseUploadError("too many multipart parts")));

  const source = Readable.fromWeb(request.body as any);
  try {
    await new Promise<void>((resolve, reject) => {
      parser.once("close", resolve);
      parser.once("error", reject);
      source.once("error", reject);
      source.pipe(parser);
    });

    if (!fileSeen || !storedPromise) {
      throw new RetailLocalReleaseUploadError("file is required");
    }
    storedFile = await storedPromise;
    if (parseFailure) throw parseFailure;
    return { fields, storedFile };
  } catch (error) {
    source.destroy();
    if (!parser.destroyed) parser.destroy(uploadError(error));
    if (!storedFile && storedPromise) {
      try {
        storedFile = await storedPromise;
      } catch {
        // The storage driver already failed; there is no completed key to clean.
      }
    }
    const cleanupTarget = storedFile as PendingStoredFile | null;
    if (cleanupTarget) {
      try {
        await deleteStoredFile(cleanupTarget.relpath);
      } catch (cleanupError) {
        console.error("retail local upload cleanup failed", cleanupError);
      }
    }
    throw uploadError(error);
  }
}
