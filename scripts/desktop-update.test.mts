import assert from "node:assert/strict";
import test from "node:test";
import { isSafeDesktopUpdateRelease, selectDesktopUpdates } from "../apps/web/lib/bms/desktopReleasePolicy.ts";
import type { RetailLocalReleaseAsset } from "../apps/web/lib/bms/retailLocalReleases.ts";

const release = (changes: Partial<RetailLocalReleaseAsset> = {}): RetailLocalReleaseAsset => {
  const platform = changes.platform ?? "macos-arm64";
  const packageType = changes.package_type ?? "pos";
  const version = changes.version ?? "0.2.15";
  const target = platform === "ubuntu-x64" ? "linux-x64" : platform;
  const extension = platform.startsWith("macos") ? "dmg" : platform.startsWith("windows") ? "exe" : "deb";
  const label = packageType === "server-pos" ? "Server-POS" : packageType === "server" ? "Server" : "POS";
  return ({
  id: "fake-release", platform, package_type: packageType, version,
  channel: "pilot", status: "latest", access_level: "public", is_latest: true,
  file_id: 42, original_name: `BMS-POS-Plus-Retail-Local-${label}-${version}-${target}.${extension}`, size_bytes: 10, sha256: "a".repeat(64),
  min_os: "macOS 13+", release_notes: "Release notes", created_by: "private-admin-id",
  created_at: "", updated_at: "", purged_at: null, identity_consistent: true, storage_present: null, ...changes,
  });
};
const client = { platform: "darwin", arch: "arm64", version: "0.2.14-pilot.2" };

test("uses semantic precedence, including pilot numbers and ignored build metadata", () => {
  for (const [current, latest, expected] of [
    ["0.2.9", "0.2.10", "available"],
    ["0.2.14-pilot.2", "0.2.14-pilot.10", "available"],
    ["0.2.14-pilot.2", "0.2.14", "available"],
    ["0.2.14", "0.2.14-pilot.2", "up-to-date"],
    ["0.2.15", "0.2.15", "up-to-date"],
    ["0.2.16", "0.2.15", "up-to-date"],
    // Installed Electron builds may report local build metadata, but published
    // release filenames intentionally do not carry `+...` metadata.
    ["0.2.15+local", "0.2.15", "up-to-date"],
  ]) assert.equal(selectDesktopUpdates([release({ version: latest })], { ...client, version: current }).status, expected);
});

test("only published public non-internal POS installers may trigger an update", () => {
  for (const changes of [
    { access_level: "trial" }, { channel: "internal" }, { status: "hidden" },
    { status: "deprecated" }, { status: "supported" }, { is_latest: false },
    { package_type: "server" }, { package_type: "server-pos" }, { version: "tomorrow" },
  ] as Partial<RetailLocalReleaseAsset>[]) {
    assert.deepEqual(selectDesktopUpdates([release(changes)], client), { status: "unavailable", releases: [] });
  }
  assert.equal(selectDesktopUpdates([release()], { ...client, version: "unknown" }).status, "unknown-version");
});

test("rejects a Server installer mislabeled as a POS release", () => {
  const mislabeled = release({
    platform: "windows-x64",
    package_type: "pos",
    original_name: "BMS-POS-Plus-Retail-Local-Server-0.2.15-windows-x64.exe",
  });
  assert.deepEqual(
    selectDesktopUpdates([mislabeled], { version: "0.2.14", platform: "win32", arch: "x64" }),
    { status: "unavailable", releases: [] },
  );
});

test("matches OS and architecture, and never guesses for a legacy shell", () => {
  const assets = ["windows-x64", "windows-x86-legacy", "ubuntu-x64", "macos-arm64", "macos-x64"]
    .map((platform) => release({ id: platform, platform: platform as RetailLocalReleaseAsset["platform"] }));
  for (const [platform, arch, target] of [
    ["win32", "x64", "windows-x64"], ["win32", "ia32", "windows-x86-legacy"],
    ["linux", "x64", "ubuntu-x64"], ["darwin", "arm64", "macos-arm64"], ["darwin", "x64", "macos-x64"],
  ]) assert.deepEqual(selectDesktopUpdates(assets, { ...client, platform, arch }).releases.map((item) => item.platform), [target]);
  assert.deepEqual(selectDesktopUpdates(assets, { version: client.version, platform: "darwin" }).releases.map((item) => item.platform), ["macos-arm64", "macos-x64"]);
  assert.equal(selectDesktopUpdates(assets, { ...client, platform: "linux", arch: "arm64" }).status, "unavailable");
  assert.equal(selectDesktopUpdates(assets, { ...client, platform: "unknown" }).status, "unavailable");
});

test("returns only display metadata and the existing release download path", () => {
  assert.deepEqual(selectDesktopUpdates([release()], client).releases, [{
    id: "fake-release", platform: "macos-arm64", version: "0.2.15",
    downloadUrl: "/api/retail-local/download/fake-release", releaseNotes: "Release notes", minOs: "macOS 13+",
    packageType: "pos", originalFilename: "BMS-POS-Plus-Retail-Local-POS-0.2.15-macos-arm64.dmg",
    sha256: "a".repeat(64),
  }]);
});

test("browser boundary rejects unsafe package identity, ids, hashes, and download URLs", () => {
  const id = "2f1cbdf3-5ac5-4a87-947c-7ca17a117d9d";
  const safe = {
    id, platform: "windows-x64", version: "0.2.15",
    downloadUrl: `/api/retail-local/download/${id}`,
    releaseNotes: "notes", minOs: "Windows x64", packageType: "pos",
    originalFilename: "BMS-POS-Plus-Retail-Local-POS-0.2.15-windows-x64.exe",
    sha256: "a".repeat(64),
  };
  assert.equal(isSafeDesktopUpdateRelease(safe), true);
  assert.equal(isSafeDesktopUpdateRelease(safe, { platform: "win32", arch: "x64" }), true);
  assert.equal(isSafeDesktopUpdateRelease(safe, { platform: "linux", arch: "x64" }), false);
  for (const unsafe of [
    { ...safe, packageType: "server" },
    { ...safe, originalFilename: "BMS-POS-Plus-Retail-Local-Server-0.2.15-windows-x64.exe" },
    { ...safe, id: "not-a-release-id" },
    { ...safe, sha256: "bad" },
    { ...safe, downloadUrl: "https://evil.example/download.exe" },
    { ...safe, downloadUrl: "javascript:alert(1)" },
    { ...safe, originalFilename: undefined },
  ]) assert.equal(isSafeDesktopUpdateRelease(unsafe), false);
});
