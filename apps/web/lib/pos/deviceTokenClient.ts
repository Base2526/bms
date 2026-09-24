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
  cashierDisplayId: string;
  displays: DesktopDisplay[];
  targetAvailable: boolean;
  positioningLimited: boolean;
};

export type DesktopAppInfo = {
  version: string;
  platform: string;
  clientLabel: string;
  securityNote: string;
  secureStorageReady: boolean;
  secureStorageError: string | null;
  secureStorageBackend: string | null;
};

declare global {
  interface Window {
    bmsDesktop?: {
      isDesktop: true;
      getDeviceToken(): Promise<string | null>;
      getStorageNamespace(): Promise<string | null>;
      getAppInfo?(): Promise<DesktopAppInfo | null>;
      /** Added in desktop 0.2.3; optional so a newer server remains usable from an older shell. */
      getCustomerDisplayState?(): Promise<DesktopCustomerDisplayState | null>;
      setCustomerDisplayConfig?(input: {
        mode: DesktopCustomerDisplayMode;
        targetDisplayId?: string | null;
      }): Promise<{ ok: boolean; error?: string; state?: DesktopCustomerDisplayState }>;
      identifyDisplays?(): Promise<{ ok: boolean }>;
      onCustomerDisplayStateChanged?(
        listener: (state: DesktopCustomerDisplayState) => void,
      ): () => void;
      /** Desktop Command/Ctrl+R requests an authoritative data refresh without destroying React. */
      onRefreshRequested?(listener: () => void): () => void;
      /** Generic OS-level attention only; accepts no order/customer payload by design. */
      requestOperationalAttention?(): Promise<{ ok: boolean; throttled?: boolean; focused?: boolean }>;
      unpair(): Promise<{ ok: boolean }>;
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

export async function clearPosDeviceToken(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.bmsDesktop) {
    await window.bmsDesktop.unpair();
    return;
  }
  window.localStorage.removeItem(POS_DEVICE_TOKEN_KEY);
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

export {};
