"use client";

import { usePosText, thaiPosText, type PosTranslator } from "@/lib/pos/usePosText";

import { useEffect, useMemo, useState } from "react";
import { Button, Select, Switch } from "antd";
import { CloseOutlined, DesktopOutlined, EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import type { DesktopCustomerDisplayMode, DesktopQueueDisplayState } from "@/lib/pos/deviceTokenClient";

function statusText(state: DesktopQueueDisplayState, posText: PosTranslator = thaiPosText): string {
  if (state.preview && state.open) return posText("กำลังทดสอบบนจอนี้");
  if (state.mode === "off") return posText("ปิดอยู่");
  if (state.open) {
    const display = state.displays.find((item) => item.id === state.activeDisplayId);
    return posText("เชื่อมต่อแล้ว · {v0}", { v0: display?.label ?? posText("จอเรียกคิว") });
  }
  if (state.conflict) return posText("จอที่เลือกใช้อยู่กับจอลูกค้า");
  if (state.displays.length < 2) return posText("ยังไม่พบจอเพิ่มเติม");
  if (state.mode === "selected" && !state.targetAvailable) return posText("จอที่เลือกไม่ได้เชื่อมต่อ");
  return posText("ยังไม่สามารถเปิดจอเรียกคิวได้");
}

export default function QueueDisplaySettings() {
  const posText = usePosText();
  const [state, setState] = useState<DesktopQueueDisplayState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const next = await window.bmsDesktop?.getQueueDisplayState?.();
      if (next) setState(next);
    } catch { setError(posText("ตรวจสอบจอเรียกคิวไม่สำเร็จ")); }
  };

  useEffect(() => {
    void refresh();
    return window.bmsDesktop?.onQueueDisplayStateChanged?.((next) => setState(next));
  }, []);

  const selectableDisplays = useMemo(
    () => state?.displays.filter((display) => !display.cashier) ?? [],
    [state],
  );

  const configure = async (mode: DesktopCustomerDisplayMode, targetDisplayId: string | null = null) => {
    const configureDisplay = window.bmsDesktop?.setQueueDisplayConfig;
    if (!configureDisplay || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await configureDisplay({ mode, targetDisplayId });
      if (!result.ok) throw new Error(result.error ?? posText("ตั้งค่าจอเรียกคิวไม่สำเร็จ"));
      if (result.state) setState(result.state);
      else await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : posText("ตั้งค่าจอเรียกคิวไม่สำเร็จ"));
    } finally { setBusy(false); }
  };

  const togglePreview = async () => {
    if (!state || busy) return;
    const action = state.preview
      ? window.bmsDesktop?.closeQueueDisplayPreview
      : window.bmsDesktop?.openQueueDisplayPreview;
    if (!action) return;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (!result.ok) throw new Error(result.error ?? posText("เปิดหน้าต่างทดสอบจอเรียกคิวไม่สำเร็จ"));
      if (result.state) setState(result.state);
      else await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : posText("เปิดหน้าต่างทดสอบจอเรียกคิวไม่สำเร็จ"));
    } finally { setBusy(false); }
  };

  if (!state) {
    return <div style={{ color: "var(--posx-muted, #667085)", fontSize: 13 }}>{error || posText("กำลังตรวจสอบจอเรียกคิว…")}</div>;
  }

  return <section style={{ padding: "14px 0" }} data-queue-display-settings>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><div style={{ fontWeight: 700 }}>{posText("จอเรียกคิว")}</div>
        <div style={{ marginTop: 4, color: "var(--posx-muted, #667085)", fontSize: 12 }}>
          {posText("เลือกจอแยกจากแคชเชียร์และจอลูกค้า · จำค่าและเปิดใหม่เองเมื่อเริ่ม POS") + " "}</div></div>
      <span style={{ padding: "4px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600,
        color: state.open ? "var(--posx-ok-text, #237804)" : state.mode === "off" ? "var(--posx-muted, #667085)" : "var(--posx-warn-text, #ad6800)",
        background: state.open ? "var(--posx-ok-bg, #f6ffed)" : state.mode === "off" ? "var(--posx-soft, #f2f4f7)" : "var(--posx-warn-bg, #fffbe6)" }}>
        {statusText(state, posText)}
      </span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
      <label style={{ display: "inline-flex", alignItems: "center", minHeight: 44, gap: 12, cursor: busy ? "wait" : "pointer" }}>
        <Switch aria-label={posText("เปิดจอเรียกคิวเมื่อเปิด POS")} checked={state.mode !== "off"} loading={busy}
          onChange={(checked) => void configure(checked ? "auto" : "off")} />
        <span>{posText("เปิดจอเรียกคิวเมื่อเปิด POS")}</span>
      </label>
      {state.mode !== "off" && !state.open && state.targetAvailable && <Button icon={<ReloadOutlined />} disabled={busy}
        onClick={() => void configure(state.mode, state.targetDisplayId)}>{posText("เปิดจออีกครั้ง")}</Button>}
      <Select aria-label={posText("เลือกจอเรียกคิว")} style={{ width: "100%", maxWidth: 400 }}
        value={state.mode === "selected" ? state.targetDisplayId : "auto"} disabled={busy || state.mode === "off"}
        onChange={(value) => void configure(value === "auto" ? "auto" : "selected", value === "auto" ? null : value)}
        options={[{ value: "auto", label: posText("เลือกจอว่างอัตโนมัติ") },
          ...selectableDisplays.map((display) => ({ value: display.id, label: `${display.label} · ${display.width}×${display.height}` })),
          ...(state.mode === "selected" && !state.targetAvailable
            ? [{ value: state.targetDisplayId!, label: posText("จอที่บันทึกไว้ (ใช้ไม่ได้)"), disabled: true }] : [])]} />
      <Button icon={<DesktopOutlined />} disabled={busy} onClick={() => void window.bmsDesktop?.identifyDisplays?.()}>
        {posText("ระบุหมายเลขจอ") + " "}</Button>
    </div>
    {typeof window.bmsDesktop?.openQueueDisplayPreview === "function" && <div style={{ marginTop: 12, padding: 12,
      border: "1px dashed var(--posx-line, #d9e2ef)", borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{posText("ทดสอบบนจอเดียว")}</div>
      <div style={{ marginTop: 3, color: "var(--posx-muted, #667085)", fontSize: 12 }}>
        {posText("เปิดเป็นหน้าต่างย่อโดยไม่เปลี่ยนค่าจอจริง เพื่อเช็คขนาดตัวเลขและเสียงก่อนเปิดร้าน") + " "}</div>
      <Button icon={state.preview ? <CloseOutlined /> : <EyeOutlined />} danger={state.preview}
        disabled={busy || (state.open && !state.preview)} onClick={() => void togglePreview()} style={{ marginTop: 10 }}>
        {state.preview ? posText("ปิดหน้าต่างทดสอบ") : posText("เปิดหน้าต่างทดสอบบนจอนี้")}
      </Button>
    </div>}
    {state.positioningLimited && <div style={{ marginTop: 10, color: "var(--posx-warn-text, #ad6800)", fontSize: 12 }}>
      {posText("Linux Wayland อาจไม่ยอมให้แอปย้ายหน้าต่างอัตโนมัติ หากเปิดผิดจอให้ลากด้วยระบบปฏิบัติการ") + " "}</div>}
    {error && <div role="alert" style={{ marginTop: 10, color: "var(--posx-danger-text, #cf1322)", fontSize: 12 }}>{error}</div>}
  </section>;
}
