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

export function managedLocalRuntimePlan({
  serverUrl,
  platform = process.platform,
  homeDirectory = os.homedir(),
} = {}) {
  if (!isManagedLocalServerUrl(serverUrl) || platform !== "darwin") return null;
  return {
    controllerPath: "/Library/Application Support/BMS/RetailLocal/control/bms-retail-local",
    receiptPath: path.join(homeDirectory, "Library/Application Support/BMS/RetailLocal/installation.json"),
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
