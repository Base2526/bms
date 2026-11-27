"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from "antd";

type Device = {
  id: string; locationId: string; label: string; active: boolean;
  hasPin: boolean; pinSetAt: string | null; pinLockedUntil: string | null; createdAt: string;
};

export default function RestaurantKioskDevices({ locationId, locationName, lang }: {
  locationId: string | null; locationName: string | null; lang: "th" | "en";
}) {
  const en = lang === "en";
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [pin, setPin] = useState("");
  const [pinDevice, setPinDevice] = useState<Device | null>(null);
  const [pinAction, setPinAction] = useState<"setPin" | "resetPin">("setPin");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!locationId) { setDevices([]); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/bms/restaurant-kiosk-devices?locationId=${encodeURIComponent(locationId)}`,
        { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(en ? (response.status === 403
        ? "No permission to view this branch" : "Could not load kiosk devices")
        : (body.error || "โหลดรายการเครื่อง Kiosk ไม่สำเร็จ"));
      if (!signal?.aborted) setDevices(body.devices ?? []);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : (en ? "Could not load kiosk devices" : "โหลดรายการเครื่อง Kiosk ไม่สำเร็จ"));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [locationId, en]);

  useEffect(() => {
    const controller = new AbortController();
    setCredential(null); setPinDevice(null); setPin(""); setDevices([]);
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function mutate(action: "issue" | "setPin" | "resetPin" | "clearPin" | "rotateCredential" | "revoke", device?: Device) {
    if (!locationId || busy) return;
    setBusy(true); setError(""); setCredential(null);
    try {
      const response = await fetch("/api/bms/restaurant-kiosk-devices", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, locationId, deviceId: device?.id,
          label: action === "issue" ? label.trim() : undefined,
          pin: action === "setPin" || action === "resetPin" ? pin : undefined, confirmed: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(en ? (response.status === 409
        ? "Device or PIN state changed. Refresh and try again." : response.status === 403
          ? "No permission to manage this branch" : "Could not update kiosk device")
        : (body.error || "จัดการเครื่อง Kiosk ไม่สำเร็จ"));
      setPin(""); setPinDevice(null); setRegisterOpen(false); setLabel("");
      if (body.credential) setCredential(body.credential);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : (en ? "Could not update kiosk device" : "จัดการเครื่อง Kiosk ไม่สำเร็จ")); }
    finally { setBusy(false); }
  }

  const active = devices.some((device) => device.active);
  return <Card title={en ? "Kiosk screen · maintenance PIN" : "จอ Kiosk · PIN ดูแลเครื่อง"} loading={loading && !devices.length}>
    <Typography.Paragraph strong>{en ? "Branch" : "สาขา"}: {locationName || (en ? "Choose a branch" : "เลือกสาขา")}</Typography.Paragraph>
    <Typography.Paragraph>{en
      ? "This PIN unlocks local screen settings only. Cashier PIN and POS permissions still control order review, URL issue and payment."
      : "PIN นี้ใช้ปลดล็อกการตั้งค่าบนเครื่องจอลูกค้าเท่านั้น PIN พนักงานและสิทธิ์ POS ยังคุมการรับคำขอ ออก URL และรับเงิน"}</Typography.Paragraph>
    {error && <Alert type="error" showIcon closable onClose={() => setError("")} message={error} style={{ marginBottom: 12 }} />}
    {credential && <Alert type="warning" showIcon closable onClose={() => setCredential(null)} style={{ marginBottom: 12 }}
      message={en ? "Device credential — copy now; shown once" : "รหัสจับคู่เครื่อง — คัดลอกตอนนี้ แสดงครั้งเดียว"}
      description={<Space direction="vertical" style={{ width: "100%" }}>
        <Typography.Text code copyable={{ text: credential }}>{credential}</Typography.Text>
        <Button onClick={() => setCredential(null)}>{en ? "I have saved it" : "เก็บรหัสแล้ว"}</Button>
      </Space>} />}
    <Space style={{ marginBottom: 12 }} wrap>
      <Button type="primary" disabled={!locationId || active || busy} onClick={() => setRegisterOpen(true)}>
        {en ? "Register kiosk screen" : "ลงทะเบียนเครื่อง Kiosk"}</Button>
      <Button disabled={!locationId || busy} onClick={() => void refresh()}>{en ? "Refresh" : "รีเฟรช"}</Button>
    </Space>
    <Table<Device> rowKey="id" size="small" dataSource={devices} pagination={false}
      locale={{ emptyText: en ? "No kiosk device in this branch" : "สาขานี้ยังไม่มีเครื่อง Kiosk" }}
      scroll={{ x: 600 }} columns={[
        { title: en ? "Screen" : "เครื่อง", dataIndex: "label" },
        { title: en ? "Status" : "สถานะ", render: (_, device) => <Tag color={device.active ? "green" : "default"}>
          {device.active ? (en ? "Active" : "เปิดใช้งาน") : (en ? "Revoked" : "เพิกถอนแล้ว")}</Tag> },
        { title: en ? "Maintenance PIN" : "PIN ดูแลจอ", render: (_, device) => <Space direction="vertical" size={0}>
          <Tag color={device.hasPin ? "green" : "red"}>{device.hasPin ? (en ? "Configured" : "ตั้งแล้ว") : (en ? "Not set" : "ยังไม่ตั้ง")}</Tag>
          {device.pinLockedUntil && new Date(device.pinLockedUntil) > new Date() && <Tag color="orange">{en ? "Locked" : "ล็อกชั่วคราว"}</Tag>}
          {device.pinSetAt && <Typography.Text type="secondary">{new Date(device.pinSetAt).toLocaleString(en ? "en-US" : "th-TH")}</Typography.Text>}
        </Space> },
        { title: en ? "Actions" : "จัดการ", render: (_, device) => device.active ? <Space wrap>
          <Button size="small" onClick={() => { setPin(""); setPinAction("setPin"); setPinDevice(device); }}>
            {device.hasPin ? (en ? "Change PIN" : "เปลี่ยน PIN") : (en ? "Set PIN" : "ตั้ง PIN")}</Button>
          {device.hasPin && <Button size="small" onClick={() => { setPin(""); setPinAction("resetPin"); setPinDevice(device); }}>
            {en ? "Reset PIN" : "รีเซ็ต PIN"}</Button>}
          {device.hasPin && <Popconfirm title={en ? "Clear the maintenance PIN? The screen will lock." : "ล้าง PIN ดูแลจอ? เครื่องจะถูกล็อก"}
            onConfirm={() => void mutate("clearPin", device)}><Button size="small" danger>{en ? "Clear PIN" : "ล้าง PIN"}</Button></Popconfirm>}
          <Popconfirm title={en ? "Rotate the device credential? The screen must be provisioned again." : "หมุนรหัสเครื่อง? ต้องติดตั้งรหัสใหม่บนจอ"}
            onConfirm={() => void mutate("rotateCredential", device)}><Button size="small">{en ? "Rotate credential" : "หมุนรหัสเครื่อง"}</Button></Popconfirm>
          <Popconfirm title={en ? "Revoke this screen?" : "เพิกถอนเครื่องนี้?"}
            onConfirm={() => void mutate("revoke", device)}><Button size="small" danger>{en ? "Revoke" : "เพิกถอน"}</Button></Popconfirm>
        </Space> : null },
      ]} />
    <Modal title={en ? "Register kiosk screen" : "ลงทะเบียนเครื่อง Kiosk"} open={registerOpen}
      onCancel={() => { setRegisterOpen(false); setLabel(""); }}
      onOk={() => void mutate("issue")} okButtonProps={{ disabled: !label.trim() || busy, loading: busy }}>
      <label htmlFor="kiosk-device-label">{en ? "Screen label" : "ชื่อเครื่อง"}</label>
      <Input id="kiosk-device-label" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
    </Modal>
    <Modal title={pinAction === "resetPin" ? (en ? "Reset kiosk maintenance PIN" : "รีเซ็ต PIN ดูแลเครื่อง Kiosk")
      : (en ? "Set kiosk maintenance PIN" : "ตั้ง PIN ดูแลเครื่อง Kiosk")} open={Boolean(pinDevice)}
      onCancel={() => { setPinDevice(null); setPin(""); }}
      onOk={() => { if (pinDevice) void mutate(pinAction, pinDevice); }}
      okButtonProps={{ disabled: !/^[0-9]{6,8}$/.test(pin), loading: busy }}>
      <Typography.Paragraph>{en ? "Use 6–8 digits. This PIN cannot accept orders or operate the POS." : "ใช้ตัวเลข 6–8 หลัก PIN นี้รับคำขอหรือใช้งาน POS ไม่ได้"}</Typography.Paragraph>
      <label htmlFor="kiosk-maintenance-pin">{en ? "New maintenance PIN" : "PIN ดูแลเครื่องใหม่"}</label>
      <Input.Password id="kiosk-maintenance-pin" value={pin} autoComplete="new-password"
        inputMode="numeric" maxLength={8} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} />
    </Modal>
  </Card>;
}
