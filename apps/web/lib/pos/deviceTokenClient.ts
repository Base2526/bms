declare global {
  interface Window {
    bmsDesktop?: {
      isDesktop: true;
      getDeviceToken(): Promise<string | null>;
      getStorageNamespace(): Promise<string | null>;
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

export {};
