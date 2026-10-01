import type { Metadata } from "next";
import {
  getPublicRetailLocalDownloads,
  type RetailLocalPackageType,
  type RetailLocalPlatform,
} from "@/lib/bms/retailLocalReleases";
import RetailLocalPageClient from "./RetailLocalPageClient";

export const metadata: Metadata = {
  title: "BMS Retail Local",
  description:
    "Download the BMS Retail Local installer for a Windows, Ubuntu or macOS shop computer.",
};

export const dynamic = "force-dynamic";

function downloadUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
    if (process.env.NODE_ENV !== "production" && url.protocol === "http:") return url.toString();
    return null;
  } catch {
    return null;
  }
}

type PlatformKey = "windows" | "ubuntu" | "macos-arm64" | "macos-x64";
type DownloadAssetData = {
  id?: string;
  url: string;
  version?: string;
  filename?: string;
  sizeBytes?: number;
  sha256?: string;
  minOs?: string;
  releaseNotes?: string;
  status?: string;
};

function mapPlatform(platform: string): PlatformKey {
  if (platform === "windows-x64") return "windows";
  if (platform === "ubuntu-x64") return "ubuntu";
  if (platform === "macos-arm64") return "macos-arm64";
  if (platform === "macos-x64") return "macos-x64";
  throw new Error(`Unsupported Retail Local platform: ${platform}`);
}

export default async function RetailLocalPage() {
  const releases = await getPublicRetailLocalDownloads();
  const emptyDownloads = (): Record<RetailLocalPackageType, null> => ({
    "server-pos": null,
    server: null,
    pos: null,
  });
  const releaseDownloads: Record<PlatformKey, Record<RetailLocalPackageType, DownloadAssetData | null>> = {
    windows: emptyDownloads(),
    ubuntu: emptyDownloads(),
    "macos-arm64": emptyDownloads(),
    "macos-x64": emptyDownloads(),
  };
  for (const [platform, packages] of Object.entries(releases.latest)) {
    if (!packages) continue;
    const platformKey = mapPlatform(platform as RetailLocalPlatform);
    for (const [packageType, asset] of Object.entries(packages)) {
      if (!asset) continue;
      releaseDownloads[platformKey][packageType as RetailLocalPackageType] = {
        id: asset.id,
        url: `/api/retail-local/download/${asset.id}`,
        version: asset.version,
        filename: asset.original_name,
        sizeBytes: asset.size_bytes,
        sha256: asset.sha256,
        minOs: asset.min_os,
        releaseNotes: asset.release_notes,
        status: asset.status,
      };
    }
  }
  const fallbackDownloads = {
    windows: downloadUrl(process.env.RETAIL_LOCAL_WINDOWS_DOWNLOAD_URL),
    ubuntu: downloadUrl(process.env.RETAIL_LOCAL_UBUNTU_DOWNLOAD_URL),
    macosArm64: downloadUrl(process.env.RETAIL_LOCAL_MACOS_ARM64_DOWNLOAD_URL)
      ?? downloadUrl(process.env.RETAIL_LOCAL_MACOS_DOWNLOAD_URL),
    macosX64: downloadUrl(process.env.RETAIL_LOCAL_MACOS_X64_DOWNLOAD_URL),
  };

  return (
    <RetailLocalPageClient
      downloads={{
        windows: {
          ...releaseDownloads.windows,
          server: releaseDownloads.windows.server ?? (fallbackDownloads.windows ? { url: fallbackDownloads.windows } : null),
        },
        ubuntu: {
          ...releaseDownloads.ubuntu,
          server: releaseDownloads.ubuntu.server ?? (fallbackDownloads.ubuntu ? { url: fallbackDownloads.ubuntu } : null),
        },
        "macos-arm64": {
          ...releaseDownloads["macos-arm64"],
          server: releaseDownloads["macos-arm64"].server
            ?? (fallbackDownloads.macosArm64 ? { url: fallbackDownloads.macosArm64 } : null),
        },
        "macos-x64": {
          ...releaseDownloads["macos-x64"],
          server: releaseDownloads["macos-x64"].server
            ?? (fallbackDownloads.macosX64 ? { url: fallbackDownloads.macosX64 } : null),
        },
      }}
      archive={releases.archive.map((asset) => ({
        id: asset.id,
        platform: mapPlatform(asset.platform),
        packageType: asset.package_type,
        version: asset.version,
        filename: asset.original_name,
        status: asset.status,
        compatibility: asset.release_notes || asset.min_os,
        url: `/api/retail-local/download/${asset.id}`,
      }))}
    />
  );
}
