import { posText } from "./clientText";

export type DesktopCustomerDisplayMode = "off" | "auto" | "selected";

export type DesktopDisplay = {
  id: string;
  label: string;
  primary: boolean;
  cashier: boolean;
  width: number;
  height: number;
  scaleFactor: number;
  rotation: number;
};

export type DesktopCustomerDisplayState = {
  mode: DesktopCustomerDisplayMode;
  targetDisplayId: string | null;
  activeDisplayId: string | null;
  open: boolean;
  /** Temporary same-monitor window; never persisted or reopened on startup. */
  preview?: boolean;
  cashierDisplayId: string;
  displays: DesktopDisplay[];
  targetAvailable: boolean;
  positioningLimited: boolean;
  /** The selected monitor is already assigned to another managed POS display. */
  conflict?: boolean;
};

export type DesktopQueueDisplayState = DesktopCustomerDisplayState;

export type DesktopExternalDisplayRole = "customer" | "queue";

export type DesktopManagedDisplayState = {
  customer: DesktopCustomerDisplayState;
  queue: DesktopQueueDisplayState;
};

export type DesktopAppInfo = {
  version: string;
  platform: string;
  /** Missing on older shells; the update menu asks the operator to choose instead. */
  arch?: string;
  clientLabel: string;
  securityNote: string;
  secureStorageReady: boolean;
  secureStorageError: string | null;
  secureStorageBackend: string | null;
};

export type DesktopPrinterState = {
  deviceName: string;
  paperWidth: 58 | 80;
  available: boolean;
  canPrint?: boolean;
  canTest?: boolean;
  busy?: boolean;
  awaitingConfirmation?: boolean;
  message?: string;
  health?: "ready" | "unknown" | "blocked";
  printers: Array<{ name: string; displayName: string; isDefault: boolean }>;
};

export type DesktopKitchenPrinterRoute = {
  stationKey: string;
  stationName: string;
  deviceName: string;
  paperWidth: 58 | 80;
  autoPrint: boolean;
};

export type DesktopKitchenPrinterState = {
  version: 1;
  routes: DesktopKitchenPrinterRoute[];
  printers: Array<{ name: string; displayName: string; isDefault: boolean }>;
};

export type DesktopKitchenPrintJob = {
  jobId: string;
  stationId: string | null;
  stationName: string | null;
  label: string;
  roundNo: number | null;
  createdAt: string;
  items: Array<{ name: string; size: string | null; qty: number; modifiers: string[]; note: string | null }>;
};

declare global {
  interface Window {
    bmsDesktop?: {
      isDesktop: true;
      getLanguage?(): Promise<"th" | "en">;
      setLanguage?(language: "th" | "en"): Promise<{ ok: boolean }>;
      onLanguageChanged?(listener: (language: "th" | "en") => void): () => void;
      getDeviceToken(): Promise<string | null>;
      getStorageNamespace(): Promise<string | null>;
      getAppInfo?(): Promise<DesktopAppInfo | null>;
      /** Opens the paired server's admin login in the system browser without POS credentials. */
      openAdmin?(): Promise<{ ok: boolean }>;
      getPrinterState?(): Promise<DesktopPrinterState | null>;
      setPrinterConfig?(input: { deviceName: string; paperWidth: 58 | 80 }): Promise<{
        ok: boolean; error?: string; state?: DesktopPrinterState;
      }>;
      printReceipt?(): Promise<{ ok: boolean; error?: string }>;
      testReceiptPrinter?(): Promise<{ ok: boolean; error?: string }>;
      confirmPrinterTest?(printed: boolean): Promise<{ ok: boolean; error?: string }>;
      getKitchenPrinterState?(): Promise<DesktopKitchenPrinterState | null>;
      setKitchenPrinterConfig?(input: { routes: DesktopKitchenPrinterRoute[] }): Promise<{ ok: boolean; error?: string }>;
      testKitchenPrinter?(stationKey: string): Promise<{ ok: boolean; error?: string; uncertain?: boolean }>;
      printKitchenTicket?(job: DesktopKitchenPrintJob, options?: { auto?: boolean; retry?: boolean }): Promise<{
        ok: boolean; error?: string; duplicate?: boolean; skipped?: boolean; uncertain?: boolean; retrySafe?: boolean;
      }>;
      /** Added in desktop 0.2.3; optional so a newer server remains usable from an older shell. */
      getCustomerDisplayState?(): Promise<DesktopCustomerDisplayState | null>;
      openCustomerDisplayPreview?(): Promise<{
        ok: boolean; error?: string; state?: DesktopCustomerDisplayState;
      }>;
      closeCustomerDisplayPreview?(): Promise<{
        ok: boolean; error?: string; state?: DesktopCustomerDisplayState;
      }>;
      setCustomerDisplayConfig?(input: {
        mode: DesktopCustomerDisplayMode;
        targetDisplayId?: string | null;
      }): Promise<{ ok: boolean; error?: string; state?: DesktopCustomerDisplayState }>;
      identifyDisplays?(): Promise<{ ok: boolean }>;
      onCustomerDisplayStateChanged?(
        listener: (state: DesktopCustomerDisplayState) => void,
      ): () => void;
      /** Added with pickup queue display management; optional for older desktop shells. */
      getQueueDisplayState?(): Promise<DesktopQueueDisplayState | null>;
      openQueueDisplayPreview?(): Promise<{
        ok: boolean; error?: string; state?: DesktopQueueDisplayState;
      }>;
      closeQueueDisplayPreview?(): Promise<{
        ok: boolean; error?: string; state?: DesktopQueueDisplayState;
      }>;
      setQueueDisplayConfig?(input: {
        mode: DesktopCustomerDisplayMode;
        targetDisplayId?: string | null;
      }): Promise<{ ok: boolean; error?: string; state?: DesktopQueueDisplayState }>;
      onQueueDisplayStateChanged?(
        listener: (state: DesktopQueueDisplayState) => void,
      ): () => void;
      /** Atomically assigns a physical display role and releases the conflicting role if needed. */
      setExternalDisplayRole?(input: {
        role: DesktopExternalDisplayRole;
        mode: DesktopCustomerDisplayMode;
        targetDisplayId?: string | null;
      }): Promise<{ ok: boolean; error?: string; state?: DesktopManagedDisplayState }>;
      /** Desktop Command/Ctrl+R requests an authoritative data refresh without destroying React. */
      onRefreshRequested?(listener: () => void): () => void;
      /** Generic OS-level attention only; accepts no order/customer payload by design. */
      requestOperationalAttention?(): Promise<{ ok: boolean; throttled?: boolean; focused?: boolean }>;
      unpair(afterRemoval?: () => void): Promise<{ ok: boolean; error?: string }>;
    };
  }
}

