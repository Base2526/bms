"use client";

/**
 * Customer-facing pickup call screen (`10.111`)
 *
 * Opened from the paired till (POS → ตั้งค่า → เปิดจอเรียกคิว) and dragged to a screen facing the
 * customers. It reads the same device token as the till, so it is never a public page, and the
 * board API returns numbers and status only: no names, phones, items or amounts.
 *
 * Polling, not WebSocket: a few seconds of delay is fine for "your order is ready", and a stale
 * screen recovers by itself on the next poll after the shop's internet comes back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { posDeviceStorageNamespace, readPosDeviceToken } from "@/lib/pos/deviceTokenClient";
import {
  queueBoardSoundStorageKey,
  readQueueBoardSoundEnabled,
} from "@/lib/pos/queueBoardSoundPreference";
import {
  queueBoardLayoutStorageKey,
  readQueueBoardLayout,
  type QueueBoardLayout,
} from "@/lib/pos/queueBoardLayoutPreference";
import {
  applyQueueBoardAudioStyle,
  queueBoardAudioStorageKey,
  readQueueBoardAudioStyle,
  type QueueBoardAudioStyle,
} from "@/lib/pos/queueBoardAudioPreference";
import {
  playPickupQueueAnnouncement,
  playPickupQueueChime,
  preloadPickupQueueVoice,
} from "@/lib/pos/pickupQueueVoice";

type BoardEntry = {
  label: string;
  status: "PREPARING" | "READY";
  readyAt: string | null;
  calledAt: string | null;
};
type BoardSettings = {
  enabled: boolean;
  autoHideMinutes: number;
  showPreparing: boolean;
  boardMessage: string | null;
  branchName: string;
  spotlightSeconds: number;
  voiceMode: "AI_STUDIO" | "VOICE_CHIME" | "CHIME" | "OFF";
  voiceLanguage: "th" | "en";
  voiceRepeat: number;
  voiceVolume: number;
};

const POLL_MS = 3000;
/** How long a freshly called number stays highlighted. */
/**
 * Only calls this recent are announced. A screen that reconnects after an outage (or opens late)
 * must not chime for a number called minutes ago: that customer has usually collected already.
 * Measured on the server clock, so a till with a wrong clock does not change the answer.
 */
const ANNOUNCE_WINDOW_MS = 30_000;
/**
 * The POS layout defines `--font-pos` (IBM Plex Sans Thai). Without a fallback inside var(), a
 * missing variable makes the whole declaration invalid and the browser drops to a serif default.
 */
const FONT = 'var(--font-pos, "IBM Plex Sans Thai"), system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif';

