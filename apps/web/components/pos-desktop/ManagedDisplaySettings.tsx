"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Select, Switch } from "antd";
import { CloseOutlined, DesktopOutlined, EyeOutlined, InfoCircleOutlined, ReloadOutlined } from "@ant-design/icons";
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
  description: "แสดงรายการ ยอดชำระ QR เงินทอน และโปรโมชัน",
  switchLabel: "เปิดจอลูกค้าเมื่อเปิด POS",
  autoLabel: "เลือกจออื่นอัตโนมัติ",
  previewTitle: "ทดสอบจอลูกค้าบนจอนี้",
  previewDescription: "ดูรายการและทดสอบ Dynamic QR โดยไม่บันทึกเป็นค่าจอที่สอง · เปิดคู่กับจอเรียกคิวได้",
  previewOpenLabel: "เปิดทดสอบจอลูกค้าบนจอนี้",
  previewCloseLabel: "ปิดทดสอบจอลูกค้า",
}, {
  role: "queue",
  title: "จอเรียกคิว",
  description: "แสดงคิวที่กำลังเตรียม คิวพร้อมรับ และเสียงเรียก",
  switchLabel: "เปิดจอเรียกคิวเมื่อเปิด POS",
  autoLabel: "เลือกจอว่างอัตโนมัติ",
  previewTitle: "ทดสอบจอเรียกคิวบนจอนี้",
  previewDescription: "เช็กขนาดตัวเลขและเสียง โดยไม่บันทึกหรือเปิดเองครั้งถัดไป · เปิดคู่กับจอลูกค้าได้",
  previewOpenLabel: "เปิดทดสอบจอเรียกคิวบนจอนี้",
  previewCloseLabel: "ปิดทดสอบจอเรียกคิว",
}];

