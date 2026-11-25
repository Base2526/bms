"use client";

import { safePosAttemptId } from "@pos-core/connectionFailure";
import { isAllowedPosDiagnosticAction, safePosDiagnosticErrorCode, safePosDiagnosticReason,
  safePosDiagnosticRoute } from "@pos-core/diagnosticOperations";

const SESSION_KEY = "bms.support.session.v1";
const MAX_LOCAL_EVENTS = 1000;
let storageError = false;

export type LocalSupportEvent = {
  eventId: string;
  occurredAt: string;
  sessionId: string;
  correlationId?: string | null;
  locationId?: string | null;
  deviceId?: string | null;
  category: string;
  action: string;
  status?: string | null;
  message?: string | null;
  context?: Record<string, string | number | boolean | null>;
  delivery?: "pending" | "rejected";
  rejectReason?: string;
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
  try {
    let value = window.sessionStorage.getItem(SESSION_KEY);
    if (!value) {
      value = eventId();
      window.sessionStorage.setItem(SESSION_KEY, value);
    }
    return value;
  } catch { storageError = true; return eventId(); }
}

function safeBrowserRoute(value: unknown): string | null {
  const posRoute = safePosDiagnosticRoute(value);
  if (posRoute) return posRoute;
  if (typeof value !== "string") return null;
  if (value === "/admin/support-diagnostics" || value === "/admin/pos-devices") return value;
  if (value === "/admin" || value.startsWith("/admin/")) return "/admin";
  return null;
}

const BROWSER_ACTIONS = new Set(["ui.route_view", "network.online", "network.offline",
  "ui.window_error", "ui.unhandled_rejection", "support.bundle_send_confirmed",
  "support.activity_gap"]);

function safeEvent(event: LocalSupportEvent): LocalSupportEvent {
  const base: LocalSupportEvent = {
    eventId: event.eventId, occurredAt: event.occurredAt, sessionId: event.sessionId,
    correlationId: event.correlationId, locationId: event.locationId, deviceId: event.deviceId,
    category: event.category, action: event.action, status: event.status, context: event.context,
    message: null,
    delivery: event.delivery === "rejected" ? "rejected" as const : "pending" as const,
    rejectReason: safePosDiagnosticReason(event.rejectReason) ?? undefined,
  };
  if (event.category !== "pos") {
    const context = event.context ?? {};
    const route = safeBrowserRoute(context.route);
    const previousRoute = safeBrowserRoute(context.previousRoute);
    const errorName = typeof context.errorName === "string" &&
      /^(?:Error|TypeError|AbortError|TimeoutError|NetworkError|FetchError|SyntaxError|ApolloError)$/.test(context.errorName)
      ? context.errorName : null;
    const clean: LocalSupportEvent["context"] = {
      ...(route ? { route } : {}), ...(previousRoute ? { previousRoute } : {}),
      ...(errorName ? { errorName } : {}),
      ...(typeof context.online === "boolean" ? { online: context.online } : {}),
    };
    if (event.action === "support.activity_gap") {
      if (Number.isInteger(context.droppedCount) && Number(context.droppedCount) > 0)
        clean.droppedCount = Math.min(Number(context.droppedCount), 1_000_000);
      for (const key of ["gapFrom", "gapTo"] as const) {
        const value = context[key];
        if (typeof value === "string" && Number.isFinite(Date.parse(value))) clean[key] = new Date(value).toISOString();
      }
      if (safePosDiagnosticReason(context.gapReason)) clean.gapReason = context.gapReason;
    }
    return { ...base, eventId: safePosAttemptId(event.eventId) ?? eventId(),
      occurredAt: Number.isFinite(Date.parse(event.occurredAt))
        ? new Date(event.occurredAt).toISOString() : new Date().toISOString(),
      sessionId: safePosAttemptId(event.sessionId) ?? "",
      correlationId: safePosAttemptId(event.correlationId),
      locationId: safePosAttemptId(event.locationId), deviceId: safePosAttemptId(event.deviceId),
      category: ["navigation", "network", "ui", "support"].includes(event.category) ? event.category : "support",
      action: BROWSER_ACTIONS.has(event.action) ? event.action : "support.unknown_event",
      status: ["success", "error", "warning", "info"].includes(String(event.status)) ? event.status : "info",
      context: clean };
  }
  const context = event.context ?? {};
  const route = safePosDiagnosticRoute(context.route);
  const clean: LocalSupportEvent["context"] = {
    source: "restaurant-pos",
    ...(route ? { route } : {}),
    ...(context.errorCode != null ? { errorCode: safePosDiagnosticErrorCode(context.errorCode) } : {}),
    ...(Number.isInteger(context.httpStatus) && Number(context.httpStatus) >= 100 && Number(context.httpStatus) <= 599
      ? { httpStatus: Number(context.httpStatus) } : {}),
    ...(typeof context.durationMs === "number" && Number.isFinite(context.durationMs) && context.durationMs >= 0 && context.durationMs <= 120_000
      ? { durationMs: Math.round(context.durationMs) } : {}),
    ...(typeof context.online === "boolean" ? { online: context.online } : {}),
    ...(typeof context.serverResponded === "boolean" ? { serverResponded: context.serverResponded } : {}),
    ...(["unknown", "rejected", "read_failed"].includes(String(context.outcome)) ? { outcome: context.outcome } : {}),
  };
  if (event.action === "pos.diagnostic_gap") {
    if (Number.isInteger(context.droppedCount) && Number(context.droppedCount) > 0)
      clean.droppedCount = Math.min(Number(context.droppedCount), 1_000_000);
    for (const key of ["gapFrom", "gapTo"] as const) {
      const value = context[key];
      if (typeof value === "string" && Number.isFinite(Date.parse(value))) clean[key] = new Date(value).toISOString();
    }
    if (safePosDiagnosticReason(context.gapReason)) clean.gapReason = context.gapReason;
  }
  return { ...base, category: "pos", sessionId: "",
    eventId: safePosAttemptId(event.eventId) ?? eventId(),
    occurredAt: Number.isFinite(Date.parse(event.occurredAt))
      ? new Date(event.occurredAt).toISOString() : new Date().toISOString(),
    deviceId: safePosAttemptId(event.deviceId), locationId: safePosAttemptId(event.locationId),
    status: ["success", "error", "warning", "info"].includes(String(event.status)) ? event.status : "error",
    action: isAllowedPosDiagnosticAction(event.action) ? event.action : "pos.unknown_operation",
    correlationId: safePosAttemptId(event.correlationId), context: clean };
}