export const POS_DEVICE_TOKEN_KEY = "bms.pos.deviceToken";

export async function readPosDeviceToken(): Promise<string> {
  if (typeof window === "undefined") return "";
  if (window.bmsDesktop) {
    try {
      return (await window.bmsDesktop.getDeviceToken()) ?? "";
    } catch {
      return "";
    }
  }
  return window.localStorage.getItem(POS_DEVICE_TOKEN_KEY) ?? "";
}

export function writeBrowserPosDeviceToken(token: string): boolean {
  if (typeof window === "undefined" || window.bmsDesktop) return false;
  window.localStorage.setItem(POS_DEVICE_TOKEN_KEY, token);
  window.dispatchEvent(new Event("bms-pos-device-token-changed"));
  return true;
}

export async function clearPosDeviceToken(afterRemoval?: () => void): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.bmsDesktop) {
    let removalConfirmed = false;
    const cleanup = () => {
      if (removalConfirmed) return;
      removalConfirmed = true;
      afterRemoval?.();
    };
    let result;
    try { result = await window.bmsDesktop.unpair(cleanup); }
    catch { throw new Error(removalConfirmed
      ? posText("เลิกจับคู่แล้ว แต่ล้างข้อมูลหน้าขายไม่สำเร็จ กรุณาปิดแอปแล้วเปิดใหม่")
      : posText("เลิกจับคู่เครื่องไม่สำเร็จ กรุณาลองใหม่ ข้อมูลหน้าขายยังอยู่")); }
    if (!result?.ok) throw new Error(result?.error || posText("เลิกจับคู่เครื่องไม่สำเร็จ กรุณาลองใหม่ ข้อมูลหน้าขายยังอยู่"));
    cleanup(); // Older preload clients do not support the pre-navigation callback.
    return;
  }
  window.localStorage.removeItem(POS_DEVICE_TOKEN_KEY);
  afterRemoval?.();
  window.dispatchEvent(new Event("bms-pos-device-token-changed"));
}

export async function posDeviceStorageNamespace(token: string): Promise<string> {
  if (typeof window !== "undefined" && window.bmsDesktop) {
    try {
      return (await window.bmsDesktop.getStorageNamespace()) ?? "desktop";
    } catch {
      return "desktop";
    }
  }
  return token;
}

export function hasDesktopPosBridge(): boolean {
  return typeof window !== "undefined" && Boolean(window.bmsDesktop);
}

export async function requestDesktopOperationalAttention(): Promise<void> {
  if (typeof window === "undefined" || typeof window.bmsDesktop?.requestOperationalAttention !== "function") return;
  try {
    await window.bmsDesktop.requestOperationalAttention();
  } catch {
    // The in-page badge/banner and sound remain authoritative fallbacks on older desktop shells.
  }
}

export async function readDesktopAppInfo(): Promise<DesktopAppInfo | null> {
  if (typeof window === "undefined" || typeof window.bmsDesktop?.getAppInfo !== "function") return null;
  try {
    return await window.bmsDesktop.getAppInfo();
  } catch {
    return null;
  }
}

export async function openDesktopAdmin(): Promise<boolean> {
  if (typeof window === "undefined" || typeof window.bmsDesktop?.openAdmin !== "function") return false;
  try {
    return Boolean((await window.bmsDesktop.openAdmin()).ok);
  } catch {
    return false;
  }
}

export function hasDesktopCustomerDisplayBridge(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = window.bmsDesktop;
  return Boolean(
    bridge
    && typeof bridge.getCustomerDisplayState === "function"
    && typeof bridge.setCustomerDisplayConfig === "function"
    && typeof bridge.identifyDisplays === "function"
    && typeof bridge.onCustomerDisplayStateChanged === "function"
  );
}

export function hasDesktopQueueDisplayBridge(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = window.bmsDesktop;
  return Boolean(
    bridge
    && typeof bridge.getQueueDisplayState === "function"
    && typeof bridge.setQueueDisplayConfig === "function"
    && typeof bridge.identifyDisplays === "function"
    && typeof bridge.onQueueDisplayStateChanged === "function"
  );
}

export function hasDesktopManagedDisplayBridge(): boolean {
  if (typeof window === "undefined") return false;
  return hasDesktopCustomerDisplayBridge()
    && hasDesktopQueueDisplayBridge()
    && typeof window.bmsDesktop?.setExternalDisplayRole === "function";
}

export {};
