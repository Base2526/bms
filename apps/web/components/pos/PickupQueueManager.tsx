"use client";

import { usePosText, thaiPosText, type PosTranslator } from "@/lib/pos/usePosText";

/**
 * Staff queue manager (`10.111`) — the full view behind the till's queue strip.
 *
 * - Type a number on the keypad to find it, call it or mark it collected (fast when the board is
 *   full and scanning buttons is slow).
 * - Filter open / preparing / ready / closed today; closed rows show what happened and when.
 * - Cancel needs an explicit second tap: it takes the number off the customer screen for good.
 *
 * Every action goes through the device-token API with the cashier PIN, exactly like the strip.
 * The list is the staff view (`?view=day`); the public call screen never sees order ids.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPickupQueueBoard, PICKUP_QUEUE_POLL_MS, type PickupQueueRow } from "./PickupQueuePanel";
import {
  playPickupQueueAnnouncement,
  preparePickupQueueAnnouncement,
  type PickupQueueVoiceSettings,
} from "@/lib/pos/pickupQueueVoice";

type DayRow = PickupQueueRow & { orderId: string; closedAt: string | null };
type Filter = "OPEN" | "PREPARING" | "READY" | "CLOSED";
type Action = "call" | "collect" | "unready" | "cancel";

const STATUS_TEXT = (posText: PosTranslator = thaiPosText): Record<DayRow["status"], string> => ({
  PREPARING: posText("กำลังเตรียม"),
  READY: posText("พร้อมรับ"),
  COLLECTED: posText("รับแล้ว"),
  CANCELLED: posText("ยกเลิกแล้ว"),
});
const STATUS_COLOR: Record<DayRow["status"], string> = {
  PREPARING: "#475569",
  READY: "#15803d",
  COLLECTED: "#64748b",
  CANCELLED: "#b91c1c",
};
const ACTION_DONE = (posText: PosTranslator = thaiPosText): Record<Action, string> => ({
  call: posText("เรียกคิว"),
  collect: posText("บันทึกรับแล้ว"),
  unready: posText("ย้ายกลับไปกำลังเตรียม"),
  cancel: posText("ยกเลิกคิว"),
});

/** "42" → "042": the keypad accepts what the customer reads off the receipt. */
export function normalizeQueueInput(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 4);
  return digits ? digits.padStart(3, "0") : "";
}

