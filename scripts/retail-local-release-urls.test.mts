import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (name: string) => readFileSync(new URL(`../deploy/retail-local/${name}`, import.meta.url), "utf8");
test("all online build entrypoints default to the BMS release host using one target map", () => {
  for (const name of ["build-release.ps1", "build-online-bootstrap.ps1", "build-online-pos-bootstrap.ps1"]) {
    const source = read(name);
    assert.match(source, /ReleaseBaseUri = "https:\/\/releases\.jachoei\.com\/retail-local"/);
    assert.match(source, /Get-RetailLocalReleaseUrls -Version \$Version -BaseUri \$ReleaseBaseUri/);
    assert.doesNotMatch(source, /github\.com\/Base2526\/bms\/releases\/download/);
  }
});
test("release URL mapping preserves the public x86 folder, HTTPS, and version", { skip: process.platform !== "win32" }, () => {
  const helper = fileURLToPath(new URL("../deploy/retail-local/release-urls.ps1", import.meta.url)).replaceAll("'", "''");
  const invoke = (extra: string) => spawnSync("pwsh", ["-NoProfile", "-Command", `$ErrorActionPreference='Stop'; . '${helper}'; ${extra}`], { encoding: "utf8" });
  const result = invoke("Get-RetailLocalReleaseUrls -Version 0.2.14-pilot.1 | ConvertTo-Json -Compress");
  assert.equal(result.status, 0, result.stderr);
  const urls = JSON.parse(result.stdout);
  const base = "https://releases.jachoei.com/retail-local/0.2.14-pilot.1";
  for (const [name, folder] of Object.entries({ WindowsManifestUri: "windows-11-x64", WindowsX86ManifestUri: "windows-10-x86", LinuxManifestUri: "ubuntu-24.04-lts-x64", MacArm64ManifestUri: "macos-15-arm64", MacX64ManifestUri: "macos-15-x64" })) {
    assert.equal(urls[name], `${base}/${folder}/release.jws.json`);
  }
  const custom = invoke("Get-RetailLocalReleaseUrls -Version 1.2.3 -BaseUri https://test.invalid/releases/ | ConvertTo-Json -Compress");
  assert.equal(custom.status, 0, custom.stderr);
  assert.equal(JSON.parse(custom.stdout).WindowsX86ManifestUri, "https://test.invalid/releases/1.2.3/windows-10-x86/release.jws.json");
  for (const baseUri of ["http://host/releases", "https://user:password@host/releases", "https://host/releases?q=x", "https://host/releases#x"]) {
    assert.notEqual(invoke(`Get-RetailLocalReleaseUrls -Version 1.2.3 -BaseUri '${baseUri}'`).status, 0);
  }
});
