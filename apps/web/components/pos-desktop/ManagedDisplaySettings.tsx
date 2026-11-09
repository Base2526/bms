"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Select, Switch } from "antd";
import { CloseOutlined, DesktopOutlined, EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import type {
  DesktopCustomerDisplayMode,
  DesktopCustomerDisplayState,
  DesktopExternalDisplayRole,
  DesktopQueueDisplayState,
} from "@/lib/pos/deviceTokenClient";
import QueueBoardPreferenceSettings from "@/components/pos-desktop/QueueBoardPreferenceSettings";

type RoleDefinition = {
  role: DesktopExternalDisplayRole;
  title: string;
  description: string;
  switchLabel: string;
  autoLabel: string;
  previewTitle: string;
  previewDescription: string;
  previewOpenLabel: string;
  previewCloseLabel: string;
};

const ROLES: RoleDefinition[] = [{
  role: "customer",
  title: "จอลูกค้า",
  description: "รายการ ยอดชำระ QR เงินทอน และโปรโมชันตอนจอว่าง",
  switchLabel: "เปิดจอลูกค้าเมื่อเปิด POS",
  autoLabel: "เลือกจออื่นอัตโนมัติ",
  previewTitle: "ทดสอบจอลูกค้าบนจอนี้",
  previewDescription: "ดูรายการและทดสอบ Dynamic QR โดยไม่บันทึกเป็นค่าจอที่สอง · เปิดคู่กับจอเรียกคิวได้",
  previewOpenLabel: "เปิดทดสอบจอลูกค้าบนจอนี้",
  previewCloseLabel: "ปิดทดสอบจอลูกค้า",
}, {
  role: "queue",
  title: "จอเรียกคิว",
  description: "คิวกำลังเตรียม คิวพร้อมรับ spotlight และเสียงเรียก",
  switchLabel: "เปิดจอเรียกคิวเมื่อเปิด POS",
  autoLabel: "เลือกจอว่างอัตโนมัติ",
  previewTitle: "ทดสอบจอเรียกคิวบนจอนี้",
  previewDescription: "เช็กขนาดตัวเลขและเสียง โดยไม่บันทึกหรือเปิดเองครั้งถัดไป · เปิดคู่กับจอลูกค้าได้",
  previewOpenLabel: "เปิดทดสอบจอเรียกคิวบนจอนี้",
  previewCloseLabel: "ปิดทดสอบจอเรียกคิว",
}];

function roleStatus(state: DesktopCustomerDisplayState, fallback: string): string {
  if (state.preview && state.open) return "กำลังทดสอบบนจอนี้";
  if (state.mode === "off") return "ปิดอยู่";
  if (state.open) {
    const display = state.displays.find((item) => item.id === state.activeDisplayId);
    return `เชื่อมต่อแล้ว · ${display?.label ?? fallback}`;
  }
  if (state.conflict) return "จอที่เลือกถูกใช้งานแล้ว";
  if (state.displays.length < 2) return "ยังไม่พบจอเพิ่มเติม";
  if (state.mode === "selected" && !state.targetAvailable) return "จอที่เลือกไม่ได้เชื่อมต่อ";
  return "รอจอที่ว่าง";
}

export default function ManagedDisplaySettings() {
  const [customer, setCustomer] = useState<DesktopCustomerDisplayState | null>(null);
  const [queue, setQueue] = useState<DesktopQueueDisplayState | null>(null);
  const [busy, setBusy] = useState<DesktopExternalDisplayRole | "identify" | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const [nextCustomer, nextQueue] = await Promise.all([
        window.bmsDesktop?.getCustomerDisplayState?.(),
        window.bmsDesktop?.getQueueDisplayState?.(),
      ]);
      if (nextCustomer) setCustomer(nextCustomer);
      if (nextQueue) setQueue(nextQueue);
    } catch {
      setError("ตรวจสอบจอภายนอกไม่สำเร็จ");
    }
  };

  useEffect(() => {
    void refresh();
    const offCustomer = window.bmsDesktop?.onCustomerDisplayStateChanged?.(setCustomer);
    const offQueue = window.bmsDesktop?.onQueueDisplayStateChanged?.(setQueue);
    return () => { offCustomer?.(); offQueue?.(); };
  }, []);

  const displays = customer?.displays ?? queue?.displays ?? [];
  const externalDisplays = useMemo(() => displays.filter((display) => !display.cashier), [displays]);

  const configure = async (
    role: DesktopExternalDisplayRole,
    mode: DesktopCustomerDisplayMode,
    targetDisplayId: string | null = null,
  ) => {
    if (busy) return;
    setBusy(role);
    setError("");
    try {
      const managed = window.bmsDesktop?.setExternalDisplayRole;
      if (!managed) throw new Error("กรุณาอัปเดต BMS POS Desktop ก่อนตั้งค่าจอเรียกคิว");
      const result = await managed({ role, mode, targetDisplayId });
      if (!result.ok) throw new Error(result.error ?? "ตั้งค่าจอภายนอกไม่สำเร็จ");
      if (result.state) {
        setCustomer(result.state.customer);
        setQueue(result.state.queue);
      } else {
        await refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ตั้งค่าจอภายนอกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  const togglePreview = async (role: DesktopExternalDisplayRole) => {
    const state = role === "customer" ? customer : queue;
    if (!state || busy) return;
    setBusy(role);
    setError("");
    try {
      const action = role === "customer"
        ? state.preview ? window.bmsDesktop?.closeCustomerDisplayPreview : window.bmsDesktop?.openCustomerDisplayPreview
        : state.preview ? window.bmsDesktop?.closeQueueDisplayPreview : window.bmsDesktop?.openQueueDisplayPreview;
      if (!action) throw new Error("Desktop รุ่นนี้ยังไม่รองรับหน้าต่างทดสอบ");
      const result = await action();
      if (!result.ok) throw new Error(result.error ?? "เปิดหน้าต่างทดสอบไม่สำเร็จ");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เปิดหน้าต่างทดสอบไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  if (!customer || !queue) {
    return <div style={{ color: "var(--posx-muted, #667085)", fontSize: 13 }}>{error || "กำลังตรวจสอบจอภายนอก…"}</div>;
  }

  const states = { customer, queue };
  return <section data-managed-display-settings style={{ padding: "14px 0" }}>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontWeight: 700 }}>จอภายนอก</div>
        <div style={{ marginTop: 4, color: "var(--posx-muted, #667085)", fontSize: 12 }}>
          จอแคชเชียร์ 1 จอ · จอลูกค้าหรือจอเรียกคิว {externalDisplays.length} จอ · ตรวจพบทั้งหมด {displays.length} จอ
        </div>
      </div>
      <Button icon={<DesktopOutlined />} loading={busy === "identify"} onClick={async () => {
        setBusy("identify");
        try { await window.bmsDesktop?.identifyDisplays?.(); }
        finally { setBusy(null); }
      }}>ระบุหมายเลขจอ</Button>
    </div>

    {externalDisplays.length === 1 && <div style={{
      marginTop: 10, padding: "8px 10px", borderRadius: 8,
      color: "var(--posx-warn-text, #ad6800)", background: "var(--posx-warn-bg, #fffbe6)", fontSize: 12,
    }}>
      โหมดจอจริงมีจอภายนอกหนึ่งจอ: เปิดได้ครั้งละหนึ่งหน้า และสลับบทบาทให้อัตโนมัติ · หน้าต่างทดสอบเปิดคู่กันได้
    </div>}

    {ROLES.map((definition) => {
      const state = states[definition.role];
      const other = states[definition.role === "customer" ? "queue" : "customer"];
      const roleBusy = busy === definition.role;
      return <div key={definition.role} data-display-role={definition.role} style={{
        marginTop: 12, padding: 12, border: "1px solid var(--posx-line, #d9e2ef)",
        borderRadius: 10, background: "var(--posx-surface, #fff)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div><strong>{definition.title}</strong><div style={{ marginTop: 3, color: "var(--posx-muted, #667085)", fontSize: 12 }}>{definition.description}</div></div>
          <span style={{ padding: "4px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600,
            color: state.open ? "var(--posx-ok-text, #237804)" : state.mode === "off" ? "var(--posx-muted, #667085)" : "var(--posx-warn-text, #ad6800)",
            background: state.open ? "var(--posx-ok-bg, #f6ffed)" : state.mode === "off" ? "var(--posx-soft, #f2f4f7)" : "var(--posx-warn-bg, #fffbe6)" }}>
            {roleStatus(state, definition.title)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <label style={{ display: "inline-flex", alignItems: "center", minHeight: 44, gap: 10, cursor: busy ? "wait" : "pointer" }}>
            <Switch aria-label={definition.switchLabel} checked={state.mode !== "off"} loading={roleBusy}
              onChange={(checked) => void configure(definition.role, checked ? "auto" : "off")} />
            <span>{definition.switchLabel}</span>
          </label>
          {state.mode !== "off" && !state.open && state.targetAvailable && <Button icon={<ReloadOutlined />} disabled={Boolean(busy)}
            onClick={() => void configure(definition.role, state.mode, state.targetDisplayId)}>เปิดจออีกครั้ง</Button>}
          <Select aria-label={`เลือก${definition.title}`} style={{ width: "100%", maxWidth: 390 }}
            value={state.mode === "selected" ? state.targetDisplayId : "auto"} disabled={Boolean(busy) || state.mode === "off"}
            onChange={(value) => void configure(definition.role, value === "auto" ? "auto" : "selected", value === "auto" ? null : value)}
            options={[{ value: "auto", label: definition.autoLabel }, ...externalDisplays.map((display) => {
              const usedByOther = !other.preview && other.open && display.id === other.activeDisplayId;
              return { value: display.id, label: `${display.label} · ${display.width}×${display.height}${usedByOther ? " · จะสลับจากอีกหน้าที่" : ""}` };
            }), ...(state.mode === "selected" && !state.targetAvailable
              ? [{ value: state.targetDisplayId!, label: "จอที่บันทึกไว้ (ไม่ได้เชื่อมต่อ)", disabled: true }] : [])]} />
        </div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--posx-line, #d9e2ef)" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{definition.previewTitle}</div>
          <div style={{ marginTop: 3, color: "var(--posx-muted, #667085)", fontSize: 12 }}>{definition.previewDescription}</div>
          <Button icon={state.preview ? <CloseOutlined /> : <EyeOutlined />} danger={state.preview}
            disabled={Boolean(busy) || (state.open && !state.preview)} onClick={() => void togglePreview(definition.role)} style={{ marginTop: 8 }}>
            {state.preview ? definition.previewCloseLabel : definition.previewOpenLabel}
          </Button>
        </div>
        {definition.role === "queue" && <div style={{ marginTop: 10 }}>
          <QueueBoardPreferenceSettings />
        </div>}
      </div>;
    })}

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
      {displays.map((display, index) => {
        const customerHere = !customer.preview && customer.open && display.id === customer.activeDisplayId;
        const queueHere = !queue.preview && queue.open && display.id === queue.activeDisplayId;
        return <span key={display.id} style={{ padding: "5px 8px", border: "1px solid var(--posx-line, #d9e2ef)", borderRadius: 8,
          background: "var(--posx-surface, #fff)", color: "var(--posx-ink2, #475467)", fontSize: 12 }}>
          จอ {index + 1}: {display.label} · {display.width}×{display.height}
          {display.cashier ? " · แคชเชียร์" : customerHere ? " · ลูกค้า" : queueHere ? " · เรียกคิว" : " · ว่าง"}
        </span>;
      })}
    </div>
    {(customer.positioningLimited || queue.positioningLimited) && <div style={{ marginTop: 10, color: "var(--posx-warn-text, #ad6800)", fontSize: 12 }}>
      Linux Wayland อาจไม่ยอมให้แอปย้ายหน้าต่างอัตโนมัติ หากเปิดผิดจอให้ลากด้วยระบบปฏิบัติการ
    </div>}
    {error && <div role="alert" style={{ marginTop: 10, color: "var(--posx-danger-text, #cf1322)", fontSize: 12 }}>{error}</div>}
  </section>;
}
