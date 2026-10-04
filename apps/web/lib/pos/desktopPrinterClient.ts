import type { DesktopPrinterState } from "./deviceTokenClient";

export function hasDesktopPrinterBridge(): boolean {
  return typeof window !== "undefined" && typeof window.bmsDesktop?.printReceipt === "function";
}

type Snapshot = { native: boolean; state: DesktopPrinterState | null; checking: boolean; busy: boolean; error: string };
const initial: Snapshot = { native: false, state: null, checking: false, busy: false, error: "" };
let snapshot = initial;
const listeners = new Set<() => void>();
let polling: ReturnType<typeof setInterval> | undefined;
let request: Promise<void> | null = null;
let generation = 0;
const publish = (next: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach(listener => listener());
};
export const getPrinterSnapshot = () => snapshot;
export const getServerPrinterSnapshot = () => initial;
export function canPrintDesktopReceipt(value = snapshot): boolean {
  return !value.native || (!value.busy && !value.checking && !value.error && value.state?.canPrint === true && !value.state.busy);
}
export function canTestDesktopPrinter(value = snapshot): boolean {
  return value.native && !value.busy && !value.checking && !value.error
    && value.state?.canTest === true && !value.state.busy && !value.state.awaitingConfirmation;
}
export function subscribePrinter(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    publish({ native: hasDesktopPrinterBridge() });
    void refreshPrinterState();
    polling = setInterval(() => { void refreshPrinterState(false); }, 5000);
    window.addEventListener("focus", onFocus);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(polling);
      window.removeEventListener("focus", onFocus);
    }
  };
}
function onFocus() { void refreshPrinterState(); }

export function refreshPrinterState(showChecking = true): Promise<void> {
  if (!hasDesktopPrinterBridge() || snapshot.busy) return Promise.resolve();
  if (request) return request;
  const current = generation;
  if (showChecking) publish({ checking: true });
  request = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const state = await Promise.race([
        window.bmsDesktop?.getPrinterState?.(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("ตรวจสอบเครื่องพิมพ์ไม่สำเร็จ กรุณาตรวจสอบอีกครั้ง")), 8000); }),
      ]);
      if (!state) throw new Error("อ่านสถานะเครื่องพิมพ์ไม่สำเร็จ");
      if (current === generation) publish({ state, error: "" });
    } catch (cause) {
      if (current === generation) publish({ error: cause instanceof Error ? cause.message : "ตรวจสอบเครื่องพิมพ์ไม่สำเร็จ" });
    } finally {
      clearTimeout(timer);
      if (current === generation) publish({ checking: false });
      request = null;
    }
  })();
  return request;
}

async function action(run: () => Promise<{ ok: boolean; error?: string }> | undefined) {
  if (snapshot.busy) throw new Error("กำลังใช้เครื่องพิมพ์ กรุณารอสักครู่");
  generation++;
  publish({ busy: true, checking: false, error: "" });
  try {
    const result = await run();
    if (!result?.ok) throw new Error(result?.error || "เครื่องพิมพ์มีปัญหา กรุณาตรวจสอบและพิมพ์ทดสอบ");
  } catch (cause) {
    publish({ error: cause instanceof Error ? cause.message : "เครื่องพิมพ์มีปัญหา" });
    throw cause;
  } finally {
    publish({ busy: false });
    if (request) await request;
    await refreshPrinterState();
  }
}

export const saveDesktopPrinter = (input: { deviceName: string; paperWidth: 58 | 80 }) =>
  action(() => window.bmsDesktop?.setPrinterConfig?.(input));
export async function testDesktopPrinter() {
  await refreshPrinterState();
  if (!canTestDesktopPrinter()) throw new Error(snapshot.error || snapshot.state?.message || "เครื่องพิมพ์ยังไม่พร้อมทดสอบ");
  await action(() => window.bmsDesktop?.testReceiptPrinter?.());
}
export const confirmDesktopPrinterTest = (printed: boolean) => action(() => window.bmsDesktop?.confirmPrinterTest?.(printed));

/** false means an older shell or a browser; native errors never silently open a dialog. */
export async function printDesktopReceipt(): Promise<boolean> {
  if (!hasDesktopPrinterBridge()) return false;
  if (snapshot.busy) throw new Error("กำลังใช้เครื่องพิมพ์ กรุณารอสักครู่");
  await refreshPrinterState();
  if (snapshot.error || snapshot.state?.canPrint !== true || snapshot.state.busy) {
    throw new Error(snapshot.error || snapshot.state?.message || "กรุณาอัปเดต Desktop POS เพื่อตรวจสถานะเครื่องพิมพ์");
  }
  await action(() => window.bmsDesktop?.printReceipt?.());
  return true;
}
