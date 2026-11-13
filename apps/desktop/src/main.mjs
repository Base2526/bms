import desktopLocale from '../renderer/locale.cjs';
const { getAppLanguage, applyAppLanguage, posText } = desktopLocale;
import { createLanguageStore } from './language-store.mjs';
import electronMain from "electron/main";
import { createReceiptPrinter, DEFAULT_PRINTER_CONFIG, isReceiptPrinterCaller, normalizePrinterConfig } from "./receipt-printer.mjs";
import { printerReadiness } from "./printer-health.mjs";
import { createKitchenPrinter, DEFAULT_KITCHEN_PRINTER_CONFIG, normalizeKitchenPrinterConfig } from "./kitchen-printer.mjs";
import { createHash } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  customerDisplayPreviewBounds,
  queueDisplayPreviewBounds,
  DEFAULT_CUSTOMER_DISPLAY_CONFIG,
  DEFAULT_QUEUE_DISPLAY_CONFIG,
  normalizeCustomerDisplayConfig,
  normalizeQueueDisplayConfig,
  selectCustomerDisplay,
  selectQueueDisplay,
} from "./display-policy.mjs";
import { parsePairingHandoff, parsePairingInput } from "./pairing.mjs";
import { createPairingWriter } from "./pairing-store.mjs";
import {
  adminUrlForServer,
  cloudAdminUrl,
  fetchPairingSession,
  canRecoverByStartingManagedLocalRuntime,
} from "./pairing-server.mjs";
import {
  ensureManagedLocalRuntime,
  checkManagedLocalAdminReady,
  detectManagedLocalInstallation,
  isManagedLocalServerUrl,
  managedLocalPosDevicesUrl,
  MANAGED_LOCAL_SERVER_URL,
} from "./local-runtime.mjs";
import {
  cachedPosEntryPath,
  MOBILE_POS_PATH,
  POS_NAVIGATION_TIMEOUT_MS,
  resolvePosEntryPath,
} from "./renderer-route.mjs";
import { createLaunchAtLogin } from "./launch-at-login.mjs";
import { platformClientLabel, platformSecurityNote, secureStorageStatus } from "./secure-storage.mjs";
import {
  desktopMenuTemplate,
  localizeNativeMenu,
  installFixedZoomPolicy,
  installGlobalZoomPolicy,
} from "./zoom-policy.mjs";

const { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, safeStorage, screen, shell } = electronMain;

installGlobalZoomPolicy(app);
// Queue-board audio is an operator-controlled POS function. The web preference remains the mute
// authority; this only lets an enabled managed display arm Web Audio without an extra customer tap.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const launchAtLogin = createLaunchAtLogin({
  app,
  preferencePath: () => path.join(app.getPath("userData"), "launch-at-login.json"),
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETUP_FILE = path.join(__dirname, "../renderer/setup.html");
const STARTUP_FILE = path.join(__dirname, "../renderer/startup.html");
const PRELOAD_FILE = path.join(__dirname, "preload.cjs");

let mainWindow = null;
let activePairing = null;
let pairingRestoreError = null;
let pairingWriter = null;
let pairingInProgress = false;
let pairingRevision = 0;
let pairingRestoreRequest = 0;
let pairingRestoreTask = null;
let pendingUnpair = null;
let customerDisplayWindow = null;
let customerDisplayWindowDisplayId = null;
let customerDisplayWindowKind = null;
let customerDisplayConfig = { ...DEFAULT_CUSTOMER_DISPLAY_CONFIG };
let queueDisplayWindow = null;
let queueDisplayWindowDisplayId = null;
let queueDisplayWindowKind = null;
let queueDisplayConfig = { ...DEFAULT_QUEUE_DISPLAY_CONFIG };
let printerConfig = { ...DEFAULT_PRINTER_CONFIG };
let printerProblem = "";
let pendingPrinterTest = null;
let printerOperationBusy = false;
let kitchenPrinterConfig = { ...DEFAULT_KITCHEN_PRINTER_CONFIG };
let kitchenPrintJournal = {};
let kitchenJournalWrite = Promise.resolve();
let displaySetupPromptOpen = false;
let managedDisplayOperationBusy = false;
let kitchenConfigBusy = false;
let displayReconcileTimer = null;
let refreshRequestSequence = 0;
let pendingRefreshRequest = null;
let startupNavigation = null;
let localRuntimeStartup = null;
let lastOperationalAttentionAt = 0;
const OPERATIONAL_ATTENTION_COOLDOWN_MS = 5_000;
const operationalNotifications = new Set();

function configPath() {
  return path.join(app.getPath("userData"), "pairing.json");
}

function customerDisplayConfigPath() {
  return path.join(app.getPath("userData"), "customer-display.json");
}

function queueDisplayConfigPath() {
  return path.join(app.getPath("userData"), "pickup-queue-display.json");
}

function printerConfigPath() {
  return path.join(app.getPath("userData"), "receipt-printer.json");
}

function kitchenPrinterConfigPath() {
  return path.join(app.getPath("userData"), "kitchen-printers.json");
}

function kitchenPrintJournalPath() {
  return path.join(app.getPath("userData"), "kitchen-print-journal.json");
}