function roleStatus(state: DesktopCustomerDisplayState, fallback: string): string {
  if (state.preview && state.open) return "กำลังทดสอบบนจอนี้";
  if (state.mode === "off") return "ยังไม่เปิด";
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
  const cashierDisplayCount = Math.max(1, displays.filter((display) => display.cashier).length);
  const activeCustomerDisplayCount = customer?.open && !customer.preview ? 1 : 0;
  const activeQueueDisplayCount = queue?.open && !queue.preview ? 1 : 0;

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
  return <section data-managed-display-settings className="pos-settings-section pos-settings-section--displays">
    <header className="pos-settings-section-head">
      <div>
        <h2>จอภายนอก</h2>
        <p>จัดการจอลูกค้าและจอเรียกคิวของเครื่องขายนี้</p>
      </div>
    </header>

    <div className="pos-display-overview">
      <div className="pos-display-overview-title"><DesktopOutlined /><strong>จอภายนอก</strong></div>
      <div className="pos-display-metric"><span>จอแคชเชียร์</span><strong>{cashierDisplayCount} จอ</strong></div>
      <div className="pos-display-metric"><span>จอลูกค้า</span><strong>{activeCustomerDisplayCount} จอ</strong></div>
      <div className="pos-display-metric"><span>จอเรียกคิว</span><strong>{activeQueueDisplayCount} จอ</strong></div>
      <Button className="pos-display-identify" icon={<DesktopOutlined />} loading={busy === "identify"} onClick={async () => {
        setBusy("identify");
        try { await window.bmsDesktop?.identifyDisplays?.(); }
        finally { setBusy(null); }
      }}>ระบุหมายเลขจอ</Button>
    </div>

    {externalDisplays.length === 1 && <div className="pos-settings-inline-warning">
      โหมดจอจริงมีจอภายนอกหนึ่งจอ: เปิดได้ครั้งละหนึ่งหน้า และสลับบทบาทให้อัตโนมัติ · หน้าต่างทดสอบเปิดคู่กันได้
    </div>}

    <div className="pos-display-role-list">
    {ROLES.map((definition) => {
      const state = states[definition.role];
      const other = states[definition.role === "customer" ? "queue" : "customer"];
      const roleBusy = busy === definition.role;
      return <article key={definition.role} data-display-role={definition.role} className="pos-display-role-card">
        <div className="pos-display-role-head">
          <div><h3>{definition.title}</h3><p>{definition.description}</p></div>
          <span className="pos-settings-status" data-tone={state.open ? "ready" : state.mode === "off" ? "muted" : "warning"}>
            {roleStatus(state, definition.title)}
          </span>
        </div>
        <div className="pos-display-role-controls">
          <label className="pos-display-toggle-field" style={{ cursor: busy ? "wait" : "pointer" }}>
            <span className="pos-settings-field-label">เปิดใช้งาน</span>
            <span className="pos-display-toggle-control">
            <Switch aria-label={definition.switchLabel} checked={state.mode !== "off"} loading={roleBusy}
              onChange={(checked) => void configure(definition.role, checked ? "auto" : "off")} />
              <span className="pos-display-toggle-copy">{state.mode === "off" ? "ปิด" : "เปิด"}</span>
            </span>
          </label>
          <label className="pos-display-select-field">
            <span className="pos-settings-field-label">จอที่ใช้</span>
            <Select aria-label={`เลือก${definition.title}`} className="pos-display-select"
            value={state.mode === "selected" ? state.targetDisplayId : "auto"} disabled={Boolean(busy) || state.mode === "off"}
            onChange={(value) => void configure(definition.role, value === "auto" ? "auto" : "selected", value === "auto" ? null : value)}
            options={[{ value: "auto", label: definition.autoLabel }, ...externalDisplays.map((display) => {
              const usedByOther = !other.preview && other.open && display.id === other.activeDisplayId;
              return { value: display.id, label: `${display.label} · ${display.width}×${display.height}${usedByOther ? " · จะสลับจากอีกหน้าที่" : ""}` };
            }), ...(state.mode === "selected" && !state.targetAvailable
              ? [{ value: state.targetDisplayId!, label: "จอที่บันทึกไว้ (ไม่ได้เชื่อมต่อ)", disabled: true }] : [])]} />
          </label>
          <Button icon={state.preview ? <CloseOutlined /> : <EyeOutlined />} danger={state.preview}
            aria-label={state.preview ? definition.previewCloseLabel : definition.previewOpenLabel}
            className="pos-display-preview-button"
            disabled={Boolean(busy) || (state.open && !state.preview)} onClick={() => void togglePreview(definition.role)}>
            {state.preview ? "ปิดการทดสอบ" : "ทดสอบจอ"}
          </Button>
        </div>
        <div className="pos-display-role-foot">
          <span>{definition.previewDescription}</span>
          {state.mode !== "off" && !state.open && state.targetAvailable && <Button icon={<ReloadOutlined />} disabled={Boolean(busy)}
            onClick={() => void configure(definition.role, state.mode, state.targetDisplayId)}>เปิดจออีกครั้ง</Button>}
        </div>
        {definition.role === "queue" && <details className="pos-display-advanced">
          <summary><span>ตั้งค่ารูปแบบและเสียง</span><small>รูปแบบหน้าจอ เสียงเรียก และระดับเสียง</small></summary>
          <div className="pos-display-advanced-body"><QueueBoardPreferenceSettings /></div>
        </details>}
      </article>;
    })}
    </div>

    <div className="pos-settings-info-note">
      <InfoCircleOutlined />
      <span>การทดสอบจอไม่บันทึกเป็นค่าจอที่สอง และปิดได้ทันที</span>
    </div>

    <details className="pos-display-diagnostics">
      <summary>รายละเอียดจอที่ตรวจพบ ({displays.length})</summary>
      <div className="pos-display-chip-list">{displays.map((display, index) => {
        const customerHere = !customer.preview && customer.open && display.id === customer.activeDisplayId;
        const queueHere = !queue.preview && queue.open && display.id === queue.activeDisplayId;
        return <span key={display.id}>
          จอ {index + 1}: {display.label} · {display.width}×{display.height}
          {display.cashier ? " · แคชเชียร์" : customerHere ? " · ลูกค้า" : queueHere ? " · เรียกคิว" : " · ว่าง"}
        </span>;
      })}</div>
    </details>
    {(customer.positioningLimited || queue.positioningLimited) && <div style={{ marginTop: 10, color: "var(--posx-warn-text, #ad6800)", fontSize: 12 }}>
      Linux Wayland อาจไม่ยอมให้แอปย้ายหน้าต่างอัตโนมัติ หากเปิดผิดจอให้ลากด้วยระบบปฏิบัติการ
    </div>}
    {error && <div role="alert" style={{ marginTop: 10, color: "var(--posx-danger-text, #cf1322)", fontSize: 12 }}>{error}</div>}
  </section>;
}
