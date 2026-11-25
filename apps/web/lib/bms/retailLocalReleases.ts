import path from "path";
import { Readable } from "stream";
import { valid } from "semver";
import { query, getClient } from "@/lib/db";
import { selectDesktopUpdates } from "./desktopReleasePolicy";
import {
  inferRetailLocalInstallerIdentity,
  inferRetailLocalInstallerIdentityFromStoredPath,
  retailLocalStoredPathOriginalName,
} from "./retailLocalReleaseFilename";
import {
  deleteStoredFile,
  inspectStoredFile,
  openStoredFileStream,
  type PendingStoredFile,
  statStoredFile,
} from "@/lib/storage";

export type RetailLocalPlatform = "windows-x64" | "windows-x86-legacy" | "ubuntu-x64" | "macos-arm64" | "macos-x64";
export type RetailLocalPackageType = "server-pos" | "server" | "pos";
export type RetailLocalReleaseStatus = "latest" | "supported" | "legacy" | "deprecated" | "hidden";
export type RetailLocalReleaseChannel = "pilot" | "stable" | "internal";
export type RetailLocalReleaseAccessLevel = "public" | "trial";

export type RetailLocalReleaseAsset = {
  id: string;
  platform: RetailLocalPlatform;
  package_type: RetailLocalPackageType;
  version: string;
  channel: RetailLocalReleaseChannel;
  status: RetailLocalReleaseStatus;
  access_level: RetailLocalReleaseAccessLevel;
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
  purged_at: string | null;
  /** Release/file-row tuple agreement. Physical object verification is separate. */
  identity_consistent: boolean;
  /** null unless the caller explicitly requested a storage existence check. */
  storage_present: boolean | null;
};

export type PurgedRetailLocalReleaseFile = {
  releaseId: string;
  freedBytes: number;
  purgedAt: string;
  alreadyPurged: boolean;
};

export class RetailLocalReleaseError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "RetailLocalReleaseError";
  }
}

const PLATFORMS = new Set<RetailLocalPlatform>([
  "windows-x64",
  "windows-x86-legacy",
  "ubuntu-x64",
  "macos-arm64",
  "macos-x64",
]);
const PACKAGE_TYPES = new Set<RetailLocalPackageType>(["server-pos", "server", "pos"]);
const STATUSES = new Set<RetailLocalReleaseStatus>(["latest", "supported", "legacy", "deprecated", "hidden"]);
const CHANNELS = new Set<RetailLocalReleaseChannel>(["pilot", "stable", "internal"]);
const ACCESS_LEVELS = new Set<RetailLocalReleaseAccessLevel>(["public", "trial"]);
const RELEASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function assertAccessLevel(value: unknown): RetailLocalReleaseAccessLevel {
  if (typeof value === "string" && ACCESS_LEVELS.has(value as RetailLocalReleaseAccessLevel)) {
    return value as RetailLocalReleaseAccessLevel;
  }
  throw new RetailLocalReleaseError("invalid access level");
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
    access_level: row.access_level ?? "public",
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
    purged_at: row.purged_at == null
      ? null
      : row.purged_at instanceof Date
        ? row.purged_at.toISOString()
        : String(row.purged_at),
    identity_consistent: row.identity_consistent !== false
      && (row.relpath == null || retailLocalStoredPathOriginalName(row.relpath) === String(row.original_name))
      && (row.stored_filename == null
        || String(row.relpath || "").replace(/\\/g, "/").split("/").pop() === String(row.stored_filename)),
    storage_present: typeof row.storage_present === "boolean" ? row.storage_present : null,
  };
}

