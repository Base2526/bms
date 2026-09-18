import electronMain from "electron/main";
import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePairingInput } from "./pairing.mjs";
import { MOBILE_POS_PATH, posEntryPathForStatus } from "./renderer-route.mjs";
import { platformClientLabel, platformSecurityNote, secureStorageStatus } from "./secure-storage.mjs";
import { desktopMenuTemplate, installFixedZoomPolicy } from "./zoom-policy.mjs";

const { app, BrowserWindow, ipcMain, Menu, net, safeStorage, shell } = electronMain;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETUP_FILE = path.join(__dirname, "../renderer/setup.html");
const PRELOAD_FILE = path.join(__dirname, "preload.cjs");
const CONFIG_VERSION = 1;

let mainWindow = null;
let activePairing = null;

function configPath() {
  return path.join(app.getPath("userData"), "pairing.json");
}

function currentSecureStorageStatus() {
  const backend = process.platform === "linux"
    ? safeStorage.getSelectedStorageBackend()
    : null;
  return {
    backend,
    ...secureStorageStatus({
      platform: process.platform,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      backend,
    }),
  };
}

function encryptedToken(token) {
  const storage = currentSecureStorageStatus();
  if (!storage.ok) throw new Error(storage.error);
  return safeStorage.encryptString(token).toString("base64");
}

function decryptedToken(value) {
  if (!currentSecureStorageStatus().ok) return null;
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
}

async function readPairing() {
  try {
    const raw = JSON.parse(await readFile(configPath(), "utf8"));
    if (raw?.version !== CONFIG_VERSION || typeof raw.serverUrl !== "string" || typeof raw.token !== "string") return null;
    const token = decryptedToken(raw.token);
    const parsed = token ? parsePairingInput({ serverUrl: raw.serverUrl, pairingInput: token }) : null;
    return parsed?.ok ? { serverUrl: parsed.serverUrl, token: parsed.token } : null;
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Unable to read desktop pairing configuration");
    return null;
  }
}

async function writePairing(pairing) {
  const target = configPath();
  const temporary = `${target}.tmp`;
  const payload = JSON.stringify({
    version: CONFIG_VERSION,
    serverUrl: pairing.serverUrl,
    token: encryptedToken(pairing.token),
  });
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

async function removePairing() {
  activePairing = null;
  await rm(configPath(), { force: true });
}

function isSetupFrame(event) {
  try {
    return fileURLToPath(event.senderFrame.url) === SETUP_FILE;
  } catch {
    return false;
  }
}

function isPairedPosFrame(event) {
  if (!activePairing) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.origin === activePairing.serverUrl && isPosPath(url.pathname);
  } catch {
    return false;
  }
}

function isPosPath(pathname) {
  return pathname === "/pos" || pathname.startsWith("/pos/");
}

function isActiveOrigin(value) {
  if (!activePairing) return false;
  try {
    return new URL(value).origin === activePairing.serverUrl;
  } catch {
    return false;
  }
}

function openExternalHttp(value) {
  try {
    const target = new URL(value);
    if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(target.toString());
  } catch {}
}

function setupWindowSecurity(targetSession) {
  targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    return permission === "media"
      && details.mediaType === "video"
      && isActiveOrigin(details.securityOrigin ?? requestingOrigin);
  });
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes ?? [] : [];
    const allowed = permission === "media"
      && mediaTypes.length > 0
      && mediaTypes.every((type) => type === "video")
      && isActiveOrigin(webContents.getURL());
    callback(allowed);
  });
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "BMS POS",
    backgroundColor: "#f4f6f8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:bms-pos",
    },
  });

  setupWindowSecurity(window.webContents.session);
  window.once("ready-to-show", () => window.show());

  window.webContents.on("will-navigate", (event, destination) => {
    if (destination.startsWith("file:")) return;
    try {
      const target = new URL(destination);
      if (activePairing && target.origin === activePairing.serverUrl && isPosPath(target.pathname)) return;
    } catch {}
    event.preventDefault();
    openExternalHttp(destination);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const isPosUtility = activePairing
        && target.origin === activePairing.serverUrl
        && (target.pathname === "/pos/display" || target.pathname === "/pos/manual");
      if (isPosUtility) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              preload: PRELOAD_FILE,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              partition: "persist:bms-pos",
            },
          },
        };
      }
    } catch {}
    openExternalHttp(url);
    return { action: "deny" };
  });

  if (process.env.BMS_POS_DESKTOP_DEVTOOLS === "1") window.webContents.openDevTools({ mode: "detach" });
  return window;
}

