"use client";

import React from "react";
import { gql, useSubscription } from "@apollo/client";

import { BoundedEventDeduplicator, validateRealtimeEvent, type RealtimeEvent } from "../../../../packages/realtime/src/events";
import type { RealtimeConnectionStatus } from "@/lib/apollo";
import { useSessionCtx } from "@/lib/session-context";

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

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { admin } = useSessionCtx();
  const scopeKey = admin?.id ? `${admin.id}:${admin.tenant_id ?? "platform"}` : "none";
  const [status, setStatus] = React.useState<RealtimeConnectionStatus>(
    typeof navigator !== "undefined" && navigator.onLine ? "connecting" : "offline",
  );
  const [event, setEvent] = React.useState<RealtimeEvent | null>(null);
  const [lastEventAt, setLastEventAt] = React.useState<number | null>(null);
  const dedup = React.useRef(new BoundedEventDeduplicator(1024));

  React.useEffect(() => {
    dedup.current.clear();
    setEvent(null);
    setLastEventAt(null);
  }, [scopeKey]);

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
    skip: !admin?.id,
    onData: ({ data }) => {
      try {
        const next = validateRealtimeEvent(data.data?.realtimeEvent);
        if (!dedup.current.remember(next.eventId)) return;
        setEvent(next);
        setLastEventAt(Date.now());
      } catch {
        setStatus("degraded");
      }
    },
    onError: () => setStatus(typeof navigator !== "undefined" && navigator.onLine ? "degraded" : "offline"),
  });

  const value = React.useMemo(() => ({ status, event, lastEventAt }), [status, event, lastEventAt]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
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
