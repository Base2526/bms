import { execFile as execFileCallback } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const MANAGED_LOCAL_SERVER_URL = "http://127.0.0.1:3100";
export const MANAGED_LOCAL_POS_DEVICES_PATH = "/admin/pos-devices";

const execFile = promisify(execFileCallback);

export class LocalRuntimeError extends Error {
  constructor(code, userMessage, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = "LocalRuntimeError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function isManagedLocalServerUrl(serverUrl) {
  return serverUrl === MANAGED_LOCAL_SERVER_URL;
}

export function managedLocalPosDevicesUrl() {
  return new URL(MANAGED_LOCAL_POS_DEVICES_PATH, MANAGED_LOCAL_SERVER_URL).toString();
}

async function probeManagedLocalAdmin(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Probe the same login surface as the installer, without credentials or redirects.
    const response = await request(new URL("/admin/login", MANAGED_LOCAL_SERVER_URL).toString(), {
      method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal,
    });
    if (response.body) await response.body.cancel();
    return response.status === 200;
  } finally { clearTimeout(timer); }
}

export async function checkManagedLocalAdminReady({ fetch: request = globalThis.fetch } = {}) {
  let ready = false;
  let cause;
  try {
    ready = await probeManagedLocalAdmin(request, 8000);
  } catch (error) {
    cause = error;
  }
  if (!ready) {
    throw new LocalRuntimeError(
      "LOCAL_ADMIN_UNAVAILABLE",
      "ยังติดต่อ Retail Local Server บนเครื่องนี้ไม่ได้ กรุณาเปิดตัวติดตั้ง Server + POS เพื่อตรวจสอบหรือซ่อมแซม หากติดตั้งเฉพาะ POS ให้ใช้ Server URL และลิงก์จับคู่จากผู้ดูแลร้าน",
      cause ?? new Error("local admin unavailable"),
    );
  }
}

// Decides which back office the first-run setup links to. A macOS installation receipt counts even
// when the server is stopped, because opening it starts the managed runtime. Elsewhere (and as a
// macOS fallback) a short probe of the fixed loopback admin decides; anything else is a POS-only
// machine, which gets its pairing link from the cloud back office instead.
export async function detectManagedLocalInstallation({
  platform = process.platform,
  homeDirectory = os.homedir(),
  lstat: inspect = lstat,
  fetch: request = globalThis.fetch,
  probeTimeoutMs = 1500,
} = {}) {
  const plan = managedLocalRuntimePlan({ serverUrl: MANAGED_LOCAL_SERVER_URL, platform, homeDirectory });
  if (plan) {
    try {
      if ((await inspect(plan.receiptPath)).isFile()) return true;
    } catch {}
  }
  try {
    return await probeManagedLocalAdmin(request, probeTimeoutMs);
  } catch {
    return false;
  }
}

export function managedLocalRuntimePlan({
  serverUrl,
  platform = process.platform,
  homeDirectory = os.homedir(),
} = {}) {
  if (!isManagedLocalServerUrl(serverUrl) || platform !== "darwin") return null;
  return {
    controllerPath: "/Library/Application Support/BMS/RetailLocal/control/bms-retail-local",
    receiptPath: path.posix.join(homeDirectory, "Library/Application Support/BMS/RetailLocal/installation.json"),
  };
}

function isRegularFile(metadata) {
  return metadata.isFile() && !metadata.isSymbolicLink();
}

export async function ensureManagedLocalRuntime(serverUrl, options = {}) {
  const platform = options.platform ?? process.platform;
  const plan = managedLocalRuntimePlan({
    serverUrl,
    platform,
    homeDirectory: options.homeDirectory ?? os.homedir(),
  });
  if (!plan) return { attempted: false };

  const inspect = options.lstat ?? lstat;
  const load = options.readFile ?? readFile;
  const run = options.execFile ?? execFile;
  let receiptMetadata;
  let controllerMetadata;
  try {
    [receiptMetadata, controllerMetadata] = await Promise.all([
      inspect(plan.receiptPath),
      inspect(plan.controllerPath),
    ]);
  } catch (error) {
    throw new LocalRuntimeError(
      "LOCAL_RUNTIME_NOT_INSTALLED",
      "ไม่พบ Retail Local Server ที่ติดตั้งเสร็จแล้ว กรุณาติดตั้ง Server หรือเปลี่ยนไปใช้เซิร์ฟเวอร์อื่น",
      error,
    );
  }

  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  const receiptOwnedByUser = currentUid === null || receiptMetadata.uid === currentUid;
  const controllerIsTrusted = controllerMetadata.uid === 0 && (controllerMetadata.mode & 0o022) === 0;
  if (!isRegularFile(receiptMetadata) || !receiptOwnedByUser || (receiptMetadata.mode & 0o077) !== 0
    || !isRegularFile(controllerMetadata) || !controllerIsTrusted) {
    throw new LocalRuntimeError(
      "LOCAL_RUNTIME_UNTRUSTED",
      "ไฟล์ควบคุม Retail Local Server ไม่ปลอดภัย กรุณาติดตั้ง Server ใหม่หรือติดต่อผู้ดูแลระบบ",
    );
  }

  try {
    const receipt = JSON.parse(await load(plan.receiptPath, "utf8"));
    if (receipt?.product !== "BMS Retail Local" || receipt?.url !== MANAGED_LOCAL_SERVER_URL) {
      throw new Error("invalid installation receipt");
    }
  } catch (error) {
    throw new LocalRuntimeError(
      "LOCAL_RUNTIME_INVALID_RECEIPT",
      "ข้อมูลการติดตั้ง Retail Local Server ไม่ถูกต้อง กรุณาติดตั้ง Server ใหม่หรือติดต่อผู้ดูแลระบบ",
      error,
    );
  }

  try {
    await run(plan.controllerPath, ["ensure-running"], {
      timeout: 330_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
  } catch (error) {
    throw new LocalRuntimeError(
      "LOCAL_RUNTIME_START_FAILED",
      "พบ Retail Local Server แต่เริ่มบริการไม่สำเร็จ กรุณาลองใหม่ หากยังไม่สำเร็จให้เปิด BMS Retail Local เพื่อตรวจสอบระบบ",
      error,
    );
  }
  return { attempted: true };
}
