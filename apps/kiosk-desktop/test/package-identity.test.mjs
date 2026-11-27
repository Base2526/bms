import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Kiosk and POS package identities and installers stay separate", async () => {
  const kiosk = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const pos = JSON.parse(await readFile(new URL("../../desktop/package.json", import.meta.url), "utf8"));
  assert.notEqual(kiosk.name, pos.name);
  assert.notEqual(kiosk.build.appId, pos.build.appId);
  assert.notEqual(kiosk.build.productName, pos.build.productName);
  assert.notEqual(kiosk.build.artifactName, pos.build.artifactName);
  assert.equal(kiosk.main, "src/main.mjs");
  assert.equal(kiosk.build.files.some((entry) => entry.includes("desktop")), false);
});
