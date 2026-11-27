import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "..", "..", ".test-output", "kiosk-desktop-shell");
let current = { view: "setup", reason: "NETWORK" };
ipcMain.handle("kiosk:get-state", () => current);
ipcMain.handle("kiosk:validate", () => ({ ok: true, storeName: "FAKE Restaurant", locationName: "FAKE Branch" }));
ipcMain.handle("kiosk:activate", () => ({ ok: true }));
ipcMain.handle("kiosk:verify-pin", (_event, pin) => ({ ok: pin === "123456", code: "INVALID_PIN" }));
ipcMain.handle("kiosk:cancel", () => ({ ok: true }));
ipcMain.handle("kiosk:retry", () => ({ ok: false, code: "NETWORK" }));
ipcMain.handle("kiosk:maintenance", () => ({ ok: true }));

async function capture(win, name) {
  await writeFile(join(output, `${name}.png`), await win.webContents.capturePage().then((image) => image.toPNG()));
}

app.whenReady().then(async () => {
  await mkdir(output, { recursive: true });
  const win = new BrowserWindow({ width: 1080, height: 1920, show: false,
    webPreferences: { preload: join(root, "src", "preload.cjs"), contextIsolation: true,
      nodeIntegration: false, sandbox: true } });
  try {
    await win.loadFile(join(root, "renderer", "shell.html"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const setup = await win.webContents.executeJavaScript("({visible:!document.querySelector('#setup').hidden, title:document.querySelector('#setup-title').textContent, bridge:typeof window.bmsKiosk.getState, overflow:document.documentElement.scrollWidth>innerWidth})");
    assert.equal(setup.visible, true);
    assert.equal(setup.bridge, "function");
    assert.equal(setup.overflow, false);
    await capture(win, "setup-portrait");
    await win.webContents.executeJavaScript(`document.querySelector('#kiosk-url').value='https://bms.jachoei.com/kiosk/${"a".repeat(43)}'; document.querySelector('#device-token').value='FAKE-CREDENTIAL'; document.querySelector('#setup-form').requestSubmit()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await win.webContents.executeJavaScript("!document.querySelector('#setup-open').hidden"), true);
    await capture(win, "verified-branch-portrait");
    current = { view: "pin", reason: "NETWORK" };
    await win.reload();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await win.webContents.executeJavaScript("!document.querySelector('#pin').hidden"), true);
    await capture(win, "maintenance-pin-portrait");
    current = { view: "recovery", reason: "REVOKED" };
    await win.reload();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#retry').hidden"), true);
    await capture(win, "recovery-portrait");
    win.setSize(1920, 1080);
    current = { view: "setup", reason: "NETWORK" };
    await win.reload();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await win.webContents.executeJavaScript("document.documentElement.scrollWidth>innerWidth"), false);
    await capture(win, "setup-landscape");
    console.log("shell smoke: setup, verified branch, PIN, recovery, landscape passed (5 screenshots)");
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
}).catch((error) => { console.error(error); process.exitCode = 1; app.quit(); });
