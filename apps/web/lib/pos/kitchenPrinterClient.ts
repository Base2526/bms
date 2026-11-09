import type { DesktopKitchenPrintJob, DesktopKitchenPrinterRoute, DesktopKitchenPrinterState } from "./deviceTokenClient";

export function hasDesktopKitchenPrinterBridge(): boolean {
  return typeof window !== "undefined" && typeof window.bmsDesktop?.printKitchenTicket === "function";
}

export async function getDesktopKitchenPrinterState(): Promise<DesktopKitchenPrinterState | null> {
  if (typeof window === "undefined") return null;
  return window.bmsDesktop?.getKitchenPrinterState?.() ?? null;
}

export async function saveDesktopKitchenPrinterRoutes(routes: DesktopKitchenPrinterRoute[]) {
  const result = await window.bmsDesktop?.setKitchenPrinterConfig?.({ routes });
  if (!result?.ok) throw new Error(result?.error || "บันทึกเครื่องพิมพ์ครัวไม่สำเร็จ");
}

export async function testDesktopKitchenPrinter(stationKey: string) {
  const result = await window.bmsDesktop?.testKitchenPrinter?.(stationKey);
  if (!result?.ok) throw new Error(result?.error || "พิมพ์ทดสอบไม่สำเร็จ");
}

export async function printDesktopKitchenTicket(
  job: DesktopKitchenPrintJob,
  options: { auto?: boolean; retry?: boolean } = {},
) {
  const result = await window.bmsDesktop?.printKitchenTicket?.(job, options);
  if (!result) throw new Error("เดสก์ท็อปเวอร์ชันนี้ยังไม่รองรับเครื่องพิมพ์ครัว");
  return result;
}
