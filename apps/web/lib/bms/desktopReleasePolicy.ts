import { gt, valid } from "semver";
import type { RetailLocalReleaseAsset, RetailLocalPlatform } from "./retailLocalReleases";
import { inferRetailLocalInstallerIdentity } from "./retailLocalReleaseFilename";

export type DesktopUpdateRelease = {
  id: string;
  platform: RetailLocalPlatform;
  version: string;
  downloadUrl: string;
  releaseNotes: string;
  minOs: string;
  packageType: "pos";
  originalFilename: string;
  sha256: string;
};

export type DesktopUpdateResult = {
  status: "available" | "up-to-date" | "unavailable" | "unknown-version";
  releases: DesktopUpdateRelease[];
};

const targets: Record<string, Partial<Record<string, RetailLocalPlatform>>> = {
  win32: { x64: "windows-x64", ia32: "windows-x86-legacy" },
  darwin: { x64: "macos-x64", arm64: "macos-arm64" },
  linux: { x64: "ubuntu-x64" },
};

const RELEASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Treat the public update endpoint as untrusted at the browser boundary. */
export function isSafeDesktopUpdateRelease(
  value: unknown,
  client?: { platform: string; arch?: string },
): value is DesktopUpdateRelease {
  if (!value || typeof value !== "object") return false;
  const release = value as Record<string, unknown>;
  if (typeof release.id !== "string" || !RELEASE_ID_PATTERN.test(release.id)
    || typeof release.originalFilename !== "string"
    || typeof release.version !== "string" || !valid(release.version)
    || typeof release.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(release.sha256)
    || typeof release.platform !== "string"
    || release.packageType !== "pos"
    || typeof release.downloadUrl !== "string"
    || typeof release.releaseNotes !== "string"
    || typeof release.minOs !== "string") return false;
  const identity = inferRetailLocalInstallerIdentity(release.originalFilename);
  if (identity?.packageType !== "pos"
    || identity.platform !== release.platform
    || identity.version !== release.version
    || release.downloadUrl !== `/api/retail-local/download/${encodeURIComponent(release.id)}`) {
    return false;
  }
  if (!client) return true;
  const platformTargets = targets[client.platform] ?? {};
  const allowed = client.arch ? [platformTargets[client.arch]] : Object.values(platformTargets);
  return allowed.includes(identity.platform);
}

// Old shells do not expose architecture. Return explicit choices, never guess from a user agent.
export function selectDesktopUpdates(
  assets: RetailLocalReleaseAsset[],
  client: { version: string; platform: string; arch?: string },
): DesktopUpdateResult {
  const current = valid(client.version);
  if (!current) return { status: "unknown-version", releases: [] };
  const platformTargets = targets[client.platform] ?? {};
  const allowed = client.arch ? [platformTargets[client.arch]] : Object.values(platformTargets);
  const eligible = assets.filter((asset) => {
    const identity = inferRetailLocalInstallerIdentity(asset.original_name);
    return allowed.includes(asset.platform)
      && asset.package_type === "pos" && asset.access_level === "public"
      && identity?.packageType === "pos" && identity.platform === asset.platform
      && identity.version === asset.version
      && asset.channel !== "internal" && asset.status === "latest" && asset.is_latest
      && valid(asset.version);
  });
  const releases = eligible.filter((asset) => gt(asset.version, current)).map((asset) => ({
    id: asset.id,
    platform: asset.platform,
    version: asset.version,
    downloadUrl: `/api/retail-local/download/${encodeURIComponent(asset.id)}`,
    releaseNotes: asset.release_notes,
    minOs: asset.min_os,
    packageType: "pos" as const,
    originalFilename: asset.original_name,
    sha256: asset.sha256,
  }));
  return {
    status: releases.length ? "available" : eligible.length ? "up-to-date" : "unavailable",
    releases,
  };
}