async function installedPrinters() {
  let timer;
  try {
    return await Promise.race([
      mainWindow.webContents.getPrintersAsync(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(posText("ตรวจสอบเครื่องพิมพ์ไม่สำเร็จ กรุณาตรวจระบบพิมพ์แล้วลองใหม่"))), 8000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function printerState() {
  const printers = await installedPrinters();
  return {
    ...printerConfig,
    ...printerReadiness(printerConfig, printers, printerProblem, pendingPrinterTest === printerConfig),
    busy: printerOperationBusy,
    printers: printers.map(({ name, displayName, isDefault }) => ({ name, displayName, isDefault })),
  };
}

async function savePrinterConfig(next) {
  const target = printerConfigPath();
  await writeFile(`${target}.tmp`, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
  await rename(`${target}.tmp`, target);
  printerConfig = next;
}

async function saveKitchenPrinterConfig(next) {
  const target = kitchenPrinterConfigPath();
  await writeFile(`${target}.tmp`, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
  await rename(`${target}.tmp`, target);
  kitchenPrinterConfig = next;
}

function saveKitchenJournalEntry(key, value) {
  // A timed-out job can still have a pending disk write. Later jobs must not race its temp file.
  const operation = kitchenJournalWrite.then(async () => {
    kitchenPrintJournal[key] = value;
    const entries = Object.entries(kitchenPrintJournal)
      .sort((left, right) => String(right[1]?.at ?? "").localeCompare(String(left[1]?.at ?? "")))
      .slice(0, 1_000);
    kitchenPrintJournal = Object.fromEntries(entries);
    const target = kitchenPrintJournalPath();
    await writeFile(`${target}.tmp`, JSON.stringify(kitchenPrintJournal), { encoding: "utf8", mode: 0o600 });
    await rename(`${target}.tmp`, target);
  });
  kitchenJournalWrite = operation.catch(() => {});
  return operation;
}

const printDesktopReceipt = createReceiptPrinter({
  getConfig: () => ({ ...printerConfig }),
  getPrinters: installedPrinters,
  createWindow: () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    return window;
  },
});

const printDesktopKitchenTicket = createKitchenPrinter({
  getConfig: () => normalizeKitchenPrinterConfig(kitchenPrinterConfig),
  getJournal: () => kitchenPrintJournal,
  setJournal: saveKitchenJournalEntry,
  getPrinters: installedPrinters,
  createWindow: () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    return window;
  },
});

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
    return { pairing: await pairingPersistence().read(decryptedToken), error: null };
  } catch (error) {
    console.error("Unable to read desktop pairing configuration");
    return { pairing: null, error };
  }
}

function pairingPersistence() {
  pairingWriter ??= createPairingWriter(configPath(), encryptedToken);
  return pairingWriter;
}

function writePairing(pairing, isCurrent) {
  return pairingPersistence().write(pairing, isCurrent);
}

async function removePairing() {
  if (pairingInProgress) return { ok: false, error: posText("กำลังเปลี่ยนข้อมูลจับคู่ กรุณารอสักครู่แล้วลองใหม่") };
  pairingInProgress = true;
  pairingRevision++;
  pairingRestoreRequest++;
  const previous = activePairing;
  const previousError = pairingRestoreError;
  activePairing = null;
  startupNavigation = null;
  if (pendingRefreshRequest) clearTimeout(pendingRefreshRequest.timer);
  pendingRefreshRequest = null;
  pairingRestoreError = null;
  installApplicationMenu();
  closeCustomerDisplayWindow();
  if (typeof closeQueueDisplayWindow === "function") closeQueueDisplayWindow();
  try {
    await pairingPersistence().remove();
    return { ok: true };
  } catch {
    activePairing = previous;
    pairingRestoreError = previousError;
    installApplicationMenu();
    scheduleCustomerDisplayReconcile();
    return { ok: false, error: posText("ลบข้อมูลจับคู่ไม่สำเร็จ ข้อมูลเดิมยังอยู่ กรุณาตรวจสิทธิ์เข้าถึงไฟล์ของบัญชีระบบปฏิบัติการแล้วลองใหม่") };
  } finally { pairingInProgress = false; }
}

function pairingHandoffArgument() {
  const prefix = "--pairing-handoff=";
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  return value && path.isAbsolute(value) ? value : null;
}

async function consumePairingHandoff(isCurrent = () => true) {
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
    if (!isCurrent()) return null;
    // The handoff contains a bearer credential. Consume it before any network operation so a
    // parse or verification failure cannot leave a reusable token on disk.
    await rm(handoffPath, { force: true });
    const parsed = parsePairingHandoff(JSON.parse(handoffBytes));
    if (!parsed) {
      return null;
    }
    const verified = await verifyPairing(parsed);
    if (!verified.ok || !isCurrent()) return null;
    await writePairing(parsed, isCurrent);
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

async function readQueueDisplayConfig() {
  try {
    return normalizeQueueDisplayConfig(JSON.parse(
      await readFile(queueDisplayConfigPath(), "utf8"),
    ));
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Unable to read pickup queue display configuration");
    return { ...DEFAULT_QUEUE_DISPLAY_CONFIG };
  }
}

async function writeQueueDisplayConfig(config) {
  const target = queueDisplayConfigPath();
  await writeFile(`${target}.tmp`, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });
  await rename(`${target}.tmp`, target);
}

async function writeManagedDisplayConfigs(nextCustomer, nextQueue, previousCustomer, previousQueue) {
  try {
    await writeCustomerDisplayConfig(nextCustomer);
    await writeQueueDisplayConfig(nextQueue);
  } catch (error) {
    // The two files are kept for backward compatibility with older Desktop builds. Restore both
    // snapshots if either atomic rename fails so one click cannot leave two roles claiming a screen.
    await Promise.allSettled([
      writeCustomerDisplayConfig(previousCustomer),
      writeQueueDisplayConfig(previousQueue),
    ]);
    throw error;
  }
}

function isSetupFrame(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
    || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    return fileURLToPath(event.senderFrame.url) === SETUP_FILE;
  } catch {
    return false;
  }
}

function isStartupFrame(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
    || event.senderFrame !== event.sender.mainFrame) return false;
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
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
    || event.senderFrame !== event.sender.mainFrame) return false;
  if (!isPairedPosFrame(event)) return false;
  try {
    const pathname = new URL(event.senderFrame.url).pathname;
    // Utility windows (customer display, cashier manual, pickup call screen) may read the paired
    // device token but must never drive cashier-only bridges such as printing or display setup.
    return pathname !== "/pos/display" && pathname !== "/pos/manual" && pathname !== "/pos/queue-board";
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

function secureUtilityWindow(window, url) {
  const allowed = new URL(url);
  const guard = (event, destination) => {
    try {
      const target = new URL(destination);
      if (target.origin === activePairing?.serverUrl && target.origin === allowed.origin
        && target.pathname === allowed.pathname) return;
    } catch {}
    event.preventDefault();
  };
  window.webContents.on("will-navigate", guard);
  window.webContents.on("will-redirect", guard);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function loadUtilityWithRetry(window, url, isCurrent) {
  let retryTimer = null;
  const retry = () => {
    if (retryTimer || window.isDestroyed() || !isCurrent()) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      load();
    }, 5_000);
  };
  const load = () => {
    if (window.isDestroyed() || !isCurrent()) return;
    void window.loadURL(url).catch(retry);
  };
  window.on("closed", () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  });
  load();
}

function openAdminBackoffice() {
  if (!activePairing) return false;
  openExternalHttp(adminUrlForServer(activePairing.serverUrl));
  return true;
}

function startManagedLocalRuntime() {
  if (!localRuntimeStartup) {
    const operation = ensureManagedLocalRuntime(MANAGED_LOCAL_SERVER_URL);
    const wrappedOperation = operation.finally(() => {
      if (localRuntimeStartup === wrappedOperation) localRuntimeStartup = null;
    });
    localRuntimeStartup = wrappedOperation;
  }
  return localRuntimeStartup;
}

async function openInstalledLocalAdmin() {
  await startManagedLocalRuntime();
  await checkManagedLocalAdminReady({ fetch: (url, options) => net.fetch(url, options) });
  await shell.openExternal(managedLocalPosDevicesUrl());
  return true;
}

async function setupAdminTarget() {
  const local = await detectManagedLocalInstallation({ fetch: (url, options) => net.fetch(url, options) });
  return local ? "local" : "cloud";
}

let launchAtLoginEnabled = false;
let launchAtLoginBusy = false;

async function toggleLaunchAtLogin(menuItem) {
  const wanted = menuItem?.checked === true;
  if (launchAtLoginBusy) {
    // A second click while the OS is still answering: redraw the real state, change nothing.
    installApplicationMenu();
    return;
  }
  if (wanted && launchAtLogin.blockedReason() === "not-in-applications") {
    installApplicationMenu();
    void dialog.showMessageBox(mainWindow ?? undefined, {
      type: "info",
      message: posText("ย้ายแอปไปไว้ในโฟลเดอร์ Applications ก่อน"),
      detail: posText("แอปกำลังเปิดจากไฟล์ติดตั้ง (DMG) ซึ่งจะหายไปหลังรีสตาร์ท ลาก BMS POS ไปไว้ใน Applications แล้วเปิดจากที่นั่น จากนั้นค่อยติ๊กตัวเลือกนี้"),
    });
    return;
  }
  launchAtLoginBusy = true;
  try {
    launchAtLoginEnabled = await launchAtLogin.setEnabled(wanted);
  } catch (error) {
    console.error("Unable to change launch-at-login setting", error?.message ?? error);
    launchAtLoginEnabled = await launchAtLogin.isEnabled().catch(() => false);
  } finally {
    launchAtLoginBusy = false;
  }
  installApplicationMenu();
  if (launchAtLoginEnabled !== wanted) {
    void dialog.showMessageBox(mainWindow ?? undefined, {
      type: "warning",
      message: wanted ? posText("ตั้งให้เปิดอัตโนมัติไม่สำเร็จ") : posText("ยกเลิกการเปิดอัตโนมัติไม่สำเร็จ"),
      detail: process.platform === "darwin"
        ? posText("macOS อาจต้องให้อนุญาตเองที่ System Settings > General > Login Items")
        : posText("ระบบปฏิบัติการไม่ยอมบันทึกการตั้งค่านี้ กรุณาลองใหม่หรือตั้งค่าจากระบบปฏิบัติการโดยตรง"),
    });
  }
}