function hhmm(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export async function postPickupQueue(token: string, body: Record<string, unknown>, posText: PosTranslator = thaiPosText) {
  let res: Response;
  try {
    res = await fetch("/api/pos/pickup-queue", {
      method: "POST",
      headers: { "x-pos-device-token": token, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(posText("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ · ตรวจอินเทอร์เน็ตแล้วลองใหม่"));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? posText("ทำรายการไม่สำเร็จ (HTTP {v0})", { v0: res.status }));
  return data as { entry?: { id: string; label: string; status: string } };
}

type ManagerProps = {
  token: string;
  cashierUserId: string;
  cashierPin: string;
  onClose: () => void;
  /** Lets the strip refresh right after an action here. */
  onChanged?: () => void;
};

export function PickupQueueManager({ token, cashierUserId, cashierPin, onClose, onChanged }: ManagerProps) {
  const posText = usePosText();
  const [rows, setRows] = useState<DayRow[]>([]);
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<PickupQueueVoiceSettings | null>(null);
  const [feedStatus, setFeedStatus] = useState<"CHECKING" | "LIVE" | "STALE">("CHECKING");
  const loadSequence = useRef(0);
  const actionLock = useRef(false);

  const load = useCallback(async (): Promise<boolean> => {
    const sequence = ++loadSequence.current;
    try {
      const res = await fetch("/api/pos/pickup-queue?view=day", {
        headers: { "x-pos-device-token": token },
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (sequence === loadSequence.current) {
          setFeedStatus("STALE");
          setNotice({ ok: false, text: data?.error ?? posText("โหลดคิวไม่สำเร็จ (HTTP {v0})", { v0: res.status }) });
        }
        return false;
      }
      if (sequence !== loadSequence.current) return false;
      setRows(Array.isArray(data?.entries) ? data.entries : []);
      if (data?.settings && typeof data.settings === "object") setVoiceSettings(data.settings);
      setFeedStatus("LIVE");
      setNotice(null);
      return true;
    } catch {
      if (sequence === loadSequence.current) {
        setFeedStatus("STALE");
        setNotice({ ok: false, text: posText("โหลดคิวไม่สำเร็จ · ตรวจการเชื่อมต่อ") });
      }
      return false;
    }
  }, [posText, token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), PICKUP_QUEUE_POLL_MS);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearInterval(timer); window.removeEventListener("keydown", onKey); };
  }, [load, onClose]);

  const wanted = normalizeQueueInput(typed);
  const counts = useMemo(() => ({
    OPEN: rows.filter((row) => row.status === "PREPARING" || row.status === "READY").length,
    PREPARING: rows.filter((row) => row.status === "PREPARING").length,
    READY: rows.filter((row) => row.status === "READY").length,
    CLOSED: rows.filter((row) => row.status === "COLLECTED" || row.status === "CANCELLED").length,
  }), [rows]);
  const visible = rows
    .filter((row) =>
      filter === "OPEN" ? row.status === "PREPARING" || row.status === "READY"
        : filter === "CLOSED" ? row.status === "COLLECTED" || row.status === "CANCELLED"
          : row.status === filter)
    .filter((row) => !wanted || row.label.includes(wanted.replace(/^0+/, "") || "0"))
    .sort((a, b) => (filter === "CLOSED" ? b.label.localeCompare(a.label) : a.label.localeCompare(b.label)));
  const exact = wanted ? rows.find((row) => row.label === wanted) ?? null : null;
  const actionsDisabled = busy != null || feedStatus !== "LIVE";

  const act = async (row: DayRow, action: Action) => {
    if (actionLock.current || feedStatus !== "LIVE") return;
    if (!cashierUserId || !cashierPin) {
      setNotice({ ok: false, text: posText("ใส่ผู้ขายและ PIN ที่แถบด้านบนก่อน") });
      return;
    }
    // Must happen before the first await while this call still belongs to the cashier click.
    const announcement = action === "call"
      ? preparePickupQueueAnnouncement(row.label, voiceSettings)
      : null;
    actionLock.current = true;
    setBusy(row.id);
    let completed = false;
    try {
      await postPickupQueue(token, { action, entryId: row.id, cashierUserId, cashierPin }, posText);
      completed = true;
      if (action === "call") {
        void playPickupQueueAnnouncement(announcement, row.label, voiceSettings);
      }
      setNotice({ ok: true, text: posText("{v0} {v1} แล้ว", { v0: ACTION_DONE(posText)[action], v1: row.label }) });
      setConfirmCancel(null);
      if (action === "call" || action === "collect") setTyped("");
      onChanged?.();
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : posText("ทำรายการไม่สำเร็จ") });
    } finally {
      setBusy(null);
    }
    if (completed) {
      const refreshed = await load();
      setNotice({ ok: true, text: refreshed
        ? posText("{v0} {v1} แล้ว", { v0: ACTION_DONE(posText)[action], v1: row.label })
        : posText("{v0} {v1} แล้ว · แต่โหลดสถานะล่าสุดไม่สำเร็จ", { v0: ACTION_DONE(posText)[action], v1: row.label }) });
    }
    actionLock.current = false;
  };

  const actByNumber = (action: "call" | "collect") => {
    if (feedStatus !== "LIVE") {
      setNotice({ ok: false, text: posText("ยังยืนยันรายการคิวล่าสุดไม่ได้ · ลองโหลดคิวใหม่ก่อน") });
      return;
    }
    if (!wanted) { setNotice({ ok: false, text: posText("พิมพ์เลขคิวก่อน") }); return; }
    if (!exact) { setNotice({ ok: false, text: posText("ไม่พบคิว {v0} ของวันนี้", { v0: wanted }) }); return; }
    if (exact.status === "COLLECTED" || exact.status === "CANCELLED") {
      setNotice({ ok: false, text: posText("คิว {v0} {v1}ไปแล้ว", { v0: exact.label, v1: STATUS_TEXT(posText)[exact.status] }) });
      return;
    }
    void act(exact, action);
  };

  const press = (key: string) => {
    setNotice(null);
    setTyped((value) => key === "DEL" ? value.slice(0, -1) : key === "CLR" ? "" : (value + key).slice(0, 4));
  };

  const button: React.CSSProperties = { padding: "10px 14px", fontSize: 15, borderRadius: 8, minHeight: 44 };
  const tab = (key: Filter, label: string) => (
    <button key={key} type="button" className="pos-btn" aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      style={{ ...button, fontWeight: filter === key ? 700 : 400, outline: filter === key ? "2px solid #2563eb" : undefined }}>
      {label} {counts[key]}
    </button>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label={posText("จัดการคิวรับของ")} data-pickup-queue-manager
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15, 23, 42, 0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div style={{ background: "var(--pos-surface, #fff)", color: "var(--pos-text, #1f1f1f)", borderRadius: 14,
        width: "min(1100px, 100%)", height: "min(760px, 100%)", display: "flex", flexDirection: "column",
        overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px",
          borderBottom: "1px solid var(--pos-line, #e2e8f0)" }}>
          <b style={{ fontSize: 20, flex: 1 }}>{posText("จัดการคิวรับของ")}</b>
          <button type="button" className="pos-btn" style={button} onClick={openPickupQueueBoard}>{posText("เปิดจอเรียกคิว")}</button>
          <button type="button" className="pos-btn" style={button} onClick={onClose} aria-label={posText("ปิด")}>{posText("ปิด")}</button>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0, flexWrap: "wrap" }}>
          <div style={{ width: 300, maxWidth: "100%", padding: 16, borderRight: "1px solid var(--pos-line, #e2e8f0)",
            display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ fontSize: 13, color: "var(--pos-muted, #64748b)" }} htmlFor="pickup-queue-number">
              {posText("พิมพ์เลขคิว") + " "}</label>
            <input id="pickup-queue-number" inputMode="numeric" autoComplete="off" value={typed}
              onChange={(event) => { setNotice(null); setTyped(event.target.value.replace(/\D/g, "").slice(0, 4)); }}
              onKeyDown={(event) => { if (event.key === "Enter") actByNumber(exact?.status === "READY" ? "collect" : "call"); }}
              placeholder={posText("เช่น 42")}
              style={{ fontSize: 34, fontWeight: 700, textAlign: "center", padding: "6px 8px", borderRadius: 8,
                border: "1px solid var(--pos-line, #cbd5e1)", fontVariantNumeric: "tabular-nums" }} />
            <div style={{ fontSize: 13, minHeight: 18, color: "var(--pos-muted, #64748b)" }}>
              {wanted ? (exact ? posText("คิว {v0} · {v1}", { v0: exact.label, v1: STATUS_TEXT(posText)[exact.status] }) : posText("ไม่พบคิว {v0}", { v0: wanted })) : " "}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLR", "0", "DEL"].map((key) => (
                <button key={key} type="button" className="pos-btn" onClick={() => press(key)}
                  style={{ ...button, fontSize: key.length > 1 ? 14 : 22, minHeight: 52 }}>
                  {key === "CLR" ? posText("ล้าง") : key === "DEL" ? posText("ลบ") : key}
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button type="button" className="pos-btn" style={{ ...button, fontWeight: 700 }}
                disabled={actionsDisabled} onClick={() => actByNumber("call")}>{posText("เรียกคิว")}</button>
              <button type="button" className="pos-btn" style={{ ...button, fontWeight: 700 }}
                disabled={actionsDisabled} onClick={() => actByNumber("collect")}>{posText("รับแล้ว")}</button>
            </div>
            {notice && (
              <div role="status" style={{ fontSize: 14, color: notice.ok ? "#15803d" : "#b91c1c" }}>{notice.text}</div>
            )}
            {feedStatus === "STALE" && (
              <button type="button" className="pos-btn" style={button}
                onClick={() => { load().catch(() => undefined); }}>{posText("ลองโหลดคิวใหม่")}</button>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "12px 16px" }}>
              {tab("OPEN", posText("ยังไม่ปิด"))}
              {tab("PREPARING", posText("กำลังเตรียม"))}
              {tab("READY", posText("พร้อมรับ"))}
              {tab("CLOSED", posText("ปิดแล้ววันนี้"))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
              {visible.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "var(--pos-muted, #64748b)" }}>
                  {feedStatus === "CHECKING"
                    ? posText("กำลังตรวจสอบรายการคิวล่าสุด…")
                    : feedStatus === "STALE"
                      ? posText("ตรวจสถานะคิวไม่ได้ · รายการว่างนี้ยังยืนยันไม่ได้")
                      : wanted ? posText("ไม่มีคิวที่ตรงกับ {v0}", { v0: wanted }) : posText("ยังไม่มีคิวในหมวดนี้")}
                </div>
              )}
              {visible.map((row) => {
                const open = row.status === "PREPARING" || row.status === "READY";
                return (
                  <div key={row.id} data-pickup-row={row.label}
                    style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 0",
                      borderBottom: "1px solid var(--pos-line, #e2e8f0)" }}>
                    <b style={{ fontSize: 30, minWidth: 82, fontVariantNumeric: "tabular-nums" }}>{row.label}</b>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: STATUS_COLOR[row.status] }}>
                        {STATUS_TEXT(posText)[row.status]}
                        {row.status === "READY" && row.readySource
                          ? row.readySource === "KITCHEN" ? posText(" · ครัวกดเสร็จ") : posText(" · พนักงานเรียก") : ""}
                      </span>
                      <div style={{ fontSize: 12, color: "var(--pos-muted, #64748b)" }}>
                        {posText("ออกเลข") + " "}{hhmm(row.createdAt)}
                        {row.calledAt ? posText(" · เรียกล่าสุด {v0}", { v0: hhmm(row.calledAt) }) : ""}
                        {row.closedAt ? posText(" · ปิด {v0}", { v0: hhmm(row.closedAt) }) : ""}
                        {posText(" · บิล #{v0}", { v0: row.orderId.slice(0, 8) })}
                      </div>
                    </div>
                    {open && confirmCancel !== row.id && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="pos-btn" style={button} disabled={actionsDisabled}
                          onClick={() => void act(row, "call")}>{row.status === "READY" ? posText("เรียกซ้ำ") : posText("เรียกคิว")}</button>
                        <button type="button" className="pos-btn" style={button} disabled={actionsDisabled}
                          onClick={() => void act(row, "collect")}>{posText("รับแล้ว")}</button>
                        {row.status === "READY" && (
                          <button type="button" className="pos-btn" style={button} disabled={actionsDisabled}
                            onClick={() => void act(row, "unready")}>{posText("ย้อน")}</button>
                        )}
                        <button type="button" className="pos-btn" style={{ ...button, color: "#b91c1c" }}
                          disabled={actionsDisabled} onClick={() => setConfirmCancel(row.id)}>{posText("ยกเลิก")}</button>
                      </div>
                    )}
                    {open && confirmCancel === row.id && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, color: "#b91c1c" }}>{posText("ยกเลิกคิว") + " "}{row.label}{posText("? เลขจะหายจากจอลูกค้า")}</span>
                        <button type="button" className="pos-btn" style={{ ...button, color: "#fff", background: "#b91c1c" }}
                          disabled={actionsDisabled} onClick={() => void act(row, "cancel")}>{posText("ยืนยันยกเลิก")}</button>
                        <button type="button" className="pos-btn" style={button}
                          onClick={() => setConfirmCancel(null)}>{posText("ไม่ยกเลิก")}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type RetryProps = {
  token: string;
  cashierUserId: string;
  cashierPin: string;
  orderId: string;
  onIssued: (label: string) => void;
};

