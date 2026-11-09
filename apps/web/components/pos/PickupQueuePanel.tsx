"use client";

/**
 * Pickup queue numbers at the till (`10.111`)
 *
 * - `PickupQueueSettings`: per-device switch (a cafe's counter till numbers orders, a retail till
 *   next to it does not) and the button that opens the customer call screen.
 * - `PickupQueueStrip`: the cashier's live list on the sell tab. Tap a preparing number to call
 *   it, tap a ready number to mark it collected.
 *
 * The switch lives in localStorage because it is a property of this till, like the customer
 * display window. PINs never go there.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PickupQueueManager } from "./PickupQueueManager";
import { useOrderAlerts } from "@/app/hooks/useOrderAlerts";
import {
  playPickupQueueAnnouncement,
  preparePickupQueueAnnouncement,
  type PickupQueueVoiceSettings,
} from "@/lib/pos/pickupQueueVoice";

const PICKUP_QUEUE_PREF_PREFIX = "bms.pos.pickupQueue.";
export const PICKUP_QUEUE_POLL_MS = 5000;

export type PickupQueueRow = {
  id: string;
  label: string;
  status: "PREPARING" | "READY" | "COLLECTED" | "CANCELLED";
  readySource: "KITCHEN" | "STAFF" | null;
  createdAt: string;
  readyAt: string | null;
  calledAt: string | null;
};

type QueueFeedStatus = "CHECKING" | "LIVE" | "STALE";

export function readPickupQueueEnabled(namespace: string): boolean {
  try {
    return window.localStorage.getItem(PICKUP_QUEUE_PREF_PREFIX + namespace) === "1";
  } catch {
    return false;
  }
}

export function writePickupQueueEnabled(namespace: string, enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(PICKUP_QUEUE_PREF_PREFIX + namespace, "1");
    else window.localStorage.removeItem(PICKUP_QUEUE_PREF_PREFIX + namespace);
  } catch {
    // Private window / blocked storage: the switch simply does not persist.
  }
}

export function openPickupQueueBoard(): void {
  window.open("/pos/queue-board", "bms-pos-queue-board", "width=1280,height=800");
}

export function PickupQueueSettings({ enabled, branchEnabled = false, managedDisplay = false, onChange }: {
  enabled: boolean;
  branchEnabled?: boolean;
  /** New Desktop owns the real/preview queue windows under External displays. */
  managedDisplay?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="pos-settings-row pos-settings-row--queue" data-pickup-queue-settings>
      <div className="pos-settings-row-copy">
        <div className="pos-settings-row-title">คิวรับสินค้า</div>
        <div className="pos-settings-row-description">
          แสดงเลขคิวบนใบเสร็จและจอเรียกคิว
        </div>
        <div className="pos-settings-row-note">
          {branchEnabled
            ? "สาขานี้เปิดออกเลขทุกเครื่องจากหลังบ้านแล้ว จึงปิดจากเครื่องนี้ไม่ได้"
            : "ตั้งค่าเฉพาะเครื่องนี้ · บิลโต๊ะยังใช้เลขโต๊ะเหมือนเดิม"}
        </div>
      </div>
      <div className="pos-settings-row-actions">
        {branchEnabled
          ? <span role="status" className="pos-settings-status" data-tone="ready">
            เปิดทั้งสาขา
          </span>
          : <button type="button" className="pos-settings-switch" role="switch" aria-checked={enabled}
            aria-pressed={enabled} onClick={() => onChange(!enabled)}
            title="เปิดหรือปิดการออกเลขคิวบนใบเสร็จของเครื่องขายนี้ ไม่ได้ใช้เปิดหน้าจอเรียกคิว">
            <span className="pos-settings-switch-track" aria-hidden="true"><i /></span>
            <span className="pos-settings-status" data-tone={enabled ? "ready" : "muted"}>{enabled ? "เปิดอยู่" : "ปิดอยู่"}</span>
          </button>}
        {!managedDisplay && <button type="button" className="pos-btn" onClick={openPickupQueueBoard}
          title="เปิดหน้าต่างจอเรียกคิว แล้วลากไปจอที่หันไปทางลูกค้า">
          เปิดจอคิวแบบหน้าต่าง
        </button>}
        {managedDisplay && <span className="pos-settings-row-action-note">
          เปิดจอจริงหรือหน้าต่างทดสอบได้จากหัวข้อ “จอภายนอก” ด้านบน
        </span>}
      </div>
    </div>
  );
}

type StripProps = {
  token: string;
  cashierUserId: string;
  cashierPin: string;
  /** Bump after a sale so a new number appears without waiting for the next poll. */
  refreshKey: number;
  /** Restaurant floor uses one compact operational row; retail keeps the full queue list. */
  variant?: "default" | "compact";
};

