import { gt, valid } from "semver";
import type { RetailLocalReleaseAsset, RetailLocalPlatform } from "./retailLocalReleases";

export type DesktopUpdateRelease = {
  id: string;
  platform: RetailLocalPlatform;
  version: string;
  downloadUrl: string;
  releaseNotes: string;
  minOs: string;
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

// Old shells do not expose architecture. Return explicit choices, never guess from a user agent.
export function selectDesktopUpdates(
  assets: RetailLocalReleaseAsset[],
  client: { version: string; platform: string; arch?: string },
): DesktopUpdateResult {
  const current = valid(client.version);
  if (!current) return { status: "unknown-version", releases: [] };
  const platformTargets = targets[client.platform] ?? {};
  const allowed = client.arch ? [platformTargets[client.arch]] : Object.values(platformTargets);
  const eligible = assets.filter((asset) => allowed.includes(asset.platform)
    && asset.package_type === "pos" && asset.access_level === "public"
    && asset.channel !== "internal" && asset.status === "latest" && asset.is_latest
    && valid(asset.version));
  const releases = eligible.filter((asset) => gt(asset.version, current)).map((asset) => ({
    id: asset.id,
    platform: asset.platform,
    version: asset.version,
    downloadUrl: `/api/retail-local/download/${encodeURIComponent(asset.id)}`,
    releaseNotes: asset.release_notes,
    minOs: asset.min_os,
  }));
  return {
    status: releases.length ? "available" : eligible.length ? "up-to-date" : "unavailable",
    releases,
  };
}
