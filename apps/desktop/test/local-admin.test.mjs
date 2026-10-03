import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("first-run setup links to the local back office when Retail Local runs here, else the cloud login", async () => {
  const [main, preload, setup, renderer, css] = await Promise.all([
    read("src/main.mjs"),
    read("src/preload.cjs"),
    read("renderer/setup.html"),
    read("renderer/setup.js"),
    read("renderer/setup.css"),
  ]);

  assert.match(preload, /getSetupAdminTarget: \(\) => ipcRenderer\.invoke\("bms-pos:setup-admin-target"\)/);
  assert.match(preload, /openSetupAdmin: \(\) => ipcRenderer\.invoke\("bms-pos:open-setup-admin"\)/);
  assert.doesNotMatch(preload, /open-local-admin/);

  for (const channel of ["bms-pos:setup-admin-target", "bms-pos:open-setup-admin"]) {
    const start = main.indexOf(`ipcMain.handle("${channel}"`);
    assert.ok(start > 0, `${channel} handler missing`);
    assert.match(main.slice(start, start + 300), /if \(!isSetupFrame\(event\)\)/, `${channel} must be setup-frame only`);
  }
  const open = main.slice(main.indexOf('ipcMain.handle("bms-pos:open-setup-admin"'), main.indexOf('ipcMain.handle("bms-pos:retry-startup"'));
  assert.match(open, /kind === "cloud"[\s\S]+shell\.openExternal\(cloudAdminUrl\(\)\)/);
  assert.match(open, /openInstalledLocalAdmin\(\)/);
  assert.match(main, /async function setupAdminTarget\(\)[\s\S]+detectManagedLocalInstallation/);
  assert.match(
    main,
    /async function openInstalledLocalAdmin\(\)[\s\S]+startManagedLocalRuntime\(\)[\s\S]+await checkManagedLocalAdminReady[\s\S]+managedLocalPosDevicesUrl\(\)/,
  );

  // The shortcut is a quiet text link under the pairing field, not a second full-width action.
  assert.doesNotMatch(setup, /local-admin-section|action-divider|local-admin-button/);
  assert.doesNotMatch(css, /\.local-admin-button|\.action-divider/);
  const pairing = setup.indexOf('id="pairing-input"');
  const link = setup.indexOf('id="admin-link-row"');
  const submit = setup.indexOf('id="pair-button"');
  assert.ok(pairing > 0 && pairing < link && link < submit, "admin link must sit between the pairing field and the submit button");
  assert.match(setup, /id="admin-link-row"[^>]*hidden/, "label must wait for the detected target");
  assert.match(renderer, /local: "สร้างจากระบบหลังบ้านบนเครื่องนี้"/);
  assert.match(renderer, /cloud: "สร้างจากระบบหลังบ้าน BMS"/);
  // Only a local server may prefill the URL field; the cloud login must never overwrite it.
  assert.match(renderer, /result\.kind === "local" && !serverInput\.value\.trim\(\)/);
  assert.doesNotMatch(renderer, /platform\s*!==\s*["']darwin/);
});
