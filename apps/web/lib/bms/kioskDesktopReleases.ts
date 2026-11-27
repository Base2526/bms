import { Readable } from "node:stream";
import { getClient, query } from "@/lib/db";
import { deleteStoredFile, inspectStoredFile, openStoredFileStream, type PendingStoredFile } from "@/lib/storage";
import { beginTenantTx, DEFAULT_TENANT_ID } from "./tenant";
import { kioskTenantRead } from "./restaurantKioskTenantRead";
import { verifyStoredKioskInstaller } from "./kioskDesktopSignature";
import { KIOSK_INSTALLER_NAME, kioskReleaseMayDownload, kioskReleaseMayPublish,
  validateKioskReleaseMetadata } from "./kioskDesktopReleasePolicy";

export const KIOSK_RELEASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Channel = "pilot" | "stable";

export class KioskDesktopReleaseError extends Error {
  constructor(readonly code: string, readonly status: 400 | 404 | 409 | 503 = 400) {
    super(code);
    this.name = "KioskDesktopReleaseError";
  }
}

function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !KIOSK_RELEASE_UUID.test(value)) throw new KioskDesktopReleaseError("NOT_FOUND", 404);
  return value;
}

function assertMetadata(input: {
  storedFile: PendingStoredFile; version: unknown; channel: unknown; expectedSha256: unknown;
  minOs: unknown; releaseNotes: unknown;
}) {
  const metadata = validateKioskReleaseMetadata({
    filename: input.storedFile.original_name, size: input.storedFile.size,
    storedSha256: input.storedFile.checksum, version: input.version, channel: input.channel,
    expectedSha256: input.expectedSha256, minOs: input.minOs, releaseNotes: input.releaseNotes,
  });
  if (!metadata) throw new KioskDesktopReleaseError("INVALID_RELEASE_METADATA");
  return metadata;
}

