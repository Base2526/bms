import electronMain from "electron/main";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow } = electronMain;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "../dist-smoke");
const screenshotPath = path.join(outputDir, "setup.png");
const startupScreenshotPath = path.join(outputDir, "startup-error.png");

async function run() {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: true,
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
    const state = await window.webContents.executeJavaScript(`({
      title: document.title,
      heading: document.querySelector('h1')?.textContent,
      fields: document.querySelectorAll('input, textarea').length,
      button: document.querySelector('#pair-button')?.textContent?.trim(),
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
      || state.alertCloseLabel !== "ปิดการแจ้งเตือน"
      || state.clientLabel !== "Windows Client"
      || !state.securityNote?.includes("Windows")
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
    console.log(JSON.stringify({ ok: true, screenshotPath, startupScreenshotPath, state, loadingState, startupState }));
  } finally {
    window.destroy();
  }
}

console.log("smoke: waiting for Electron");
app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
