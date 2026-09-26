import path from "path";
import { Readable } from "stream";
import { query, getClient } from "@/lib/db";
import { openStoredFileStream, persistWebFile, statStoredFile } from "@/lib/storage";

export type RetailLocalPlatform = "windows-x64" | "ubuntu-x64" | "macos-arm64";
export type RetailLocalPackageType = "server-pos" | "server" | "pos";
export type RetailLocalReleaseStatus = "latest" | "supported" | "legacy" | "deprecated" | "hidden";
export type RetailLocalReleaseChannel = "pilot" | "stable" | "internal";

export type RetailLocalReleaseAsset = {
  id: string;
  platform: RetailLocalPlatform;
  package_type: RetailLocalPackageType;
  version: string;
  channel: RetailLocalReleaseChannel;
  status: RetailLocalReleaseStatus;
  is_latest: boolean;
  file_id: number;
  original_name: string;
  size_bytes: number;
  sha256: string;
  min_os: string;
  release_notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export class RetailLocalReleaseError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "RetailLocalReleaseError";
  }
}

const PLATFORMS = new Set<RetailLocalPlatform>(["windows-x64", "ubuntu-x64", "macos-arm64"]);
const PACKAGE_TYPES = new Set<RetailLocalPackageType>(["server-pos", "server", "pos"]);
const STATUSES = new Set<RetailLocalReleaseStatus>(["latest", "supported", "legacy", "deprecated", "hidden"]);
const CHANNELS = new Set<RetailLocalReleaseChannel>(["pilot", "stable", "internal"]);

function assertPlatform(value: unknown): RetailLocalPlatform {
  if (typeof value === "string" && PLATFORMS.has(value as RetailLocalPlatform)) return value as RetailLocalPlatform;
  throw new RetailLocalReleaseError("invalid platform");
}

function assertPackageType(value: unknown): RetailLocalPackageType {
  if (typeof value === "string" && PACKAGE_TYPES.has(value as RetailLocalPackageType)) {
    return value as RetailLocalPackageType;
  }
  throw new RetailLocalReleaseError("invalid package type");
}

function assertStatus(value: unknown): RetailLocalReleaseStatus {
  if (typeof value === "string" && STATUSES.has(value as RetailLocalReleaseStatus)) return value as RetailLocalReleaseStatus;
  throw new RetailLocalReleaseError("invalid status");
}

function assertChannel(value: unknown): RetailLocalReleaseChannel {
  if (typeof value === "string" && CHANNELS.has(value as RetailLocalReleaseChannel)) return value as RetailLocalReleaseChannel;
  throw new RetailLocalReleaseError("invalid channel");
}

function trimRequired(value: unknown, field: string, max = 200): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new RetailLocalReleaseError(`${field} is required`);
  return text.slice(0, max);
}