function rowIdentityMatches(row: any): boolean {
  const releaseIdentity = inferRetailLocalInstallerIdentity(String(row.original_name || ""));
  const fileIdentity = inferRetailLocalInstallerIdentity(String(row.file_original_name || ""));
  const storedIdentity = inferRetailLocalInstallerIdentityFromStoredPath(row.relpath);
  return releaseIdentity?.packageType === row.package_type
    && fileIdentity?.packageType === row.package_type
    && storedIdentity?.packageType === row.package_type
    && releaseIdentity?.platform === row.platform
    && fileIdentity?.platform === row.platform
    && storedIdentity?.platform === row.platform
    && releaseIdentity?.version === String(row.version)
    && fileIdentity?.version === String(row.version)
    && storedIdentity?.version === String(row.version)
    && String(row.original_name) === String(row.file_original_name)
    && retailLocalStoredPathOriginalName(row.relpath) === String(row.original_name)
    && (row.stored_filename == null
      || String(row.relpath || "").replace(/\\/g, "/").split("/").pop() === String(row.stored_filename))
    && Number(row.size_bytes) === Number(row.file_size)
    && /^[0-9a-f]{64}$/i.test(String(row.sha256))
    && String(row.sha256).toLowerCase() === String(row.file_checksum).toLowerCase()
    && row.purged_at == null
    && row.deleted_at == null;
}

async function verifyStoredReleaseRow(row: any, verifyChecksum: boolean): Promise<boolean> {
  if (!rowIdentityMatches(row) || !row.relpath) return false;
  try {
    const stat = await statStoredFile(String(row.relpath));
    if (!stat || Number(stat.size) !== Number(row.size_bytes)) return false;
    if (!verifyChecksum) return true;
    const inspected = await inspectStoredFile(String(row.relpath));
    return inspected.size === Number(row.size_bytes)
      && inspected.checksum === String(row.sha256).toLowerCase();
  } catch {
    return false;
  }
}

