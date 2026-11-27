import { app, BrowserWindow, ipcMain, safeStorage, session } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createKioskConfigStore, KioskConfigRestoreError } from "./config-store.mjs";
import { createKioskDeviceApi } from "./device-api.mjs";
import { CLOUD_ORIGIN, parseKioskUrl, validDeviceCredential, maskedKioskUrl } from "./url-policy.mjs";
import { staffWebPreferences, guestWebPreferences, guestMayNavigate, redactExternalReferrer } from "./window-policy.mjs";
import { configureKioskAutostart } from "./launch-at-login.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureOrigin = !app.isPackaged && /^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(
  process.env.BMS_KIOSK_TEST_ORIGIN || "") ? process.env.BMS_KIOSK_TEST_ORIGIN : null;
const allowedOrigins = app.isPackaged ? [CLOUD_ORIGIN]
  : [CLOUD_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000", ...(fixtureOrigin ? [fixtureOrigin] : [])];
const api = createKioskDeviceApi();
const fixtureMaintenanceMs = Number(process.env.BMS_KIOSK_TEST_MAINTENANCE_MS);
const MAINTENANCE_MS = fixtureOrigin && Number.isInteger(fixtureMaintenanceMs)
  && fixtureMaintenanceMs >= 1000 && fixtureMaintenanceMs <= 60_000
  ? fixtureMaintenanceMs : 120_000;
let shell = null;
let guest = null;
let config = null;
let view = "setup";
let reason = "NETWORK";
let unlockUntil = 0;
let pinVersion = null;
let healthTimer = null;
let maintenanceTimer = null;
let store;
let quitting = false;
let pendingProvision = null;
let lastRetryAt = 0;

function secureSession(partition) {
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  return ses;
}

function localSender(event) {
  return shell && !shell.isDestroyed() && event.sender === shell.webContents
    && event.senderFrame?.url === pathToFileURL(join(root, "renderer", "shell.html")).href;
}

function staffState() { return { view, reason, canMaintain: Boolean(config),
  maskedUrl: config ? maskedKioskUrl(config.url) : null }; }

function openShell(nextView, nextReason = reason) {
  view = nextView;
  reason = nextReason;
  if (nextView !== "setup") pendingProvision = null;
  if (nextView === "pin") scheduleMaintenanceLock();
  if (guest && !guest.isDestroyed()) guest.hide();
  if (shell && !shell.isDestroyed()) {
    shell.reload();
    shell.show();
    shell.focus();
    return;
  }
  shell = new BrowserWindow({
    fullscreen: true, autoHideMenuBar: true, backgroundColor: "#ffffff", show: false,
    webPreferences: staffWebPreferences(join(root, "src", "preload.cjs")),
  });
  shell.setMenu(null);
  shell.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  shell.webContents.on("did-fail-load", (_event, code) => {
    console.error("kiosk local shell failed to load", { code });
  });
  shell.webContents.on("will-navigate", (event, target) => {
    if (target !== pathToFileURL(join(root, "renderer", "shell.html")).href) event.preventDefault();
  });
  shell.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) event.preventDefault();
  });
  shell.on("closed", () => { shell = null; });
  shell.on("close", (event) => { if (!quitting) event.preventDefault(); });
  void shell.loadFile(join(root, "renderer", "shell.html")).then(() => shell?.show())
    .catch(() => { view = "recovery"; reason = "SERVER"; shell?.show(); });
}

function clearMaintenance() {
  unlockUntil = 0;
  pendingProvision = null;
  if (maintenanceTimer) clearTimeout(maintenanceTimer);
  maintenanceTimer = null;
  if (shell && !shell.isDestroyed()) shell.webContents.executeJavaScript(
    "document.querySelector('#maintenance-pin').value = ''; document.querySelector('#device-token').value = '';").catch(() => {});
}

function scheduleMaintenanceLock() {
  if (maintenanceTimer) clearTimeout(maintenanceTimer);
  maintenanceTimer = setTimeout(() => {
    clearMaintenance();
    if (config) { closeGuest(); void recover(); }
    else openShell("setup");
  }, MAINTENANCE_MS);
}

function showGuest(target) {
  if (guest !== target || target.isDestroyed() || view !== "customer") return;
  clearMaintenance();
  if (shell && !shell.isDestroyed()) shell.hide();
  target.show();
  target.focus();
}

function closeGuest() {
  const current = guest;
  guest = null;
  if (current && !current.isDestroyed()) current.destroy();
}