/** Shown where a committed sale reported `pickupQueueError`: ask for the number again. */
export function PickupQueueRetryButton({ token, cashierUserId, cashierPin, orderId, onIssued }: RetryProps) {
  const posText = usePosText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryLock = useRef(false);
  const retry = async () => {
    if (retryLock.current) return;
    if (!cashierUserId || !cashierPin) { setError(posText("ใส่ผู้ขายและ PIN ที่แถบด้านบนก่อน")); return; }
    retryLock.current = true;
    setBusy(true);
    try {
      const data = await postPickupQueue(token, { action: "issue", orderId, cashierUserId, cashierPin }, posText);
      if (!data.entry?.label) throw new Error(posText("ขายสำเร็จแล้ว แต่เซิร์ฟเวอร์ยังไม่ส่งเลขคิวกลับมา"));
      onIssued(data.entry.label);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : posText("ออกเลขคิวไม่สำเร็จ"));
    } finally {
      retryLock.current = false;
      setBusy(false);
    }
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="pos-btn" disabled={busy} onClick={() => void retry()}
        data-pickup-queue-retry>
        {busy ? posText("กำลังออกเลข…") : posText("ออกเลขคิวใหม่")}
      </button>
      {error && <span style={{ fontSize: 12, color: "#b91c1c" }}>{error}</span>}
    </span>
  );
}