function serialize(row: any) {
  return {
    id: String(row.id), appKind: "BMS_KIOSK" as const, platform: "windows-x64" as const,
    version: String(row.version), channel: row.channel as Channel,
    status: row.status as "DRAFT" | "PUBLISHED" | "HIDDEN",
    filename: String(row.original_name), sizeBytes: Number(row.size_bytes), sha256: String(row.sha256),
    signatureStatus: row.signature_status as "VALID" | "INVALID" | "UNAVAILABLE",
    signatureVerifier: row.signature_verifier as string | null,
    signerThumbprint: row.signer_thumbprint as string | null,
    minimumOs: String(row.min_os), releaseNotes: String(row.release_notes),
    publishedAt: row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** Upload is platform-admin only at the route. The file and release share one DB transaction. */
export async function createKioskDesktopReleaseDraft(input: {
  storedFile: PendingStoredFile; version: unknown; channel: unknown; expectedSha256: unknown;
  minOs: unknown; releaseNotes: unknown; adminId: string | number;
}) {
  let commitAttempted = false;
  try {
    const metadata = assertMetadata(input);
    const verification = await verifyStoredKioskInstaller(
      input.storedFile.relpath, metadata.sha256, input.storedFile.size);
    if (!verification.integrity) throw new KioskDesktopReleaseError("CHECKSUM_MISMATCH");
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const actor = await client.query<{ tenant_id: string | null }>(
        "SELECT tenant_id FROM users WHERE id=$1 AND is_platform_admin=TRUE", [String(input.adminId)]);
      if (!actor.rows[0]) throw new KioskDesktopReleaseError("FORBIDDEN", 404);
      const file = await client.query<{ id: number }>(
        `INSERT INTO files(filename,original_name,mimetype,size,checksum,relpath,visibility,tenant_id)
         VALUES($1,$2,'application/vnd.microsoft.portable-executable',$3,$4,$5,'private',NULL) RETURNING id`,
        [input.storedFile.filename, metadata.filename, input.storedFile.size, metadata.sha256, input.storedFile.relpath]);
      const result = await client.query(
        `INSERT INTO bms_kiosk_desktop_releases
          (version,channel,file_id,original_name,size_bytes,sha256,signature_status,signature_checked_at,
           signature_verifier,signer_thumbprint,min_os,release_notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10,$11,$12) RETURNING *`,
        [metadata.version, metadata.channel, file.rows[0].id, metadata.filename, input.storedFile.size,
          metadata.sha256, verification.signature.status, verification.signature.verifier,
          verification.signature.thumbprint, metadata.minOs, metadata.releaseNotes, String(input.adminId)]);
      await client.query(
        `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
         VALUES($1,$2,'platform.kiosk_release.draft',$3,$4::jsonb)`,
        [actor.rows[0].tenant_id ?? DEFAULT_TENANT_ID, String(input.adminId), result.rows[0].id,
          JSON.stringify({ version: metadata.version, channel: metadata.channel, sha256: metadata.sha256,
            signatureStatus: verification.signature.status })]);
      commitAttempted = true;
      await client.query("COMMIT");
      return serialize(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  } catch (error) {
    if (!commitAttempted) await deleteStoredFile(input.storedFile.relpath).catch(() => undefined);
    if (error instanceof Error && (error as { code?: string }).code === "23505") {
      throw new KioskDesktopReleaseError("DUPLICATE_VERSION", 409);
    }
    throw error;
  }
}

export async function listKioskDesktopReleasesForPublisher() {
  const { rows } = await query(`SELECT * FROM bms_kiosk_desktop_releases ORDER BY created_at DESC LIMIT 40`);
  return rows.map(serialize);
}

async function releaseFileRow(id: string) {
  const { rows } = await query(
    `SELECT r.*, f.relpath, f.original_name AS file_original_name, f.size AS file_size,
            f.checksum AS file_checksum, f.deleted_at
       FROM bms_kiosk_desktop_releases r JOIN files f ON f.id=r.file_id
      WHERE r.id=$1`, [id]);
  return rows[0] ?? null;
}

function fileIdentityMatches(row: any): boolean {
  return row && row.app_kind === "BMS_KIOSK" && row.platform === "windows-x64"
    && KIOSK_INSTALLER_NAME.exec(String(row.original_name))?.[1] === String(row.version)
    && row.original_name === row.file_original_name && row.deleted_at == null
    && Number(row.size_bytes) === Number(row.file_size)
    && String(row.sha256) === String(row.file_checksum).toLowerCase();
}

async function assertStoredIntegrity(row: any) {
  if (!fileIdentityMatches(row)) throw new KioskDesktopReleaseError("FILE_UNAVAILABLE", 503);
  try {
    const inspected = await inspectStoredFile(String(row.relpath));
    if (inspected.size !== Number(row.size_bytes) || inspected.checksum !== String(row.sha256)) {
      throw new KioskDesktopReleaseError("FILE_UNAVAILABLE", 503);
    }
  } catch { throw new KioskDesktopReleaseError("FILE_UNAVAILABLE", 503); }
}

export async function publishKioskDesktopReleaseForBranch(input: {
  releaseId: string; tenantId: string; locationId: string; adminId: string | number;
}) {
  const releaseId = requireUuid(input.releaseId);
  requireUuid(input.locationId);
  const candidate = await releaseFileRow(releaseId);
  if (!candidate || candidate.status === "HIDDEN") throw new KioskDesktopReleaseError("NOT_FOUND", 404);
  if (!fileIdentityMatches(candidate)) throw new KioskDesktopReleaseError("FILE_UNAVAILABLE", 503);
  const verification = await verifyStoredKioskInstaller(candidate.relpath, candidate.sha256, Number(candidate.size_bytes));
  if (!verification.integrity) throw new KioskDesktopReleaseError("CHECKSUM_MISMATCH", 409);
  if (!kioskReleaseMayPublish({ status: candidate.status, integrity: verification.integrity,
    signatureStatus: verification.signature.status })) throw new KioskDesktopReleaseError("SIGNATURE_NOT_VALID", 409);
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.adminId });
    const branch = await client.query(
      `SELECT id FROM bms_locations WHERE tenant_id=$1 AND id=$2 AND active FOR KEY SHARE`,
      [input.tenantId, input.locationId]);
    if (!branch.rows[0]) throw new KioskDesktopReleaseError("NOT_FOUND", 404);
    const result = await client.query(
      `SELECT * FROM bms_kiosk_desktop_releases WHERE id=$1 FOR UPDATE`, [releaseId]);
    const row = result.rows[0];
    if (!row || row.status === "HIDDEN" || row.sha256 !== candidate.sha256 || row.file_id !== candidate.file_id) {
      throw new KioskDesktopReleaseError("RELEASE_CHANGED", 409);
    }
    const existing = await client.query<{ id: string; active: boolean }>(
      `SELECT id,active FROM bms_kiosk_desktop_release_branches
        WHERE tenant_id=$1 AND location_id=$2 AND release_id=$3 FOR UPDATE`,
      [input.tenantId, input.locationId, releaseId]);
    if (row.status === "PUBLISHED" && existing.rows[0]?.active) {
      await client.query("COMMIT");
      return serialize(row);
    }
    await client.query(
      `UPDATE bms_kiosk_desktop_releases SET status='PUBLISHED', signature_status='VALID',
         signature_checked_at=now(), signature_verifier=$2, signer_thumbprint=$3,
         published_at=COALESCE(published_at,now()), published_by=COALESCE(published_by,$4), updated_at=now()
       WHERE id=$1`, [releaseId, verification.signature.verifier,
        verification.signature.thumbprint, String(input.adminId)]);
    await client.query(
      `INSERT INTO bms_kiosk_desktop_release_branches
         (tenant_id,location_id,release_id,granted_by) VALUES($1,$2,$3,$4)
       ON CONFLICT(tenant_id,location_id,release_id)
       DO UPDATE SET active=TRUE,updated_at=now(),granted_by=EXCLUDED.granted_by`,
      [input.tenantId, input.locationId, releaseId, String(input.adminId)]);
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'platform.kiosk_release.publish',$3,$4::jsonb)`,
      [input.tenantId, String(input.adminId), releaseId,
        JSON.stringify({ locationId: input.locationId, version: row.version, sha256: row.sha256 })]);
    await client.query("COMMIT");
    return serialize({ ...row, status: "PUBLISHED", signature_status: "VALID",
      signature_verifier: verification.signature.verifier, signer_thumbprint: verification.signature.thumbprint,
      published_at: row.published_at ?? new Date() });
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function hideKioskDesktopRelease(input: {
  releaseId: string; tenantId: string; adminId: string | number;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.adminId });
    const result = await client.query(
      `UPDATE bms_kiosk_desktop_releases SET status='HIDDEN',updated_at=now()
        WHERE id=$1 AND status<>'HIDDEN' RETURNING *`, [requireUuid(input.releaseId)]);
    if (!result.rows[0]) throw new KioskDesktopReleaseError("NOT_FOUND", 404);
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'platform.kiosk_release.hide',$3,$4::jsonb)`,
      [input.tenantId, String(input.adminId), input.releaseId,
        JSON.stringify({ version: result.rows[0].version, sha256: result.rows[0].sha256 })]);
    await client.query("COMMIT");
    return serialize(result.rows[0]);
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function findKioskDesktopReleaseForBranch(input: {
  tenantId: string; locationId: string; releaseId?: string;
}) {
  requireUuid(input.locationId);
  if (input.releaseId) requireUuid(input.releaseId);
  const granted = await kioskTenantRead(input.tenantId, async (client) => {
    const result = await client.query(
      `SELECT r.id
         FROM bms_kiosk_desktop_release_branches b
         JOIN bms_kiosk_desktop_releases r ON r.id=b.release_id
        WHERE b.tenant_id=$1 AND b.location_id=$2 AND b.active
          AND r.status='PUBLISHED' AND r.signature_status='VALID'
          AND ($3::uuid IS NULL OR r.id=$3)
        ORDER BY r.published_at DESC,r.created_at DESC LIMIT 1`,
      [input.tenantId, input.locationId, input.releaseId ?? null]);
    return result.rows[0]?.id ?? null;
  });
  if (!granted) return null;
  // `bms_app` intentionally has no SELECT on files. Read only the file id
  // derived from a branch-scoped grant after the tenant transaction closes.
  const row = await releaseFileRow(String(granted));
  if (!row || row.status !== "PUBLISHED" || row.signature_status !== "VALID") return null;
  if (!kioskReleaseMayDownload({ status: row.status, signatureStatus: row.signature_status,
    branchGrantActive: true, fileIntegrity: fileIdentityMatches(row) })) {
    throw new KioskDesktopReleaseError("FILE_UNAVAILABLE", 503);
  }
  await assertStoredIntegrity(row);
  return row;
}