function bound(scopeKey: string, events: LocalSupportEvent[]): LocalSupportEvent[] {
  const markerAction = scopeKey.startsWith("pos-") ? "pos.diagnostic_gap" : "support.activity_gap";
  const marker = events.find(event => event.action === markerAction && event.delivery !== "rejected");
  const regular = events.filter(event => event !== marker);
  if (regular.length + (marker ? 1 : 0) <= MAX_LOCAL_EVENTS) return events;
  const dropped = regular.splice(0, regular.length - MAX_LOCAL_EVENTS + 1);
  const oldMarkers = dropped.filter(event => event.action === markerAction);
  const previousCount = (Number(marker?.context?.droppedCount) || 0)
    + oldMarkers.reduce((sum, event) => sum + (Number(event.context?.droppedCount) || 0), 0);
  const first = typeof marker?.context?.gapFrom === "string" ? marker.context.gapFrom
    : typeof dropped[0].context?.gapFrom === "string" ? dropped[0].context.gapFrom : dropped[0].occurredAt;
  const lastDropped = dropped.at(-1)!;
  const last = typeof lastDropped.context?.gapTo === "string" ? lastDropped.context.gapTo : lastDropped.occurredAt;
  const gapEvent: LocalSupportEvent = {
    eventId: marker?.eventId ?? eventId(), occurredAt: marker?.occurredAt ?? new Date().toISOString(),
    sessionId: scopeKey.startsWith("pos-") ? "" : marker?.sessionId ?? sessionId(),
    category: scopeKey.startsWith("pos-") ? "pos" : "support",
    action: markerAction, status: "warning", delivery: "pending", message: null,
    context: { errorCode: "POS_DIAGNOSTIC_GAP", source: scopeKey.startsWith("pos-") ? "restaurant-pos" : "admin",
      droppedCount: Math.min(previousCount + dropped.length - oldMarkers.length, 1_000_000), gapFrom: first, gapTo: last,
      gapReason: oldMarkers.length ? "gap_summary_rotated" : "local_capacity" },
  };
  return [gapEvent, ...regular];
}

