import electronMain from "electron/main";
import { createHash } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CUSTOMER_DISPLAY_CONFIG,
  normalizeCustomerDisplayConfig,
  selectCustomerDisplay,
} from "./display-policy.mjs";
import { parsePairingHandoff, parsePairingInput } from "./pairing.mjs";
import {
  cachedPosEntryPath,
  MOBILE_POS_PATH,
  POS_NAVIGATION_TIMEOUT_MS,
  resolvePosEntryPath,
} from "./renderer-route.mjs";
import { platformClientLabel, platformSecurityNote, secureStorageStatus } from "./secure-storage.mjs";
import {
  desktopMenuTemplate,
  installFixedZoomPolicy,
  installGlobalZoomPolicy,
} from "./zoom-policy.mjs";

const { app, BrowserWindow, ipcMain, Menu, net, Notification, safeStorage, screen, shell } = electronMain;

installGlobalZoomPolicy(app);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETUP_FILE = path.join(__dirname, "../renderer/setup.html");
const STARTUP_FILE = path.join(__dirname, "../renderer/startup.html");
const PRELOAD_FILE = path.join(__dirname, "preload.cjs");
const CONFIG_VERSION = 1;

let mainWindow = null;
let activePairing = null;
let customerDisplayWindow = null;
let customerDisplayWindowDisplayId = null;
let customerDisplayConfig = { ...DEFAULT_CUSTOMER_DISPLAY_CONFIG };
let displayReconcileTimer = null;
let refreshRequestSequence = 0;
let pendingRefreshRequest = null;
let startupNavigation = null;
let lastOperationalAttentionAt = 0;
const OPERATIONAL_ATTENTION_COOLDOWN_MS = 5_000;
const operationalNotifications = new Set();

function configPath() {
  return path.join(app.getPath("userData"), "pairing.json");
}

function customerDisplayConfigPath() {
  return path.join(app.getPath("userData"), "customer-display.json");
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
    return parsed?.ok ? {
      serverUrl: parsed.serverUrl,
      token: parsed.token,
      posEntryPath: cachedPosEntryPath(raw.posEntryPath),
    } : null;
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
    posEntryPath: cachedPosEntryPath(pairing.posEntryPath),
  });
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

async function removePairing() {
  activePairing = null;
  closeCustomerDisplayWindow();
  await rm(configPath(), { force: true });
}

function pairingHandoffArgument() {
  const prefix = "--pairing-handoff=";
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  return value && path.isAbsolute(value) ? value : null;
}

async function consumePairingHandoff() {
  const handoffPath = pairingHandoffArgument();
  if (!handoffPath) return null;
  try {
    const metadata = await lstat(handoffPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > 4096) {
      await rm(handoffPath, { force: true });
      return null;
    }
    if (process.platform !== "win32") {
      if ((metadata.mode & 0o077) !== 0 || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
        await rm(handoffPath, { force: true });
        return null;
      }
    }
    const handoffBytes = await readFile(handoffPath, "utf8");
    // The handoff contains a bearer credential. Consume it before any network operation so a
    // parse or verification failure cannot leave a reusable token on disk.
    await rm(handoffPath, { force: true });
    const parsed = parsePairingHandoff(JSON.parse(handoffBytes));
    if (!parsed) {
      return null;
    }
    const verified = await verifyPairing(parsed);
    if (!verified.ok) return null;
    await writePairing(parsed);
    return { serverUrl: parsed.serverUrl, token: parsed.token, posEntryPath: null };
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Unable to consume local pairing handoff");
    return null;
  }
}

async function readCustomerDisplayConfig() {
  try {
    return normalizeCustomerDisplayConfig(JSON.parse(
      await readFile(customerDisplayConfigPath(), "utf8"),
    ));
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Unable to read customer-display configuration");
    return { ...DEFAULT_CUSTOMER_DISPLAY_CONFIG };
  }
}

