"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Select, Switch } from "antd";
import { DesktopOutlined, ReloadOutlined } from "@ant-design/icons";
import type {
  DesktopCustomerDisplayMode,
  DesktopCustomerDisplayState,
} from "@/lib/pos/deviceTokenClient";

function statusText(state: DesktopCustomerDisplayState): string {
  if (state.mode === "off") return "ปิดอยู่";
  if (state.open) {
    const display = state.displays.find((item) => item.id === state.activeDisplayId);
    return `เชื่อมต่อแล้ว · ${display?.label ?? "จอลูกค้า"}`;
  }
  if (state.displays.length < 2) return "ยังไม่พบจอที่สอง";
  if (state.mode === "selected" && !state.targetAvailable) return "จอที่เลือกไม่ได้เชื่อมต่อ";
  return "ยังไม่สามารถเปิดจอลูกค้าได้";
}

export default function CustomerDisplaySettings() {
  const [state, setState] = useState<DesktopCustomerDisplayState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const next = await window.bmsDesktop?.getCustomerDisplayState?.();
      if (next) setState(next);
    } catch { setError("ตรวจสอบจอลูกค้าไม่สำเร็จ"); }
  };

  useEffect(() => {
    void refresh();
    return window.bmsDesktop?.onCustomerDisplayStateChanged?.((next) => setState(next));
  }, []);

  const selectableDisplays = useMemo(
    () => state?.displays.filter((display) => !display.cashier) ?? [],
    [state],
  );

  const configure = async (
    mode: DesktopCustomerDisplayMode,
    targetDisplayId: string | null = null,
  ) => {
    const configureDisplay = window.bmsDesktop?.setCustomerDisplayConfig;
    if (!configureDisplay || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await configureDisplay({ mode, targetDisplayId });
      if (!result.ok) throw new Error(result.error ?? "ตั้งค่าจอลูกค้าไม่สำเร็จ");
      if (result.state) setState(result.state);
      else await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ตั้งค่าจอลูกค้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return <div style={{ color: "var(--posx-muted, #667085)", fontSize: 13 }}>{error || "กำลังตรวจสอบจอที่เชื่อมต่อ…"}</div>;
  }

  return (
    <section style={{
      padding: "14px 0",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>จอลูกค้า</div>
          <div style={{ marginTop: 4, color: "var(--posx-muted, #667085)", fontSize: 12 }}>
            เครื่องขายนี้ใช้จอแคชเชียร์ 1 จอ และจอลูกค้าได้สูงสุด 1 จอ · ตรวจพบ {state.displays.length} จอ
          </div>
        </div>
        <span style={{
          padding: "4px 9px",
          borderRadius: 999,
          color: state.open ? "var(--posx-ok-text, #237804)" : state.mode === "off" ? "var(--posx-muted, #667085)" : "var(--posx-warn-text, #ad6800)",
          background: state.open ? "var(--posx-ok-bg, #f6ffed)" : state.mode === "off" ? "var(--posx-soft, #f2f4f7)" : "var(--posx-warn-bg, #fffbe6)",
          fontSize: 12,
          fontWeight: 600,
        }}>
          {statusText(state)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <label style={{ display: "inline-flex", alignItems: "center", minHeight: 44, gap: 12, cursor: busy ? "wait" : "pointer" }}>
          <Switch aria-label="เปิดจอลูกค้าเมื่อเปิด POS" checked={state.mode !== "off"} loading={busy}
            style={{ flex: "0 0 auto" }}
            onChange={(checked) => void configure(checked ? "auto" : "off")} />
          <span>เปิดจอลูกค้าเมื่อเปิด POS</span>
        </label>
        {state.mode !== "off" && !state.open && state.targetAvailable && (
          <Button
            icon={<ReloadOutlined />}
            disabled={busy}
            onClick={() => void configure(state.mode, state.targetDisplayId)}
          >
            เปิดจอลูกค้าอีกครั้ง
          </Button>
        )}
        <Select
          aria-label="เลือกจอลูกค้า"
          style={{ width: "100%", maxWidth: 400 }}
          value={state.mode === "selected" ? state.targetDisplayId : "auto"}
          disabled={busy || state.mode === "off"}
          onChange={(value) => {
            void configure(value === "auto" ? "auto" : "selected", value === "auto" ? null : value);
          }}
          options={[
            { value: "auto", label: "เลือกจออื่นอัตโนมัติ" },
            ...selectableDisplays.map((display) => ({ value: display.id, label: `${display.label} · ${display.width}×${display.height}` })),
            ...(state.mode === "selected" && !state.targetAvailable ? [{ value: state.targetDisplayId!, label: "จอที่บันทึกไว้ (ไม่ได้เชื่อมต่อ)", disabled: true }] : []),
          ]}
        />
        <Button
          icon={<DesktopOutlined />}
          disabled={busy}
          onClick={() => void window.bmsDesktop?.identifyDisplays?.()}
        >
          ระบุหมายเลขจอ
        </Button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {state.displays.map((display, index) => (
          <span key={display.id} style={{
            padding: "5px 8px",
            border: "1px solid var(--posx-line, #d9e2ef)",
            borderRadius: 8,
            background: "var(--posx-surface, #fff)",
            color: "var(--posx-ink2, #475467)",
            fontSize: 12,
          }}>
            จอ {index + 1}: {display.label} · {display.width}×{display.height}
            {display.cashier ? " · แคชเชียร์" : display.id === state.activeDisplayId ? " · ลูกค้า" : ""}
          </span>
        ))}
      </div>

      {state.positioningLimited && (
        <div style={{ marginTop: 10, color: "var(--posx-warn-text, #ad6800)", fontSize: 12 }}>
          Linux Wayland อาจไม่ยอมให้แอปย้ายหน้าต่างอัตโนมัติ หากเปิดผิดจอให้ลากหน้าต่างไปยังจอลูกค้าด้วยระบบปฏิบัติการ
        </div>
      )}
      {error && <div role="alert" style={{ marginTop: 10, color: "var(--posx-danger-text, #cf1322)", fontSize: 12 }}>{error}</div>}
    </section>
  );
}