function read(scopeKey: string): LocalSupportEvent[] {
  const key = storageKey(scopeKey);
  if (!key) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const cleaned = bound(scopeKey, parsed.filter((item): item is LocalSupportEvent => item && typeof item === "object"
      && typeof item.eventId === "string" && typeof item.occurredAt === "string"
      && Number.isFinite(Date.parse(item.occurredAt))).map(safeEvent));
    if (JSON.stringify(cleaned) !== JSON.stringify(parsed)) write(scopeKey, cleaned);
    return cleaned;
  } catch { storageError = true; return []; }
}

function write(scopeKey: string, events: LocalSupportEvent[]) {
  const key = storageKey(scopeKey);
  if (!key) return;
  try {
    if (events.length) window.localStorage.setItem(key, JSON.stringify(bound(scopeKey, events)));
    else window.localStorage.removeItem(key);
  } catch { storageError = true; }
}

export function recordSupportActivity(scopeKey: string, event: Omit<LocalSupportEvent, "eventId" | "occurredAt" | "sessionId">) {
  if (typeof window === "undefined" || !storageKey(scopeKey)) return;
  const next = bound(scopeKey, [...read(scopeKey), safeEvent({ ...event,
    eventId: eventId(), occurredAt: new Date().toISOString(), sessionId: sessionId() })]);
  write(scopeKey, next);
}

export async function flushSupportActivity(scopeKey: string, options: FlushOptions = {}): Promise<number> {
  if (typeof window === "undefined") return 0;
  const events = read(scopeKey).filter(event => event.delivery !== "rejected");
  if (!events.length) return 0;
  let sent = 0;
  while (sent < events.length) {
    const batch = events.slice(sent, sent + 100);
    const response = await fetch(options.url ?? "/api/bms/support-diagnostics/events", {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
      body: JSON.stringify({ ...(options.body ?? {}), events: batch.map(({ delivery: _delivery, rejectReason: _reason, ...item }) => item) }),
      cache: "no-store",
      keepalive: true,
    });
    if (!response.ok) throw new Error(`ส่ง activity log ไม่สำเร็จ (${response.status})`);
    const ack = await response.json().catch(() => null) as { results?: Array<{ index: number; eventId: string | null;
      status: "accepted" | "duplicate" | "rejected"; reason?: string }> } | null;
    if (!Array.isArray(ack?.results) || ack.results.length !== batch.length || ack.results.some((row, index) =>
      row?.index !== index || row.eventId !== batch[index].eventId
      || !["accepted", "duplicate", "rejected"].includes(row.status)))
      throw new Error("เซิร์ฟเวอร์ไม่ยืนยันผลการส่งหลักฐานครบทุกเหตุการณ์");
    const sentIds = new Set(ack.results.filter(row => row.status === "accepted" || row.status === "duplicate")
      .map(row => row.eventId));
    const rejected = new Map(ack.results.filter(row => row.status === "rejected")
      .map(row => [row.eventId, safePosDiagnosticReason(row.reason) ?? "server_rejected"]));
    write(scopeKey, read(scopeKey).filter(event => !sentIds.has(event.eventId)).map(event =>
      rejected.has(event.eventId) ? { ...event, delivery: "rejected" as const,
        rejectReason: rejected.get(event.eventId) } : event));
    sent += batch.length;
  }
  return events.length - read(scopeKey).filter(event => events.some(sentEvent => sentEvent.eventId === event.eventId)).length;
}

export function localSupportEventCount(scopeKey: string) {
  return typeof window === "undefined" ? 0 : read(scopeKey).length;
}

export function localSupportEvidenceSummary(scopeKey: string) {
  const events = typeof window === "undefined" ? [] : read(scopeKey);
  return { pending: events.filter(event => event.delivery !== "rejected").length, storageError,
    rejected: events.filter(event => event.delivery === "rejected").length,
    dropped: events.filter(event => event.action === "pos.diagnostic_gap" || event.action === "support.activity_gap")
      .reduce((sum, event) => sum + (Number(event.context?.droppedCount) || 0), 0) };
}