function installApplicationMenu() {
  Menu.setApplicationMenu(localizeNativeMenu(Menu.buildFromTemplate(desktopMenuTemplate(
    process.platform,
    process.env.BMS_POS_DESKTOP_DEVTOOLS === "1",
    {
      language: getAppLanguage(),
      setLanguage: (value) => { void changeAppLanguage(value); },
      adminAvailable: Boolean(activePairing),
      openAdmin: openAdminBackoffice,
      refreshData: refreshMainWindowData,
      reloadApplication: reloadMainApplication,
      launchAtLogin: launchAtLoginEnabled,
      launchAtLoginSupported: launchAtLogin.supported(),
      toggleLaunchAtLogin: (menuItem) => { void toggleLaunchAtLogin(menuItem); },
    },
  ))));
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
    label: String(display.label ?? "").trim() || posText("จอ {v0}", { v0: index + 1 }),
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
    preview: customerDisplayWindowKind === "preview",
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
  customerDisplayWindowKind = null;
  if (window && !window.isDestroyed()) window.destroy();
}

function createCustomerDisplayWindow(targetDisplay, kind = "managed") {
  if (!activePairing) return;
  const targetId = String(targetDisplay.id);
  if (
    customerDisplayWindow
    && !customerDisplayWindow.isDestroyed()
    && customerDisplayWindowDisplayId === targetId
    && customerDisplayWindowKind === kind
  ) {
    if (kind === "managed") {
      try { customerDisplayWindow.setBounds(displayUsableBounds(targetDisplay)); } catch {}
    }
    customerDisplayWindow.showInactive();
    return;
  }
  closeCustomerDisplayWindow();
  const preview = kind === "preview";
  const window = new BrowserWindow({
    ...(preview ? customerDisplayPreviewBounds(targetDisplay) : displayUsableBounds(targetDisplay)),
    show: false,
    // Wayland may ignore app-directed placement. Keep a native frame there so the operator can
    // still move the window with the compositor instead of trapping a borderless window.
    frame: preview || isWaylandSession(),
    skipTaskbar: preview ? false : !isWaylandSession(),
    resizable: preview,
    maximizable: preview,
    title: preview ? posText("BMS POS — ทดสอบจอลูกค้า") : posText("BMS POS — จอลูกค้า"),
    backgroundColor: "#0b0b0c",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:bms-pos",
      zoomFactor: 1,
      // Customer totals and idle promotions continue while the cashier window has focus.
      backgroundThrottling: false,
    },
  });
  customerDisplayWindow = window;
  customerDisplayWindowDisplayId = targetId;
  customerDisplayWindowKind = kind;
  setupWindowSecurity(window.webContents.session);
  window.once("ready-to-show", () => {
    if (window.isDestroyed()) return;
    try {
      window.setBounds(preview
        ? customerDisplayPreviewBounds(targetDisplay)
        : displayUsableBounds(targetDisplay));
    } catch {}
    window.showInactive();
  });
  window.on("closed", () => {
    if (customerDisplayWindow === window) {
      customerDisplayWindow = null;
      customerDisplayWindowDisplayId = null;
      customerDisplayWindowKind = null;
      broadcastCustomerDisplayState();
    }
  });
  secureUtilityWindow(window, new URL("/pos/display", activePairing.serverUrl).toString());
  const url = new URL("/pos/display", activePairing.serverUrl).toString();
  loadUtilityWithRetry(window, url, () => customerDisplayWindow === window
    && activePairing?.serverUrl === new URL(url).origin);
}

function reconcileCustomerDisplay() {
  void offerCustomerDisplaySetup();
  if (!activePairing || !mainWindow || mainWindow.isDestroyed()) {
    closeCustomerDisplayWindow();
    broadcastCustomerDisplayState();
    return;
  }
  if (customerDisplayConfig.mode === "off") {
    if (customerDisplayWindowKind !== "preview") closeCustomerDisplayWindow();
    broadcastCustomerDisplayState();
    return;
  }
  const displays = screen.getAllDisplays();
  const target = selectCustomerDisplay(displays, cashierDisplay().id, customerDisplayConfig);
  if (target) createCustomerDisplayWindow(target);
  else if (customerDisplayWindowKind !== "preview") closeCustomerDisplayWindow();
  broadcastCustomerDisplayState();
}

function customerDisplayTargetId(displays = screen.getAllDisplays(), cashier = cashierDisplay()) {
  const target = selectCustomerDisplay(displays, cashier.id, customerDisplayConfig);
  return target ? String(target.id) : null;
}

function currentQueueDisplayState() {
  const displays = screen.getAllDisplays();
  const cashier = cashierDisplay();
  const customerTargetId = customerDisplayTargetId(displays, cashier);
  const target = selectQueueDisplay(displays, cashier.id, customerTargetId, queueDisplayConfig);
  const selectedConflict = queueDisplayConfig.mode === "selected"
    && queueDisplayConfig.targetDisplayId != null
    && queueDisplayConfig.targetDisplayId === customerTargetId;
  return {
    mode: queueDisplayConfig.mode,
    targetDisplayId: queueDisplayConfig.targetDisplayId,
    activeDisplayId: queueDisplayWindow && !queueDisplayWindow.isDestroyed()
      ? queueDisplayWindowDisplayId
      : null,
    open: Boolean(queueDisplayWindow && !queueDisplayWindow.isDestroyed()),
    preview: queueDisplayWindowKind === "preview",
    cashierDisplayId: String(cashier.id),
    displays: displays.map((display, index) => displaySummary(display, index, cashier.id)),
    targetAvailable: Boolean(target),
    conflict: selectedConflict,
    positioningLimited: isWaylandSession(),
  };
}

function currentManagedDisplayState() {
  return {
    customer: currentCustomerDisplayState(),
    queue: currentQueueDisplayState(),
  };
}

function broadcastQueueDisplayState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("bms-pos:queue-display-state-changed", currentQueueDisplayState());
}

function closeQueueDisplayWindow() {
  const window = queueDisplayWindow;
  queueDisplayWindow = null;
  queueDisplayWindowDisplayId = null;
  queueDisplayWindowKind = null;
  if (window && !window.isDestroyed()) window.destroy();
}

