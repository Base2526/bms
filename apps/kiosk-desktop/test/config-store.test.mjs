import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKioskConfigStore, KioskConfigRestoreError } from "../src/config-store.mjs";

const config = { url: `https://bms.jachoei.com/kiosk/${"a".repeat(43)}`,
  deviceToken: `bmsk_${"b".repeat(43)}` };
test("encrypted config is atomic, absent config is distinct from corruption", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bms-kiosk-test-"));
  try {
    const file = join(dir, "config.json");
    const store = createKioskConfigStore(file, (s) => Buffer.from(s).toString("base64"),
      (s) => Buffer.from(s, "base64").toString(), ["https://bms.jachoei.com"]);
    assert.equal(await store.read(), null);
    await store.write(config);
    assert.deepEqual(await store.read(), config);
    const rotated = { ...config, url: `https://bms.jachoei.com/kiosk/${"c".repeat(43)}` };
    await store.write(rotated);
    assert.deepEqual(await store.read(), rotated);
    const raw = await readFile(file, "utf8");
    assert.equal(raw.includes(config.deviceToken), false);
    assert.equal(raw.includes(config.url), false);
    assert.equal(raw.includes(rotated.url), false);
    const broken = createKioskConfigStore(file, () => "", () => { throw Error("lost OS key"); }, ["https://bms.jachoei.com"]);
    await assert.rejects(broken.read(), KioskConfigRestoreError);
    assert.deepEqual(await store.read(), rotated);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