function customerWindow(url) {
  closeGuest();
  const partition = `bms-kiosk-customer-${randomUUID()}`;
  const guestSession = secureSession(partition); // fresh in-memory partition on every new guest window
  const boundOrigin = new URL(url).origin;
  guestSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: redactExternalReferrer(details.url, boundOrigin, details.requestHeaders) });
  });
  const currentGuest = new BrowserWindow({
    fullscreen: true, kiosk: true, autoHideMenuBar: true, backgroundColor: "#fff", show: false,
    webPreferences: guestWebPreferences(partition),
  });
  guest = currentGuest;
  view = "customer";
  currentGuest.setMenu(null);
  currentGuest.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  currentGuest.webContents.on("will-navigate", (event, target) => {
    if (!guestMayNavigate(target, url)) event.preventDefault();
  });
  currentGuest.webContents.on("before-input-event", (event, input) => {
    if (guest !== currentGuest) return;
    const key = input.key.toLowerCase();
    if (input.control && input.alt && key === "k") { event.preventDefault(); openShell("pin"); return; }
    if (key === "f12" || key === "f5" || input.alt && key === "f4"
      || input.control && ["r", "w", "t", "n", "l"].includes(key)) event.preventDefault();
  });
  currentGuest.webContents.on("render-process-gone", () => {
    if (guest !== currentGuest) return;
    closeGuest(); openShell("recovery", "CRASH");
  });
  currentGuest.webContents.on("did-fail-load", (_event, code, _description, validatedUrl, isMainFrame) => {
    if (guest !== currentGuest) return;
    if (isMainFrame && validatedUrl === url && code !== -3) { closeGuest(); openShell("recovery", "NETWORK"); }
  });
  currentGuest.on("closed", () => { if (guest === currentGuest) guest = null; });
  currentGuest.on("close", (event) => { if (!quitting) event.preventDefault(); });
  void currentGuest.loadURL(url).then(() => showGuest(currentGuest)).catch(() => {
    if (guest !== currentGuest) return;
    closeGuest(); openShell("recovery", "NETWORK");
  });
}

async function checkDevice() {
  if (!config) return false;
  const parsed = parseKioskUrl(config.url, allowedOrigins);
  if (!parsed) throw new Error("BINDING");
  const status = await api.status(parsed.origin, config.deviceToken);
  if (!status.pinConfigured) throw new Error("NO_PIN");
  if (pinVersion && pinVersion !== status.pinVersion) { clearMaintenance(); closeGuest(); throw new Error("PIN_CHANGED"); }
  pinVersion = status.pinVersion;
  await api.bind(parsed.origin, config.deviceToken, parsed.publicToken, status.pinVersion);
  return true;
}

async function recover() {
  if (!config) { openShell("recovery", "STORAGE"); return { ok: false, code: "STORAGE" }; }
  try {
    await checkDevice();
    const parsed = parseKioskUrl(config.url, allowedOrigins);
    await api.publicMenu(parsed.origin, parsed.publicToken);
    customerWindow(config.url); return { ok: true };
  }
  catch (error) {
    closeGuest();
    const code = error?.code || error?.message || "SERVER";
    openShell("recovery", ["REVOKED", "BINDING", "URL_UNAVAILABLE", "WRONG_BRANCH",
      "PIN_CHANGED", "NO_PIN", "NETWORK", "TIMEOUT", "REDIS_UNAVAILABLE", "RATE_LIMITED"].includes(code)
      ? code : "SERVER");
    return { ok: false, code };
  }
}