function createQueueDisplayWindow(targetDisplay, kind = "managed") {
  if (!activePairing) return;
  const targetId = String(targetDisplay.id);
  if (
    queueDisplayWindow
    && !queueDisplayWindow.isDestroyed()
    && queueDisplayWindowDisplayId === targetId
    && queueDisplayWindowKind === kind
  ) {
    if (kind === "managed") {
      try { queueDisplayWindow.setBounds(displayUsableBounds(targetDisplay)); } catch {}
    }
    queueDisplayWindow.showInactive();
    return;
  }
  closeQueueDisplayWindow();
  const preview = kind === "preview";
  const window = new BrowserWindow({
    ...(preview ? queueDisplayPreviewBounds(targetDisplay) : displayUsableBounds(targetDisplay)),
    show: false,
    frame: preview || isWaylandSession(),
    skipTaskbar: preview ? false : !isWaylandSession(),
    resizable: preview,
    maximizable: preview,
    title: preview ? posText("BMS POS — ทดสอบจอเรียกคิว") : posText("BMS POS — จอเรียกคิว"),
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:bms-pos",
      zoomFactor: 1,
      backgroundThrottling: false,
    },
  });
  queueDisplayWindow = window;
  queueDisplayWindowDisplayId = targetId;
  queueDisplayWindowKind = kind;
  setupWindowSecurity(window.webContents.session);
  window.once("ready-to-show", () => {
    if (window.isDestroyed()) return;
    try {
      window.setBounds(preview
        ? queueDisplayPreviewBounds(targetDisplay)
        : displayUsableBounds(targetDisplay));
    } catch {}
    window.showInactive();
  });
  window.on("closed", () => {
    if (queueDisplayWindow === window) {
      queueDisplayWindow = null;
      queueDisplayWindowDisplayId = null;
      queueDisplayWindowKind = null;
      broadcastQueueDisplayState();
    }
  });
  secureUtilityWindow(window, new URL("/pos/queue-board", activePairing.serverUrl).toString());
  const url = new URL("/pos/queue-board?desktop=1", activePairing.serverUrl).toString();
  loadUtilityWithRetry(window, url, () => queueDisplayWindow === window
    && activePairing?.serverUrl === new URL(url).origin);
}

function reconcileQueueDisplay() {
  if (!activePairing || !mainWindow || mainWindow.isDestroyed()) {
    closeQueueDisplayWindow();
    broadcastQueueDisplayState();
    return;
  }
  if (queueDisplayConfig.mode === "off") {
    if (queueDisplayWindowKind !== "preview") closeQueueDisplayWindow();
    broadcastQueueDisplayState();
    return;
  }
  const displays = screen.getAllDisplays();
  const cashier = cashierDisplay();
  const target = selectQueueDisplay(
    displays,
    cashier.id,
    customerDisplayTargetId(displays, cashier),
    queueDisplayConfig,
  );
  if (target) createQueueDisplayWindow(target);
  else if (queueDisplayWindowKind !== "preview") closeQueueDisplayWindow();
  broadcastQueueDisplayState();
}

async function offerCustomerDisplaySetup() {
  if (!activePairing || customerDisplayConfig.configured || displaySetupPromptOpen
    || !mainWindow || mainWindow.isDestroyed() || screen.getAllDisplays().length < 2) return;
  // Wait until the cashier page is loaded; never interrupt pairing or connection recovery.
  try {
    if (new URL(mainWindow.webContents.getURL()).origin !== activePairing.serverUrl) return;
  } catch { return; }
  displaySetupPromptOpen = true;
  const pairing = activePairing;
  const previousConfig = customerDisplayConfig;
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "question", title: posText("จอลูกค้า"), message: posText("พบจอเพิ่มเติม ใช้เป็นจอลูกค้าหรือไม่?"),
      detail: posText("เมื่อเปิดใช้งาน ระบบจะเปิดจอลูกค้าให้อัตโนมัติทุกครั้งที่เปิด POS เปลี่ยนจอได้ในตั้งค่า"),
      buttons: [posText("เปิดจอลูกค้า"), posText("ยังไม่ใช้")], defaultId: 0, cancelId: 1,
    });
    if (managedDisplayOperationBusy || activePairing !== pairing || customerDisplayConfig !== previousConfig
      || !mainWindow || mainWindow.isDestroyed()) return;
    const next = normalizeCustomerDisplayConfig({ mode: result.response === 0 ? "auto" : "off", configured: true });
    managedDisplayOperationBusy = true;
    try {
      await writeCustomerDisplayConfig(next);
      customerDisplayConfig = next;
      reconcileCustomerDisplay();
      reconcileQueueDisplay();
    } finally { managedDisplayOperationBusy = false; }
  } catch {
    console.error("Unable to save customer-display setup");
  } finally {
    displaySetupPromptOpen = false;
  }
}

function scheduleCustomerDisplayReconcile() {
  if (displayReconcileTimer) clearTimeout(displayReconcileTimer);
  displayReconcileTimer = setTimeout(() => {
    displayReconcileTimer = null;
    reconcileCustomerDisplay();
    reconcileQueueDisplay();
  }, 200);
}

