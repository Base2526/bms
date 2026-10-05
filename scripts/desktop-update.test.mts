import assert from "node:assert/strict";
import test from "node:test";
import { selectDesktopUpdates } from "../apps/web/lib/bms/desktopReleasePolicy.ts";
import type { RetailLocalReleaseAsset } from "../apps/web/lib/bms/retailLocalReleases.ts";

const release = (changes: Partial<RetailLocalReleaseAsset> = {}): RetailLocalReleaseAsset => ({
  id: "fake-release", platform: "macos-arm64", package_type: "pos", version: "0.2.15",
  channel: "pilot", status: "latest", access_level: "public", is_latest: true,
  file_id: 42, original_name: "FAKE.dmg", size_bytes: 10, sha256: "fake",
  min_os: "macOS 13+", release_notes: "Release notes", created_by: "private-admin-id",
  created_at: "", updated_at: "", ...changes,
});
const client = { platform: "darwin", arch: "arm64", version: "0.2.14-pilot.2" };

test("uses semantic precedence, including pilot numbers and ignored build metadata", () => {
  for (const [current, latest, expected] of [
    ["0.2.9", "0.2.10", "available"],
    ["0.2.14-pilot.2", "0.2.14-pilot.10", "available"],
    ["0.2.14-pilot.2", "0.2.14", "available"],
    ["0.2.14", "0.2.14-pilot.2", "up-to-date"],
    ["0.2.15", "0.2.15", "up-to-date"],
    ["0.2.16", "0.2.15", "up-to-date"],
    ["0.2.15+local", "0.2.15+release", "up-to-date"],
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
  }]);
});