function registerIpc() {
  ipcMain.handle("kiosk:get-state", (event) => localSender(event) ? staffState() : null);
  ipcMain.handle("kiosk:maintenance", (event) => {
    if (!localSender(event) || !config) return { ok: false };
    openShell("pin"); return { ok: true };
  });
  ipcMain.handle("kiosk:cancel", (event) => {
    if (!localSender(event)) return { ok: false };
    clearMaintenance();
    if (config) { closeGuest(); void recover(); }
    else openShell("setup");
    return { ok: true };
  });
  ipcMain.handle("kiosk:retry", async (event) => {
    if (!localSender(event) || Date.now() - lastRetryAt < 5000) return { ok: false, code: "RATE_LIMITED" };
    lastRetryAt = Date.now();
    return recover();
  });
  ipcMain.handle("kiosk:verify-pin", async (event, pin) => {
    if (!localSender(event) || view !== "pin" || !config || typeof pin !== "string" || pin.length > 8) return { ok: false, code: "INVALID_PIN" };
    const parsed = parseKioskUrl(config.url, allowedOrigins);
    if (!parsed) return { ok: false, code: "BINDING" };
    try {
      const result = await api.verifyPin(parsed.origin, config.deviceToken, pin);
      if (result.status !== "OK") return { ok: false, code: result.status };
      unlockUntil = Date.now() + MAINTENANCE_MS;
      pinVersion = result.pinVersion;
      scheduleMaintenanceLock();
      openShell("setup");
      return { ok: true };
    } catch (error) { return { ok: false, code: error?.code || "SERVER" }; }
  });
  ipcMain.handle("kiosk:validate", async (event, input) => {
    pendingProvision = null;
    if (!localSender(event) || view !== "setup" || config && Date.now() >= unlockUntil) return { ok: false, code: "LOCKED" };
    const parsed = parseKioskUrl(input?.url, allowedOrigins);
    const token = input?.deviceToken || config?.deviceToken;
    if (!parsed) return { ok: false, code: "INVALID_URL" };
    if (!validDeviceCredential(token)) return { ok: false, code: "INVALID_CREDENTIAL" };
    try {
      const status = await api.status(parsed.origin, token);
      if (!status.pinConfigured) return { ok: false, code: "NO_PIN" };
      if (config && pinVersion && status.pinVersion !== pinVersion) {
        clearMaintenance(); openShell("pin"); return { ok: false, code: "PIN_CHANGED" };
      }
      const binding = await api.bind(parsed.origin, token, parsed.publicToken, status.pinVersion);
      const publicMenu = await api.publicMenu(parsed.origin, parsed.publicToken);
      if (publicMenu.storeName !== binding.storeName || publicMenu.locationName !== binding.locationName) {
        return { ok: false, code: "BINDING" };
      }
      pendingProvision = { url: parsed.url, deviceToken: token, pinVersion: status.pinVersion,
        storeName: publicMenu.storeName, locationName: publicMenu.locationName, verifiedAt: Date.now() };
      return { ok: true, storeName: publicMenu.storeName, locationName: publicMenu.locationName };
    } catch (error) { return { ok: false, code: error?.code || "SERVER" }; }
  });
  ipcMain.handle("kiosk:activate", async (event) => {
    if (!localSender(event) || view !== "setup" || !pendingProvision ||
        Date.now() - pendingProvision.verifiedAt > MAINTENANCE_MS ||
        config && Date.now() >= unlockUntil) return { ok: false, code: "LOCKED" };
    const proposal = pendingProvision;
    pendingProvision = null;
    const parsed = parseKioskUrl(proposal.url, allowedOrigins);
    if (!parsed) return { ok: false, code: "INVALID_URL" };
    try {
      const status = await api.status(parsed.origin, proposal.deviceToken);
      if (!status.pinConfigured || status.pinVersion !== proposal.pinVersion) return { ok: false, code: "PIN_CHANGED" };
      const binding = await api.bind(parsed.origin, proposal.deviceToken, parsed.publicToken, status.pinVersion);
      const publicMenu = await api.publicMenu(parsed.origin, parsed.publicToken);
      if (publicMenu.storeName !== binding.storeName || publicMenu.locationName !== binding.locationName ||
          publicMenu.storeName !== proposal.storeName || publicMenu.locationName !== proposal.locationName) {
        return { ok: false, code: "BINDING" };
      }
      await store.write({ url: proposal.url, deviceToken: proposal.deviceToken });
      config = { url: proposal.url, deviceToken: proposal.deviceToken };
      pinVersion = status.pinVersion;
      customerWindow(config.url);
      return { ok: true };
    } catch (error) { return { ok: false, code: error?.name === "KioskDeviceApiError" ? error.code : "STORAGE" }; }
  });
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
else {
  app.on("second-instance", () => { (guest && !guest.isDestroyed() ? guest : shell)?.focus(); });
  app.on("window-all-closed", () => { /* Staff recovers from OS account; kiosk never exits via window close. */ });
  app.whenReady().then(async () => {
    app.setAppUserModelId("com.bms.kiosk-desktop");
    const kioskUserData = join(app.getPath("appData"), "BMS Kiosk");
    await mkdir(kioskUserData, { recursive: true });
    app.setPath("userData", kioskUserData);
    configureKioskAutostart(app, app.isPackaged, process.platform);
    secureSession("bms-kiosk-staff");
    registerIpc();
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") {
      openShell("recovery", "STORAGE"); return;
    }
    store = createKioskConfigStore(join(app.getPath("userData"), "kiosk-device.enc.json"),
      (plain) => safeStorage.encryptString(plain).toString("base64"),
      (cipher) => safeStorage.decryptString(Buffer.from(cipher, "base64")), allowedOrigins);
    try { config = await store.read(); }
    catch (error) { openShell("recovery", error instanceof KioskConfigRestoreError ? "STORAGE" : "SERVER"); return; }
    if (config) await recover(); else openShell("setup");
    healthTimer = setInterval(async () => {
      if (!config || !guest || guest.isDestroyed()) return;
      try { await checkDevice(); }
      catch (error) {
        const code = error?.code || error?.message;
        if (["REVOKED", "BINDING", "URL_UNAVAILABLE", "WRONG_BRANCH", "PIN_CHANGED", "NO_PIN"].includes(code)) {
          closeGuest(); openShell("recovery", code);
        }
        // Transient network/5xx/Redis failures belong to the Web page. Never
        // destroy a customer's in-progress cart just because a heartbeat failed.
      }
    }, 15_000);
  }).catch((error) => {
    console.error("kiosk startup failed", { name: error?.name, code: error?.code });
    if (app.isReady()) openShell("recovery", "SERVER");
  });
  app.on("before-quit", () => { quitting = true; if (healthTimer) clearInterval(healthTimer); clearMaintenance(); });
}