function identifyDisplays() {
  const cashierId = cashierDisplay().id;
  for (const [index, display] of screen.getAllDisplays().entries()) {
    const role = display.id === cashierId ? posText("จอแคชเชียร์") : posText("จอที่เลือกได้");
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
      if (pendingRefreshRequest) clearTimeout(pendingRefreshRequest.timer);
      pendingRefreshRequest = null;
      if (pendingUnpair?.window === window) {
        clearTimeout(pendingUnpair.timer);
        pendingUnpair = null;
      }
      mainWindow = null;
      startupNavigation = null;
    }
    closeCustomerDisplayWindow();
    closeQueueDisplayWindow();
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Desktop POS renderer exited: ${details.reason}`);
    if (!activePairing || window.isDestroyed()) return;
    void showStartup("error", posText("หน้าจอหยุดทำงาน กรุณาลองเปิดใหม่")).catch(() => {});
  });

  const guardNavigation = (event, destination) => {
    try {
      const target = new URL(destination);
      if (activePairing && target.origin === activePairing.serverUrl && isPosPath(target.pathname)) return;
    } catch {}
    event.preventDefault();
    openExternalHttp(destination);
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);
  window.webContents.on("did-create-window", (child, details) => secureUtilityWindow(child, details.url));

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const isPairedOrigin = activePairing && target.origin === activePairing.serverUrl;
      if (isPairedOrigin && target.pathname === "/pos/display") {
        reconcileCustomerDisplay();
        return { action: "deny" };
      }
      if (isPairedOrigin && target.pathname === "/pos/queue-board" && queueDisplayConfig.mode !== "off") {
        reconcileQueueDisplay();
        return { action: "deny" };
      }
      // The pickup call screen (`10.111`) needs the paired token, so it must open inside the
      // app's POS partition; the system browser would show a "not paired" screen instead.
      const isPosUtility = isPairedOrigin
        && (target.pathname === "/pos/manual" || target.pathname === "/pos/queue-board");
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
              // A legacy popup still serves as a live call screen while the till has focus.
              backgroundThrottling: target.pathname !== "/pos/queue-board",
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

async function showSetup(targetWindow = mainWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  await targetWindow.loadFile(SETUP_FILE, { query: { language: getAppLanguage() } });
  if (!targetWindow.isDestroyed()) targetWindow.show();
}

async function showStartup(state = "loading", message = "", targetWindow = mainWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  await targetWindow.loadFile(STARTUP_FILE, {
    query: {
      state,
      message,
      language: getAppLanguage(),
    },
  });
  if (!targetWindow.isDestroyed()) targetWindow.show();
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

async function probePairingServer(pairing, timeoutMs = 5_000) {
  return fetchPairingSession(pairing, (...args) => net.fetch(...args), timeoutMs);
}

async function ensurePairingServerAvailable(pairing, targetWindow = mainWindow) {
  const revision = pairingRevision;
  const current = () => pairingRevision === revision && activePairing === pairing
    && targetWindow && mainWindow === targetWindow && !targetWindow.isDestroyed();
  if (!current()) return;
  try {
    await probePairingServer(pairing);
    return;
  } catch (networkError) {
    if (!current()) return;
    if (!isManagedLocalServerUrl(pairing.serverUrl) || process.platform !== "darwin") {
      throw networkError;
    }
    if (!canRecoverByStartingManagedLocalRuntime(networkError)) throw networkError;
  }

  await showStartup(
    "starting",
    posText("พบ Retail Local Server ในเครื่องนี้ กำลังเริ่มบริการและตรวจสอบฐานข้อมูล กรุณารอสักครู่"),
    targetWindow,
  );
  if (!current()) return;
  await startManagedLocalRuntime();
  if (!current()) return;
  await probePairingServer(pairing);
}

async function showPos(targetWindow = mainWindow) {
  if (!targetWindow || targetWindow.isDestroyed() || !activePairing) return;
  const pairing = activePairing;
  const revision = pairingRevision;
  const current = () => pairingRevision === revision && activePairing === pairing
    && mainWindow === targetWindow && !targetWindow.isDestroyed();
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
  if (!current()) return;
  await loadPosUrl(new URL(entryPath, pairing.serverUrl).toString(), targetWindow);

  if (!cachedEntryPath) {
    if (current()) {
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
    if (freshEntryPath === cachedEntryPath || !current()) return;
    const refreshedPairing = { ...pairing, posEntryPath: freshEntryPath };
    activePairing = refreshedPairing;
    await writePairing(refreshedPairing);

    // Upgrades wait until the next launch so they never replace an active legacy sale. A rollback
    // is different: an exact 404 proves the cached mobile page cannot be a working register, so
    // recover that invalid page immediately instead of making the cashier restart the app.
    if (cachedEntryPath === MOBILE_POS_PATH && freshEntryPath === "/pos"
      && !targetWindow.isDestroyed() && mainWindow === targetWindow
      && pairingRevision === revision && activePairing === refreshedPairing) {
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
  const pairing = activePairing;
  const revision = pairingRevision;
  const current = () => pairingRevision === revision && activePairing === pairing
    && mainWindow === targetWindow && !targetWindow.isDestroyed();
  const operation = (async () => {
    try {
      await showStartup("loading", "", targetWindow);
      if (!current()) return;
      await ensurePairingServerAvailable(pairing, targetWindow);
      if (!current()) return;
      await showPos(targetWindow);
      if (targetWindow.isDestroyed()) return;
      reconcileCustomerDisplay();
      reconcileQueueDisplay();
    } catch (error) {
      if (!current()) return;
      console.error("Unable to open desktop POS", error);
      try {
        await showStartup(
          "error",
          error?.userMessage
            ?? posText("เชื่อมต่อหน้าขายไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตหรือเซิร์ฟเวอร์แล้วลองใหม่"),
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

async function restoreSavedPairing() {
  const targetWindow = mainWindow;
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const revision = pairingRevision;
  const request = ++pairingRestoreRequest;
  if (!pairingRestoreTask || pairingRestoreTask.revision !== revision) {
    const task = { revision, promise: null };
    task.promise = (async () => {
      const result = await readPairing();
      if (pairingRevision !== revision || result.error || result.pairing) return result;
      // Share the one-use installer handoff across windows reopened during verification.
      return { pairing: await consumePairingHandoff(() => pairingRevision === revision), error: null };
    })().finally(() => {
      if (pairingRestoreTask === task) pairingRestoreTask = null;
    });
    pairingRestoreTask = task;
  }
  const result = await pairingRestoreTask.promise;
  if (pairingRevision !== revision || request !== pairingRestoreRequest
    || targetWindow !== mainWindow || targetWindow.isDestroyed()) return;
  activePairing = result.pairing;
  pairingRestoreError = result.error;
  if (pairingRestoreError) {
    await showStartup("storage-error", pairingRestoreError.userMessage, targetWindow);
    return;
  }
  installApplicationMenu();
  if (activePairing) void startPosNavigation();
  else await showSetup(targetWindow);
}

async function verifyPairing(pairing) {
  try {
    await probePairingServer(pairing);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.userMessage ?? posText("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจ URL อินเทอร์เน็ต และใบรับรอง HTTPS") };
  }
}

function finishUnpairNavigation(request = pendingUnpair) {
  if (!request || pendingUnpair !== request) return;
  clearTimeout(request.timer);
  pendingUnpair = null;
  if (request.window !== mainWindow || request.window.isDestroyed() || activePairing) return;
  void showSetup(request.window).catch(() => console.error("Unable to open setup after unpairing"));
}

let languageStore;
async function changeAppLanguage(value) {
  if ((value !== 'th' && value !== 'en') || !languageStore) return { ok: false };
  try {
    await languageStore.write(value);
    applyAppLanguage(value);
    installApplicationMenu();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bms-pos:language-changed', value);
    return { ok: true };
  } catch { return { ok: false }; }
}

function registerIpc() {
  const languageCaller = (event) => isSetupFrame(event) || isStartupFrame(event) || isPairedCashierFrame(event);
  ipcMain.handle('bms-pos:get-language', (event) => languageCaller(event) ? getAppLanguage() : null);
  ipcMain.handle('bms-pos:set-language', (event, value) => languageCaller(event)
    ? changeAppLanguage(value) : { ok: false });
  const isPrinterCaller = (event) => isReceiptPrinterCaller(event, mainWindow, activePairing?.serverUrl);
  ipcMain.handle("bms-pos:get-printer-state", async (event) => {
    if (!isPrinterCaller(event)) return null;
    return printerState();
  });
  ipcMain.handle("bms-pos:set-printer-config", async (event, input) => {
    if (!isPrinterCaller(event)) return { ok: false, error: posText("ไม่มีสิทธิ์ตั้งค่าเครื่องพิมพ์") };
    if (printerOperationBusy) return { ok: false, error: posText("กำลังใช้เครื่องพิมพ์ กรุณารอสักครู่") };
    printerOperationBusy = true;
    const pairing = activePairing;
    try {
      if (![58, 80].includes(input?.paperWidth)) throw new Error(posText("ขนาดกระดาษไม่ถูกต้อง"));
      const next = normalizePrinterConfig(input);
      const { printers } = await printerState();
      if (activePairing !== pairing || !isPrinterCaller(event)) throw new Error(posText("หน้าขายเปลี่ยนแล้ว กรุณาลองใหม่"));
      if (!next.deviceName || !printers.some((printer) => printer.name === next.deviceName)) {
        throw new Error(posText("ไม่พบเครื่องพิมพ์ที่เลือก"));
      }
      if (next.deviceName !== printerConfig.deviceName || next.paperWidth !== printerConfig.paperWidth) {
        next.tested = false;
        await savePrinterConfig(next);
        printerProblem = "";
        pendingPrinterTest = null;
      }
      return { ok: true, state: await printerState() };
    } catch (error) {
      return { ok: false, error: error?.message || posText("บันทึกเครื่องพิมพ์ไม่สำเร็จ") };
    } finally { printerOperationBusy = false; }
  });
  const runPrinterJob = async (event, testPage) => {
    if (printerOperationBusy) return { ok: false, error: posText("กำลังใช้เครื่องพิมพ์ กรุณารอสักครู่") };
    printerOperationBusy = true;
    const pairing = activePairing;
    try {
      const state = await printerState();
      if (!(testPage ? state.canTest : state.canPrint)) return { ok: false, error: state.message };
      pendingPrinterTest = null;
      const result = await printDesktopReceipt(event.sender, testPage, () => activePairing === pairing && isPrinterCaller(event));
      if (!result.ok) printerProblem = result.error;
      else if (testPage) pendingPrinterTest = printerConfig;
      return result;
    } catch {
      printerProblem = posText("ตรวจสอบเครื่องพิมพ์ไม่สำเร็จ กรุณาตรวจสอบและพิมพ์ทดสอบอีกครั้ง");
      return { ok: false, error: printerProblem };
    }
    finally { printerOperationBusy = false; }
  };
  ipcMain.handle("bms-pos:print-receipt", async (event) => {
    if (!isPrinterCaller(event)) return { ok: false, error: posText("ไม่มีสิทธิ์พิมพ์ใบเสร็จ") };
    return runPrinterJob(event, false);
  });
  ipcMain.handle("bms-pos:test-receipt-printer", async (event) => {
    if (!isPrinterCaller(event)) return { ok: false, error: posText("ไม่มีสิทธิ์พิมพ์ทดสอบ") };
    return runPrinterJob(event, true);
  });
  ipcMain.handle("bms-pos:confirm-printer-test", async (event, printed) => {
    if (!isPrinterCaller(event) || printerOperationBusy || !pendingPrinterTest || pendingPrinterTest !== printerConfig
      || typeof printed !== "boolean") return { ok: false, error: posText("กรุณาพิมพ์ทดสอบก่อนยืนยัน") };
    printerOperationBusy = true;
    try {
      await savePrinterConfig({ ...printerConfig, tested: printed });
      pendingPrinterTest = null;
      printerProblem = printed ? "" : posText("กระดาษทดสอบไม่ออกหรือไม่ถูกต้อง ตรวจเครื่องและคิวพิมพ์ แล้วทดสอบใหม่");
      return { ok: true };
    } catch { return { ok: false, error: posText("บันทึกผลทดสอบไม่สำเร็จ") }; }
    finally { printerOperationBusy = false; }
  });
  ipcMain.handle("bms-pos:get-kitchen-printer-state", async (event) => {
    if (!isPrinterCaller(event)) return null;
    const printers = await installedPrinters();
    return {
      ...normalizeKitchenPrinterConfig(kitchenPrinterConfig),
      printers: printers.map(({ name, displayName, isDefault }) => ({ name, displayName, isDefault })),
    };
  });
  ipcMain.handle("bms-pos:set-kitchen-printer-config", async (event, input) => {
    if (!isPrinterCaller(event)) return { ok: false, error: posText("ไม่มีสิทธิ์ตั้งค่าเครื่องพิมพ์ครัว") };
    if (kitchenConfigBusy) return { ok: false, error: posText("กำลังบันทึกเครื่องพิมพ์ครัว กรุณารอสักครู่") };
    kitchenConfigBusy = true;
    const pairing = activePairing;
    try {
      const next = normalizeKitchenPrinterConfig(input);
      const keys = new Set();
      for (const route of next.routes) {
        if (keys.has(route.stationKey)) throw new Error(posText("สถานีครัวซ้ำกัน"));
        keys.add(route.stationKey);
      }
      const printers = await installedPrinters();
      if (activePairing !== pairing || !isPrinterCaller(event)) throw new Error(posText("หน้าขายเปลี่ยนแล้ว กรุณาลองใหม่"));
      if (next.routes.some((route) => !printers.some((printer) => printer.name === route.deviceName))) {
        throw new Error(posText("ไม่พบเครื่องพิมพ์ที่เลือก"));
      }
      await saveKitchenPrinterConfig(next);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || posText("บันทึกเครื่องพิมพ์ครัวไม่สำเร็จ") };
    } finally { kitchenConfigBusy = false; }
  });
  ipcMain.handle("bms-pos:test-kitchen-printer", async (event, stationKey) => {
    if (!isPrinterCaller(event)) return { ok: false, error: posText("ไม่มีสิทธิ์พิมพ์ทดสอบ") };
    const route = normalizeKitchenPrinterConfig(kitchenPrinterConfig).routes.find((item) => item.stationKey === stationKey);
    if (!route) return { ok: false, error: posText("ไม่พบสถานีที่ตั้งค่าไว้") };
    const pairing = activePairing;
    return printDesktopKitchenTicket({
      jobId: `test:${route.stationKey}:${Date.now()}`,
      stationId: route.stationKey.startsWith("id:") ? route.stationKey.slice(3) : null,
      stationName: route.stationName || (route.stationKey.startsWith("name:") ? route.stationKey.slice(5) : posText("สถานีทดสอบ")),
      label: "TEST KITCHEN",
      createdAt: new Date().toISOString(),
      items: [{ name: "ทดสอบภาษาไทย / Print test", qty: 1, modifiers: ["A", "B"], note: posText("ไม่ใช่ออเดอร์จริง") }],
    }, { retry: true }, () => activePairing === pairing && isPrinterCaller(event));
  });
  ipcMain.handle("bms-pos:print-kitchen-ticket", async (event, input, options) => {
    if (!isPrinterCaller(event)) return { ok: false, error: posText("ไม่มีสิทธิ์พิมพ์ใบงานครัว") };
    const pairing = activePairing;
    return printDesktopKitchenTicket(input, { auto: options?.auto === true, retry: options?.retry === true },
      () => activePairing === pairing && isPrinterCaller(event));
  });
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
        body: posText("มีงานออร์เดอร์รอดำเนินการ"),
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
    if (!isSetupFrame(event)) return { ok: false, error: posText("หน้าต่างนี้ไม่มีสิทธิ์จับคู่เครื่อง") };
    if (pairingInProgress) return { ok: false, error: posText("กำลังตรวจการจับคู่ กรุณารอสักครู่") };
    const storage = currentSecureStorageStatus();
    if (!storage.ok) return { ok: false, error: storage.error };
    const parsed = parsePairingInput({ serverUrl: input?.serverUrl, pairingInput: input?.pairingInput });
    if (!parsed.ok) return parsed;
    pairingInProgress = true;
    const revision = ++pairingRevision;
    const current = () => pairingRevision === revision && isSetupFrame(event);
    pairingRestoreRequest++;
    try {
      const verified = await verifyPairing(parsed);
      if (!verified.ok) return verified;
      if (!current()) return { ok: false, error: posText("หน้าจอจับคู่เปลี่ยนแล้ว กรุณาลองใหม่") };
      await writePairing(parsed, current);
      // A rename already in progress may finish after window closure. Its durable credential
      // is valid for the next restore, but the old frame must not navigate a replacement window.
      if (!current()) return { ok: true };
      activePairing = { serverUrl: parsed.serverUrl, token: parsed.token, posEntryPath: null };
      installApplicationMenu();
      void startPosNavigation();
      return { ok: true };
    } catch {
      return { ok: false, error: posText("บันทึกการจับคู่แบบเข้ารหัสไม่สำเร็จ") };
    } finally { pairingInProgress = false; }
  });

  ipcMain.handle("bms-pos:get-device-token", async (event) => {
    if (!isPairedPosFrame(event)) return null;
    return activePairing?.token ?? null;
  });

  ipcMain.handle("bms-pos:open-admin", async (event) => {
    if (!isPairedPosFrame(event)) return { ok: false };
    return { ok: openAdminBackoffice() };
  });

  ipcMain.handle("bms-pos:setup-admin-target", async (event) => {
    if (!isSetupFrame(event)) return null;
    return { kind: await setupAdminTarget() };
  });

  // The setup screen's "no pairing link yet?" shortcut: the local Retail Local back office when this
  // machine runs one, otherwise the cloud BMS login. Only the setup frame may ask.
  ipcMain.handle("bms-pos:open-setup-admin", async (event) => {
    if (!isSetupFrame(event)) return { ok: false, error: posText("หน้าต่างนี้ไม่มีสิทธิ์เปิดระบบหลังบ้าน") };
    const kind = await setupAdminTarget();
    if (kind === "cloud") {
      await shell.openExternal(cloudAdminUrl());
      return { ok: true, kind };
    }
    try {
      return { ok: await openInstalledLocalAdmin(), kind, serverUrl: MANAGED_LOCAL_SERVER_URL };
    } catch (error) {
      return {
        ok: false,
        kind,
        error: error?.userMessage
          ?? posText("เปิดระบบหลังบ้านบนเครื่องนี้ไม่สำเร็จ กรุณาตรวจสอบการติดตั้ง Retail Local Server"),
      };
    }
  });

  ipcMain.handle("bms-pos:retry-startup", async (event) => {
    if (!isStartupFrame(event)) return { ok: false };
    if (activePairing) void startPosNavigation();
    else await restoreSavedPairing();
    return { ok: true };
  });

  ipcMain.handle("bms-pos:change-server", async (event) => {
    if (!isStartupFrame(event)) return { ok: false };
    const targetWindow = mainWindow;
    const result = await removePairing();
    if (result.ok && targetWindow === mainWindow) await showSetup(targetWindow);
    return result;
  });

  ipcMain.handle("bms-pos:get-storage-namespace", async (event) => {
    if (!isPairedPosFrame(event) || !activePairing) return null;
    return createHash("sha256").update(activePairing.token).digest("hex").slice(0, 16);
  });

  ipcMain.handle("bms-pos:unpair", async (event, options) => {
    if (!isPairedCashierFrame(event)) return { ok: false };
    const targetWindow = mainWindow;
    const result = await removePairing();
    if (result.ok && targetWindow === mainWindow) {
      if (options?.deferSetup === true) {
        // Acknowledge durable removal first so the renderer can clear operator/drafts before unload.
        const request = { window: targetWindow, frame: event.senderFrame, timer: null };
        pendingUnpair = request;
        request.timer = setTimeout(() => finishUnpairNavigation(request), 5_000);
      } else await showSetup(targetWindow); // Compatibility with older web/preload clients.
    }
    return result;
  });

  ipcMain.handle("bms-pos:complete-unpair", async (event) => {
    const request = pendingUnpair;
    if (!request || request.window !== mainWindow || request.window.isDestroyed()
      || event.sender !== request.window.webContents || event.senderFrame !== request.frame) return { ok: false };
    finishUnpairNavigation(request);
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
      arch: process.arch,
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
    if (!isPairedCashierFrame(event)) return { ok: false, error: posText("หน้าต่างนี้ไม่มีสิทธิ์ตั้งค่าจอลูกค้า") };
    if (managedDisplayOperationBusy) return { ok: false, error: posText("กำลังบันทึกการตั้งค่าจอ กรุณารอสักครู่") };
    const next = normalizeCustomerDisplayConfig(input);
    if (input?.mode !== next.mode) return { ok: false, error: posText("รูปแบบการตั้งค่าจอลูกค้าไม่ถูกต้อง") };
    const queueState = currentQueueDisplayState();
    if (next.mode === "selected" && queueDisplayConfig.mode !== "off"
      && (next.targetDisplayId === queueState.activeDisplayId
        || next.targetDisplayId === queueState.targetDisplayId)) {
      return { ok: false, error: posText("จอนี้กำลังใช้เป็นจอเรียกคิว กรุณาเลือกคนละจอ") };
    }
    if (next.mode === "selected") {
      const cashierId = String(cashierDisplay().id);
      const selected = screen.getAllDisplays().find((display) => String(display.id) === next.targetDisplayId);
      if (!selected) return { ok: false, error: posText("ไม่พบจอที่เลือก กรุณาตรวจสายจอแล้วลองใหม่") };
      if (String(selected.id) === cashierId) return { ok: false, error: posText("จอหลักกำลังใช้เป็นจอแคชเชียร์ กรุณาเลือกจออื่น") };
    }
    managedDisplayOperationBusy = true;
    try {
      await writeCustomerDisplayConfig(next);
      if (customerDisplayWindowKind === "preview") closeCustomerDisplayWindow();
      customerDisplayConfig = next;
      reconcileCustomerDisplay();
      reconcileQueueDisplay();
      return { ok: true, state: currentCustomerDisplayState() };
    } catch {
      return { ok: false, error: posText("บันทึกการตั้งค่าจอลูกค้าไม่สำเร็จ") };
    } finally { managedDisplayOperationBusy = false; }
  });

  ipcMain.handle("bms-pos:open-customer-display-preview", async (event) => {
    if (!isPairedCashierFrame(event)) return { ok: false, error: posText("หน้าต่างนี้ไม่มีสิทธิ์เปิดตัวอย่างจอลูกค้า") };
    if (customerDisplayWindow && !customerDisplayWindow.isDestroyed() && customerDisplayWindowKind !== "preview") {
      return { ok: false, error: posText("จอลูกค้าจริงกำลังเปิดอยู่แล้ว กรุณาใช้จอนั้นหรือปิดการตั้งค่าจอก่อน") };
    }
    try {
      createCustomerDisplayWindow(cashierDisplay(), "preview");
      broadcastCustomerDisplayState();
      return { ok: true, state: currentCustomerDisplayState() };
    } catch {
      return { ok: false, error: posText("เปิดหน้าต่างทดสอบจอลูกค้าไม่สำเร็จ") };
    }
  });

  ipcMain.handle("bms-pos:close-customer-display-preview", async (event) => {
    if (!isPairedCashierFrame(event)) return { ok: false, error: posText("หน้าต่างนี้ไม่มีสิทธิ์ปิดตัวอย่างจอลูกค้า") };
    if (customerDisplayWindowKind === "preview") closeCustomerDisplayWindow();
    broadcastCustomerDisplayState();
    return { ok: true, state: currentCustomerDisplayState() };
  });

  ipcMain.handle("bms-pos:identify-displays", async (event) => {
    if (!isPairedCashierFrame(event)) return { ok: false };
    identifyDisplays();
    return { ok: true };
  });

  ipcMain.handle("bms-pos:set-external-display-role", async (event, input) => {
    if (!isPairedCashierFrame(event)) {
      return { ok: false, error: posText("หน้าต่างนี้ไม่มีสิทธิ์ตั้งค่าจอภายนอก") };
    }
    if (managedDisplayOperationBusy) return { ok: false, error: posText("กำลังบันทึกการตั้งค่าจอ กรุณารอสักครู่") };
    if (input?.role !== "customer" && input?.role !== "queue") {
      return { ok: false, error: posText("ประเภทจอภายนอกไม่ถูกต้อง") };
    }
    const normalize = input.role === "customer"
      ? normalizeCustomerDisplayConfig
      : normalizeQueueDisplayConfig;
    const requested = normalize(input);
    if (input?.mode !== requested.mode) {
      return { ok: false, error: posText("รูปแบบการตั้งค่าจอภายนอกไม่ถูกต้อง") };
    }

    const displays = screen.getAllDisplays();
    const cashierId = String(cashierDisplay().id);
    const externalDisplays = displays.filter((display) => String(display.id) !== cashierId);
    if (requested.mode === "selected") {
      const selected = externalDisplays.find((display) => String(display.id) === requested.targetDisplayId);
      if (!selected) return { ok: false, error: posText("ไม่พบจอที่เลือก กรุณาตรวจสายจอแล้วลองใหม่") };
    }

    const previousCustomer = customerDisplayConfig;
    const previousQueue = queueDisplayConfig;
    let nextCustomer = input.role === "customer" ? requested : previousCustomer;
    let nextQueue = input.role === "queue" ? requested : previousQueue;

    if (requested.mode !== "off") {
      if (input.role === "customer") {
        const desired = selectCustomerDisplay(displays, cashierId, nextCustomer);
        const queueRawTarget = selectCustomerDisplay(displays, cashierId, nextQueue);
        // Customer display has first choice in the legacy selection policy. Make that hand-off
        // explicit so a queue window is closed before the customer window takes the same screen.
        if (externalDisplays.length <= 1
          || (nextQueue.mode === "selected" && desired && queueRawTarget
            && String(desired.id) === String(queueRawTarget.id))) {
          nextQueue = normalizeQueueDisplayConfig({ mode: "off" });
        }
      } else {
        const customerTarget = selectCustomerDisplay(displays, cashierId, nextCustomer);
        const requestedRawTarget = selectCustomerDisplay(displays, cashierId, nextQueue);
        // Auto mode can use a second free external monitor. Selected mode, or a machine with only
        // one external monitor, means the operator explicitly chose queue instead of customer.
        if (externalDisplays.length <= 1
          || (requested.mode === "selected" && customerTarget && requestedRawTarget
            && String(customerTarget.id) === String(requestedRawTarget.id))) {
          nextCustomer = normalizeCustomerDisplayConfig({ mode: "off" });
        }
      }
    }

    managedDisplayOperationBusy = true;
    try {
      await writeManagedDisplayConfigs(nextCustomer, nextQueue, previousCustomer, previousQueue);
      if (customerDisplayWindowKind === "preview") closeCustomerDisplayWindow();
      if (queueDisplayWindowKind === "preview") closeQueueDisplayWindow();
      customerDisplayConfig = nextCustomer;
      queueDisplayConfig = nextQueue;
      // Reconcile in ownership order. Customer has first choice; queue takes another free display.
      reconcileCustomerDisplay();
      reconcileQueueDisplay();
      return { ok: true, state: currentManagedDisplayState() };
    } catch {
      return { ok: false, error: posText("บันทึกการตั้งค่าจอภายนอกไม่สำเร็จ") };
    } finally { managedDisplayOperationBusy = false; }
  });

  ipcMain.handle("bms-pos:get-queue-display-state", async (event) => {
    if (!isPairedCashierFrame(event)) return null;
    return currentQueueDisplayState();
  });

  ipcMain.handle("bms-pos:set-queue-display-config", async (event, input) => {
    if (!isPairedCashierFrame(event)) return { ok: false, error: posText("หน้าต่างนี้ไม่มีสิทธิ์ตั้งค่าจอเรียกคิว") };
    if (managedDisplayOperationBusy) return { ok: false, error: posText("กำลังบันทึกการตั้งค่าจอ กรุณารอสักครู่") };
    const next = normalizeQueueDisplayConfig(input);
    if (input?.mode !== next.mode) return { ok: false, error: posText("รูปแบบการตั้งค่าจอเรียกคิวไม่ถูกต้อง") };
    if (next.mode === "selected") {
      const selected = screen.getAllDisplays().find((display) => String(display.id) === next.targetDisplayId);
      if (selected && String(selected.id) === String(cashierDisplay().id)) {
        return { ok: false, error: posText("จอแคชเชียร์ใช้เป็นจอเรียกคิวไม่ได้") };
      }
      if (next.targetDisplayId === customerDisplayTargetId()) {
        return { ok: false, error: posText("จอนี้กำลังใช้เป็นจอลูกค้า กรุณาเลือกคนละจอ") };
      }
    }
    managedDisplayOperationBusy = true;
    try {
      await writeQueueDisplayConfig(next);
      if (queueDisplayWindowKind === "preview") closeQueueDisplayWindow();
      queueDisplayConfig = next;
      reconcileQueueDisplay();
      return { ok: true, state: currentQueueDisplayState() };
    } catch {
      return { ok: false, error: posText("บันทึกการตั้งค่าจอเรียกคิวไม่สำเร็จ") };
    } finally { managedDisplayOperationBusy = false; }
  });

  ipcMain.handle("bms-pos:open-queue-display-preview", async (event) => {
    if (!isPairedCashierFrame(event)) return { ok: false, error: posText("หน้าต่างนี้ไม่มีสิทธิ์เปิดตัวอย่างจอเรียกคิว") };
    if (queueDisplayWindow && !queueDisplayWindow.isDestroyed() && queueDisplayWindowKind !== "preview") {
      return { ok: false, error: posText("จอเรียกคิวจริงกำลังเปิดอยู่แล้ว กรุณาใช้จอนั้นหรือปิดการตั้งค่าจอก่อน") };
    }
    try {
      createQueueDisplayWindow(cashierDisplay(), "preview");
      broadcastQueueDisplayState();
      return { ok: true, state: currentQueueDisplayState() };
    } catch {
      return { ok: false, error: posText("เปิดหน้าต่างทดสอบจอเรียกคิวไม่สำเร็จ") };
    }
  });

  ipcMain.handle("bms-pos:close-queue-display-preview", async (event) => {
    if (!isPairedCashierFrame(event)) return { ok: false, error: posText("หน้าต่างนี้ไม่มีสิทธิ์ปิดตัวอย่างจอเรียกคิว") };
    if (queueDisplayWindowKind === "preview") closeQueueDisplayWindow();
    broadcastQueueDisplayState();
    return { ok: true, state: currentQueueDisplayState() };
  });
}

function reopenMainWindow() {
  if (!app.isReady()) return;
  // A manual/print window may remain after the cashier closes. It is not the register.
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    void (activePairing ? startPosNavigation() : restoreSavedPairing());
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", reopenMainWindow);

  app.whenReady().then(async () => {
    app.setAppUserModelId("com.bms.pos.desktop");
    app.on("web-contents-created", (_event, webContents) => {
      installFixedZoomPolicy(webContents);
    });
    languageStore = createLanguageStore(app.getPath('userData'));
    applyAppLanguage(await languageStore.read());
    registerIpc();
    mainWindow = createMainWindow();
    customerDisplayConfig = await readCustomerDisplayConfig();
    queueDisplayConfig = await readQueueDisplayConfig();
    try {
      printerConfig = normalizePrinterConfig(JSON.parse(await readFile(printerConfigPath(), "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") console.error("Unable to read receipt printer configuration");
    }
    try {
      kitchenPrinterConfig = normalizeKitchenPrinterConfig(JSON.parse(await readFile(kitchenPrinterConfigPath(), "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") console.error("Unable to read kitchen printer configuration");
    }
    try {
      const value = JSON.parse(await readFile(kitchenPrintJournalPath(), "utf8"));
      kitchenPrintJournal = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      if (error?.code !== "ENOENT") console.error("Unable to read kitchen print journal");
    }
    launchAtLoginEnabled = await launchAtLogin.initialize().catch((error) => {
      console.error("Unable to apply launch-at-login default", error?.message ?? error);
      return false;
    });
    installApplicationMenu();
    await restoreSavedPairing();
    screen.on("display-added", scheduleCustomerDisplayReconcile);
    screen.on("display-removed", scheduleCustomerDisplayReconcile);
    screen.on("display-metrics-changed", scheduleCustomerDisplayReconcile);
  });

  app.on("activate", reopenMainWindow);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