const QUEUE_BOARD_CSS = `
  .pq-page {
    height: 100vh;
    box-sizing: border-box;
    overflow: hidden;
    padding: clamp(18px, 2.2vw, 36px);
    background: radial-gradient(circle at 82% 8%, #153158 0, #0f1f39 22%, #0b1425 62%);
    color: #f8fafc;
    font-family: ${FONT};
    font-variant-numeric: tabular-nums;
    display: flex;
    flex-direction: column;
    gap: clamp(14px, 1.8vw, 24px);
  }
  .pq-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-width: 0; }
  .pq-brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .pq-mark {
    width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center;
    background: #1f6b50; color: white; font-size: 24px; font-weight: 800; box-shadow: 0 10px 30px #02061755;
  }
  .pq-title { font-size: clamp(24px, 2.25vw, 38px); line-height: 1.12; font-weight: 750; letter-spacing: -.02em; }
  .pq-branch { margin-top: 3px; font-size: clamp(14px, 1.2vw, 19px); color: #9fb0c8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pq-controls { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; color: #b7c3d4; font-size: 14px; }
  .pq-sound-button {
    min-height: 44px; padding: 8px 14px; border-radius: 12px; border: 1px solid #42526a;
    background: #15243a; color: #f8fafc; cursor: pointer; font: inherit; font-weight: 650;
  }
  .pq-sound-state { padding: 8px 12px; border-radius: 999px; background: #153b30; color: #9ff3c8; }
  .pq-sound-off { padding: 8px 12px; border-radius: 999px; background: #2b3545; color: #cbd5e1; }
  .pq-warning { color: #fcd34d; }
  .pq-error { color: #fecaca; }
  .pq-message {
    margin-top: -4px; padding: 9px 16px; border: 1px solid #30435f; border-radius: 12px;
    background: #14223a; color: #d8e2ef; text-align: center; font-size: clamp(16px, 1.5vw, 23px);
  }
  .pq-grid {
    min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0, .82fr) minmax(0, 1.18fr);
    gap: clamp(14px, 1.7vw, 24px);
  }
  .pq-panel {
    min-width: 0; min-height: 0; overflow: hidden; border: 1px solid #2b3a52; border-radius: 22px;
    padding: clamp(18px, 2vw, 30px); box-shadow: 0 18px 45px #02061742;
  }
  .pq-preparing { background: linear-gradient(145deg, #1b293e, #162236); }
  .pq-ready { display: flex; flex-direction: column; background: linear-gradient(145deg, #123d2d, #0e3025); border-color: #256347; }
  .pq-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: clamp(14px, 1.6vw, 22px); }
  .pq-panel-title { margin: 0; font-size: clamp(24px, 2.2vw, 36px); font-weight: 700; letter-spacing: -.01em; }
  .pq-preparing .pq-panel-title { color: #d4deeb; }
  .pq-ready .pq-panel-title { color: #d6ffe7; }
  .pq-count { color: #94a3b8; font-size: clamp(14px, 1.15vw, 18px); }
  .pq-ready .pq-count { color: #8ed5af; }
  .pq-numbers { display: flex; align-content: flex-start; flex-wrap: wrap; gap: clamp(8px, 1vw, 14px); overflow: hidden; }
  .pq-number {
    display: inline-flex; align-items: center; justify-content: center; font-weight: 760; line-height: 1;
    border-radius: 14px; letter-spacing: .01em;
  }
  .pq-preparing-number { padding: .23em .42em; background: #2b3b53; color: #e2e8f0; border: 1px solid #3d4e67; }
  .pq-ready-number { padding: .18em .4em; background: #17613f; color: #fff; border: 1px solid #2b8059; }
  .pq-ready-number.pq-current { background: #21c76a; border-color: #73f0a7; box-shadow: 0 0 0 5px #22c55e25; }
  .pq-empty { color: #8392a7; font-size: clamp(20px, 2vw, 30px); }
  .pq-ready .pq-empty { color: #80c7a3; }
  .pq-spotlight {
    flex: 0 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
    gap: 18px; margin: 0 0 clamp(16px, 1.6vw, 24px); padding: clamp(16px, 2vw, 28px);
    border-radius: 18px; border: 1px solid #6cf39e; background: linear-gradient(125deg, #1cc763, #109449);
    color: white; box-shadow: 0 16px 42px #021b0d66;
  }
  .pq-spotlight-kicker { font-size: clamp(14px, 1.25vw, 19px); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; opacity: .82; }
  .pq-spotlight-title { margin-top: 3px; font-size: clamp(24px, 2.4vw, 40px); font-weight: 700; line-height: 1.15; }
  .pq-spotlight-number { font-size: clamp(72px, 10vw, 164px); font-weight: 800; line-height: .8; letter-spacing: -.045em; }
  .pq-layout { min-height: 0; flex: 1; }
  .pq-call-card {
    min-width: 0; min-height: 0; padding: clamp(22px, 3vw, 42px); border-radius: 22px;
    background: linear-gradient(125deg, #176640, #18b85c); border: 1px solid #49dc89;
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 24px;
    box-shadow: 0 18px 48px #021b0d55;
  }
  .pq-call-copy { min-width: 0; }
  .pq-call-kicker { color: #b9f7d2; font-size: clamp(14px, 1.25vw, 19px); font-weight: 750; letter-spacing: .06em; }
  .pq-call-title { margin-top: 6px; font-size: clamp(25px, 2.5vw, 42px); font-weight: 750; line-height: 1.12; }
  .pq-call-number { font-size: clamp(94px, 13vw, 210px); font-weight: 800; line-height: .78; letter-spacing: -.045em; }
  .pq-call-card:not(.is-live) { background: linear-gradient(125deg, #14523b, #16824b); border-color: #2b8059; }
  .pq-overflow { margin-top: 12px; color: #94a3b8; font-size: clamp(12px, 1vw, 15px); }
  .pq-ready .pq-overflow { color: #8ed5af; }
  .pq-spotlight-layout { display: grid; grid-template-rows: minmax(210px, .82fr) minmax(0, 1.18fr); gap: clamp(14px, 1.7vw, 24px); }
  .pq-layout-lower { min-height: 0; display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); gap: clamp(14px, 1.7vw, 24px); }
  .pq-three-layout { display: grid; grid-template-columns: minmax(0, .8fr) minmax(280px, 1.25fr) minmax(0, 1fr); gap: clamp(12px, 1.3vw, 20px); }
  .pq-three-layout .pq-call-card { grid-template-columns: 1fr; place-content: center; text-align: center; }
  .pq-three-layout .pq-call-number { font-size: clamp(90px, 11vw, 190px); }
  .pq-ticker-layout { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: clamp(14px, 1.7vw, 24px); }
  .pq-ticker-upper { min-height: 0; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(280px, .7fr); gap: clamp(14px, 1.7vw, 24px); }
  .pq-ticker-preparing { min-height: 0; }
  .pq-ticker-preparing .pq-panel-head { margin-bottom: 10px; }
  .pq-ticker-preparing .pq-preparing.is-empty {
    min-height: 72px; box-sizing: border-box; padding: 14px 20px;
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 18px;
  }
  .pq-ticker-preparing .pq-preparing.is-empty .pq-panel-head { margin: 0; }
  .pq-ticker-preparing .pq-preparing.is-empty .pq-numbers { justify-content: flex-end; }
  .pq-ticker-preparing .pq-preparing.is-empty .pq-empty { font-size: clamp(20px, 2vw, 28px); }
  .pq-minimal-layout { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: clamp(14px, 1.7vw, 24px); }
  .pq-minimal-layout .pq-call-card { grid-template-columns: 1fr; place-content: center; text-align: center; }
  .pq-minimal-layout .pq-call-number { font-size: clamp(140px, 22vw, 360px); }
  .pq-minimal-rail {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 20px;
    padding: 16px 20px; border-radius: 18px; background: #123d2d; border: 1px solid #256347;
  }
  .pq-minimal-rail .pq-numbers { flex-wrap: nowrap; }
  .pq-minimal-preparing { color: #aebed1; white-space: nowrap; }
  .pq-airport-layout { min-height: 0; overflow: hidden; border-radius: 22px; background: #121f32; border: 1px solid #30415b; }
  .pq-board-row { display: grid; grid-template-columns: .55fr .85fr 1.4fr; align-items: center; gap: 18px; min-height: 54px; padding: 9px 24px; border-bottom: 1px solid #2a3950; }
  .pq-board-head { color: #94a3b8; font-size: 13px; background: #18273b; }
  .pq-board-no { font-size: clamp(27px, 3vw, 48px); font-weight: 800; }
  .pq-board-status { font-size: clamp(17px, 1.6vw, 25px); font-weight: 700; }
  .pq-board-row.ready .pq-board-no, .pq-board-row.ready .pq-board-status { color: #8ef0b6; }
  .pq-board-row.current { background: #176640; }
  .pq-board-row.current .pq-board-no { color: white; }
  .pq-board-note { color: #aebed1; font-size: clamp(14px, 1.2vw, 18px); }
  .pq-board-footer { padding: 10px 24px; color: #94a3b8; font-size: 13px; }
  @media (max-width: 900px) and (orientation: portrait) {
    .pq-page { overflow: auto; }
    .pq-header { align-items: flex-start; }
    .pq-mark { width: 42px; height: 42px; border-radius: 12px; }
    .pq-controls { max-width: 44%; }
    .pq-grid { grid-template-columns: 1fr; grid-template-rows: minmax(220px, .85fr) minmax(310px, 1.15fr); }
    .pq-spotlight-number { font-size: clamp(70px, 19vw, 132px); }
    .pq-spotlight-layout, .pq-ticker-layout, .pq-minimal-layout { grid-template-rows: auto auto; }
    .pq-layout-lower, .pq-ticker-upper { grid-template-columns: 1fr; }
    .pq-three-layout { grid-template-columns: 1fr; }
    .pq-three-layout .pq-call-card { order: -1; min-height: 260px; }
    .pq-minimal-rail { grid-template-columns: 1fr; }
    .pq-board-row { grid-template-columns: .7fr 1fr; }
    .pq-board-note { display: none; }
  }
  @media (max-height: 700px) {
    .pq-page { padding: 14px 18px; gap: 12px; }
    .pq-mark { width: 40px; height: 40px; border-radius: 11px; font-size: 20px; }
    .pq-panel { padding: 16px; border-radius: 16px; }
    .pq-panel-head { margin-bottom: 12px; }
    .pq-spotlight { padding: 14px 18px; margin-bottom: 14px; }
    .pq-spotlight-number { font-size: clamp(62px, 9vw, 110px); }
  }
`;

