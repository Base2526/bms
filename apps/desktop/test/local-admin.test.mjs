import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("first-run setup can start only the installed local server and open POS device management", async () => {
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
});