async function writeCustomerDisplayConfig(config) {
  const target = customerDisplayConfigPath();
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

function isSetupFrame(event) {
  try {
    return fileURLToPath(event.senderFrame.url) === SETUP_FILE;
  } catch {
    return false;
  }
}

function isStartupFrame(event) {
  try {
    return fileURLToPath(event.senderFrame.url) === STARTUP_FILE;
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

function isPairedCashierFrame(event) {
  if (!isPairedPosFrame(event)) return false;
  try {
    const pathname = new URL(event.senderFrame.url).pathname;
    return pathname !== "/pos/display" && pathname !== "/pos/manual";
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

function cashierDisplay() {
  if (!mainWindow || mainWindow.isDestroyed()) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(mainWindow.getBounds());
}

function isWaylandSession() {
  return process.platform === "linux"
    && String(process.env.XDG_SESSION_TYPE ?? "").toLowerCase() === "wayland";
}

function displaySummary(display, index, cashierDisplayId) {
  return {
    id: String(display.id),
    label: String(display.label ?? "").trim() || `จอ ${index + 1}`,
    primary: display.id === screen.getPrimaryDisplay().id,
    cashier: String(display.id) === String(cashierDisplayId),
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
  };
}

function currentCustomerDisplayState() {
  const displays = screen.getAllDisplays();
  const cashier = cashierDisplay();
  const target = selectCustomerDisplay(displays, cashier.id, customerDisplayConfig);
  return {
    mode: customerDisplayConfig.mode,
    targetDisplayId: customerDisplayConfig.targetDisplayId,
    activeDisplayId: customerDisplayWindow && !customerDisplayWindow.isDestroyed()
      ? customerDisplayWindowDisplayId
      : null,
    open: Boolean(customerDisplayWindow && !customerDisplayWindow.isDestroyed()),
    cashierDisplayId: String(cashier.id),
    displays: displays.map((display, index) => displaySummary(display, index, cashier.id)),
    targetAvailable: Boolean(target),
    positioningLimited: isWaylandSession(),
  };
}

function displayUsableBounds(display) {
  return display.workArea ?? display.bounds;
}

function broadcastCustomerDisplayState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("bms-pos:customer-display-state-changed", currentCustomerDisplayState());
}

function closeCustomerDisplayWindow() {
  const window = customerDisplayWindow;
  customerDisplayWindow = null;
  customerDisplayWindowDisplayId = null;
  if (window && !window.isDestroyed()) window.destroy();
}

function createCustomerDisplayWindow(targetDisplay) {
  if (!activePairing) return;
  const targetId = String(targetDisplay.id);
  if (
    customerDisplayWindow
    && !customerDisplayWindow.isDestroyed()
    && customerDisplayWindowDisplayId === targetId
  ) {
    try { customerDisplayWindow.setBounds(displayUsableBounds(targetDisplay)); } catch {}
    return;
  }
  closeCustomerDisplayWindow();
  const window = new BrowserWindow({
    ...displayUsableBounds(targetDisplay),
    show: false,
    // Wayland may ignore app-directed placement. Keep a native frame there so the operator can
    // still move the window with the compositor instead of trapping a borderless window.
    frame: isWaylandSession(),
    skipTaskbar: !isWaylandSession(),
    title: "BMS POS — จอลูกค้า",
    backgroundColor: "#0b0b0c",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:bms-pos",
      zoomFactor: 1,
    },
  });
  customerDisplayWindow = window;
  customerDisplayWindowDisplayId = targetId;
  setupWindowSecurity(window.webContents.session);
  window.once("ready-to-show", () => {
    if (window.isDestroyed()) return;
    try { window.setBounds(displayUsableBounds(targetDisplay)); } catch {}
    window.showInactive();
  });
  window.on("closed", () => {
    if (customerDisplayWindow === window) {
      customerDisplayWindow = null;
      customerDisplayWindowDisplayId = null;
      broadcastCustomerDisplayState();
    }
  });
  window.webContents.on("will-navigate", (event, destination) => {
    try {
      const target = new URL(destination);
      if (target.origin === activePairing?.serverUrl && target.pathname === "/pos/display") return;
    } catch {}
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadURL(new URL("/pos/display", activePairing.serverUrl).toString()).catch(() => {});
}

function reconcileCustomerDisplay() {
  if (!activePairing || customerDisplayConfig.mode === "off") {
    closeCustomerDisplayWindow();
    broadcastCustomerDisplayState();
    return;
  }
  const displays = screen.getAllDisplays();
  const target = selectCustomerDisplay(displays, cashierDisplay().id, customerDisplayConfig);
  if (target) createCustomerDisplayWindow(target);
  else closeCustomerDisplayWindow();
  broadcastCustomerDisplayState();
}

function scheduleCustomerDisplayReconcile() {
  if (displayReconcileTimer) clearTimeout(displayReconcileTimer);
  displayReconcileTimer = setTimeout(() => {
    displayReconcileTimer = null;
    reconcileCustomerDisplay();
  }, 200);
}

function identifyDisplays() {
  const cashierId = cashierDisplay().id;
  for (const [index, display] of screen.getAllDisplays().entries()) {
    const role = display.id === cashierId ? "จอแคชเชียร์" : "จอที่เลือกได้";
    const overlay = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:rgba(0,0,0,.48);font-family:system-ui,sans-serif;color:white;display:grid;place-items:center}.card{text-align:center;background:#1677ff;border:8px solid white;border-radius:44px;padding:42px 76px;box-shadow:0 20px 80px #0008}.number{font-size:140px;font-weight:800;line-height:1}.role{font-size:28px;margin-top:14px}</style><div class="card"><div class="number">${index + 1}</div><div class="role">${role}</div></div>`;
    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => overlay.showInactive());
    setTimeout(() => { if (!overlay.isDestroyed()) overlay.destroy(); }, 3000);
  }
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
      zoomFactor: 1,
      // Incoming-order realtime/poll reconciliation must continue while the register is minimized;
      // otherwise the native attention bridge cannot fire until the cashier reopens the window.
      backgroundThrottling: false,
    },
  });

  setupWindowSecurity(window.webContents.session);
  window.on("move", scheduleCustomerDisplayReconcile);
  window.on("focus", () => window.flashFrame(false));
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
      startupNavigation = null;
    }
    closeCustomerDisplayWindow();
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Desktop POS renderer exited: ${details.reason}`);
    if (!activePairing || window.isDestroyed()) return;
    void showStartup("error", "หน้าจอหยุดทำงาน กรุณาลองเปิดใหม่").catch(() => {});
  });

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
      const isPairedOrigin = activePairing && target.origin === activePairing.serverUrl;
      if (isPairedOrigin && target.pathname === "/pos/display") {
        reconcileCustomerDisplay();
        return { action: "deny" };
      }
      const isPosUtility = isPairedOrigin && target.pathname === "/pos/manual";
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
              zoomFactor: 1,
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

function reloadMainApplication() {
  if (pendingRefreshRequest) {
    clearTimeout(pendingRefreshRequest.timer);
    pendingRefreshRequest = null;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.reloadIgnoringCache();
}

function refreshMainWindowData() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  let current;
  try { current = new URL(mainWindow.webContents.getURL()); } catch { reloadMainApplication(); return; }
  // Every current cashier surface uses the same shortcut contract. Utility/customer windows are
  // deliberately excluded: they are not the primary register workspace and must not acknowledge a
  // refresh they cannot perform. Older deployments report `handled: false` and retain the full-
  // reload fallback below.
  const contentRefreshRoutes = new Set(["/pos", "/pos/app", "/pos/restaurant"]);
  if (!activePairing || current.origin !== activePairing.serverUrl || !contentRefreshRoutes.has(current.pathname)) {
    reloadMainApplication();
    return;
  }
  if (pendingRefreshRequest) return;
  const requestId = ++refreshRequestSequence;
  const timer = setTimeout(() => {
    if (pendingRefreshRequest?.requestId !== requestId) return;
    pendingRefreshRequest = null;
    // Backward compatibility: an older server does not know the new bridge event, so Command+R
    // must still reload rather than silently doing nothing.
    reloadMainApplication();
  }, 500);
  pendingRefreshRequest = { requestId, timer };
  mainWindow.webContents.send("bms-pos:refresh-data", requestId);
}

async function showSetup() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadFile(SETUP_FILE);
  mainWindow.show();
}

async function showStartup(state = "loading", message = "", targetWindow = mainWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  await targetWindow.loadFile(STARTUP_FILE, {
    query: {
      state,
      message,
    },
  });
  targetWindow.show();
}

async function loadPosUrl(url, targetWindow = mainWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (!targetWindow.isDestroyed()) targetWindow.webContents.stop();
        reject(new Error("POS navigation timed out"));
      }, POS_NAVIGATION_TIMEOUT_MS);
    });
    await Promise.race([targetWindow.loadURL(url), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function showPos(targetWindow = mainWindow) {
  if (!targetWindow || targetWindow.isDestroyed() || !activePairing) return;
  const pairing = activePairing;
  const probeEntryPath = () => resolvePosEntryPath(async (signal) => {
    const response = await net.fetch(new URL(MOBILE_POS_PATH, pairing.serverUrl), {
      // Compatibility needs one status code, not a second rendered copy of the application.
      method: "HEAD",
      cache: "no-store",
      redirect: "manual",
      signal,
      headers: {
        authorization: `Bearer ${pairing.token}`,
        "x-pos-device-token": pairing.token,
      },
    });
    return response.status;
  });
  const cachedEntryPath = cachedPosEntryPath(pairing.posEntryPath);
  const entryPath = cachedEntryPath ?? await probeEntryPath();
  await loadPosUrl(new URL(entryPath, pairing.serverUrl).toString(), targetWindow);

  if (!cachedEntryPath) {
    if (activePairing === pairing) {
      activePairing = { ...pairing, posEntryPath: entryPath };
      void writePairing(activePairing).catch(() => {
        console.error("Unable to cache desktop POS entry path");
      });
    }
    return;
  }

  // Known servers open immediately. Refresh compatibility only for the next launch so an upgrade
  // from the legacy route never tears down a cashier's active screen in the middle of a sale.
  void probeEntryPath().then(async (freshEntryPath) => {
    if (freshEntryPath === cachedEntryPath || activePairing !== pairing) return;
    const refreshedPairing = { ...pairing, posEntryPath: freshEntryPath };
    activePairing = refreshedPairing;
    await writePairing(refreshedPairing);

    // Upgrades wait until the next launch so they never replace an active legacy sale. A rollback
    // is different: an exact 404 proves the cached mobile page cannot be a working register, so
    // recover that invalid page immediately instead of making the cashier restart the app.
    if (cachedEntryPath === MOBILE_POS_PATH && freshEntryPath === "/pos"
      && !targetWindow.isDestroyed() && activePairing === refreshedPairing) {
      let current;
      try { current = new URL(targetWindow.webContents.getURL()); } catch { return; }
      if (current.origin === pairing.serverUrl && current.pathname === MOBILE_POS_PATH) {
        await loadPosUrl(new URL(freshEntryPath, pairing.serverUrl).toString(), targetWindow);
      }
    }
  }).catch(() => {
    // A transient background probe must not erase a working last-known route.
  });
}

function startPosNavigation() {
  if (!activePairing || !mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  if (startupNavigation) return startupNavigation;
  const targetWindow = mainWindow;
  const operation = (async () => {
    try {
      await showStartup("loading", "", targetWindow);
      await showPos(targetWindow);
      if (targetWindow.isDestroyed()) return;
      reconcileCustomerDisplay();
    } catch (error) {
      console.error("Unable to open desktop POS", error);
      try {
        await showStartup(
          "error",
          "เชื่อมต่อหน้าขายไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตหรือเซิร์ฟเวอร์แล้วลองใหม่",
          targetWindow,
        );
      } catch (recoveryError) {
        console.error("Unable to show desktop POS recovery", recoveryError);
      }
    }
  })();
  const wrappedOperation = operation.finally(() => {
    if (startupNavigation === wrappedOperation) startupNavigation = null;
  });
  startupNavigation = wrappedOperation;
  return wrappedOperation;
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
  ipcMain.on("bms-pos:refresh-data-result", (event, result) => {
    if (!isPairedCashierFrame(event) || !pendingRefreshRequest) return;
    if (Number(result?.requestId) !== pendingRefreshRequest.requestId) return;
    clearTimeout(pendingRefreshRequest.timer);
    pendingRefreshRequest = null;
    if (!result?.handled) reloadMainApplication();
  });
  ipcMain.handle("bms-pos:request-operational-attention", async (event) => {
    if (!isPairedCashierFrame(event) || !mainWindow || mainWindow.isDestroyed()) return { ok: false };
    // A foreground event is already visible in-page and must not consume the cooldown for a
    // different event that arrives just after the cashier minimizes the window.
    if (mainWindow.isFocused()) return { ok: true, focused: true };
    const now = Date.now();
    if (now - lastOperationalAttentionAt < OPERATIONAL_ATTENTION_COOLDOWN_MS) return { ok: true, throttled: true };
    lastOperationalAttentionAt = now;
    mainWindow.flashFrame(true);
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: "BMS POS",
        // This may be a new acceptance, hand-off, deadline or recovery task. Keep the
        // lock-screen copy generic but accurate for every transition.
        body: "มีงานออร์เดอร์รอดำเนินการ",
        silent: true,
      });
      // Keep the object alive until the OS closes it; otherwise some Linux notification
      // implementations can collect a locally scoped Notification before its click handler runs.
      operationalNotifications.add(notification);
      notification.once("close", () => operationalNotifications.delete(notification));
      notification.on("click", () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        notification.close();
      });
      notification.show();
    }
    return { ok: true };
  });
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
      activePairing = { serverUrl: parsed.serverUrl, token: parsed.token, posEntryPath: null };
      void startPosNavigation();
      return { ok: true };
    } catch {
      return { ok: false, error: "บันทึกการจับคู่แบบเข้ารหัสไม่สำเร็จ" };
    }
  });

  ipcMain.handle("bms-pos:get-device-token", async (event) => {
    if (!isPairedPosFrame(event)) return null;
    return activePairing?.token ?? null;
  });

  ipcMain.handle("bms-pos:retry-startup", async (event) => {
    if (!isStartupFrame(event) || !activePairing) return { ok: false };
    void startPosNavigation();
    return { ok: true };
  });

  ipcMain.handle("bms-pos:change-server", async (event) => {
    if (!isStartupFrame(event)) return { ok: false };
    await removePairing();
    await showSetup();
    return { ok: true };
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
    // Read-only build/runtime metadata is useful both before pairing and from the in-app About
    // dialog. Keep the same strict frame allow-list as every credential-adjacent bridge method.
    if (!isSetupFrame(event) && !isPairedPosFrame(event)) return null;
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

  ipcMain.handle("bms-pos:get-customer-display-state", async (event) => {
    if (!isPairedCashierFrame(event)) return null;
    return currentCustomerDisplayState();
  });

  ipcMain.handle("bms-pos:set-customer-display-config", async (event, input) => {
    if (!isPairedCashierFrame(event)) return { ok: false, error: "หน้าต่างนี้ไม่มีสิทธิ์ตั้งค่าจอลูกค้า" };
    const next = normalizeCustomerDisplayConfig(input);
    if (input?.mode !== next.mode) return { ok: false, error: "รูปแบบการตั้งค่าจอลูกค้าไม่ถูกต้อง" };
    if (next.mode === "selected") {
      const cashierId = String(cashierDisplay().id);
      const selected = screen.getAllDisplays().find((display) => String(display.id) === next.targetDisplayId);
      if (!selected) return { ok: false, error: "ไม่พบจอที่เลือก กรุณาตรวจสายจอแล้วลองใหม่" };
      if (String(selected.id) === cashierId) return { ok: false, error: "จอหลักกำลังใช้เป็นจอแคชเชียร์ กรุณาเลือกจออื่น" };
    }
    try {
      await writeCustomerDisplayConfig(next);
      customerDisplayConfig = next;
      reconcileCustomerDisplay();
      return { ok: true, state: currentCustomerDisplayState() };
    } catch {
      return { ok: false, error: "บันทึกการตั้งค่าจอลูกค้าไม่สำเร็จ" };
    }
  });

  ipcMain.handle("bms-pos:identify-displays", async (event) => {
    if (!isPairedCashierFrame(event)) return { ok: false };
    identifyDisplays();
    return { ok: true };
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
      {
        refreshData: refreshMainWindowData,
        reloadApplication: reloadMainApplication,
      },
    )));
    registerIpc();
    mainWindow = createMainWindow();
    customerDisplayConfig = await readCustomerDisplayConfig();
    activePairing = await readPairing();
    if (!activePairing) activePairing = await consumePairingHandoff();
    if (activePairing) {
      void startPosNavigation();
    }
    else await showSetup();
    screen.on("display-added", scheduleCustomerDisplayReconcile);
    screen.on("display-removed", scheduleCustomerDisplayReconcile);
    screen.on("display-metrics-changed", scheduleCustomerDisplayReconcile);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      void (activePairing ? startPosNavigation() : showSetup());
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
