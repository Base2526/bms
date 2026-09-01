"use client";

const SESSION_KEY = "bms.support.session.v1";
const MAX_LOCAL_EVENTS = 1000;

export type LocalSupportEvent = {
  eventId: string;
  occurredAt: string;
  sessionId: string;
  locationId?: string | null;
  deviceId?: string | null;
  category: string;
  action: string;
  status?: string | null;
  message?: string | null;
  context?: Record<string, string | number | boolean | null>;
};

type FlushOptions = {
  url?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

function eventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function storageKey(scopeKey: string) {
  const safe = String(scopeKey ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160);
  return safe ? `bms.support.activity.v2.${safe}` : null;
}

function sessionId() {
  let value = window.sessionStorage.getItem(SESSION_KEY);
  if (!value) {
    value = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(SESSION_KEY, value);
  }
  return value;
}

function read(scopeKey: string): LocalSupportEvent[] {
  const key = storageKey(scopeKey);
  if (!key) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(-MAX_LOCAL_EVENTS) : [];
  } catch { return []; }
}

function write(scopeKey: string, events: LocalSupportEvent[]) {
  const key = storageKey(scopeKey);
  if (!key) return;
  try {
    if (events.length) window.localStorage.setItem(key, JSON.stringify(events.slice(-MAX_LOCAL_EVENTS)));
    else window.localStorage.removeItem(key);
  } catch {}
}

export function recordSupportActivity(scopeKey: string, event: Omit<LocalSupportEvent, "eventId" | "occurredAt" | "sessionId">) {
  if (typeof window === "undefined" || !storageKey(scopeKey)) return;
  const next = [...read(scopeKey), { ...event, eventId: eventId(), occurredAt: new Date().toISOString(), sessionId: sessionId() }]
    .slice(-MAX_LOCAL_EVENTS);
  write(scopeKey, next);
}

export async function flushSupportActivity(scopeKey: string, options: FlushOptions = {}): Promise<number> {
  if (typeof window === "undefined") return 0;
  const events = read(scopeKey);
  if (!events.length) return 0;
  let sent = 0;
  while (sent < events.length) {
    const batch = events.slice(sent, sent + 100);
    const response = await fetch(options.url ?? "/api/bms/support-diagnostics/events", {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
      body: JSON.stringify({ ...(options.body ?? {}), events: batch }),
      cache: "no-store",
      keepalive: true,
    });
    if (!response.ok) throw new Error(`ส่ง activity log ไม่สำเร็จ (${response.status})`);
    sent += batch.length;
  }
  // Idempotent event ids make retry safe. Remove only the exact snapshot sent so events created
  // by this or another tab while the request was in flight survive the flush.
  const sentIds = new Set(events.map((event) => event.eventId));
  write(scopeKey, read(scopeKey).filter((event) => !sentIds.has(event.eventId)));
  return sent;
}

export function localSupportEventCount(scopeKey: string) {
  return typeof window === "undefined" ? 0 : read(scopeKey).length;
}
