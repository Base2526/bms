import electronMain from "electron/main";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";
import locale from "../renderer/locale.cjs";
import { desktopMenuTemplate, localizeNativeMenu } from "../src/zoom-policy.mjs";
import { platformClientLabel, platformSecurityNote } from "../src/secure-storage.mjs";
import { PairingRestoreError } from "../src/pairing-store.mjs";

const { app, BrowserWindow, ipcMain, Menu } = electronMain;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "../dist-smoke");
const screenshotPath = path.join(outputDir, "setup.png");
const compactScreenshotPath = path.join(outputDir, "setup-compact.png");
const startupScreenshotPath = path.join(outputDir, "startup-error.png");

async function run() {
  const menuItems = menu => menu.items.flatMap(item => [item, ...(item.submenu ? menuItems(item.submenu) : [])]);
  for (const language of ["en", "th"]) {
    locale.applyAppLanguage(language);
    const menu = localizeNativeMenu(Menu.buildFromTemplate(desktopMenuTemplate(process.platform, false, { language })));
    Menu.setApplicationMenu(menu);
    const copy = menuItems(menu).find(item => item.role === "copy");
    assert.equal(copy?.label, language === "en" ? "Copy" : "คัดลอก");
    assert.equal(menu.items.find(item => item.id === "view")?.label, language === "en" ? "View" : "มุมมอง");
  }
  console.log("smoke: native menu roles follow TH/EN");
  const { version } = JSON.parse(await readFile(path.join(__dirname, "../package.json"), "utf8"));
  // Use the host's labels, but keep pairing/storage stubbed: never read a real device token.
  ipcMain.handle("smoke:app-info", () => ({
    version,
    platform: process.platform,
    clientLabel: platformClientLabel(process.platform),
    securityNote: platformSecurityNote(process.platform),
    secureStorageReady: true,
    secureStorageError: null,
    secureStorageBackend: null,
  }));
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "smoke-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  console.log("smoke: loading setup renderer");
  try {
    await window.loadFile(path.join(__dirname, "../renderer/setup.html"));
    console.log("smoke: setup renderer loaded");
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => { const tick = () => document.querySelector('#admin-link-row')?.hidden === false ? resolve() : setTimeout(tick, 20); tick(); })",
    );
    const state = await window.webContents.executeJavaScript(`({
      title: document.title,
      heading: document.querySelector('h1')?.textContent,
      fields: document.querySelectorAll('input, textarea').length,
      button: document.querySelector('#pair-button')?.textContent?.trim(),
      adminLink: document.querySelector('#admin-link-label')?.textContent?.trim(),
      alertCloseLabel: document.querySelector('#status-close')?.getAttribute('aria-label'),
      clientLabel: document.querySelector('#client-label')?.textContent,
      securityNote: document.querySelector('#security-note')?.textContent,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight
    })`);
    if (state.title !== "ตั้งค่า BMS POS" || state.heading !== "เชื่อมต่อเครื่องแคชเชียร์") {
      throw new Error(`Unexpected setup content: ${JSON.stringify(state)}`);
    }
    if (
      state.fields !== 2
      || !state.button?.includes("ตรวจสอบและเชื่อมต่อ")
      || !state.adminLink?.includes("สร้างจากระบบหลังบ้านบนเครื่องนี้")
      || state.alertCloseLabel !== "ปิดการแจ้งเตือน"
      || state.clientLabel !== platformClientLabel(process.platform)
      || state.securityNote !== platformSecurityNote(process.platform)
      || state.overflowX
      || state.overflowY
    ) {
      throw new Error(`Invalid setup layout: ${JSON.stringify(state)}`);
    }
    await mkdir(outputDir, { recursive: true });
    console.log("smoke: capturing setup renderer");
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const image = await window.webContents.capturePage();
    await writeFile(screenshotPath, image.toPNG());

    // The dismiss button must sit inside the error box; the global button rule once pushed it below.
    const alertGeometry = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('#pairing-form').requestSubmit();
      await new Promise((resolve) => { const tick = () => document.querySelector('#status').hidden ? setTimeout(tick, 20) : resolve(); tick(); });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = document.querySelector('#status').getBoundingClientRect();
      const close = document.querySelector('#status-close').getBoundingClientRect();
      return { inside: close.top >= box.top && close.bottom <= box.bottom && close.right <= box.right && close.left >= box.left,
        centred: Math.abs((close.top + close.bottom) / 2 - (box.top + box.bottom) / 2) <= 1 };
    })()`);
    if (!alertGeometry.inside || !alertGeometry.centred) {
      throw new Error(`Alert close button is outside its box: ${JSON.stringify(alertGeometry)}`);
    }
    await writeFile(path.join(outputDir, "setup-error.png"), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("document.querySelector('#status-close').click()");

    window.setContentSize(700, 900);
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const compactState = await window.webContents.executeJavaScript(`({
      adminLinkVisible: !document.querySelector('#admin-link-row')?.hidden,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight
    })`);
    if (!compactState.adminLinkVisible || compactState.overflowX || compactState.overflowY) {
      throw new Error(`Invalid compact setup layout: ${JSON.stringify(compactState)}`);
    }
    const compactImage = await window.webContents.capturePage();
    await writeFile(compactScreenshotPath, compactImage.toPNG());
    window.setContentSize(1100, 760);

    console.log("smoke: loading startup renderer");
    await window.loadFile(path.join(__dirname, "../renderer/startup.html"));
    const loadingState = await window.webContents.executeJavaScript(`({
      heading: document.querySelector('#loading-state h1')?.textContent,
      loadingHidden: document.querySelector('#loading-state')?.hidden,
      errorHidden: document.querySelector('#error-state')?.hidden
    })`);
    if (
      loadingState.heading !== "กำลังเชื่อมต่อเครื่องขาย"
      || loadingState.loadingHidden !== false
      || loadingState.errorHidden !== true
    ) {
      throw new Error(`Invalid startup loading layout: ${JSON.stringify(loadingState)}`);
    }

    console.log("smoke: loading local runtime startup renderer");
    await window.loadFile(path.join(__dirname, "../renderer/startup.html"), {
      query: {
        state: "starting",
        message: "กำลังเริ่มเซิร์ฟเวอร์ทดสอบ",
      },
    });
    const localRuntimeState = await window.webContents.executeJavaScript(`({
      heading: document.querySelector('#loading-heading')?.textContent,
      message: document.querySelector('#loading-message')?.textContent,
      loadingHidden: document.querySelector('#loading-state')?.hidden,
      errorHidden: document.querySelector('#error-state')?.hidden,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight
    })`);
    if (
      localRuntimeState.heading !== "กำลังเริ่ม Retail Local Server"
      || localRuntimeState.message !== "กำลังเริ่มเซิร์ฟเวอร์ทดสอบ"
      || localRuntimeState.loadingHidden !== false
      || localRuntimeState.errorHidden !== true
      || localRuntimeState.overflowX
      || localRuntimeState.overflowY
    ) {
      throw new Error(`Invalid local runtime startup layout: ${JSON.stringify(localRuntimeState)}`);
    }

    console.log("smoke: loading startup recovery renderer");
    await window.loadFile(path.join(__dirname, "../renderer/startup.html"), {
      query: {
        state: "error",
        message: "ทดสอบการเชื่อมต่อไม่สำเร็จ",
      },
    });
    const startupState = await window.webContents.executeJavaScript(`({
      title: document.title,
      loadingHidden: document.querySelector('#loading-state')?.hidden,
      errorHidden: document.querySelector('#error-state')?.hidden,
      message: document.querySelector('#error-message')?.textContent,
      retry: document.querySelector('#retry-button')?.textContent,
      changeServer: document.querySelector('#change-server-button')?.textContent,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight
    })`);
    if (
      startupState.title !== "กำลังเปิด BMS POS"
      || startupState.loadingHidden !== true
      || startupState.errorHidden !== false
      || startupState.message !== "ทดสอบการเชื่อมต่อไม่สำเร็จ"
      || startupState.retry !== "ลองใหม่"
      || startupState.changeServer !== "เปลี่ยนเซิร์ฟเวอร์"
      || startupState.overflowX
      || startupState.overflowY
    ) {
      throw new Error(`Invalid startup recovery layout: ${JSON.stringify(startupState)}`);
    }
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const startupImage = await window.webContents.capturePage();
    await writeFile(startupScreenshotPath, startupImage.toPNG());

    for (const [selector, message] of [
      ["#change-server-button", "ลบข้อมูลจับคู่ไม่สำเร็จ ข้อมูลเดิมยังอยู่"],
      ["#retry-button", "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่"],
    ]) {
      const failedAction = await window.webContents.executeJavaScript(`(async () => {
        document.querySelector(${JSON.stringify(selector)}).click();
        await new Promise((resolve) => { const tick = () => document.querySelector('#retry-button').disabled ? setTimeout(tick, 20) : resolve(); tick(); });
        return { message: document.querySelector('#error-message').textContent,
          retryDisabled: document.querySelector('#retry-button').disabled,
          changeDisabled: document.querySelector('#change-server-button').disabled };
      })()`);
      if (failedAction.message !== message || failedAction.retryDisabled || failedAction.changeDisabled) {
        throw new Error(`Recovery action failure was not usable: ${JSON.stringify(failedAction)}`);
      }
    }

    // Recovery text must remain readable at both desktop and compact window sizes.
    const recoveryMessage = new PairingRestoreError().userMessage;
    for (const [width, height] of [[1100, 760], [700, 900]]) {
      window.setContentSize(width, height);
      await window.loadFile(path.join(__dirname, "../renderer/startup.html"), {
        query: { state: "storage-error", message: recoveryMessage },
      });
      const recovery = await window.webContents.executeJavaScript(`({
        heading: document.querySelector('#error-heading')?.textContent,
        message: document.querySelector('#error-message')?.textContent,
        errorHidden: document.querySelector('#error-state')?.hidden,
        retryDisabled: document.querySelector('#retry-button')?.disabled,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        overflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight
      })`);
      if (recovery.heading !== "ยังอ่านข้อมูลจับคู่เดิมไม่ได้"
        || recovery.message !== recoveryMessage || recovery.errorHidden || recovery.retryDisabled
        || recovery.overflowX || recovery.overflowY) {
        throw new Error(`Invalid pairing recovery layout: ${JSON.stringify(recovery)}`);
      }
      await writeFile(path.join(outputDir, `pairing-recovery-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
    // Exercise the real reopen function with native windows, leaving a utility window alive.
    const mainSource = (await readFile(path.join(__dirname, "../src/main.mjs"), "utf8")).replace(/\r\n/g, "\n");
    const start = mainSource.indexOf("function reopenMainWindow(");
    const reopenSource = mainSource.slice(start, mainSource.indexOf("\n}\n", start) + 3);
    const oldCashier = new BrowserWindow({show:false});
    oldCashier.destroy();
    let reopened;
    let opened = 0;
    try {
      vm.runInNewContext(`${reopenSource};reopenMainWindow();`, {
        app, mainWindow:oldCashier, activePairing:{},
        createMainWindow:()=>{reopened=new BrowserWindow({show:false});return reopened;},
        startPosNavigation:()=>{opened++;},
      });
      if (!reopened || reopened.isDestroyed() || opened !== 1 || window.isDestroyed()) {
        throw new Error("Could not reopen the native cashier with a utility window still open");
      }
    } finally { if (reopened && !reopened.isDestroyed()) reopened.destroy(); }
    // Production preload + native IPC must let the renderer clear its draft before navigation.
    const pairedWindow = new BrowserWindow({ show: false, webPreferences: {
      preload: path.join(__dirname, "../src/preload.cjs"), contextIsolation: true,
      nodeIntegration: false, sandbox: true,
    } });
    const registered = [];
    let removed = false, navigatedResolve;
    const navigated = new Promise(resolve => { navigatedResolve = resolve; });
    const extract = name => {
      const from = mainSource.indexOf(`function ${name}(`);
      return from < 0 ? "" : mainSource.slice(from, mainSource.indexOf("\n}\n", from) + 3);
    };
    const unpairContext = vm.createContext({
      mainWindow: pairedWindow, activePairing: {}, pendingUnpair: null, setTimeout, clearTimeout, console,
      ipcMain: {
        handle: (name, handler) => { registered.push(name); ipcMain.handle(name, handler); },
        on: () => {},
      },
      isPairedCashierFrame: () => true,
      removePairing: async () => { removed = true; unpairContext.activePairing = null; return { ok: true }; },
      showSetup: async target => {
        const outcome = { removed, title: target.webContents.getTitle() };
        await target.loadURL("about:blank");
        navigatedResolve(outcome);
      },
    });
    try {
      vm.runInContext(`${extract("finishUnpairNavigation")};${extract("registerIpc")};registerIpc();`, unpairContext);
      await pairedWindow.loadURL("about:blank");
      void pairedWindow.webContents.executeJavaScript(`window.bmsDesktop.unpair(() => {
        document.title = 'draft-cleared-before-navigation';
      })`).catch(() => {}); // Navigating destroys the caller after its cleanup has completed.
      const result = await navigated;
      if (!result.removed || result.title !== "draft-cleared-before-navigation") {
        throw new Error(`Unpair navigation ran before renderer cleanup: ${JSON.stringify(result)}`);
      }
    } finally {
      if (unpairContext.pendingUnpair) clearTimeout(unpairContext.pendingUnpair.timer);
      for (const name of registered) ipcMain.removeHandler(name);
      if (!pairedWindow.isDestroyed()) pairedWindow.destroy();
    }
    console.log(JSON.stringify({ ok: true, platform: process.platform, version, cashierReopened:true, screenshotPath, compactScreenshotPath, startupScreenshotPath, state, compactState, loadingState, localRuntimeState, startupState }));
  } finally {
    window.destroy();
    ipcMain.removeHandler("smoke:app-info");
  }
}

const watchdog = setTimeout(() => {
  console.error("Electron setup smoke timed out after 60 seconds");
  app.exit(1);
}, 60_000);
console.log("smoke: waiting for Electron");
app.whenReady()
  .then(run)
  .then(() => {
    clearTimeout(watchdog);
    app.quit();
  })
  .catch((error) => {
    clearTimeout(watchdog);
    console.error(error);
    app.exit(1);
  });