async function filterAssetsWithPresentStorage(
  assets: RetailLocalReleaseAsset[],
): Promise<RetailLocalReleaseAsset[]> {
  if (!assets.length) return [];
  const ids = assets.map((asset) => asset.id).filter((id) => RELEASE_ID_PATTERN.test(id));
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT a.id, a.platform, a.package_type, a.version, a.original_name, a.size_bytes, a.sha256,
            f.original_name AS file_original_name, f.size AS file_size,
            f.checksum AS file_checksum, f.filename AS stored_filename,
            f.relpath, f.deleted_at, f.deleted_at AS purged_at
       FROM bms_retail_local_release_assets a
       JOIN files f ON f.id = a.file_id
      WHERE a.id = ANY($1::uuid[])`,
    [ids],
  );
  const present = new Set<string>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, rows.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= rows.length) return;
      const row = rows[index];
      if (await verifyStoredReleaseRow(row, false)) present.add(String(row.id));
    }
  });
  await Promise.all(workers);
  return assets.filter((asset) => present.has(asset.id));
}

function expectedExtensions(platform: RetailLocalPlatform, packageType: RetailLocalPackageType): string[] {
  if (platform === "windows-x64" || platform === "windows-x86-legacy") return [".exe"];
  if (platform === "ubuntu-x64") return [".deb"];
  return packageType === "pos" ? [".dmg"] : [".pkg"];
}

function mimeForDownload(platform: RetailLocalPlatform, filename: string): string {
  if (filename.toLowerCase().endsWith(".dmg")) return "application/x-apple-diskimage";
  switch (platform) {
    case "windows-x64":
    case "windows-x86-legacy":
      return "application/vnd.microsoft.portable-executable";
    case "ubuntu-x64": return "application/vnd.debian.binary-package";
    case "macos-arm64":
    case "macos-x64":
      return "application/vnd.apple.installer+xml";
  }
}

function isWindowsX86Filename(filename: string): boolean {
  return /(?:^|[-_])(?:windows[-_])?(?:x86(?![_-]?64)|ia32)(?:[-_.]|$)/i.test(filename);
}

function assertPlatformPackageCompatibility(platform: RetailLocalPlatform, packageType: RetailLocalPackageType) {
  if (platform === "windows-x86-legacy" && packageType !== "pos") {
    throw new RetailLocalReleaseError("windows-x86-legacy supports POS Desktop only");
  }
}

function validateFileName(filename: string, platform: RetailLocalPlatform, packageType: RetailLocalPackageType) {
  const ext = path.extname(filename || "").toLowerCase();
  const expected = expectedExtensions(platform, packageType);
  if (!expected.includes(ext)) {
    throw new RetailLocalReleaseError(`expected ${expected.join(" or ")} file for ${platform} ${packageType}`);
  }
  if (platform === "windows-x86-legacy" && !isWindowsX86Filename(filename)) {
    throw new RetailLocalReleaseError("windows-x86-legacy filename must include x86 or ia32");
  }
  if (platform === "windows-x64" && isWindowsX86Filename(filename)) {
    throw new RetailLocalReleaseError("x86 installer must use the windows-x86-legacy platform");
  }
  const identity = inferRetailLocalInstallerIdentity(filename);
  if (!identity) {
    throw new RetailLocalReleaseError("installer filename must use the canonical Retail Local release format");
  }
  if (identity.packageType !== packageType) {
    throw new RetailLocalReleaseError(
      `installer filename identifies ${identity.packageType}, not selected package type ${packageType}`
    );
  }
  if (identity.platform !== platform) {
    throw new RetailLocalReleaseError(
      `installer filename identifies ${identity.platform}, not selected platform ${platform}`
    );
  }
}

export async function listRetailLocalReleaseAssets(
  options: { includeHidden?: boolean; verifyStorage?: boolean } = {},
) {
  const { rows } = await query(
    `
    SELECT a.id, a.platform, a.package_type, a.version, a.channel, a.status, a.is_latest, a.file_id,
           a.original_name, a.access_level, a.size_bytes, a.sha256, a.min_os, a.release_notes,
           a.created_by, a.created_at, a.updated_at, f.deleted_at AS purged_at,
           f.original_name AS file_original_name, f.filename AS stored_filename,
           f.size AS file_size, f.checksum AS file_checksum, f.relpath, f.deleted_at,
           (f.deleted_at IS NULL AND a.original_name = f.original_name
            AND a.size_bytes = f.size AND lower(a.sha256) = lower(f.checksum)) AS identity_consistent
      FROM bms_retail_local_release_assets a
      JOIN files f ON f.id = a.file_id
     WHERE ($1::boolean OR (
       a.status <> 'hidden' AND a.access_level = 'public' AND f.deleted_at IS NULL
       AND a.original_name = f.original_name
       AND a.size_bytes = f.size
       AND lower(a.sha256) = lower(f.checksum)
     ))
     ORDER BY a.platform ASC, a.package_type ASC, a.is_latest DESC, a.created_at DESC, a.version DESC
    `,
    [options.includeHidden === true]
  );
  const assets = rows.map(serialize);
  if (options.verifyStorage !== true) return assets;
  const presentIds = new Set((await filterAssetsWithPresentStorage(assets)).map((asset) => asset.id));
  return assets.map((asset) => ({
    ...asset,
    storage_present: presentIds.has(asset.id),
    identity_consistent: asset.identity_consistent && presentIds.has(asset.id),
  }));
}

export async function getPublicRetailLocalDownloads() {
  const assets = await filterAssetsWithPresentStorage(
    await listRetailLocalReleaseAssets({ includeHidden: false }),
  );
  const latest: Partial<Record<RetailLocalPlatform, Partial<Record<RetailLocalPackageType, RetailLocalReleaseAsset>>>> = {};
  const archive: RetailLocalReleaseAsset[] = [];

  for (const asset of assets) {
    const identity = inferRetailLocalInstallerIdentity(asset.original_name);
    if (identity?.packageType !== asset.package_type
      || identity.platform !== asset.platform
      || identity.version !== asset.version) {
      continue;
    }
    if (asset.is_latest && asset.status === "latest" && !latest[asset.platform]?.[asset.package_type]) {
      latest[asset.platform] = { ...latest[asset.platform], [asset.package_type]: asset };
    } else {
      archive.push(asset);
    }
  }

  return { latest, archive };
}

export async function getDesktopReleaseUpdates(client: { version: string; platform: string; arch?: string }) {
  const assets = await filterAssetsWithPresentStorage(await listRetailLocalReleaseAssets());
  return selectDesktopUpdates(assets, client);
}

export async function createRetailLocalReleaseAsset(input: {
  storedFile: PendingStoredFile;
  platform: unknown;
  packageType: unknown;
  version: unknown;
  channel?: unknown;
  status?: unknown;
  accessLevel?: unknown;
  isLatest?: unknown;
  expectedSha256: unknown;
  minOs: unknown;
  releaseNotes?: unknown;
  adminId: string | number;
}) {
  let commitAttempted = false;
  try {
    const platform = assertPlatform(input.platform);
    const packageType = assertPackageType(input.packageType);
    assertPlatformPackageCompatibility(platform, packageType);
    validateFileName(input.storedFile.original_name || input.storedFile.filename, platform, packageType);
    const version = trimRequired(input.version, "version", 80);
    const identity = inferRetailLocalInstallerIdentity(input.storedFile.original_name || input.storedFile.filename);
    if (!identity || identity.version !== version || !valid(version)) {
      throw new RetailLocalReleaseError("version must be semantic and match the installer filename");
    }
    if (retailLocalStoredPathOriginalName(input.storedFile.relpath) !== input.storedFile.original_name
      || String(input.storedFile.relpath).replace(/\\/g, "/").split("/").pop() !== input.storedFile.filename) {
      throw new RetailLocalReleaseError("stored installer path does not match the uploaded filename");
    }
    const expectedSha256 = trimRequired(input.expectedSha256, "SHA-256", 64).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expectedSha256)
      || expectedSha256 !== input.storedFile.checksum.toLowerCase()) {
      throw new RetailLocalReleaseError("uploaded installer SHA-256 does not match the selected file");
    }
    const channel = input.channel ? assertChannel(input.channel) : "pilot";
    const requestedStatus = input.status ? assertStatus(input.status) : "supported";
    const requestedAccess = input.accessLevel == null ? "public" : assertAccessLevel(input.accessLevel);
    const isLatest = input.isLatest === true || input.isLatest === "true" || requestedStatus === "latest";
    const status: RetailLocalReleaseStatus = isLatest ? "latest" : requestedStatus;
    const minOs = trimRequired(input.minOs, "minimum OS", 200);
    const releaseNotes = typeof input.releaseNotes === "string" ? input.releaseNotes.trim().slice(0, 5000) : "";

    const client = await getClient();
    try {
      await client.query("BEGIN");
      const fileResult = await client.query(
        `INSERT INTO files (filename, original_name, mimetype, size, checksum, relpath, visibility, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,'private',NULL)
         RETURNING id`,
        [
          input.storedFile.filename,
          input.storedFile.original_name,
          input.storedFile.mimetype,
          input.storedFile.size,
          input.storedFile.checksum,
          input.storedFile.relpath,
        ]
      );
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
          (platform, package_type, version, channel, status, access_level, is_latest, file_id, original_name, size_bytes, sha256, min_os, release_notes, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id, platform, package_type, version, channel, status, access_level, is_latest, file_id, original_name,
                  size_bytes, sha256, min_os, release_notes, created_by, created_at, updated_at
        `,
        [
          platform,
          packageType,
          version,
          channel,
          status,
          requestedAccess,
          isLatest,
          fileResult.rows[0].id,
          input.storedFile.original_name || input.storedFile.filename,
          input.storedFile.size,
          input.storedFile.checksum,
          minOs,
          releaseNotes,
          String(input.adminId),
        ]
      );
      commitAttempted = true;
      await client.query("COMMIT");
      return serialize(rows[0]);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    // Once COMMIT has been attempted its outcome can be ambiguous. Keeping an
    // orphan is safer than deleting bytes which a committed row may reference.
    if (!commitAttempted) {
      try {
        await deleteStoredFile(input.storedFile.relpath);
      } catch (cleanupError) {
        console.error("retail local release cleanup failed", cleanupError);
      }
    }
    throw error;
  }
}

