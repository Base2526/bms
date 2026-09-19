"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import styles from "./page.module.css";

type Call = {
  id: string;
  requestCode: string;
  requestNote: string | null;
  status: "PENDING" | "ACKNOWLEDGED" | "COMPLETED" | "EXPIRED";
  createdAt: string;
};
type Bootstrap = {
  status: "READY";
  storeName: string;
  locationName: string;
  tableCode: string;
  tableName: string;
  billingMode: string;
};

const OPTIONS = [
  {
    code: "GAME_HELP",
    icon: "📘",
    th: "ช่วยสอนหรืออธิบายเกม",
    en: "Game rules help",
  },
  {
    code: "GAME_ISSUE",
    icon: "🎲",
    th: "ชิ้นส่วนขาด / เกมชำรุด",
    en: "Missing or damaged pieces",
  },
  {
    code: "FOOD_DRINK",
    icon: "🥤",
    th: "อาหารหรือเครื่องดื่ม",
    en: "Food or drinks",
  },
  { code: "BILL", icon: "🧾", th: "ขอคิดเงิน", en: "Ask for the bill" },
  {
    code: "EXTEND_TIME",
    icon: "⏱",
    th: "ขอต่อเวลา",
    en: "Extend play time",
    fixedOnly: true,
  },
  {
    code: "CLEANUP",
    icon: "⚠️",
    th: "น้ำหก / ขอทำความสะอาด",
    en: "Spill or cleanup",
  },
  { code: "OTHER", icon: "🔔", th: "อื่น ๆ", en: "Something else" },
] as const;

async function api<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  headers.set("x-bms-board-game-guest", token);
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body as T;
}

export default function BoardGameGuestPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? "");
  const [lang, setLang] = useState<"th" | "en">("th");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef<string | null>(null);
  const th = lang === "th";

  const loadCalls = useCallback(async () => {
    const result = await api<{ calls: Call[] }>(
      "/api/bms/board-game-guest/service-calls",
      token
    );
    setCalls(result.calls);
  }, [token]);

  useEffect(() => {
    void (async () => {
      try {
        const state = await api<Bootstrap>(
          `/api/bms/board-game-guest/${encodeURIComponent(token)}`,
          token
        );
        setBootstrap(state);
        await loadCalls();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Link unavailable");
      }
    })();
  }, [loadCalls, token]);

  useEffect(() => {
    if (!bootstrap) return;
    const timer = window.setInterval(
      () => void loadCalls().catch(() => undefined),
      5000
    );
    return () => window.clearInterval(timer);
  }, [bootstrap, loadCalls]);

  const pending = calls.find((call) => call.status === "PENDING");
  const active =
    calls.find((call) => call.status === "ACKNOWLEDGED") ?? pending;
  const activeOption = OPTIONS.find((option) => option.code === active?.requestCode);
  const activeLabel = activeOption
    ? th ? activeOption.th : activeOption.en
    : active?.requestNote || (th ? "คำขอความช่วยเหลือ" : "Help request");
  const options = OPTIONS.filter(
    (option) =>
      !("fixedOnly" in option) || bootstrap?.billingMode === "FIXED_DURATION"
  );

  async function submit() {
    if (!selected || busy) return;
    if (selected === "OTHER" && note.trim().length < 3) {
      setError(
        th
          ? "กรุณาระบุสิ่งที่ต้องการอย่างน้อย 3 ตัวอักษร"
          : "Please add at least 3 characters"
      );
      return;
    }
    setBusy(true);
    setError("");
    requestKey.current ||= crypto.randomUUID();
    try {
      await api("/api/bms/board-game-guest/service-calls", token, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: requestKey.current,
          requestCode: selected,
          requestNote: note.trim() || null,
        }),
      });
      requestKey.current = null;
      setSelected(null);
      setNote("");
      await loadCalls();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Call failed");
    } finally {
      setBusy(false);
    }
  }

  if (!bootstrap) {
    return (
      <main className={styles.center}>
        <div>
          <span>{error ? "⚠️" : "🎲"}</span>
          <h1>{error || (th ? "กำลังเปิดโต๊ะ…" : "Opening table…")}</h1>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <strong>{bootstrap.storeName}</strong>
          <small>{bootstrap.locationName}</small>
        </div>
        <button type="button" onClick={() => setLang(th ? "en" : "th")}>
          {th ? "EN" : "ไทย"}
        </button>
      </header>
      <section className={styles.hero}>
        <span>🎲</span>
        <div>
          <small>{th ? "กำลังเล่นที่" : "Playing at"}</small>
          <h1>{bootstrap.tableName || bootstrap.tableCode}</h1>
        </div>
      </section>
      {active ? (
        <section className={styles.active} data-status={active.status}>
          <span>🔔</span>
          <div>
            <strong>
              {active.status === "ACKNOWLEDGED"
                ? th
                  ? "พนักงานกำลังไปที่โต๊ะ"
                  : "Staff are coming to your table"
                : th
                ? "ส่งคำเรียกแล้ว"
                : "Request sent"}
            </strong>
            <small>
              {active.status === "ACKNOWLEDGED"
                ? th
                  ? `${activeLabel} · ตอนนี้ไม่ต้องกดอะไร เมื่อดูแลเสร็จหน้านี้จะกลับมาให้เรียกใหม่`
                  : `${activeLabel} · Nothing else to tap. This page will reset when staff finish.`
                : th
                ? `${activeLabel} · กรุณารอพนักงานกดรับเรื่อง`
                : `${activeLabel} · Waiting for staff to accept the request.`}
            </small>
          </div>
        </section>
      ) : (
        <>
          <div className={styles.heading}>
            <h2>{th ? "ต้องการให้ช่วยอะไร" : "How can we help?"}</h2>
            <p>
              {th
                ? "เลือกหนึ่งรายการเพื่อแจ้งพนักงาน"
                : "Choose one request for staff"}
            </p>
          </div>
          <section className={styles.grid}>
            {options.map((option) => (
              <button
                type="button"
                key={option.code}
                data-selected={selected === option.code}
                onClick={() => setSelected(option.code)}
              >
                <span>{option.icon}</span>
                <b>{th ? option.th : option.en}</b>
              </button>
            ))}
          </section>
          {selected === "OTHER" || selected === "GAME_ISSUE" ? (
            <textarea
              value={note}
              maxLength={200}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                selected === "GAME_ISSUE"
                  ? th
                    ? "ระบุชื่อเกมและชิ้นส่วนที่ขาดหรือชำรุด (ถ้าทราบ)…"
                    : "Game and missing or damaged piece (optional)…"
                  : th
                  ? "ระบุสิ่งที่ต้องการ…"
                  : "Describe what you need…"
              }
            />
          ) : null}
          <button
            className={styles.submit}
            type="button"
            disabled={!selected || busy}
            onClick={() => void submit()}
          >
            {busy
              ? th
                ? "กำลังส่ง…"
                : "Sending…"
              : th
              ? "🔔 เรียกพนักงาน"
              : "🔔 Call staff"}
          </button>
        </>
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <p className={styles.note}>
        {th
          ? "คำขอนี้ไม่เพิ่มรายการในบิลและไม่เปลี่ยนเวลาเล่นโดยอัตโนมัติ"
          : "This request does not change your bill or play time automatically."}
      </p>
    </main>
  );
}
