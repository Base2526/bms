import { valid } from "semver";

export const KIOSK_INSTALLER_NAME = /^BMS-Kiosk-Setup-(.+)-x64\.exe$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SIGNER_THUMBPRINT = /^[0-9a-f]{40}$/i;

/** Only a platform-configured Authenticode certificate may distribute a kiosk binary. */
export function kioskSignerApproved(thumbprint: string | null, approvedThumbprints: string | undefined): boolean {
  if (!thumbprint || !SIGNER_THUMBPRINT.test(thumbprint)) return false;
  const approved = (approvedThumbprints ?? "").split(",").map((value) => value.trim());
  return approved.every((value) => SIGNER_THUMBPRINT.test(value))
    && approved.some((value) => value.toLowerCase() === thumbprint.toLowerCase());
}

export type KioskReleaseMetadata = {
  filename: string; version: string; channel: "pilot" | "stable";
  sha256: string; minOs: string; releaseNotes: string;
};

export function validateKioskReleaseMetadata(input: {
  filename: unknown; size: unknown; storedSha256: unknown; version: unknown; channel: unknown;
  expectedSha256: unknown; minOs: unknown; releaseNotes: unknown;
}): KioskReleaseMetadata | null {
  const filename = typeof input.filename === "string" ? input.filename : "";
  const version = typeof input.version === "string" ? input.version.trim() : "";
  const match = KIOSK_INSTALLER_NAME.exec(filename);
  if (!match || !valid(version) || match[1] !== version || version.length > 80
    || !Number.isSafeInteger(input.size) || Number(input.size) <= 0) return null;
  if (input.channel !== "pilot" && input.channel !== "stable") return null;
  const sha256 = typeof input.expectedSha256 === "string" ? input.expectedSha256.toLowerCase() : "";
  if (!SHA256.test(sha256) || sha256 !== String(input.storedSha256).toLowerCase()) return null;
  const minOs = typeof input.minOs === "string" ? input.minOs.trim() : "";
  if (!minOs || minOs.length > 200) return null;
  const releaseNotes = typeof input.releaseNotes === "string" ? input.releaseNotes.trim() : "";
  if (releaseNotes.length > 5000) return null;
  return { filename, version, channel: input.channel, sha256, minOs, releaseNotes };
}

export function kioskReleaseMayPublish(input: {
  status: string; integrity: boolean; signatureStatus: string; signerApproved: boolean;
}) {
  return input.status !== "HIDDEN" && input.integrity && input.signatureStatus === "VALID"
    && input.signerApproved;
}

export function kioskReleaseMayDownload(input: {
  status: string; signatureStatus: string; branchGrantActive: boolean; fileIntegrity: boolean;
  signerApproved: boolean;
}) {
  return input.status === "PUBLISHED" && input.signatureStatus === "VALID"
    && input.branchGrantActive && input.fileIntegrity && input.signerApproved;
}
