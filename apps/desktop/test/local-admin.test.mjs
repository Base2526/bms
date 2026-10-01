import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("first-run setup can open local POS device management on every desktop platform", async () => {
  const [main, preload, setup] = await Promise.all([
    read("src/main.mjs"),
    read("src/preload.cjs"),
    read("renderer/setup.html"),
  ]);

  assert.match(preload, /openLocalAdmin: \(\) => ipcRenderer\.invoke\("bms-pos:open-local-admin"\)/);
  assert.match(setup, /id="local-admin-button"[\s\S]+เปิดระบบหลังบ้านบนเครื่องนี้/);
  assert.match(
    main,
    /ipcMain\.handle\("bms-pos:open-local-admin"[\s\S]+if \(!isSetupFrame\(event\)\)[\s\S]+openInstalledLocalAdmin\(\)/,
  );
  assert.match(
    main,
    /async function openInstalledLocalAdmin\(\)[\s\S]+startManagedLocalRuntime\(\)[\s\S]+managedLocalPosDevicesUrl\(\)/,
  );
  assert.doesNotMatch(setup, /id="local-admin-section"[^>]*hidden/);
  const renderer = await read("renderer/setup.js");
  assert.doesNotMatch(renderer, /platform\s*!==\s*["']darwin/);
  assert.match(main, /await checkManagedLocalAdminReady/);
  assert.match(main, /await shell\.openExternal\(managedLocalPosDevicesUrl\(\)\)/);
  assert.doesNotMatch(main, /if \(!result\?\.attempted\) return false/);
});
