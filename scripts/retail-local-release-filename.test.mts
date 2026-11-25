import assert from "node:assert/strict";
import test from "node:test";

import {
  inferRetailLocalInstallerPackageType,
  inferRetailLocalInstallerIdentity,
  inferRetailLocalInstallerIdentityFromStoredPath,
  retailLocalStoredPathOriginalName,
  retailLocalInstallerFilenameMatchesPackageType,
} from "../apps/web/lib/bms/retailLocalReleaseFilename.ts";

test("classifies current Retail Local installer filenames without confusing the POS brand prefix", () => {
  const cases = [
    ["BMS-POS-Plus-Retail-Local-POS-0.2.14-pilot.13-windows-x64.exe", "pos"],
    ["BMS-POS-Plus-Retail-Local-POS-0.2.14-pilot.13-windows-x86-legacy.exe", "pos"],
    ["BMS-POS-Plus-Retail-Local-POS-0.2.14-pilot.13-linux-x64.deb", "pos"],
    ["BMS-POS-Plus-Retail-Local-Server-0.2.14-pilot.13-windows-x64.exe", "server"],
    ["BMS-POS-Plus-Retail-Local-Server-0.2.14-pilot.13-linux-x64.deb", "server"],
    ["BMS-POS-Plus-Retail-Local-Server-POS-0.2.14-pilot.13-windows-x64.exe", "server-pos"],
    ["BMS-POS-Plus-Retail-Local-Server-POS-0.2.14-pilot.13-linux-x64.deb", "server-pos"],
    ["BMS-POS-Plus-Retail-Local-POS-0.2.14-pilot.13-macos-arm64.dmg", "pos"],
    ["BMS-POS-Plus-Retail-Local-POS-0.2.14-pilot.13-macos-x64.dmg", "pos"],
    ["BMS-POS-Plus-Retail-Local-Server-POS-0.2.14-pilot.13-arm64.pkg", "server-pos"],
    ["BMS-POS-Plus-Retail-Local-Server-POS-0.2.14-pilot.13-x64.pkg", "server-pos"],
    ["BMS-POS-Plus-Retail-Local-Server-0.2.14-pilot.13-arm64.pkg", "server"],
    ["BMS-POS-Plus-Retail-Local-Server-0.2.14-pilot.13-x64.pkg", "server"],
  ] as const;

  for (const [filename, packageType] of cases) {
    assert.equal(inferRetailLocalInstallerPackageType(filename), packageType, filename);
    const identity = inferRetailLocalInstallerIdentity(filename);
    assert.equal(identity?.version, "0.2.14-pilot.13", filename);
    const expectedPlatform = filename.includes("windows-x86") ? "windows-x86-legacy"
      : filename.includes("windows") ? "windows-x64"
        : filename.includes("linux") ? "ubuntu-x64"
          : filename.includes("arm64") ? "macos-arm64" : "macos-x64";
    assert.equal(identity?.platform, expectedPlatform);
    assert.equal(retailLocalInstallerFilenameMatchesPackageType(filename, packageType), true, filename);
  }
});

test("fails closed for ambiguous names and mismatched selected package types", () => {
  assert.equal(inferRetailLocalInstallerPackageType("bms-retail-local-0.2.14.exe"), null);
  assert.equal(inferRetailLocalInstallerPackageType("BMS-POS-Plus-0.2.14-windows-x64.exe"), null);
  assert.equal(inferRetailLocalInstallerPackageType("BMS-POS-Plus-Retail-Local-Full-0.2.14-windows-x64.exe"), null);
  assert.equal(inferRetailLocalInstallerPackageType("BMS-POS-Plus-Retail-Local-Server-POS-0.2.14-windows-x64.dmg"), null);
  for (const malformed of [
    "BMS-POS-Plus-Retail-Local-POS-not-semver-windows-x64.exe",
    "BMS-POS-Plus-Retail-Local-POS-01.2.3-windows-x64.exe",
    "BMS-POS-Plus-Retail-Local-POS-1.2.3-alpha..1-windows-x64.exe",
    "BMS-POS-Plus-Retail-Local-POS-1.2.3+build.1-windows-x64.exe",
    "BMS-POS-Plus-Retail-Local-POS-Server-1.2.3-windows-x64.exe",
    "BMS-POS-Plus-Retail-Local-Server-POS-POS-1.2.3-windows-x64.exe",
    "BMS-POS-Plus-Retail-Local-POS-1.2.3-windows-arm64.exe",
    "BMS-POS-Plus-Retail-Local-POS-1.2.3-windows-x64.exe.zip",
  ]) assert.equal(inferRetailLocalInstallerIdentity(malformed), null, malformed);
  assert.equal(
    retailLocalInstallerFilenameMatchesPackageType(
      "BMS-POS-Plus-Retail-Local-Server-0.2.14-windows-x64.exe",
      "pos",
    ),
    false,
  );
});

test("keeps explicit legacy macOS package names classifiable during migration", () => {
  assert.deepEqual(
    inferRetailLocalInstallerIdentity("BMS-Retail-Local-Server-POS-0.2.14-pilot.12-arm64.pkg"),
    {
      filename: "BMS-Retail-Local-Server-POS-0.2.14-pilot.12-arm64.pkg",
      packageType: "server-pos",
      platform: "macos-arm64",
      version: "0.2.14-pilot.12",
    },
  );
});

test("recovers canonical identity from legacy and collision-proof storage keys", () => {
  const original = "BMS-POS-Plus-Retail-Local-POS-0.2.14-pilot.13-windows-x64.exe";
  const legacy = `2026/11/25/1790000000000-${original}`;
  const current = `2026/11/25/1790000000000-${original.slice(0, -4)}-2f1cbdf3-5ac5-4a87-947c-7ca17a117d9d.exe`;
  for (const storedPath of [original, legacy, current]) {
    assert.equal(retailLocalStoredPathOriginalName(storedPath), original);
    assert.equal(inferRetailLocalInstallerIdentityFromStoredPath(storedPath)?.packageType, "pos");
  }
  assert.equal(
    retailLocalStoredPathOriginalName(
      "2026/11/25/1790000000000-BMS-POS-Plus-Retail-Local-Server-0.2.14-pilot.13-windows-x64.exe",
    ),
    "BMS-POS-Plus-Retail-Local-Server-0.2.14-pilot.13-windows-x64.exe",
  );
  assert.equal(retailLocalStoredPathOriginalName("2026/11/25/random-installer.exe"), null);
});
