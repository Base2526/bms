"use client";

import { useEffect, useMemo, useState } from "react";
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
    const next = await window.bmsDesktop?.getCustomerDisplayState?.();
    if (next) setState(next);
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
    return <div style={{ color: "#667085", fontSize: 13 }}>กำลังตรวจสอบจอที่เชื่อมต่อ…</div>;
  }

  return (
    <section style={{
      padding: 14,
      border: "1px solid #d9e2ef",
      borderRadius: 12,
      background: "#f8fbff",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>จอลูกค้า</div>
          <div style={{ marginTop: 4, color: "#667085", fontSize: 12 }}>
            เครื่องขายนี้ใช้จอแคชเชียร์ 1 จอ และจอลูกค้าได้สูงสุด 1 จอ · ตรวจพบ {state.displays.length} จอ
          </div>
        </div>
        <span style={{
          padding: "4px 9px",
          borderRadius: 999,
          color: state.open ? "#237804" : state.mode === "off" ? "#667085" : "#ad6800",
          background: state.open ? "#f6ffed" : state.mode === "off" ? "#f2f4f7" : "#fffbe6",
          fontSize: 12,
          fontWeight: 600,
        }}>
          {statusText(state)}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" disabled={busy || state.mode === "off"} onClick={() => void configure("off")}>ปิด</button>
        <button type="button" disabled={busy || state.mode === "auto"} onClick={() => void configure("auto")}>
          เลือกจออื่นอัตโนมัติ
        </button>
        {state.mode !== "off" && !state.open && state.targetAvailable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void configure(state.mode, state.targetDisplayId)}
          >
            เปิดจอลูกค้าอีกครั้ง
          </button>
        )}
        <select
          aria-label="เลือกจอลูกค้า"
          value={state.mode === "selected" ? state.targetDisplayId ?? "" : ""}
          disabled={busy || selectableDisplays.length === 0}
          onChange={(event) => {
            if (event.target.value) void configure("selected", event.target.value);
          }}
        >
          <option value="">เลือกจอลูกค้าเอง…</option>
          {selectableDisplays.map((display) => (
            <option key={display.id} value={display.id}>
              {display.label} · {display.width}×{display.height}{display.primary ? " · จอหลักของระบบ" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => void window.bmsDesktop?.identifyDisplays?.()}
        >
          ระบุหมายเลขจอ
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {state.displays.map((display, index) => (
          <span key={display.id} style={{
            padding: "5px 8px",
            border: "1px solid #d9e2ef",
            borderRadius: 8,
            background: "#fff",
            color: "#475467",
            fontSize: 12,
          }}>
            จอ {index + 1}: {display.label} · {display.width}×{display.height}
            {display.cashier ? " · แคชเชียร์" : display.id === state.activeDisplayId ? " · ลูกค้า" : ""}
          </span>
        ))}
      </div>

      {state.positioningLimited && (
        <div style={{ marginTop: 10, color: "#ad6800", fontSize: 12 }}>
          Linux Wayland อาจไม่ยอมให้แอปย้ายหน้าต่างอัตโนมัติ หากเปิดผิดจอให้ลากหน้าต่างไปยังจอลูกค้าด้วยระบบปฏิบัติการ
        </div>
      )}
      {error && <div role="alert" style={{ marginTop: 10, color: "#cf1322", fontSize: 12 }}>{error}</div>}
    </section>
  );
}
