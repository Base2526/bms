import React from "react";
import { createRoot } from "react-dom/client";
import ReceiptPaper from "../../web/components/pos/ReceiptPaper";
import ReceiptPrinterSettings from "../../web/components/pos-desktop/ReceiptPrinterSettings";
import CustomerDisplaySettings from "../../web/components/pos-desktop/CustomerDisplaySettings";
import { useReceiptPrinter } from "../../web/components/pos-desktop/useReceiptPrinter";
import { refreshPrinterState } from "../../web/lib/pos/desktopPrinterClient";

let printer = { deviceName: "thermal-test", paperWidth: 80, available: true,
  canPrint: true, canTest: true, awaitingConfirmation: false, message: "ระบบไม่พบปัญหาเครื่องพิมพ์",
  printers: [{ name: "thermal-test", displayName: "Thermal test printer", isDefault: true }] };
let display = { mode: "auto", targetDisplayId: null, activeDisplayId: "20", open: true,
  targetAvailable: true, positioningLimited: false, displays: [
    { id: "10", label: "Cashier", width: 1920, height: 1080, cashier: true },
    { id: "20", label: "Customer", width: 1280, height: 720, cashier: false },
  ] };
Object.assign(window, { testPrintCount: 0, testSaveCount: 0,
  simulatePrinter: async (next) => { printer = { ...printer, ...next }; await refreshPrinterState(); },
  bmsDesktop: {
  printReceipt: async () => ({ ok: true }),
  getPrinterState: async () => printer,
  setPrinterConfig: async (next) => { printer = { ...printer, ...next }; window.testSaveCount++; return { ok: true, state: printer }; },
  testReceiptPrinter: async () => { window.testPrintCount++; printer = { ...printer, canPrint: false, awaitingConfirmation: true }; return { ok: true }; },
  confirmPrinterTest: async (printed) => {
    printer = { ...printer, canPrint: printed, awaitingConfirmation: false, message: printed ? "ยืนยันผลทดสอบแล้ว" : "กระดาษทดสอบไม่ออก กรุณาตรวจสอบเครื่อง" };
    return { ok: true };
  },
  getCustomerDisplayState: async () => display,
  setCustomerDisplayConfig: async (next) => {
    display = { ...display, ...next, open: next.mode !== "off" };
    return { ok: true, state: display };
  },
  identifyDisplays: async () => ({ ok: true }),
} });

function ReceiptAction() {
  const printer = useReceiptPrinter();
  return <button id="receipt-action" disabled={printer.disabled}>พิมพ์ใบเสร็จ</button>;
}
createRoot(document.getElementById("root")!).render(<main className="pos-root" style={{ padding: 20, fontFamily: "Arial, sans-serif", maxWidth: 800 }}>
  <h2>อุปกรณ์ POS</h2>
  <ReceiptPrinterSettings />
  <ReceiptAction />
  <CustomerDisplaySettings />
  <ReceiptPaper payload={{ storeName: "FAKE Shop B", storeLogoUrl: window.testLogo,
    branchCode: "00000", posNo: "E001", docTitle: "ใบเสร็จรับเงิน", docNo: "FAKE-001",
    lines: [{ qty: 1, name: "ข้าวเหนียวมะม่วง สูตรพิเศษ ขนาดมาตรฐาน", amount: 89 }],
    total: 89, itemCount: 1, payments: [{ label: "เงินสด", amount: 89, tendered: 100, change: 11 }],
    at: "04/10/2569 06:47", cashier: "FAKE Cashier", taxRequestUrl: "https://example.invalid/FAKE",
  }} />
</main>);