function serialize(row: any): RetailLocalReleaseAsset {
  return {
    id: String(row.id),
    platform: row.platform,
    package_type: row.package_type,
    version: String(row.version),
    channel: row.channel,
    status: row.status,
    is_latest: row.is_latest === true,
    file_id: Number(row.file_id),
    original_name: String(row.original_name || ""),
    size_bytes: Number(row.size_bytes || 0),
    sha256: String(row.sha256 || ""),
    min_os: String(row.min_os || ""),
    release_notes: String(row.release_notes || ""),
    created_by: row.created_by == null ? null : String(row.created_by),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function expectedExtensions(platform: RetailLocalPlatform, packageType: RetailLocalPackageType): string[] {
  if (platform === "windows-x64") return [".exe"];
  if (platform === "ubuntu-x64") return [".deb"];
  return packageType === "pos" ? [".dmg"] : [".pkg"];
}

function mimeForDownload(platform: RetailLocalPlatform, filename: string): string {
  if (filename.toLowerCase().endsWith(".dmg")) return "application/x-apple-diskimage";
  switch (platform) {
    case "windows-x64": return "application/vnd.microsoft.portable-executable";
    case "ubuntu-x64": return "application/vnd.debian.binary-package";
    case "macos-arm64": return "application/vnd.apple.installer+xml";
  }
}

function validateFileName(file: File, platform: RetailLocalPlatform, packageType: RetailLocalPackageType) {
  const ext = path.extname(file.name || "").toLowerCase();
  const expected = expectedExtensions(platform, packageType);
  if (!expected.includes(ext)) {
    throw new RetailLocalReleaseError(`expected ${expected.join(" or ")} file for ${platform} ${packageType}`);
  }
}

export async function listRetailLocalReleaseAssets(options: { includeHidden?: boolean } = {}) {
  const { rows } = await query(
    `
    SELECT id, platform, package_type, version, channel, status, is_latest, file_id, original_name,
           size_bytes, sha256, min_os, release_notes, created_by, created_at, updated_at
      FROM bms_retail_local_release_assets
     WHERE ($1::boolean OR status <> 'hidden')
     ORDER BY platform ASC, package_type ASC, is_latest DESC, created_at DESC, version DESC
    `,
    [options.includeHidden === true]
  );
  return rows.map(serialize);
}

export async function getPublicRetailLocalDownloads() {
  const assets = await listRetailLocalReleaseAssets({ includeHidden: false });
  const latest: Partial<Record<RetailLocalPlatform, Partial<Record<RetailLocalPackageType, RetailLocalReleaseAsset>>>> = {};
  const archive: RetailLocalReleaseAsset[] = [];

  for (const asset of assets) {
    if (asset.is_latest && asset.status === "latest" && !latest[asset.platform]?.[asset.package_type]) {
      latest[asset.platform] = { ...latest[asset.platform], [asset.package_type]: asset };
    } else {
      archive.push(asset);
    }
  }

  return { latest, archive };
}

export async function createRetailLocalReleaseAsset(input: {
  file: File;
  platform: unknown;
  packageType: unknown;
  version: unknown;
  channel?: unknown;
  status?: unknown;
  isLatest?: unknown;
  minOs: unknown;
  releaseNotes?: unknown;
  adminId: string | number;
}) {
  const platform = assertPlatform(input.platform);
  const packageType = assertPackageType(input.packageType);
  validateFileName(input.file, platform, packageType);
  const version = trimRequired(input.version, "version", 80);
  const channel = input.channel ? assertChannel(input.channel) : "pilot";
  const requestedStatus = input.status ? assertStatus(input.status) : "supported";
  const isLatest = input.isLatest === true || input.isLatest === "true" || requestedStatus === "latest";
  const status: RetailLocalReleaseStatus = isLatest ? "latest" : requestedStatus;
  const minOs = trimRequired(input.minOs, "minimum OS", 200);
  const releaseNotes = typeof input.releaseNotes === "string" ? input.releaseNotes.trim().slice(0, 5000) : "";

  const stored = await persistWebFile(input.file, input.file.name, "private", null);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    if (isLatest) {
      await client.query(
        `UPDATE bms_retail_local_release_assets
            SET is_latest = FALSE,
                status = CASE WHEN status = 'latest' THEN 'supported' ELSE status END
          WHERE platform = $1 AND package_type = $2`,
        [platform, packageType]
      );
    }
    const { rows } = await client.query(
      `
      INSERT INTO bms_retail_local_release_assets
        (platform, package_type, version, channel, status, is_latest, file_id, original_name, size_bytes, sha256, min_os, release_notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id, platform, package_type, version, channel, status, is_latest, file_id, original_name,
                size_bytes, sha256, min_os, release_notes, created_by, created_at, updated_at
      `,
      [
        platform,
        packageType,
        version,
        channel,
        status,
        isLatest,
        stored.id,
        stored.original_name || stored.filename,
        stored.size,
        stored.checksum,
        minOs,
        releaseNotes,
        String(input.adminId),
      ]
    );
    await client.query("COMMIT");
    return serialize(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateRetailLocalReleaseAsset(id: string, input: {
  status?: unknown;
  isLatest?: unknown;
  minOs?: unknown;
  releaseNotes?: unknown;
}) {
  const current = await getRetailLocalReleaseAsset(id, { includeHidden: true });
  if (!current) throw new RetailLocalReleaseError("release asset not found", 404);

  const status = input.status == null ? current.status : assertStatus(input.status);
  const isLatest = input.isLatest == null ? current.is_latest : input.isLatest === true;
  const nextLatest = status === "hidden" ? false : isLatest || status === "latest";
  const nextStatus: RetailLocalReleaseStatus = status === "hidden" ? "hidden" : nextLatest ? "latest" : status;
  const minOs = input.minOs == null ? current.min_os : trimRequired(input.minOs, "minimum OS", 200);
  const releaseNotes = input.releaseNotes == null
    ? current.release_notes
    : String(input.releaseNotes || "").trim().slice(0, 5000);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    if (nextLatest) {
      await client.query(
        `UPDATE bms_retail_local_release_assets
            SET is_latest = FALSE,
                status = CASE WHEN status = 'latest' THEN 'supported' ELSE status END
          WHERE platform = $1 AND package_type = $2 AND id <> $3`,
        [current.platform, current.package_type, id]
      );
    }
    const { rows } = await client.query(
      `
      UPDATE bms_retail_local_release_assets
         SET status = $2,
             is_latest = $3,
             min_os = $4,
             release_notes = $5
       WHERE id = $1
       RETURNING id, platform, package_type, version, channel, status, is_latest, file_id, original_name,
                 size_bytes, sha256, min_os, release_notes, created_by, created_at, updated_at
      `,
      [id, nextStatus, nextLatest, minOs, releaseNotes]
    );
    await client.query("COMMIT");
    return serialize(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getRetailLocalReleaseAsset(id: string, options: { includeHidden?: boolean } = {}) {
  const { rows } = await query(
    `
    SELECT id, platform, package_type, version, channel, status, is_latest, file_id, original_name,
           size_bytes, sha256, min_os, release_notes, created_by, created_at, updated_at
      FROM bms_retail_local_release_assets
     WHERE id = $1
       AND ($2::boolean OR status <> 'hidden')
     LIMIT 1
    `,
    [id, options.includeHidden === true]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

export async function openRetailLocalReleaseDownload(id: string) {
  const { rows } = await query(
    `
    SELECT a.id, a.platform, a.package_type, a.version, a.status, a.original_name, a.size_bytes,
           a.sha256, f.relpath
      FROM bms_retail_local_release_assets a
      JOIN files f ON f.id = a.file_id AND f.deleted_at IS NULL
     WHERE a.id = $1
       AND a.status <> 'hidden'
     LIMIT 1
    `,
    [id]
  );
  const row = rows[0];
  if (!row?.relpath) throw new RetailLocalReleaseError("release asset not found", 404);
  const stat = await statStoredFile(row.relpath);
  if (!stat) throw new RetailLocalReleaseError("release file missing", 404);
  const nodeStream = await openStoredFileStream(row.relpath);
  return {
    stream: Readable.toWeb(nodeStream) as any,
    size: Number(stat.size),
    filename: String(row.original_name),
    mime: mimeForDownload(row.platform, row.original_name),
    sha256: String(row.sha256),
  };
}
