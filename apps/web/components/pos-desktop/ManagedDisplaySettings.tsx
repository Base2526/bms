"use client";

import { usePosText, thaiPosText, type PosTranslator } from "@/lib/pos/usePosText";

import { useEffect, useMemo, useState } from "react";
import { Button, Select, Switch } from "antd";
import { CloseOutlined, DesktopOutlined, EyeOutlined, InfoCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type {
  DesktopCustomerDisplayMode,
  DesktopCustomerDisplayState,
  DesktopExternalDisplayRole,
  DesktopQueueDisplayState,
} from "@/lib/pos/deviceTokenClient";
import { posDeviceStorageNamespace, readPosDeviceToken } from "@/lib/pos/deviceTokenClient";
import { QUEUE_BOARD_LAYOUTS, clearQueueBoardLayoutOverride, readQueueBoardLayoutOverride, writeQueueBoardLayout,
  type QueueBoardLayout } from "@/lib/pos/queueBoardLayoutPreference";
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

const ROLES = (posText: PosTranslator = thaiPosText): RoleDefinition[] => ([{
  role: "customer",
  title: posText("จอลูกค้า"),
  description: posText("แสดงรายการ ยอดชำระ QR เงินทอน และโปรโมชัน"),
  switchLabel: posText("เปิดจอลูกค้าเมื่อเปิด POS"),
  autoLabel: posText("เลือกจออื่นอัตโนมัติ"),
  previewTitle: posText("ทดสอบจอลูกค้าบนจอนี้"),
  previewDescription: posText("ดูรายการและทดสอบ Dynamic QR โดยไม่บันทึกเป็นค่าจอที่สอง · เปิดคู่กับจอเรียกคิวได้"),
  previewOpenLabel: posText("เปิดทดสอบจอลูกค้าบนจอนี้"),
  previewCloseLabel: posText("ปิดทดสอบจอลูกค้า"),
}, {
  role: "queue",
  title: posText("จอเรียกคิว"),
  description: posText("แสดงคิวที่กำลังเตรียม คิวพร้อมรับ และเสียงเรียก"),
  switchLabel: posText("เปิดจอเรียกคิวเมื่อเปิด POS"),
  autoLabel: posText("เลือกจอว่างอัตโนมัติ"),
  previewTitle: posText("ทดสอบจอเรียกคิวบนจอนี้"),
  previewDescription: posText("เช็กขนาดตัวเลขโดยไม่บันทึกหรือเปิดเองครั้งถัดไป · หน้าต่างทดสอบปิดเสียง และเปิดคู่กับจอลูกค้าได้"),
  previewOpenLabel: posText("เปิดทดสอบจอเรียกคิวบนจอนี้"),
  previewCloseLabel: posText("ปิดทดสอบจอเรียกคิว"),
}]);

function roleStatus(state: DesktopCustomerDisplayState, fallback: string, posText: PosTranslator = thaiPosText): string {
  if (state.preview && state.open) return posText("กำลังทดสอบบนจอนี้");
  if (state.mode === "off") return posText("ยังไม่เปิด");
  if (state.open) {
    const display = state.displays.find((item) => item.id === state.activeDisplayId);
    return posText("เชื่อมต่อแล้ว · {v0}", { v0: display?.label ?? fallback });
  }
  if (state.conflict) return posText("จอที่เลือกถูกใช้งานแล้ว");
  if (state.displays.length < 2) return posText("ยังไม่พบจอเพิ่มเติม");
  if (state.mode === "selected" && !state.targetAvailable) return posText("จอที่เลือกไม่ได้เชื่อมต่อ");
  return posText("รอจอที่ว่าง");
}

export default function ManagedDisplaySettings() {
  const posText = usePosText();
  const [customer, setCustomer] = useState<DesktopCustomerDisplayState | null>(null);
  const [queue, setQueue] = useState<DesktopQueueDisplayState | null>(null);
  const [busy, setBusy] = useState<DesktopExternalDisplayRole | "identify" | null>(null);
  const [error, setError] = useState("");
  const [storageNamespace, setStorageNamespace] = useState("");
  const [, setLayoutRevision] = useState(0);

  const refresh = async () => {
    try {
      const [nextCustomer, nextQueue] = await Promise.all([
        window.bmsDesktop?.getCustomerDisplayState?.(),
        window.bmsDesktop?.getQueueDisplayState?.(),
      ]);
      if (nextCustomer) setCustomer(nextCustomer);
      if (nextQueue) setQueue(nextQueue);
    } catch {
      setError(posText("ตรวจสอบจอภายนอกไม่สำเร็จ"));
    }
  };

  useEffect(() => {
    void refresh();
    const offCustomer = window.bmsDesktop?.onCustomerDisplayStateChanged?.(setCustomer);
    const offQueue = window.bmsDesktop?.onQueueDisplayStateChanged?.(setQueue);
    return () => { offCustomer?.(); offQueue?.(); };
  }, []);

  useEffect(() => {
    let active = true;
    void readPosDeviceToken().then((token) => token ? posDeviceStorageNamespace(token) : "")
      .then((namespace) => { if (active) setStorageNamespace(namespace); });
    return () => { active = false; };
  }, []);

  const displays = customer?.displays ?? queue?.displays ?? [];
  const externalDisplays = useMemo(() => displays.filter((display) => !display.cashier), [displays]);
  const freeExternalCount = externalDisplays.filter((display) =>
    !customer?.open || customer.preview || display.id !== customer.activeDisplayId).length;
  const autoQueueChoices = Array.from({ length: Math.min(queue?.maxDisplays ?? 32,
    Math.max(1, freeExternalCount, queue?.mode === "auto" ? queue.displayCount ?? 1 : 1)) },
  (_, index) => index + 1);
  const cashierDisplayCount = Math.max(1, displays.filter((display) => display.cashier).length);
  const activeCustomerDisplayCount = customer?.open && !customer.preview ? 1 : 0;
  const activeQueueDisplayCount = queue?.activeDisplayIds?.length ?? (queue?.open && !queue.preview ? 1 : 0);
  const multiQueueSupported = Boolean(queue?.maxDisplays && typeof window !== "undefined"
    && window.bmsDesktop?.setQueueDisplaysConfig);

  const configureQueue = async (change: Partial<{
    mode: DesktopCustomerDisplayMode;
    displayCount: number;
    targetDisplayIds: string[];
    audioDisplayId: string | null;
  }>) => {
    if (!queue || busy || !window.bmsDesktop?.setQueueDisplaysConfig) return;
    const mode = change.mode ?? queue.mode;
    let targetDisplayIds = change.targetDisplayIds ?? queue.targetDisplayIds ?? [];
    if (mode === "selected" && targetDisplayIds.length === 0) {
      // A single external screen can be handed over from the customer display.
      const available = externalDisplays.find((display) => display.id !== customer?.activeDisplayId)
        ?? externalDisplays[0];
      targetDisplayIds = available ? [available.id] : [];
    }
    if (mode === "selected" && targetDisplayIds.length === 0) {
      setError(posText("ยังไม่มีจอภายนอกให้เลือก"));
      return;
    }
    const preferredAudio = change.audioDisplayId === undefined
      ? change.mode && change.mode !== queue.mode ? null : queue.preferredAudioDisplayId ?? null
      : change.audioDisplayId;
    const audioDisplayId = mode === "selected" && preferredAudio && !targetDisplayIds.includes(preferredAudio)
      ? null : preferredAudio;
    const displayCount = change.displayCount ?? (mode === "auto" && queue.mode !== "auto"
      ? Math.min(queue.displayCount ?? 1, Math.max(1, freeExternalCount))
      : queue.displayCount ?? 1);
    setBusy("queue");
    setError("");
    try {
      const result = await window.bmsDesktop.setQueueDisplaysConfig({
        mode,
        displayCount,
        targetDisplayIds: mode === "selected" ? targetDisplayIds : [],
        audioDisplayId: mode === "off" ? null : audioDisplayId,
      });
      if (!result.ok) throw new Error(result.error ?? posText("ตั้งค่าจอเรียกคิวไม่สำเร็จ"));
      if (result.state) { setCustomer(result.state.customer); setQueue(result.state.queue); }
      else await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : posText("ตั้งค่าจอเรียกคิวไม่สำเร็จ"));
    } finally { setBusy(null); }
  };

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
      if (!managed) throw new Error(posText("กรุณาอัปเดต BMS POS Desktop ก่อนตั้งค่าจอเรียกคิว"));
      const result = await managed({ role, mode, targetDisplayId });
      if (!result.ok) throw new Error(result.error ?? posText("ตั้งค่าจอภายนอกไม่สำเร็จ"));
      if (result.state) {
        setCustomer(result.state.customer);
        setQueue(result.state.queue);
      } else {
        await refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : posText("ตั้งค่าจอภายนอกไม่สำเร็จ"));
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
      if (!action) throw new Error(posText("Desktop รุ่นนี้ยังไม่รองรับหน้าต่างทดสอบ"));
      const result = await action();
      if (!result.ok) throw new Error(result.error ?? posText("เปิดหน้าต่างทดสอบไม่สำเร็จ"));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : posText("เปิดหน้าต่างทดสอบไม่สำเร็จ"));
    } finally {
      setBusy(null);
    }
  };

  if (!customer || !queue) {
    return <div style={{ color: "var(--posx-muted, #667085)", fontSize: 13 }}>{error || posText("กำลังตรวจสอบจอภายนอก…")}</div>;
  }

  const states = { customer, queue };
  return <section data-managed-display-settings className="pos-settings-section pos-settings-section--displays">
    <header className="pos-settings-section-head">
      <div>
        <h2>{posText("จอภายนอก")}</h2>
        <p>{posText("จัดการจอลูกค้าและจอเรียกคิวของเครื่องขายนี้")}</p>
      </div>
    </header>

    <div className="pos-display-overview">
      <div className="pos-display-overview-title"><DesktopOutlined /><strong>{posText("จอภายนอก")}</strong></div>
      <div className="pos-display-metric"><span>{posText("จอแคชเชียร์")}</span><strong>{cashierDisplayCount} {" " + posText("จอ")}</strong></div>
      <div className="pos-display-metric"><span>{posText("จอลูกค้า")}</span><strong>{activeCustomerDisplayCount} {" " + posText("จอ")}</strong></div>
      <div className="pos-display-metric"><span>{posText("จอเรียกคิว")}</span><strong>{activeQueueDisplayCount} {" " + posText("จอ")}</strong></div>
      <Button className="pos-display-identify" icon={<DesktopOutlined />} loading={busy === "identify"} onClick={async () => {
        setBusy("identify");
        try { await window.bmsDesktop?.identifyDisplays?.(); }
        finally { setBusy(null); }
      }}>{posText("ระบุหมายเลขจอ")}</Button>
    </div>

    {externalDisplays.length === 1 && <div className="pos-settings-inline-warning">
      {posText("โหมดจอจริงมีจอภายนอกหนึ่งจอ: เปิดได้ครั้งละหนึ่งหน้า และสลับบทบาทให้อัตโนมัติ · หน้าต่างทดสอบเปิดคู่กันได้") + " "}</div>}

    <div className="pos-display-role-list">
    {ROLES(posText).map((definition) => {
      const state = states[definition.role];
      const other = states[definition.role === "customer" ? "queue" : "customer"];
      const roleBusy = busy === definition.role;
      return <article key={definition.role} data-display-role={definition.role} className="pos-display-role-card">
        <div className="pos-display-role-head">
          <div><h3>{definition.title}</h3><p>{definition.description}</p></div>
          <span className="pos-settings-status" data-tone={state.open ? "ready" : state.mode === "off" ? "muted" : "warning"}>
            {definition.role === "queue" && multiQueueSupported && state.mode !== "off" && !state.preview
              ? posText("จอคิวที่เปิด {v0}/{v1} จอ", {
                v0: queue.activeDisplayIds?.length ?? 0, v1: queue.displayCount ?? 1,
              })
              : roleStatus(state, definition.title, posText)}
          </span>
        </div>
        <div className="pos-display-role-controls">
          <label className="pos-display-toggle-field" style={{ cursor: busy ? "wait" : "pointer" }}>
            <span className="pos-settings-field-label">{posText("เปิดใช้งาน")}</span>
            <span className="pos-display-toggle-control">
            <Switch aria-label={definition.switchLabel} checked={state.mode !== "off"} loading={roleBusy}
              onChange={(checked) => void (definition.role === "queue" && multiQueueSupported
                ? configureQueue({ mode: checked ? "auto" : "off" })
                : configure(definition.role, checked ? "auto" : "off"))} />
              <span className="pos-display-toggle-copy">{state.mode === "off" ? posText("ปิด") : posText("เปิด")}</span>
            </span>
          </label>
          {definition.role !== "queue" || !multiQueueSupported ? <label className="pos-display-select-field">
            <span className="pos-settings-field-label">{posText("จอที่ใช้")}</span>
            <Select aria-label={posText("เลือก{v0}", { v0: definition.title })} className="pos-display-select"
            value={state.mode === "selected" ? state.targetDisplayId : "auto"} disabled={Boolean(busy) || state.mode === "off"}
            onChange={(value) => void configure(definition.role, value === "auto" ? "auto" : "selected", value === "auto" ? null : value)}
            options={[{ value: "auto", label: definition.autoLabel }, ...externalDisplays.map((display) => {
              const usedByOther = !other.preview && other.open && display.id === other.activeDisplayId;
              return { value: display.id, label: `${display.label} · ${display.width}×${display.height}${usedByOther ? posText(" · จะสลับจากอีกหน้าที่") : ""}` };
            }), ...(state.mode === "selected" && !state.targetAvailable
              ? [{ value: state.targetDisplayId!, label: posText("จอที่บันทึกไว้ (ไม่ได้เชื่อมต่อ)"), disabled: true }] : [])]} />
          </label> : <div className="pos-display-select-field">
            <span className="pos-settings-field-label">{posText("วิธีเลือกจอคิว")}</span>
            <Select aria-label={posText("วิธีเลือกจอคิว")} className="pos-display-select"
              value={queue.mode === "selected" ? "selected" : "auto"}
              disabled={Boolean(busy) || queue.mode === "off"}
              onChange={(value) => void configureQueue({ mode: value === "selected" ? "selected" : "auto" })}
              options={[{ value: "auto", label: posText("เลือกจอว่างอัตโนมัติ") },
                { value: "selected", label: posText("เลือกจอเอง") }]} />
          </div>}
          <Button icon={state.preview ? <CloseOutlined /> : <EyeOutlined />} danger={state.preview}
            aria-label={state.preview ? definition.previewCloseLabel : definition.previewOpenLabel}
            className="pos-display-preview-button"
            disabled={Boolean(busy) || (state.open && !state.preview && !(definition.role === "queue" && multiQueueSupported))}
            onClick={() => void togglePreview(definition.role)}>
            {state.preview ? posText("ปิดการทดสอบ") : posText("ทดสอบจอ")}
          </Button>
        </div>
        {definition.role === "queue" && multiQueueSupported && queue.mode !== "off" && <div className="pos-display-multi-queue">
          {queue.mode === "auto" ? <label className="pos-display-select-field">
            <span className="pos-settings-field-label">{posText("จำนวนจอคิวที่ต้องการ")}</span>
            <Select aria-label={posText("จำนวนจอคิวที่ต้องการ")} className="pos-display-select"
              value={queue.displayCount ?? 1} disabled={Boolean(busy)}
              onChange={(value) => void configureQueue({ displayCount: value, audioDisplayId: null })}
              options={autoQueueChoices.map((count) => ({ value: count, label: posText("{v0} จอ", { v0: count }) }))} />
          </label> : <label className="pos-display-select-field">
            <span className="pos-settings-field-label">{posText("เลือกจอคิวจากจอภายนอกที่ตรวจพบ")}</span>
            <Select mode="multiple" aria-label={posText("เลือกจอคิวจากจอภายนอกที่ตรวจพบ")}
              className="pos-display-select" value={queue.targetDisplayIds ?? []} disabled={Boolean(busy)}
              onChange={(ids) => void configureQueue(ids.length ? { targetDisplayIds: ids } : { mode: "off" })}
              options={[...externalDisplays.map((display) => ({ value: display.id,
                label: `${display.label} · ${display.width}×${display.height}${display.id === customer?.activeDisplayId ? posText(" · จะสลับจากอีกหน้าที่") : ""}` })),
                ...(queue.targetDisplayIds ?? []).filter((id) => !externalDisplays.some((display) => display.id === id))
                  .map((id) => ({ value: id, label: posText("จอที่บันทึกไว้ (ไม่ได้เชื่อมต่อ)") }))]} />
          </label>}
          <label className="pos-display-select-field">
            <span className="pos-settings-field-label">{posText("จอที่ประกาศเสียง")}</span>
            <Select aria-label={posText("จอที่ประกาศเสียง")} className="pos-display-select"
              value={queue.preferredAudioDisplayId ?? "auto"} disabled={Boolean(busy)}
              onChange={(id) => void configureQueue({ audioDisplayId: id === "auto" ? null : id })}
              options={[{ value: "auto", label: posText("จอคิวที่เปิดอยู่จอแรก") },
                ...(queue.screens ?? []).filter((screen) => screen.connected && screen.open).map((screen) => ({
                  value: screen.id, label: screen.label,
                })), ...(queue.preferredAudioDisplayId && !queue.screens?.some((screen) =>
                  screen.id === queue.preferredAudioDisplayId && screen.open)
                  ? [{ value: queue.preferredAudioDisplayId, label: posText("จอเสียงที่บันทึกไว้ (ไม่ได้เปิด)"), disabled: true }]
                  : [])]} />
          </label>
          <div className="pos-display-multi-queue-list">
            {(queue.screens ?? []).map((screen) => <div key={screen.id} className="pos-display-multi-queue-row">
              <span><strong>{screen.label}</strong><small>{screen.open
                ? posText("เปิดอยู่") : screen.connected ? posText("รอเปิดจอ") : posText("รอเชื่อมต่อจอ")}
                {screen.audio ? ` · ${posText("ประกาศเสียง")}` : ""}</small></span>
              {screen.connected && <Select aria-label={posText("รูปแบบจอ {v0}", { v0: screen.label })}
                value={storageNamespace ? readQueueBoardLayoutOverride(storageNamespace, screen.id) ?? "DEFAULT" : "DEFAULT"}
                disabled={!storageNamespace} style={{ width: 220, maxWidth: "100%" }}
                onChange={(value: QueueBoardLayout | "DEFAULT") => {
                  if (value === "DEFAULT") clearQueueBoardLayoutOverride(storageNamespace, screen.id);
                  else writeQueueBoardLayout(storageNamespace, value, screen.id);
                  setLayoutRevision((current) => current + 1);
                }}
                options={[{ value: "DEFAULT", label: posText("ตามรูปแบบเริ่มต้น") },
                  ...QUEUE_BOARD_LAYOUTS.map((option) => ({ value: option.value, label: posText(option.label) }))]} />}
            </div>)}
          </div>
          {(queue.activeDisplayIds?.length ?? 0) < (queue.displayCount ?? 1) &&
            <div className="pos-settings-inline-warning">{posText("กำลังรอจอคิวอีก {v0} จอ", {
              v0: (queue.displayCount ?? 1) - (queue.activeDisplayIds?.length ?? 0),
            })}{" "}<Button size="small" disabled={Boolean(busy)} onClick={() => void configureQueue({})}>
              {posText("เปิดจออีกครั้ง")}</Button></div>}
        </div>}
        <div className="pos-display-role-foot">
          <span>{definition.role === "queue" && !multiQueueSupported
            ? posText("เช็กขนาดตัวเลขและเสียง โดยไม่บันทึกหรือเปิดเองครั้งถัดไป · เปิดคู่กับจอลูกค้าได้")
            : definition.previewDescription}</span>
          {state.mode !== "off" && !state.open && state.targetAvailable && <Button icon={<ReloadOutlined />} disabled={Boolean(busy)}
            onClick={() => void (definition.role === "queue" && multiQueueSupported
              ? configureQueue({}) : configure(definition.role, state.mode, state.targetDisplayId))}>
            {posText("เปิดจออีกครั้ง")}</Button>}
        </div>
        {definition.role === "queue" && <details className="pos-display-advanced">
          <summary><span>{posText("ตั้งค่ารูปแบบและเสียง")}</span><small>{posText("รูปแบบหน้าจอ เสียงเรียก และระดับเสียง")}</small></summary>
          <div className="pos-display-advanced-body"><QueueBoardPreferenceSettings multiDisplay={multiQueueSupported} /></div>
        </details>}
      </article>;
    })}
    </div>

    <div className="pos-settings-info-note">
      <InfoCircleOutlined />
      <span>{posText("การทดสอบจอไม่บันทึกเป็นค่าจอที่สอง และปิดได้ทันที")}</span>
    </div>

    <details className="pos-display-diagnostics">
      <summary>{posText("รายละเอียดจอที่ตรวจพบ (")}{displays.length})</summary>
      <div className="pos-display-chip-list">{displays.map((display, index) => {
        const customerHere = !customer.preview && customer.open && display.id === customer.activeDisplayId;
        const queueHere = (queue.activeDisplayIds?.includes(display.id) ?? false)
          || (!multiQueueSupported && !queue.preview && queue.open && display.id === queue.activeDisplayId);
        return <span key={display.id}>
          {posText("จอ") + " "}{index + 1}: {display.label} · {display.width}×{display.height}
          {display.cashier ? posText(" · แคชเชียร์") : customerHere ? posText(" · ลูกค้า") : queueHere ? posText(" · เรียกคิว") : posText(" · ว่าง")}
        </span>;
      })}</div>
    </details>
    {(customer.positioningLimited || queue.positioningLimited) && <div style={{ marginTop: 10, color: "var(--posx-warn-text, #ad6800)", fontSize: 12 }}>
      {posText("Linux Wayland อาจไม่ยอมให้แอปย้ายหน้าต่างอัตโนมัติ หากเปิดผิดจอให้ลากด้วยระบบปฏิบัติการ") + " "}</div>}
    {error && <div role="alert" style={{ marginTop: 10, color: "var(--posx-danger-text, #cf1322)", fontSize: 12 }}>{error}</div>}
  </section>;
}