export function PickupQueueStrip({ token, cashierUserId, cashierPin, refreshKey, variant = "default" }: StripProps) {
  const alerts = useOrderAlerts();
  const [rows, setRows] = useState<PickupQueueRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedStatus, setFeedStatus] = useState<QueueFeedStatus>("CHECKING");
  const [managerOpen, setManagerOpen] = useState(false);
  const [readyFlash, setReadyFlash] = useState<string | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<PickupQueueVoiceSettings | null>(null);
  const seenKitchenReady = useRef<Map<string, string> | null>(null);
  const loadSequence = useRef(0);
  const actionLock = useRef(false);

  const load = useCallback(async (): Promise<boolean> => {
    if (!token) {
      setFeedStatus("STALE");
      setError("ยังตรวจสถานะคิวไม่ได้ · เครื่องขายยังไม่ได้รับสิทธิ์");
      return false;
    }
    const sequence = ++loadSequence.current;
    try {
      const res = await fetch("/api/pos/pickup-queue", {
        headers: { "x-pos-device-token": token },
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (sequence === loadSequence.current) {
          setFeedStatus("STALE");
          setError(data?.error ?? `โหลดคิวไม่สำเร็จ (HTTP ${res.status})`);
        }
        return false;
      }
      const next: PickupQueueRow[] = Array.isArray(data?.entries) ? data.entries : [];
      if (sequence !== loadSequence.current) return false;
      if (data?.settings && typeof data.settings === "object") setVoiceSettings(data.settings);
      const previous = seenKitchenReady.current;
      const seen = new Map<string, string>();
      let newest: PickupQueueRow | null = null;
      for (const row of next) {
        if (row.status !== "READY" || row.readySource !== "KITCHEN" || !row.readyAt) continue;
        seen.set(row.id, row.readyAt);
        if (previous && previous.get(row.id) !== row.readyAt
          && (!newest || row.readyAt > (newest.readyAt ?? ""))) newest = row;
      }
      seenKitchenReady.current = seen;
      if (newest) {
        setReadyFlash(newest.label);
        alerts.notify("PICKUP_READY");
      }
      setRows(next);
      setFeedStatus("LIVE");
      setError(null);
      return true;
    } catch {
      if (sequence === loadSequence.current) {
        setFeedStatus("STALE");
        setError("โหลดคิวไม่สำเร็จ · ตรวจการเชื่อมต่อ");
      }
      return false;
    }
  }, [token]);

  useEffect(() => {
    if (!readyFlash) return;
    const timer = window.setTimeout(() => setReadyFlash(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [readyFlash]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), PICKUP_QUEUE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, refreshKey]);

  const act = async (row: PickupQueueRow, action: "call" | "collect" | "unready" | "cancel") => {
    if (actionLock.current || feedStatus !== "LIVE") return;
    if (!cashierUserId || !cashierPin) {
      setError("ใส่ผู้ขายและ PIN ที่แถบด้านบนก่อน");
      return;
    }
    // Prime Web Audio in the click handler; starting it after the POST is blocked as autoplay.
    const announcement = action === "call"
      ? preparePickupQueueAnnouncement(row.label, voiceSettings)
      : null;
    actionLock.current = true;
    setBusyId(row.id);
    try {
      const res = await fetch("/api/pos/pickup-queue", {
        method: "POST",
        headers: { "x-pos-device-token": token, "content-type": "application/json" },
        body: JSON.stringify({ action, entryId: row.id, cashierUserId, cashierPin }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `ทำรายการไม่สำเร็จ (HTTP ${res.status})`);
        return;
      }
      if (action === "call") {
        void playPickupQueueAnnouncement(announcement, row.label, voiceSettings);
      }
      const refreshed = await load();
      if (!refreshed) {
        setError("ทำรายการคิวสำเร็จแล้ว · แต่โหลดสถานะล่าสุดไม่สำเร็จ");
      }
    } catch {
      setError("ส่งคำสั่งคิวไม่สำเร็จ · ตรวจการเชื่อมต่อแล้วลองใหม่");
    } finally {
      actionLock.current = false;
      setBusyId(null);
    }
  };

  const preparing = rows.filter((row) => row.status === "PREPARING");
  const ready = rows.filter((row) => row.status === "READY");
  const currentReady = [...ready].sort((a, b) => String(b.calledAt ?? b.readyAt).localeCompare(String(a.calledAt ?? a.readyAt)))[0] ?? null;
  const nextPreparing = preparing[0] ?? null;
  const actionsDisabled = busyId !== null || feedStatus !== "LIVE";
  const summary = feedStatus === "CHECKING"
    ? "กำลังตรวจสอบคิว…"
    : feedStatus === "STALE"
      ? "ตรวจสถานะคิวไม่ได้"
      : `กำลังเตรียม ${preparing.length} · พร้อมรับ ${ready.length}`;
  const closeManager = useCallback(() => setManagerOpen(false), []);
  const refreshAfterManagerAction = useCallback(() => {
    load().catch(() => undefined);
  }, [load]);
  const manager = managerOpen && (
    <PickupQueueManager token={token} cashierUserId={cashierUserId} cashierPin={cashierPin}
      onClose={closeManager} onChanged={refreshAfterManagerAction} />
  );

  if (variant === "compact") {
    return (
      <div data-pickup-queue-strip data-variant="compact">
        <div data-pickup-queue-main>
          <span data-pickup-queue-summary>
            <b>คิวรับของ</b>
            <span>{summary}</span>
          </span>
          {feedStatus === "STALE"
            ? <span data-pickup-queue-current data-state="stale"><span>ข้อมูลคิวไม่อัปเดต</span></span>
            : currentReady
            ? <span data-pickup-queue-current data-state="ready"
                role={readyFlash === currentReady.label ? "status" : undefined}>
                <span>พร้อมรับ</span><b>{currentReady.label}</b>
                {ready.length > 1 && <small>+{ready.length - 1}</small>}
              </span>
            : nextPreparing
              ? <span data-pickup-queue-current data-state="preparing">
                  <span>คิวถัดไป</span><b>{nextPreparing.label}</b>
                  {preparing.length > 1 && <small>+{preparing.length - 1}</small>}
                </span>
              : <span data-pickup-queue-current data-state="empty"><span>ยังไม่มีคิวที่รออยู่</span></span>}
          <span data-pickup-queue-actions>
            {currentReady && <>
              <button type="button" className="pos-btn" data-action="collect" disabled={actionsDisabled}
                onClick={() => void act(currentReady, "collect")}>รับแล้ว</button>
              <button type="button" className="pos-btn" data-action="recall" disabled={actionsDisabled}
                onClick={() => void act(currentReady, "call")} title="ประกาศเลขนี้บนจออีกครั้ง">เรียกซ้ำ</button>
            </>}
            {!currentReady && nextPreparing && <button type="button" className="pos-btn" data-action="call" disabled={actionsDisabled}
              onClick={() => void act(nextPreparing, "call")} title="กดเพื่อเรียกคิวนี้ขึ้นจอ">เรียกคิว</button>}
            <button type="button" className="pos-btn" data-action="manage" onClick={() => setManagerOpen(true)}
              title="ดูคิวทั้งหมดของวันนี้ เรียกด้วยเลข ย้อนสถานะ และยกเลิกคิว">จัดการคิว</button>
          </span>
        </div>
        {readyFlash && readyFlash !== currentReady?.label && <span role="status" data-pickup-ready-flash>
          คิว {readyFlash} พร้อมรับแล้ว
        </span>}
        {error && <div data-pickup-queue-error>
          {error}
          {feedStatus === "STALE" && <button type="button" className="pos-btn"
            onClick={() => { load().catch(() => undefined); }}>ลองโหลดคิวใหม่</button>}
        </div>}
        {manager}
      </div>
    );
  }

  // Always visible while the till numbers orders: staff need a way into the manager even when
  // the board is empty (to look up an earlier number or reprint a lost one).
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }} data-pickup-queue-strip>
      {readyFlash && <div role="status" style={{ padding: "8px 12px", borderRadius: 8,
        background: "var(--posx-ok-bg, #f0fdf4)", color: "var(--posx-ok-text, #166534)", fontWeight: 700 }}>
        คิว {readyFlash} พร้อมรับแล้ว
      </div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>
          {feedStatus === "CHECKING"
            ? "คิวรับของ · กำลังตรวจสอบสถานะล่าสุด…"
            : feedStatus === "STALE"
              ? "คิวรับของ · ตรวจสถานะล่าสุดไม่ได้"
              : rows.length === 0
            ? "คิวรับของ · ยังไม่มีคิวที่รออยู่"
            : `คิวรับของ · กำลังเตรียม ${preparing.length} · พร้อมรับ ${ready.length}`}
        </span>
        <button type="button" className="pos-btn" onClick={() => setManagerOpen(true)}
          title="ดูคิวทั้งหมดของวันนี้ เรียกด้วยเลข และยกเลิกคิว">
          จัดการคิว
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {preparing.map((row) => (
          <button key={row.id} type="button" className="pos-btn" disabled={actionsDisabled}
            onClick={() => void act(row, "call")} title="กดเพื่อเรียกคิวนี้ขึ้นจอ">
            {row.label} · เรียกคิว
          </button>
        ))}
        {ready.map((row) => (
          <span key={row.id} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            border: "1px solid var(--pos-line)", borderRadius: 8, padding: "2px 4px 2px 10px",
            background: "rgba(22, 163, 74, 0.08)",
          }}>
            <b>{row.label}</b>
            <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>พร้อมรับ</span>
            <button type="button" className="pos-btn" disabled={actionsDisabled}
              onClick={() => void act(row, "collect")}>รับแล้ว</button>
            <button type="button" className="pos-btn" disabled={actionsDisabled}
              onClick={() => void act(row, "call")} title="ประกาศเลขนี้บนจออีกครั้ง">เรียกซ้ำ</button>
            <button type="button" className="pos-btn" disabled={actionsDisabled}
              onClick={() => void act(row, "unready")} title="กดเรียกผิด ย้ายกลับไปกำลังเตรียม">ย้อน</button>
          </span>
        ))}
      </div>
      {error && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        fontSize: 12, color: "var(--pos-danger, #b91c1c)" }}>
        <span>{error}</span>
        {feedStatus === "STALE" && <button type="button" className="pos-btn"
          onClick={() => { load().catch(() => undefined); }}>ลองโหลดคิวใหม่</button>}
      </div>}
      {manager}
    </div>
  );
}
