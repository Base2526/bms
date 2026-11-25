import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { inferRetailLocalInstallerIdentity } from "../apps/web/lib/bms/retailLocalReleaseFilename.ts";
import { hashRetailLocalInstallerFile } from "../apps/web/lib/bms/retailLocalReleaseClientHash.ts";

const page = readFileSync(
  new URL("../apps/web/app/(admin)/admin/retail-local-releases/page.tsx", import.meta.url),
  "utf8",
);

test("changing installer files replaces every inferred identity field", () => {
  const server = inferRetailLocalInstallerIdentity(
    "BMS-POS-Plus-Retail-Local-Server-0.2.14-pilot.13-windows-x64.exe",
  );
  const pos = inferRetailLocalInstallerIdentity(
    "BMS-POS-Plus-Retail-Local-POS-0.2.14-pilot.14-linux-x64.deb",
  );
  assert.deepEqual(
    [server?.platform, server?.packageType, server?.version],
    ["windows-x64", "server", "0.2.14-pilot.13"],
  );
  assert.deepEqual(
    [pos?.platform, pos?.packageType, pos?.version],
    ["ubuntu-x64", "pos", "0.2.14-pilot.14"],
  );
  assert.match(page, /platform: platform \?\? undefined,[\s\S]*packageType: packageType \?\? undefined,[\s\S]*version: version \?\? undefined/);
  assert.match(page, /Clear identity from the previous file before inferring the new one/);
});

test("upload blocks mismatches and previews a streamed SHA256 before submit", () => {
  assert.match(page, /identity\.packageType !== values\.packageType/);
  assert.match(page, /identity\.platform !== values\.platform/);
  assert.match(page, /identity\.version !== values\.version/);
  assert.match(page, /hashRetailLocalInstallerFile\(file, controller\.signal\)/);
  assert.match(page, /body\.set\("sha256", inferredFile\.sha256\)/);
  assert.doesNotMatch(page, /arrayBuffer\(/);
  assert.match(page, /disabled=\{Boolean\(inferredFile\)\}/);
});

test("changing a file while hashing cancels the stale read and hashes the new bytes", async () => {
  let cancelled = false;
  const stale = {
    stream: () => new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("old-prefix")); },
      cancel() { cancelled = true; },
    }),
  } as Blob;
  const controller = new AbortController();
  const staleHash = hashRetailLocalInstallerFile(stale, controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(staleHash, (error: any) => error?.name === "AbortError");
  assert.equal(cancelled, true);
  assert.equal(
    await hashRetailLocalInstallerFile(new Blob(["new-file"])),
    "342ee80adc3b487a99a1ae5dd36816697350a34f4d8b8d9ab8949a1049f05f0b",
  );
  assert.match(page, /hashAbort\.current\?\.abort\(\)/);
  assert.match(page, /hashGeneration\.current !== generation/);
});