export async function updateRetailLocalReleaseAsset(id: string, input: {
  status?: unknown;
  accessLevel?: unknown;
  isLatest?: unknown;
  minOs?: unknown;
  releaseNotes?: unknown;
}) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT a.id, a.platform, a.package_type, a.version, a.channel, a.status, a.is_latest, a.file_id,
              a.original_name, a.access_level, a.size_bytes, a.sha256, a.min_os, a.release_notes,
              a.created_by, a.created_at, a.updated_at, f.deleted_at AS purged_at,
              f.original_name AS file_original_name, f.size AS file_size,
              f.checksum AS file_checksum, f.filename AS stored_filename, f.relpath, f.deleted_at,
              (f.deleted_at IS NULL AND a.original_name = f.original_name
               AND a.size_bytes = f.size AND lower(a.sha256) = lower(f.checksum)) AS identity_consistent
         FROM bms_retail_local_release_assets a
         JOIN files f ON f.id = a.file_id
        WHERE a.id = $1
        FOR UPDATE OF a, f`,
      [id]
    );
    if (!currentResult.rows[0]) throw new RetailLocalReleaseError("release asset not found", 404);
    const current = serialize(currentResult.rows[0]);
    if (current.purged_at) {
      throw new RetailLocalReleaseError("release file was permanently deleted", 409);
    }

    const status = input.status == null ? current.status : assertStatus(input.status);
    const accessLevel = input.accessLevel == null ? current.access_level : assertAccessLevel(input.accessLevel);
    const isLatest = input.isLatest == null ? current.is_latest : input.isLatest === true;
    const nextLatest = status === "hidden" ? false : isLatest || status === "latest";
    const nextStatus: RetailLocalReleaseStatus = status === "hidden" ? "hidden" : nextLatest ? "latest" : status;
    const minOs = input.minOs == null ? current.min_os : trimRequired(input.minOs, "minimum OS", 200);
    const releaseNotes = input.releaseNotes == null
      ? current.release_notes
      : String(input.releaseNotes || "").trim().slice(0, 5000);

    if (nextStatus !== "hidden" && !rowIdentityMatches(currentResult.rows[0])) {
      throw new RetailLocalReleaseError(
        "release package identity is inconsistent; keep it hidden and upload the correct installer",
        409,
      );
    }
    if ((current.status === "hidden" || nextLatest)
      && nextStatus !== "hidden"
      && !await verifyStoredReleaseRow(currentResult.rows[0], true)) {
      throw new RetailLocalReleaseError(
        "release file is missing or does not match its recorded size/checksum",
        409,
      );
    }

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
             access_level = $4,
             min_os = $5,
             release_notes = $6
       WHERE id = $1
       RETURNING id, platform, package_type, version, channel, status, access_level, is_latest, file_id, original_name,
                 size_bytes, sha256, min_os, release_notes, created_by, created_at, updated_at
      `,
      [id, nextStatus, nextLatest, accessLevel, minOs, releaseNotes]
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
    SELECT a.id, a.platform, a.package_type, a.version, a.channel, a.status, a.is_latest, a.file_id,
           a.original_name, a.access_level, a.size_bytes, a.sha256, a.min_os, a.release_notes,
           a.created_by, a.created_at, a.updated_at, f.deleted_at AS purged_at,
           f.filename AS stored_filename, f.relpath,
           (f.deleted_at IS NULL AND a.original_name = f.original_name
            AND a.size_bytes = f.size AND lower(a.sha256) = lower(f.checksum)) AS identity_consistent
      FROM bms_retail_local_release_assets a
      JOIN files f ON f.id = a.file_id
     WHERE a.id = $1
       AND ($2::boolean OR (
         a.status <> 'hidden' AND f.deleted_at IS NULL
         AND a.original_name = f.original_name
         AND a.size_bytes = f.size
         AND lower(a.sha256) = lower(f.checksum)
       ))
     LIMIT 1
    `,
    [id, options.includeHidden === true]
  );
  const row = rows[0];
  if (!row || (options.includeHidden !== true && !rowIdentityMatches(row))) return null;
  return serialize(row);
}

/**
 * Permanently remove installer bytes while retaining the release/file rows as a
 * small audit tombstone. Requiring `hidden` makes an operator revoke every
 * download path before this irreversible storage mutation.
 */
export async function purgeRetailLocalReleaseFile(input: {
  releaseId: string;
  tenantId: string;
  adminId: string | number;
}): Promise<PurgedRetailLocalReleaseFile> {
  if (!RELEASE_ID_PATTERN.test(input.releaseId)) {
    throw new RetailLocalReleaseError("release asset not found", 404);
  }
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT a.id, a.platform, a.package_type, a.version, a.channel, a.status, a.is_latest,
              a.original_name, a.size_bytes, a.sha256, f.id AS file_id, f.relpath, f.deleted_at
         FROM bms_retail_local_release_assets a
         JOIN files f ON f.id = a.file_id
        WHERE a.id = $1
        FOR UPDATE OF a, f`,
      [input.releaseId]
    );
    const row = result.rows[0];
    if (!row) throw new RetailLocalReleaseError("release asset not found", 404);
    if (row.is_latest === true || row.status === "latest") {
      throw new RetailLocalReleaseError("latest release cannot be deleted", 409);
    }
    if (row.status !== "hidden") {
      throw new RetailLocalReleaseError("hide the release before deleting its file", 409);
    }

    const alreadyPurged = row.deleted_at != null;
    // The storage drivers make delete idempotent. Retrying therefore also
    // repairs a lost/ambiguous response without recreating a public download.
    const relpath = String(row.relpath);
    const storedBeforeDelete = await statStoredFile(relpath);
    await deleteStoredFile(relpath);
    if (await statStoredFile(relpath)) {
      throw new RetailLocalReleaseError("release file deletion could not be verified", 503);
    }

    const purged = await client.query<{ deleted_at: Date | string }>(
      `UPDATE files
          SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
        WHERE id = $1
        RETURNING deleted_at`,
      [row.file_id]
    );
    const purgedAtValue = purged.rows[0]?.deleted_at ?? row.deleted_at;
    const purgedAt = purgedAtValue instanceof Date
      ? purgedAtValue.toISOString()
      : String(purgedAtValue);

    if (!alreadyPurged) {
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,$2,'platform.retail_local_release_file.purge',$3,$4::jsonb)`,
        [
          input.tenantId,
          String(input.adminId),
          String(row.id),
          JSON.stringify({
            version: String(row.version),
            platform: String(row.platform),
            packageType: String(row.package_type),
            channel: String(row.channel),
            fileName: String(row.original_name),
            sizeBytes: Number(row.size_bytes || 0),
            freedBytes: Number(storedBeforeDelete?.size || 0),
            sha256: String(row.sha256),
          }),
        ]
      );
    }
    await client.query("COMMIT");
    return {
      releaseId: String(row.id),
      freedBytes: Number(storedBeforeDelete?.size || 0),
      purgedAt,
      alreadyPurged,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function openRetailLocalReleaseDownload(id: string, options: { includeTrialLocked?: boolean } = {}) {
  if (!RELEASE_ID_PATTERN.test(id)) {
    throw new RetailLocalReleaseError("release asset not found", 404);
  }
  const { rows } = await query(
    `
    SELECT a.id, a.platform, a.package_type, a.version, a.status, a.access_level, a.file_id,
           a.original_name, a.size_bytes, a.sha256,
           f.original_name AS file_original_name, f.filename AS stored_filename,
           f.size AS file_size, f.checksum AS file_checksum, f.relpath
      FROM bms_retail_local_release_assets a
      JOIN files f ON f.id = a.file_id AND f.deleted_at IS NULL
     WHERE a.id = $1
       AND a.status <> 'hidden'
       AND ($2::boolean OR a.access_level = 'public')
     LIMIT 1
    `,
    [id, options.includeTrialLocked === true]
  );
  const row = rows[0];
  if (!row?.relpath) throw new RetailLocalReleaseError("release asset not found", 404);
  if (!rowIdentityMatches(row)) {
    throw new RetailLocalReleaseError("release package identity is inconsistent", 409);
  }
  const stat = await statStoredFile(row.relpath);
  if (!stat) throw new RetailLocalReleaseError("release file missing", 404);
  if (Number(stat.size) !== Number(row.size_bytes)) {
    throw new RetailLocalReleaseError("release file size does not match release metadata", 409);
  }
  const verified = await inspectStoredFile(row.relpath);
  if (verified.size !== Number(row.size_bytes)
    || verified.checksum !== String(row.sha256).toLowerCase()) {
    throw new RetailLocalReleaseError("release file checksum does not match release metadata", 409);
  }
  const nodeStream = await openStoredFileStream(row.relpath);
  return {
    releaseId: String(row.id),
    fileId: Number(row.file_id),
    packageType: row.package_type as RetailLocalPackageType,
    relpath: String(row.relpath),
    stream: Readable.toWeb(nodeStream) as any,
    size: Number(stat.size),
    filename: String(row.original_name),
    mime: mimeForDownload(row.platform, row.original_name),
    sha256: String(row.sha256).toLowerCase(),
  };
}
