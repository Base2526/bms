"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Select, Space, Switch, Tag, message } from "antd";
import { PrinterOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { readPosDeviceToken, type DesktopKitchenPrinterRoute, type DesktopKitchenPrinterState } from "@/lib/pos/deviceTokenClient";
import { getDesktopKitchenPrinterState, saveDesktopKitchenPrinterRoutes, testDesktopKitchenPrinter } from "@/lib/pos/kitchenPrinterClient";

type Station = { id: string; name: string; active?: boolean };

export default function KitchenPrinterSettings() {
  const [state, setState] = useState<DesktopKitchenPrinterState | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [routes, setRoutes] = useState<DesktopKitchenPrinterRoute[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setBusy(true); setError("");
    try {
      const [next, token] = await Promise.all([getDesktopKitchenPrinterState(), readPosDeviceToken()]);
      if (!next) throw new Error("อ่านสถานะเครื่องพิมพ์ครัวไม่สำเร็จ");
      const response = await fetch("/api/pos/kitchen/tickets?limit=1", { headers: { "x-pos-device-token": token }, cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      // สถานีที่เพิ่งปิดอาจยังมีงานค้างอยู่ จึงต้องเก็บ route ไว้จนกว่างานบน server จะหมด
      const nextStations = Array.isArray(data?.stations) ? data.stations.filter((item: Station) => item?.id && item?.name) : [];
      setState(next);
      setStations(nextStations);
      setRoutes(nextStations.map((station: Station) => next.routes.find((route) => route.stationKey === `id:${station.id}`) ?? {
        stationKey: `id:${station.id}`, stationName: station.name, deviceName: "", paperWidth: 80, autoPrint: false,
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดการตั้งค่าไม่สำเร็จ"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const patchRoute = (stationKey: string, patch: Partial<DesktopKitchenPrinterRoute>) => {
    setRoutes((values) => values.map((route) => route.stationKey === stationKey ? { ...route, ...patch } : route));
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await saveDesktopKitchenPrinterRoutes(routes.filter((route) => route.deviceName));
      message.success("บันทึกการแยกเครื่องพิมพ์ตามสถานีแล้ว");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ"); setBusy(false); }
  };

  return <Card size="small" title={<Space><PrinterOutlined /> เครื่องพิมพ์แยกตามสถานีครัว <Tag color="blue">Desktop pilot</Tag></Space>}
    extra={<Button size="small" icon={<ReloadOutlined />} loading={busy} onClick={() => void load()} />}> 
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <div style={{ color: "var(--posx-ink2, #555)", fontSize: 13 }}>กำหนดปลายทางในแอปเดสก์ท็อปเครื่องนี้ ระบบจะพิมพ์จากใบงานครัวที่เซิร์ฟเวอร์ส่งมาเท่านั้น</div>
      {error && <Alert closable type="error" showIcon message={error} onClose={() => setError("")} />}
      {stations.length === 0 && <Alert closable type="info" showIcon message="ยังไม่มีสถานีครัวที่เปิดใช้งาน" />}
      {routes.map((route) => <div key={route.stationKey} style={{ display: "grid", gridTemplateColumns: "minmax(120px, .7fr) minmax(180px, 1.4fr) 110px auto auto", gap: 8, alignItems: "center" }}>
        <b>{route.stationName}</b>
        <Select allowClear value={route.deviceName || undefined} placeholder="เลือกเครื่องพิมพ์" options={(state?.printers ?? []).map((printer) => ({ value: printer.name, label: printer.displayName || printer.name }))} onChange={(deviceName) => patchRoute(route.stationKey, { deviceName: deviceName ?? "" })} />
        <Select value={route.paperWidth} options={[{ value: 80, label: "80 mm" }, { value: 58, label: "58 mm" }]} onChange={(paperWidth) => patchRoute(route.stationKey, { paperWidth })} />
        <Space><Switch checked={route.autoPrint} disabled={!route.deviceName} onChange={(autoPrint) => patchRoute(route.stationKey, { autoPrint })} /> <span>พิมพ์อัตโนมัติ</span></Space>
        <Button disabled={!route.deviceName} onClick={() => void testDesktopKitchenPrinter(route.stationKey).then(() => message.success("ส่งใบทดสอบแล้ว")).catch((cause) => setError(cause.message))}>ทดสอบ</Button>
      </div>)}
      <Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={() => void save()}>บันทึกเครื่องพิมพ์ครัว</Button>
    </Space>
  </Card>;
}