/**
 * A call screen is a TV across the room: it must never need scrolling. Numbers are as large as
 * the screen allows when the shop is quiet and shrink in steps as the board fills up.
 */
function numberSizes(count: number) {
  if (count <= 12) return { preparing: "clamp(28px, 3.2vw, 64px)", ready: "clamp(40px, 5vw, 96px)" };
  if (count <= 30) return { preparing: "clamp(22px, 2.4vw, 48px)", ready: "clamp(30px, 3.6vw, 72px)" };
  return { preparing: "clamp(18px, 1.8vw, 36px)", ready: "clamp(24px, 2.7vw, 54px)" };
}

export default function PickupQueueBoardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [settings, setSettings] = useState<BoardSettings | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState<{ label: string; until: number } | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean | null>(null);
  const [layout, setLayout] = useState<QueueBoardLayout>("SPOTLIGHT");
  const [audioStyle, setAudioStyle] = useState<QueueBoardAudioStyle>("AI_STUDIO");
  const [pageTick, setPageTick] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState<"AI_STUDIO" | "SYSTEM" | "CHIME" | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const settingsRef = useRef<BoardSettings | null>(null);
  // calledAt already announced per number; empty until the first load so opening the screen
  // does not replay every number that was called earlier.
  const announcedRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    void readPosDeviceToken().then((value) => setToken(value || ""));
  }, []);

  useEffect(() => {
    if (!token) {
      setSoundEnabled(null);
      return;
    }
    let active = true;
    let removeStorageListener = () => {};
    void posDeviceStorageNamespace(token).then((namespace) => {
      if (!active) return;
      const soundKey = queueBoardSoundStorageKey(namespace);
      const layoutKey = queueBoardLayoutStorageKey(namespace);
      const audioKey = queueBoardAudioStorageKey(namespace);
      setSoundEnabled(readQueueBoardSoundEnabled(namespace));
      setLayout(readQueueBoardLayout(namespace));
      setAudioStyle(readQueueBoardAudioStyle(namespace));
      const onStorage = (event: StorageEvent) => {
        if (event.key === soundKey) setSoundEnabled(event.newValue !== "0");
        if (event.key === layoutKey) setLayout(readQueueBoardLayout(namespace));
        if (event.key === audioKey) setAudioStyle(readQueueBoardAudioStyle(namespace));
      };
      window.addEventListener("storage", onStorage);
      removeStorageListener = () => window.removeEventListener("storage", onStorage);
    });
    return () => {
      active = false;
      removeStorageListener();
    };
  }, [token]);

  const startSound = useCallback(async (playFeedback: boolean) => {
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("AUDIO_CONTEXT_UNAVAILABLE");
      const context = audioRef.current ?? new Ctor();
      audioRef.current = context;
      await context.resume();
      if (context.state !== "running") throw new Error("AUDIO_CONTEXT_BLOCKED");
      const voiceSettings = applyQueueBoardAudioStyle(settings, audioStyle);
      const mode = voiceSettings.voiceMode ?? "AI_STUDIO";
      if (mode === "CHIME") {
        setVoiceStatus("CHIME");
      } else if (mode !== "OFF") {
        const ready = await preloadPickupQueueVoice(
          context,
          "A042",
          voiceSettings.voiceLanguage ?? "th",
          voiceSettings.voiceProfile ?? "KORE",
        );
        setVoiceStatus(ready ? "AI_STUDIO" : "SYSTEM");
      }
      if (playFeedback) playPickupQueueChime(
        context,
        voiceSettings.voiceVolume ?? 80,
        voiceSettings.chimeTone,
      );
      setSoundOn(true);
    } catch {
      setSoundOn(false);
    }
  }, [audioStyle, settings?.voiceLanguage, settings?.voiceMode, settings?.voiceRepeat, settings?.voiceVolume]);

  useEffect(() => {
    if (soundEnabled === null) return;
    if (soundEnabled) {
      void startSound(false);
      return;
    }
    const context = audioRef.current;
    audioRef.current = null;
    if (context) void context.close().catch(() => {});
    if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
    setSoundOn(false);
    setVoiceStatus(null);
  }, [soundEnabled, startSound]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/pos/pickup-queue?view=board", {
        headers: { "x-pos-device-token": token },
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // Keep the stored credential untouched because the cashier window may still need it.
          // Emptying only this page's local state stops polling and replaces a raw token error
          // with the operator workflow that can safely reopen the managed display.
          setEntries([]);
          setSettings(null);
          settingsRef.current = null;
          setSpotlight(null);
          setError(null);
          setOffline(false);
          setToken("");
          return;
        }
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      const next: BoardEntry[] = Array.isArray(data?.entries) ? data.entries : [];
      setEntries(next);
      const nextSettings = data?.settings && typeof data.settings === "object"
        ? data.settings as BoardSettings
        : settingsRef.current;
      if (nextSettings) {
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
      }
      setOffline(false);
      setError(null);

      const announced = announcedRef.current;
      const fresh: BoardEntry[] = [];
      const seen = new Map<string, string>();
      const serverNow = Date.parse(String(data?.serverTime ?? "")) || Date.now();
      for (const entry of next) {
        if (entry.status !== "READY" || !entry.calledAt) continue;
        seen.set(entry.label, entry.calledAt);
        const age = serverNow - Date.parse(entry.calledAt);
        if (announced && announced.get(entry.label) !== entry.calledAt && age <= ANNOUNCE_WINDOW_MS) {
          fresh.push(entry);
        }
      }
      announcedRef.current = seen;
      if (fresh.length > 0) {
        const latest = fresh.sort((a, b) => String(b.calledAt).localeCompare(String(a.calledAt)))[0];
        setSpotlight({ label: latest.label, until: Date.now() + Math.max(5, nextSettings?.spotlightSeconds ?? 12) * 1000 });
        const context = audioRef.current;
        const voiceSettings = applyQueueBoardAudioStyle(nextSettings, audioStyle);
        if (context && (voiceSettings.voiceMode ?? "AI_STUDIO") !== "OFF") {
          void playPickupQueueAnnouncement(context, latest.label, voiceSettings).then((result) => {
            setVoiceStatus(result.played ? "AI_STUDIO" : result.usedSystemVoice ? "SYSTEM" : "CHIME");
          });
        }
      }
    } catch {
      setOffline(true);
    }
  }, [audioStyle, token]);

  useEffect(() => {
    if (!token) return;
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [token, load]);

  useEffect(() => {
    if (!spotlight) return;
    const timer = window.setTimeout(() => setSpotlight(null), Math.max(0, spotlight.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [spotlight]);

  useEffect(() => {
    const timer = window.setInterval(() => setPageTick((value) => value + 1), 8000);
    return () => window.clearInterval(timer);
  }, []);

  const preparing = entries.filter((entry) => entry.status === "PREPARING");
  const ready = entries
    .filter((entry) => entry.status === "READY")
    .sort((a, b) => String(b.calledAt ?? b.readyAt).localeCompare(String(a.calledAt ?? a.readyAt)));

  const sizes = numberSizes(entries.length);
  const currentLabel = spotlight?.label ?? ready[0]?.label ?? null;
  const effectiveVoiceSettings = applyQueueBoardAudioStyle(settings, audioStyle);
  const chimeReadyLabel = audioStyle === "DOUBLE_BEEP"
    ? "บี๊บสองครั้งพร้อม"
    : audioStyle === "SOFT_PING" ? "เสียงนุ่มพร้อม" : "กระดิ่งเคาน์เตอร์พร้อม";
  const pageRows = (rows: BoardEntry[], limit: number) => {
    const pages = Math.max(1, Math.ceil(rows.length / limit));
    const pageIndex = pageTick % pages;
    return { rows: rows.slice(pageIndex * limit, pageIndex * limit + limit), pageIndex, pages };
  };
  const renderNumbers = (rows: BoardEntry[], kind: "preparing" | "ready", limit: number) => {
    const visible = pageRows(rows, limit);
    const size = kind === "preparing" ? sizes.preparing : sizes.ready;
    return <>
      <div className="pq-numbers">
        {rows.length === 0 && <span className="pq-empty">—</span>}
        {visible.rows.map((entry) => (
          <span key={entry.label}
            className={`pq-number pq-${kind}-number${spotlight?.label === entry.label ? " pq-current" : ""}`}
            style={{ fontSize: size }}>{entry.label}</span>
        ))}
      </div>
      {visible.pages > 1 && <div className="pq-overflow">
        หน้า {visible.pageIndex + 1}/{visible.pages} · ทั้งหมด {rows.length} คิว · สลับทุก 8 วินาที
      </div>}
    </>;
  };
  const preparingPanel = (limit = 12) => <section className={`pq-panel pq-preparing${preparing.length === 0 ? " is-empty" : ""}`}>
    <div className="pq-panel-head"><h2 className="pq-panel-title">กำลังเตรียม</h2><span className="pq-count">{preparing.length} คิว</span></div>
    {renderNumbers(preparing, "preparing", limit)}
  </section>;
  const readyPanel = (limit = 10, includeLiveCall = false) => <section className="pq-panel pq-ready">
    {includeLiveCall && spotlight && <div role="status" aria-live="assertive" className="pq-spotlight">
      <div><div className="pq-spotlight-kicker">กำลังเรียก</div><div className="pq-spotlight-title">เชิญรับที่เคาน์เตอร์</div></div>
      <div className="pq-spotlight-number">{spotlight.label}</div>
    </div>}
    <div className="pq-panel-head"><h2 className="pq-panel-title">พร้อมรับ</h2><span className="pq-count">{ready.length} คิว</span></div>
    {renderNumbers(ready, "ready", limit)}
  </section>;
  const callCard = <section className={`pq-call-card${spotlight ? " is-live" : ""}`}
    role={spotlight ? "status" : undefined} aria-live={spotlight ? "assertive" : undefined}>
    <div className="pq-call-copy">
      <div className="pq-call-kicker">{spotlight ? "กำลังเรียกตอนนี้" : "เรียกล่าสุด"}</div>
      <div className="pq-call-title">{spotlight
        ? "เชิญรับที่เคาน์เตอร์"
        : currentLabel ? "คิวพร้อมรับล่าสุด" : "ยังไม่มีคิวพร้อมรับ"}</div>
    </div>
    <div className="pq-call-number">{currentLabel ?? "—"}</div>
  </section>;
  const page: React.CSSProperties = {
    minHeight: "100vh", boxSizing: "border-box", padding: "24px 32px",
    background: "#0f172a", color: "#f8fafc", fontFamily: FONT, fontVariantNumeric: "tabular-nums",
    display: "flex", flexDirection: "column", gap: 20,
  };

  if (token === null) return <main style={page} />;
  if (!token) {
    return (
      <main style={{ ...page, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ fontSize: 30, fontWeight: 600 }}>เปิดจอเรียกคิวจากแอป BMS POS</div>
        <div style={{ fontSize: 18, color: "#cbd5e1" }}>POS → ตั้งค่า → จอภายนอก → จอเรียกคิว</div>
        <div style={{ maxWidth: 680, fontSize: 16, lineHeight: 1.6, color: "#94a3b8" }}>
          แอปจะเปิดหน้าต่างบนจอที่เลือกและส่งสิทธิ์ของเครื่องขายให้อัตโนมัติ ไม่ต้องคัดลอก URL นี้ไปเปิดใน Chrome
        </div>
      </main>
    );
  }

  return (
    <main className="pq-page" data-queue-layout={layout.toLowerCase()} data-queue-audio={audioStyle.toLowerCase()}>
      <style>{QUEUE_BOARD_CSS}</style>
      <header className="pq-header">
        <div className="pq-brand">
          <div className="pq-mark" aria-hidden="true">B</div>
          <div style={{ minWidth: 0 }}>
            <div className="pq-title">คิวรับของ</div>
            {settings?.branchName && <div className="pq-branch">{settings.branchName}</div>}
          </div>
        </div>
        <div className="pq-controls">
          {offline && <span className="pq-warning">กำลังเชื่อมต่อใหม่…</span>}
          {error && <span className="pq-error">{error}</span>}
          {soundEnabled === false && <span className="pq-sound-off">🔇 ปิดเสียงจากการตั้งค่าเครื่อง</span>}
          {soundEnabled === true && !soundOn && (
            <button type="button" onClick={() => void startSound(true)} className="pq-sound-button">
              🔊 แตะเพื่อเปิดเสียง
            </button>
          )}
          {soundEnabled === true && soundOn && effectiveVoiceSettings.voiceMode === "OFF" && (
            <span className="pq-sound-off">🔇 ปิดเสียงจากการตั้งค่าสาขา</span>
          )}
          {soundEnabled === true && soundOn && effectiveVoiceSettings.voiceMode !== "OFF" && (
            <span className={voiceStatus === "CHIME" ? "pq-warning" : "pq-sound-state"}>
              {effectiveVoiceSettings.voiceMode === "CHIME"
                ? chimeReadyLabel
                : voiceStatus === "AI_STUDIO"
                  ? "AI Studio voice พร้อม"
                  : voiceStatus === "SYSTEM"
                    ? "ใช้เสียงพูดภาษาไทยของเครื่อง"
                    : voiceStatus === "CHIME" ? "ใช้กริ่งสำรอง" : "กำลังเตรียมเสียง…"}
            </span>
          )}
        </div>
      </header>

      {settings?.boardMessage && <div className="pq-message">
        {settings.boardMessage}
      </div>}

      {layout === "SPOTLIGHT" && <div className="pq-layout pq-spotlight-layout">
        {callCard}<div className="pq-layout-lower">{preparingPanel(9)}{readyPanel(8)}</div>
      </div>}
      {layout === "THREE_ZONE" && <div className="pq-layout pq-three-layout">
        {preparingPanel(10)}{callCard}{readyPanel(8)}
      </div>}
      {layout === "TICKER" && <div className="pq-layout pq-ticker-layout">
        <div className="pq-ticker-upper">{callCard}{readyPanel(6)}</div>
        <div className="pq-ticker-preparing">{preparingPanel(14)}</div>
      </div>}
      {layout === "MINIMAL" && <div className="pq-layout pq-minimal-layout">
        {callCard}
        <section className="pq-minimal-rail">
          <div><div className="pq-panel-title">พร้อมรับ</div><div className="pq-count">{ready.length} คิว</div></div>
          {renderNumbers(ready, "ready", 5)}
          <div className="pq-minimal-preparing">กำลังเตรียม {preparing.length} คิว</div>
        </section>
      </div>}
      {layout === "AIRPORT" && (() => {
        const ordered = [...ready, ...preparing];
        const visible = pageRows(ordered, 9);
        return <div className="pq-layout pq-airport-layout">
          <div className="pq-board-row pq-board-head"><span>หมายเลขคิว</span><span>สถานะ</span><span>จุดรับอาหาร</span></div>
          {visible.rows.map((entry) => <div key={`${entry.status}-${entry.label}`}
            className={`pq-board-row ${spotlight?.label === entry.label ? "current" : entry.status === "READY" ? "ready" : ""}`}>
            <div className="pq-board-no">{entry.label}</div>
            <div className="pq-board-status">{spotlight?.label === entry.label ? "กำลังเรียก" : entry.status === "READY" ? "พร้อมรับ" : "กำลังเตรียม"}</div>
            <div className="pq-board-note">{entry.status === "READY" ? "เชิญรับที่เคาน์เตอร์" : "กรุณารอสักครู่"}</div>
          </div>)}
          <div className="pq-board-footer">หน้า {visible.pageIndex + 1}/{visible.pages} · ทั้งหมด {ordered.length} คิว · สลับทุก 8 วินาที</div>
        </div>;
      })()}
      {layout === "SPLIT" && <div className="pq-grid">
        {preparingPanel(16)}{readyPanel(12, true)}
      </div>}
    </main>
  );
}
