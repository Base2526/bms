/**
 * Read-only Retail Local release identity audit.
 *
 *   npx tsx --import scripts/testing/next-runtime-shim.mjs \
 *     scripts/retail-local-release-identity-diagnostic.mts [--verify-storage]
 *
 * --verify-storage streams and hashes every live installer object. It never
 * updates release rows, file rows, or storage objects.
 */
import { closeDatabasePool, query } from "../apps/web/lib/db.ts";
import {
  inferRetailLocalInstallerIdentity,
  retailLocalStoredPathOriginalName,
} from "../apps/web/lib/bms/retailLocalReleaseFilename.ts";
import { inspectStoredFile, statStoredFile } from "../apps/web/lib/storage.ts";

const verifyStorage = process.argv.includes("--verify-storage");
const limitAt = process.argv.indexOf("--limit");
const requestedLimit = limitAt >= 0 ? Number(process.argv[limitAt + 1]) : 1_000;
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 10_000) {
  throw new Error("--limit must be an integer from 1 to 10000");
}
const rowLimit = requestedLimit;

type Row = {
  release_id: string;
  file_id: number;
  package_type: "server-pos" | "server" | "pos";
  platform: string;
  version: string;
  status: string;
  is_latest: boolean;
  original_name: string;
  file_original_name: string | null;
  stored_filename: string | null;
  relpath: string | null;
  size_bytes: string;
  file_size: string | null;
  sha256: string;
  file_checksum: string | null;
  deleted_at: string | null;
  latest_count: string;
  file_package_type_count: string;
  total_count: string;
};

const { rows } = await query<Row>(`
  WITH latest_counts AS (
    SELECT platform,package_type,count(*) FILTER (WHERE is_latest)::text AS latest_count
      FROM bms_retail_local_release_assets
     GROUP BY platform,package_type
  ), file_type_counts AS (
    SELECT file_id,count(DISTINCT package_type)::text AS file_package_type_count
      FROM bms_retail_local_release_assets
     GROUP BY file_id
  )
  SELECT a.id AS release_id,a.file_id,a.package_type,a.platform,a.version,a.status,a.is_latest,
         a.original_name,f.original_name AS file_original_name,f.filename AS stored_filename,
         f.relpath,a.size_bytes::text,f.size::text AS file_size,a.sha256,
         f.checksum AS file_checksum,f.deleted_at::text,
         lc.latest_count,fc.file_package_type_count,count(*) OVER()::text AS total_count
    FROM bms_retail_local_release_assets a
    LEFT JOIN files f ON f.id=a.file_id
    JOIN latest_counts lc USING (platform,package_type)
    JOIN file_type_counts fc USING (file_id)
   ORDER BY a.platform,a.package_type,a.is_latest DESC,a.created_at DESC
   LIMIT $1
`, [rowLimit]);

const findings: Array<Record<string, unknown>> = [];
for (const row of rows) {
  const releaseIdentity = inferRetailLocalInstallerIdentity(row.original_name);
  const fileIdentity = inferRetailLocalInstallerIdentity(row.file_original_name ?? "");
  const reasons: string[] = [];
  if (releaseIdentity?.packageType !== row.package_type) reasons.push("release filename/package_type mismatch");
  if (releaseIdentity?.platform !== row.platform) reasons.push("release filename/platform mismatch");
  if (releaseIdentity?.version !== row.version) reasons.push("release filename/version mismatch");
  if (row.platform === "windows-x86-legacy" && row.package_type !== "pos") reasons.push("Windows x86 is not POS");
  if (Number(row.latest_count) > 1) reasons.push("multiple latest rows");
  if (!row.file_original_name || row.deleted_at) reasons.push("release points to missing/deleted file");
  if (row.file_original_name !== row.original_name) reasons.push("release/file original_name mismatch");
  if (retailLocalStoredPathOriginalName(row.relpath) !== row.original_name) {
    reasons.push("release/storage relpath identity mismatch");
  }
  if (row.relpath?.replace(/\\/g, "/").split("/").pop() !== row.stored_filename) {
    reasons.push("files.filename/relpath basename mismatch");
  }
  if (fileIdentity?.packageType !== row.package_type) reasons.push("file filename/package_type mismatch");
  if (fileIdentity?.platform !== row.platform) reasons.push("file filename/platform mismatch");
  if (row.file_size !== row.size_bytes) reasons.push("release/file size mismatch");
  if (row.file_checksum?.toLowerCase() !== row.sha256.toLowerCase()) reasons.push("release/file SHA256 mismatch");
  if (Number(row.file_package_type_count) > 1) reasons.push("file_id shared across package types");

  let storageSize: number | null = null;
  let storageSha256: string | null = null;
  let storageError: string | null = null;
  if (row.relpath && !row.deleted_at) {
    try {
      const stat = await statStoredFile(row.relpath);
      storageSize = stat?.size ?? null;
      if (storageSize == null) reasons.push("storage object missing");
      else if (storageSize !== Number(row.size_bytes)) reasons.push("storage size mismatch");
      if (verifyStorage && storageSize != null) {
        const inspected = await inspectStoredFile(row.relpath);
        storageSha256 = inspected.checksum;
        if (inspected.size !== Number(row.size_bytes)) reasons.push("streamed storage size mismatch");
        if (inspected.checksum !== row.sha256.toLowerCase()) reasons.push("storage SHA256 mismatch");
      }
    } catch (error) {
      storageError = error instanceof Error ? error.name : "StorageError";
      reasons.push("storage verification error");
    }
  }

  if (reasons.length) findings.push({
    releaseId: row.release_id,
    fileId: row.file_id,
    packageType: row.package_type,
    platform: row.platform,
    version: row.version,
    filename: row.original_name,
    fileOriginalName: row.file_original_name,
    storedFilename: row.stored_filename,
    relpath: row.relpath,
    sizeBytes: row.size_bytes,
    fileSize: row.file_size,
    storageSize,
    sha256: row.sha256,
    fileSha256: row.file_checksum,
    storageSha256,
    storageError,
    status: row.status,
    isLatest: row.is_latest,
    reasons,
  });
}

const total = Number(rows[0]?.total_count ?? 0);
console.log(JSON.stringify({ checked: rows.length, total, limit: rowLimit, truncated: total > rows.length, verifyStorage, findings }, null, 2));
await closeDatabasePool();
if (findings.length || total > rows.length) process.exitCode = 1;
