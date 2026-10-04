"use client";

import { useState } from "react";
import { Alert, Button, Space } from "antd";
import { PrinterOutlined, ReloadOutlined, CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { canTestDesktopPrinter, confirmDesktopPrinterTest, refreshPrinterState, testDesktopPrinter } from "@/lib/pos/desktopPrinterClient";
import { useReceiptPrinter } from "./useReceiptPrinter";

export default function ReceiptPrinterStatus() {
  const printer = useReceiptPrinter();
  const [error, setError] = useState("");
  if (!printer.native) return null;
  const run = async (action: () => Promise<void>) => {
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "เครื่องพิมพ์มีปัญหา"); }
  };
  const unavailable = printer.state && printer.state.canPrint === undefined;
  return <div style={{ margin: "12px 0", textAlign: "left", width: "100%", flex: "1 0 100%", order: -1 }}>
    <Alert showIcon type={error || printer.error ? "error" : printer.disabled ? "warning" : "success"}
      message={error || printer.error || (printer.busy ? "กำลังส่งงานไปเครื่องพิมพ์" : printer.checking ? "กำลังตรวจสอบเครื่องพิมพ์"
        : unavailable ? "กรุณาอัปเดต Desktop POS เพื่อตรวจสถานะเครื่องพิมพ์"
        : printer.state?.message || "กำลังตรวจสอบเครื่องพิมพ์")} />
    <Space wrap style={{ marginTop: 8 }}>
      <Button icon={<ReloadOutlined />} disabled={printer.busy || printer.checking}
        onClick={() => void run(refreshPrinterState)}>ตรวจสอบอีกครั้ง</Button>
      <Button icon={<PrinterOutlined />} disabled={!canTestDesktopPrinter(printer)}
        onClick={() => void run(testDesktopPrinter)}>พิมพ์ทดสอบ</Button>
    </Space>
    {printer.state?.awaitingConfirmation && <div style={{ marginTop: 10 }}>
      <div style={{ marginBottom: 8 }}>กระดาษทดสอบออกและอ่านได้ถูกต้องหรือไม่?</div>
      <Space wrap>
        <Button icon={<CheckOutlined />} disabled={printer.busy} onClick={() => void run(() => confirmDesktopPrinterTest(true))}>ออกถูกต้อง</Button>
        <Button icon={<CloseOutlined />} disabled={printer.busy} onClick={() => void run(() => confirmDesktopPrinterTest(false))}>ไม่ออก / ไม่ถูกต้อง</Button>
      </Space>
    </div>}
  </div>;
}
