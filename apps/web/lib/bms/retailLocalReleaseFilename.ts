export type RetailLocalInstallerPackageType = "server-pos" | "server" | "pos";
export type RetailLocalInstallerPlatform =
  | "windows-x64"
  | "windows-x86-legacy"
  | "ubuntu-x64"
  | "macos-arm64"
  | "macos-x64";

export type RetailLocalInstallerIdentity = {
  filename: string;
  packageType: RetailLocalInstallerPackageType;
  platform: RetailLocalInstallerPlatform;
  version: string;
};

// Online builders intentionally exclude build metadata (`+...`) so the exact
// version remains portable in Windows/Linux/macOS filenames. Numeric
// prerelease identifiers follow SemVer's no-leading-zero rule.
export const RETAIL_LOCAL_RELEASE_VERSION_SOURCE =
  String.raw`(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?`;

const releaseVersionPattern = new RegExp(`^${RETAIL_LOCAL_RELEASE_VERSION_SOURCE}$`);

export function isRetailLocalReleaseVersion(value: unknown): value is string {
  return typeof value === "string" && releaseVersionPattern.test(value);
}

function filenameOnly(filename: unknown): string {
  if (typeof filename !== "string") return "";
  return filename.replace(/\\/g, "/").split("/").pop() ?? "";
}

const extensions: Record<RetailLocalInstallerPlatform, Record<RetailLocalInstallerPackageType, string>> = {
  "windows-x64": { "server-pos": "exe", server: "exe", pos: "exe" },
  "windows-x86-legacy": { "server-pos": "", server: "", pos: "exe" },
  "ubuntu-x64": { "server-pos": "deb", server: "deb", pos: "deb" },
  "macos-arm64": { "server-pos": "pkg", server: "pkg", pos: "dmg" },
  "macos-x64": { "server-pos": "pkg", server: "pkg", pos: "dmg" },
};

/** Parse only canonical filenames emitted by the online builders. */
export function inferRetailLocalInstallerIdentity(filename: string): RetailLocalInstallerIdentity | null {
  const base = filenameOnly(filename);
  const prefix = /^BMS-(?:POS-Plus-)?Retail-Local-/i.exec(base)?.[0];
  if (!prefix) return null;
  const afterPrefix = base.slice(prefix.length);
  const packageMarker = ([
    ["Server-POS-", "server-pos"], ["Server-", "server"], ["POS-", "pos"],
  ] as const).find(([marker]) => afterPrefix.toLowerCase().startsWith(marker.toLowerCase()));
  if (!packageMarker) return null;
  const packageType = packageMarker[1];
  const afterPackage = afterPrefix.slice(packageMarker[0].length);
  const target = ([
    ["windows-x86-legacy", "windows-x86-legacy"],
    ["windows-x64", "windows-x64"],
    ["linux-x64", "ubuntu-x64"],
    ["macos-arm64", "macos-arm64"],
    ["macos-x64", "macos-x64"],
    ["arm64", "macos-arm64"],
    ["x64", "macos-x64"],
  ] as const).find(([marker]) => new RegExp(`-${marker}(?:-SMOKE-ONLY)?\\.[^.]+$`, "i").test(afterPackage));
  if (!target) return null;
  const suffix = new RegExp(`-${target[0]}(?:-SMOKE-ONLY)?\\.([^.]+)$`, "i").exec(afterPackage);
  if (!suffix) return null;
  const version = afterPackage.slice(0, suffix.index);
  const platform = target[1];
  const extension = suffix[1].toLowerCase();
  if (!isRetailLocalReleaseVersion(version) || extensions[platform][packageType] !== extension) return null;
  return { filename: base, packageType, platform, version };
}

const STORAGE_UUID_SUFFIX = /-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\.[^.]+$)/i;

/** Recover the upload's original canonical name from legacy and UUID storage keys. */
export function retailLocalStoredPathOriginalName(storedPath: unknown): string | null {
  const base = filenameOnly(storedPath);
  if (!base) return null;
  if (inferRetailLocalInstallerIdentity(base)) return base;
  const unwrapped = base.replace(/^[0-9]+-/, "").replace(STORAGE_UUID_SUFFIX, "");
  return inferRetailLocalInstallerIdentity(unwrapped) ? unwrapped : null;
}

export function inferRetailLocalInstallerIdentityFromStoredPath(
  storedPath: unknown,
): RetailLocalInstallerIdentity | null {
  const originalName = retailLocalStoredPathOriginalName(storedPath);
  return originalName ? inferRetailLocalInstallerIdentity(originalName) : null;
}

export function inferRetailLocalInstallerPackageType(
  filename: string,
): RetailLocalInstallerPackageType | null {
  return inferRetailLocalInstallerIdentity(filename)?.packageType ?? null;
}

export function retailLocalInstallerFilenameMatchesPackageType(
  filename: string,
  packageType: RetailLocalInstallerPackageType,
): boolean {
  return inferRetailLocalInstallerIdentity(filename)?.packageType === packageType;
}
