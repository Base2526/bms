import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name: string) => readFileSync(new URL(`../deploy/retail-local/${name}`, import.meta.url), "utf8");

test("online builders emit seven canonical package identities and signed metadata sidecars", () => {
  const pos = read("build-online-pos-bootstrap.ps1");
  const server = read("build-online-bootstrap.ps1");
  for (const fragment of [
    "BMS-POS-Plus-Retail-Local-POS-$Version-windows-x64",
    "BMS-POS-Plus-Retail-Local-POS-$Version-windows-x86-legacy",
    "BMS-POS-Plus-Retail-Local-POS-$Version-linux-x64",
  ]) assert.ok(pos.includes(fragment), fragment);
  for (const fragment of [
    '"BMS-POS-Plus-Retail-Local-$label-$Version-windows-x64$artifactQualifier.exe"',
    '"BMS-POS-Plus-Retail-Local-$label-$Version-linux-x64$artifactQualifier.deb"',
    '$label = if ($_ -eq "server") { "Server" } else { "Server-POS" }',
  ]) assert.ok(server.includes(fragment), fragment);
  for (const source of [pos, server]) {
    for (const field of ["version", "sourceCommit", "platform", "architecture", "packageType", "distribution", "sizeBytes", "sha256"]) {
      assert.match(source, new RegExp(`\\b${field}\\s*=`), field);
    }
    assert.match(source, /Get-FileHash -LiteralPath \$Path -Algorithm SHA256/);
    assert.match(source, /\$Path\.sha256/);
    assert.match(source, /\$Path\.json/);
    assert.match(source, /Online bootstrap exceeds 25 MiB|POS online bootstrap exceeds 25 MiB/);
  }
});

test("online is the default and macOS emits payload-free canonical identities", () => {
  const wrapper = read("build-release.ps1");
  const macServer = read("managed-runtime/macos/build-bootstrap-pkg.sh");
  const macPos = read("managed-runtime/macos/build-pos-bootstrap-dmg.sh");
  assert.match(wrapper, /\[ValidateSet\("Online", "Offline"\)\]\[string\]\$Distribution = "Online"/);
  assert.match(wrapper, /-Distribution Offline -AllowOfflineRecovery/);
  assert.match(macServer, /BMS-POS-Plus-Retail-Local-\$package_label-\$version-\$architecture\$qualifier[.]pkg/);
  assert.match(macPos, /BMS-POS-Plus-Retail-Local-POS-\$version-macos-\$architecture\$qualifier[.]dmg/);
  for (const source of [macServer, macPos]) {
    assert.match(source, /packageType/);
    assert.match(source, /distribution":"online-bootstrap/);
    assert.match(source, /sizeBytes/);
    assert.match(source, /sha256/);
    assert.match(source, /PRIVATE KEY/);
  }
  assert.match(macPos, /electronEmbedded":false/);
  assert.match(macPos, /firstInstallInternetRequired":true/);
});
