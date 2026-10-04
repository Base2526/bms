"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Select, Segmented, Space, message } from "antd";
import { ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { refreshPrinterState, saveDesktopPrinter } from "@/lib/pos/desktopPrinterClient";
import { useReceiptPrinter } from "./useReceiptPrinter";
import ReceiptPrinterStatus from "./ReceiptPrinterStatus";

export default function ReceiptPrinterSettings({ showStatus = true }: { showStatus?: boolean }) {
  const printer = useReceiptPrinter();
  const [deviceName, setDeviceName] = useState("");
  const [paperWidth, setPaperWidth] = useState<58 | 80>(80);
  const [error, setError] = useState("");
  useEffect(() => {
    setDeviceName(printer.state?.deviceName || "");
    setPaperWidth(printer.state?.paperWidth || 80);
  }, [printer.state?.deviceName, printer.state?.paperWidth]);
  const dirty = deviceName !== printer.state?.deviceName || paperWidth !== printer.state?.paperWidth;
  const busy = printer.busy || printer.checking || printer.state?.busy;
  const selectedExists = printer.state?.printers.some(item => item.name === deviceName);
  const save = async () => {
    setError("");
    try {
      await saveDesktopPrinter({ deviceName, paperWidth });
      message.success("บันทึกเครื่องพิมพ์แล้ว");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกเครื่องพิมพ์ไม่สำเร็จ"); }
  };
  return <section style={{ marginBottom: 16 }}>
    <div style={{ fontWeight: 600, marginBottom: 8 }}>เครื่องพิมพ์ใบเสร็จ</div>
    <Space direction="vertical" size={12} style={{ width: "100%", maxWidth: 520 }}>
      <Select aria-label="เครื่องพิมพ์ใบเสร็จ" placeholder="เลือกเครื่องพิมพ์" style={{ width: "100%" }}
        value={deviceName || undefined} onChange={setDeviceName} disabled={busy}
        options={printer.state?.printers.map(item => ({ value: item.name, label: item.displayName || item.name }))}
        notFoundContent="ไม่พบเครื่องพิมพ์ในระบบ" />
      <Space wrap><span>กระดาษ</span>
        <Segmented value={paperWidth} options={[{ label: "58 mm", value: 58 }, { label: "80 mm", value: 80 }]}
          disabled={busy} onChange={value => setPaperWidth(value as 58 | 80)} />
      </Space>
      <Space wrap>
        <Button icon={<SaveOutlined />} type="primary" disabled={busy || !selectedExists || !dirty} onClick={() => void save()}>บันทึก</Button>
        <Button icon={<ReloadOutlined />} disabled={busy} onClick={() => void refreshPrinterState()}>ค้นหาเครื่องพิมพ์</Button>
      </Space>
      {dirty && selectedExists ? <Alert key={`${deviceName}:${paperWidth}`} closable type="info" message="บันทึกเครื่องพิมพ์และขนาดกระดาษก่อนพิมพ์ทดสอบ" /> : showStatus && <ReceiptPrinterStatus />}
      {error && <Alert closable onClose={() => setError("")} type="error" showIcon message={error} />}
    </Space>
  </section>;
}