async function showSetup() {
  if (mainWindow) await mainWindow.loadFile(SETUP_FILE);
}

async function showPos() {
  if (!mainWindow || !activePairing) return;
  let entryPath = MOBILE_POS_PATH;
  try {
    const response = await net.fetch(new URL(MOBILE_POS_PATH, activePairing.serverUrl), {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${activePairing.token}`,
        "x-pos-device-token": activePairing.token,
      },
    });
    entryPath = posEntryPathForStatus(response.status);
  } catch {
    // Preserve the new route for transient network failures. Chromium will show the real connection
    // error and a retry can recover; fallback is only for a confirmed old-server 404.
  }
  await mainWindow.loadURL(new URL(entryPath, activePairing.serverUrl).toString());
}

async function verifyPairing(pairing) {
  let response;
  try {
    response = await net.fetch(new URL("/api/pos/session", pairing.serverUrl), {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: { "x-pos-device-token": pairing.token },
    });
  } catch {
    return { ok: false, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจ URL อินเทอร์เน็ต และใบรับรอง HTTPS" };
  }
  if (response.status === 401) return { ok: false, error: "token ไม่ถูกต้อง ถูกยกเลิก หรือมีการออก token ใหม่แล้ว" };
  if (!response.ok) return { ok: false, error: `เซิร์ฟเวอร์ตอบกลับ HTTP ${response.status}` };
  return { ok: true };
}

function registerIpc() {
  ipcMain.handle("bms-pos:pair", async (event, input) => {
    if (!isSetupFrame(event)) return { ok: false, error: "หน้าต่างนี้ไม่มีสิทธิ์จับคู่เครื่อง" };
    const storage = currentSecureStorageStatus();
    if (!storage.ok) return { ok: false, error: storage.error };
    const parsed = parsePairingInput({ serverUrl: input?.serverUrl, pairingInput: input?.pairingInput });
    if (!parsed.ok) return parsed;
    const verified = await verifyPairing(parsed);
    if (!verified.ok) return verified;
    try {
      await writePairing(parsed);
      activePairing = { serverUrl: parsed.serverUrl, token: parsed.token };
      await showPos();
      return { ok: true };
    } catch {
      return { ok: false, error: "บันทึกการจับคู่แบบเข้ารหัสไม่สำเร็จ" };
    }
  });

  ipcMain.handle("bms-pos:get-device-token", async (event) => {
    if (!isPairedPosFrame(event)) return null;
    return activePairing?.token ?? null;
  });

  ipcMain.handle("bms-pos:get-storage-namespace", async (event) => {
    if (!isPairedPosFrame(event) || !activePairing) return null;
    return createHash("sha256").update(activePairing.token).digest("hex").slice(0, 16);
  });

  ipcMain.handle("bms-pos:unpair", async (event) => {
    if (!isPairedPosFrame(event)) return { ok: false };
    await removePairing();
    await showSetup();
    return { ok: true };
  });

  ipcMain.handle("bms-pos:app-info", async (event) => {
    if (!isSetupFrame(event)) return null;
    const storage = currentSecureStorageStatus();
    return {
      version: app.getVersion(),
      platform: process.platform,
      clientLabel: platformClientLabel(process.platform),
      securityNote: platformSecurityNote(process.platform),
      secureStorageReady: storage.ok,
      secureStorageError: storage.ok ? null : storage.error,
      secureStorageBackend: storage.backend,
    };
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("com.bms.pos.desktop");
    app.on("web-contents-created", (_event, webContents) => {
      installFixedZoomPolicy(webContents);
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(desktopMenuTemplate(
      process.platform,
      process.env.BMS_POS_DESKTOP_DEVTOOLS === "1",
    )));
    registerIpc();
    mainWindow = createMainWindow();
    activePairing = await readPairing();
    if (activePairing) await showPos();
    else await showSetup();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      void (activePairing ? showPos() : showSetup());
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