export async function kioskDesktopReleaseSummary(input: { tenantId: string; locationId: string }) {
  const row = await findKioskDesktopReleaseForBranch(input);
  return row ? serialize(row) : null;
}

export async function openKioskDesktopReleaseDownload(input: {
  tenantId: string; locationId: string; releaseId: string;
}) {
  const row = await downloadRow(input);
  try {
    const nodeStream = await openStoredFileStream(String(row.relpath));
    return { stream: Readable.toWeb(nodeStream) as ReadableStream, filename: String(row.original_name),
      size: Number(row.size_bytes), sha256: String(row.sha256) };
  } catch { throw new KioskDesktopReleaseError("FILE_UNAVAILABLE", 503); }
}

async function downloadRow(input: { tenantId: string; locationId: string; releaseId: string }) {
  const row = await findKioskDesktopReleaseForBranch(input);
  if (!row || String(row.id).toLowerCase() !== input.releaseId.toLowerCase()) {
    throw new KioskDesktopReleaseError("NOT_FOUND", 404);
  }
  return row;
}

export async function kioskDesktopReleaseDownloadInfo(input: {
  tenantId: string; locationId: string; releaseId: string;
}) {
  const row = await downloadRow(input);
  return { filename: String(row.original_name), size: Number(row.size_bytes), sha256: String(row.sha256) };
}
