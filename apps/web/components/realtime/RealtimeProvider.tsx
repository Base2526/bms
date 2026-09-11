"use client";

import React from "react";
import { gql, useApolloClient, useSubscription } from "@apollo/client";

import { BoundedEventDeduplicator, validateRealtimeEvent, type RealtimeEvent } from "../../../../packages/realtime/src/events";
import type { RealtimeConnectionStatus } from "@/lib/apollo";
import { useSessionCtx } from "@/lib/session-context";
import { useI18n } from "@/lib/i18nContext";
import { queryNeedsRealtimeRefetch } from "./realtimeInvalidation";

const S_REALTIME = gql`
  subscription RealtimeEvents {
    realtimeEvent {
      eventId eventType schemaVersion tenantId locationId userId actorType actorId deviceId
      entityType entityId aggregateVersion updatedAt occurredAt payload
    }
  }
`;

type RealtimeContextValue = {
  status: RealtimeConnectionStatus;
  event: RealtimeEvent | null;
  lastEventAt: number | null;
};

const RealtimeContext = React.createContext<RealtimeContextValue>({
  status: "offline",
  event: null,
  lastEventAt: null,
});

function RealtimeTransportProvider({
  children,
  enabled,
  scopeKey,
}: {
  children: React.ReactNode;
  enabled: boolean;
  scopeKey: string;
}) {
  const apollo = useApolloClient();
  const [status, setStatus] = React.useState<RealtimeConnectionStatus>(
    typeof navigator !== "undefined" && navigator.onLine ? "connecting" : "offline",
  );
  const [event, setEvent] = React.useState<RealtimeEvent | null>(null);
  const [lastEventAt, setLastEventAt] = React.useState<number | null>(null);
  const dedup = React.useRef(new BoundedEventDeduplicator(1024));
  const aggregateState = React.useRef(new Map<string, { version?: number; updatedAt?: number }>());
  const invalidationQueue = React.useRef<RealtimeEvent[]>([]);
  const invalidationTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetchForEvents = React.useCallback(async (events: RealtimeEvent[]) => {
    if (events.length === 0) {
      await apollo.refetchQueries({ include: "active" });
      return;
    }
    const types = new Set(events.map((item) => item.eventType));
    await apollo.refetchQueries({
      include: "active",
      onQueryUpdated(observable) {
        return [...types].some((type) => queryNeedsRealtimeRefetch(observable.options.query, type))
          ? observable.refetch()
          : false;
      },
    });
  }, [apollo]);

  const queueInvalidation = React.useCallback((next: RealtimeEvent) => {
    invalidationQueue.current.push(next);
    if (invalidationTimer.current) return;
    invalidationTimer.current = setTimeout(() => {
      const batch = invalidationQueue.current.splice(0);
      invalidationTimer.current = null;
      void refetchForEvents(batch);
    }, next.eventType === "dashboard.invalidated" ? 500 : 150);
  }, [refetchForEvents]);

  React.useEffect(() => {
    dedup.current.clear();
    aggregateState.current.clear();
    invalidationQueue.current.length = 0;
    if (invalidationTimer.current) clearTimeout(invalidationTimer.current);
    invalidationTimer.current = null;
    setEvent(null);
    setLastEventAt(null);
  }, [scopeKey]);

  React.useEffect(() => () => {
    if (invalidationTimer.current) clearTimeout(invalidationTimer.current);
  }, []);

  React.useEffect(() => {
    const onStatus = (raw: Event) => {
      const next = (raw as CustomEvent<{ status?: RealtimeConnectionStatus }>).detail?.status;
      if (next) setStatus(next);
    };
    const online = () => setStatus((current) => current === "connected" ? current : "reconnecting");
    const offline = () => setStatus("offline");
    window.addEventListener("bms-realtime-status", onStatus);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("bms-realtime-status", onStatus);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  useSubscription(S_REALTIME, {
    skip: !enabled,
    onData: ({ data }) => {
      try {
        const next = validateRealtimeEvent(data.data?.realtimeEvent);
        if (!dedup.current.remember(next.eventId)) return;
        const aggregateKey = `${next.tenantId}:${next.locationId ?? ""}:${next.entityType}:${next.entityId}`;
        const prior = aggregateState.current.get(aggregateKey);
        const nextUpdatedAt = next.updatedAt ? Date.parse(next.updatedAt) : undefined;
        const stale = next.aggregateVersion !== undefined && prior?.version !== undefined
          ? next.aggregateVersion <= prior.version
          : nextUpdatedAt !== undefined && prior?.updatedAt !== undefined
            ? nextUpdatedAt < prior.updatedAt
            : false;
        queueInvalidation(next);
        if (stale) return;
        aggregateState.current.set(aggregateKey, {
          version: next.aggregateVersion ?? prior?.version,
          updatedAt: nextUpdatedAt ?? prior?.updatedAt,
        });
        setEvent(next);
        setLastEventAt(Date.now());
      } catch {
        setStatus("degraded");
      }
    },
    onError: () => setStatus(typeof navigator !== "undefined" && navigator.onLine ? "degraded" : "offline"),
  });

  React.useEffect(() => {
    if (!enabled) return;
    const reconcile = () => {
      if (document.visibilityState === "visible") void refetchForEvents([]);
    };
    const onStatus = (raw: Event) => {
      if ((raw as CustomEvent<{ status?: RealtimeConnectionStatus }>).detail?.status === "connected") {
        void refetchForEvents([]);
      }
    };
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("bms-realtime-status", onStatus);
    return () => {
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("bms-realtime-status", onStatus);
    };
  }, [enabled, scopeKey, refetchForEvents]);

  const value = React.useMemo(() => ({ status, event, lastEventAt }), [status, event, lastEventAt]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { admin } = useSessionCtx();
  const scopeKey = admin?.id ? `${admin.id}:${admin.tenant_id ?? "platform"}` : "none";
  return (
    <RealtimeTransportProvider enabled={Boolean(admin?.id)} scopeKey={scopeKey}>
      {children}
    </RealtimeTransportProvider>
  );
}

export function PosRealtimeProvider({ children }: { children: React.ReactNode }) {
  const [tokenGeneration, setTokenGeneration] = React.useState(0);
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    const refresh = () => {
      setEnabled(Boolean(window.localStorage.getItem("bms.pos.deviceToken")));
      setTokenGeneration((value) => value + 1);
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("bms-pos-device-token-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("bms-pos-device-token-changed", refresh);
    };
  }, []);
  return (
    <RealtimeTransportProvider enabled={enabled} scopeKey={`pos:${tokenGeneration}`}>
      {children}
      {enabled ? <PosRealtimeIndicator /> : null}
    </RealtimeTransportProvider>
  );
}

function PosRealtimeIndicator() {
  const { t } = useI18n();
  const { status } = useRealtimeStatus();
  if (status === "connected") return null;
  const key = status === "offline"
    ? "admin.realtime_offline"
    : status === "degraded"
      ? "admin.realtime_degraded"
      : status === "reconnecting"
        ? "admin.realtime_reconnecting"
        : "admin.realtime_connecting";
  return (
    <div role="status" aria-live="polite" style={{
      position: "fixed",
      zIndex: 1200,
      left: "max(12px, env(safe-area-inset-left))",
      right: "max(12px, env(safe-area-inset-right))",
      bottom: "max(12px, env(safe-area-inset-bottom))",
      border: "1px solid var(--app-border)",
      borderRadius: 8,
      padding: "8px 12px",
      color: "var(--text-secondary)",
      background: "var(--app-surface-2)",
      boxShadow: "0 8px 24px rgba(var(--app-shadow-rgb), .18)",
      fontSize: 13,
    }}>
      {t(key)}
    </div>
  );
}

export function useRealtimeStatus() {
  return React.useContext(RealtimeContext);
}

export function useRealtimeInvalidation(input: {
  eventTypes: readonly RealtimeEvent["eventType"][];
  onInvalidate: (events: RealtimeEvent[]) => void | Promise<void>;
  debounceMs?: number;
}) {
  const { event, status } = useRealtimeStatus();
  const callback = React.useRef(input.onInvalidate);
  const connectedOnce = React.useRef(false);
  const pending = React.useRef<RealtimeEvent[]>([]);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  callback.current = input.onInvalidate;
  const eventTypes = input.eventTypes.join("|");

  React.useEffect(() => {
    if (!event || !input.eventTypes.includes(event.eventType)) return;
    pending.current.push(event);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      const batch = pending.current.splice(0);
      timer.current = null;
      void callback.current(batch);
    }, input.debounceMs ?? 150);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [event?.eventId, eventTypes, input.debounceMs]);

  React.useEffect(() => {
    if (status !== "connected") return;
    if (connectedOnce.current) void callback.current([]);
    connectedOnce.current = true;
  }, [status]);

  React.useEffect(() => {
    const reconcile = () => {
      if (document.visibilityState === "visible") void callback.current([]);
    };
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, []);

  return status;
}
