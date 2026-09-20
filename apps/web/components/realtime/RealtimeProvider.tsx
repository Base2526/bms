"use client";

import React from "react";
import { gql, useApolloClient, useSubscription, type DocumentNode } from "@apollo/client";
import { usePathname } from "next/navigation";

import { BoundedEventDeduplicator, validateRealtimeEvent, type RealtimeEvent } from "../../../../packages/realtime/src/events";
import type { RealtimeConnectionStatus } from "@/lib/apollo";
import { useSessionCtx } from "@/lib/session-context";
import { useI18n } from "@/lib/i18nContext";
import { queryNeedsRealtimeRefetch } from "./realtimeInvalidation";
import { readPosDeviceToken } from "@/lib/pos/deviceTokenClient";
import styles from "./RealtimeProvider.module.css";

const REALTIME_EVENT_FIELDS = gql`
  fragment RealtimeEventFields on RealtimeEvent {
    eventId eventType schemaVersion tenantId locationId userId actorType actorId deviceId
    entityType entityId aggregateVersion updatedAt occurredAt payload
  }
`;

const S_REALTIME = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription RealtimeEvents {
    realtimeEvent {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_DEVICE_SESSION_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosDeviceSessionChanged {
    bmsDeviceSessionChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_SHIFT_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosShiftChanged {
    bmsShiftChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_ORDER_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosOrderChanged {
    bmsPosOrderChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_RESTAURANT_FLOOR_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosRestaurantFloorChanged {
    bmsRestaurantFloorChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_RESTAURANT_CHECK_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosRestaurantCheckChanged {
    bmsRestaurantCheckChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_KITCHEN_TICKET_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosKitchenTicketChanged {
    bmsKitchenTicketChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_MENU_AVAILABILITY_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosMenuAvailabilityChanged {
    bmsMenuAvailabilityChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_QR_ORDER_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosQrOrderChanged {
    bmsQrOrderChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_INCOMING_ORDER_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosIncomingOrderChanged {
    bmsIncomingOrderChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_WAITLIST_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosWaitlistChanged {
    bmsWaitlistChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_SERVICE_CALL_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosServiceCallChanged {
    bmsServiceCallChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_INVENTORY_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosInventoryChanged {
    bmsInventoryChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_STOCK_TRANSFER_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosStockTransferChanged {
    bmsStockTransferChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_STOCK_COUNT_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosStockCountChanged {
    bmsStockCountChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_PAYMENT_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosPaymentChanged {
    bmsPaymentChanged {
      ...RealtimeEventFields
    }
  }
`;

const S_POS_BMS_ORDER_CHANGED = gql`
  ${REALTIME_EVENT_FIELDS}
  subscription PosBmsOrderChanged {
    bmsOrderChanged {
      ...RealtimeEventFields
    }
  }
`;

type RealtimeSubscriptionSpec = {
  document: DocumentNode;
  fieldName: string;
};

const ADMIN_REALTIME_SUBSCRIPTIONS: readonly RealtimeSubscriptionSpec[] = [
  { document: S_REALTIME, fieldName: "realtimeEvent" },
];

const POS_REALTIME_SUBSCRIPTIONS: readonly RealtimeSubscriptionSpec[] = [
  { document: S_POS_DEVICE_SESSION_CHANGED, fieldName: "bmsDeviceSessionChanged" },
  { document: S_POS_SHIFT_CHANGED, fieldName: "bmsShiftChanged" },
  { document: S_POS_ORDER_CHANGED, fieldName: "bmsPosOrderChanged" },
  { document: S_POS_RESTAURANT_FLOOR_CHANGED, fieldName: "bmsRestaurantFloorChanged" },
  { document: S_POS_RESTAURANT_CHECK_CHANGED, fieldName: "bmsRestaurantCheckChanged" },
  { document: S_POS_KITCHEN_TICKET_CHANGED, fieldName: "bmsKitchenTicketChanged" },
  { document: S_POS_MENU_AVAILABILITY_CHANGED, fieldName: "bmsMenuAvailabilityChanged" },
  { document: S_POS_QR_ORDER_CHANGED, fieldName: "bmsQrOrderChanged" },
  { document: S_POS_INCOMING_ORDER_CHANGED, fieldName: "bmsIncomingOrderChanged" },
  { document: S_POS_WAITLIST_CHANGED, fieldName: "bmsWaitlistChanged" },
  { document: S_POS_SERVICE_CALL_CHANGED, fieldName: "bmsServiceCallChanged" },
  { document: S_POS_INVENTORY_CHANGED, fieldName: "bmsInventoryChanged" },
  { document: S_POS_STOCK_TRANSFER_CHANGED, fieldName: "bmsStockTransferChanged" },
  { document: S_POS_STOCK_COUNT_CHANGED, fieldName: "bmsStockCountChanged" },
  { document: S_POS_PAYMENT_CHANGED, fieldName: "bmsPaymentChanged" },
  { document: S_POS_BMS_ORDER_CHANGED, fieldName: "bmsOrderChanged" },
];

function RealtimeSubscription({
  enabled,
  spec,
  onEvent,
  onSubscriptionError,
}: {
  enabled: boolean;
  spec: RealtimeSubscriptionSpec;
  onEvent: (raw: unknown) => void;
  onSubscriptionError: () => void;
}) {
  useSubscription(spec.document, {
    skip: !enabled,
    onData: ({ data }) => {
      const payload = data.data as Record<string, unknown> | null | undefined;
      onEvent(payload?.[spec.fieldName]);
    },
    onError: onSubscriptionError,
  });
  return null;
}

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
  subscriptions,
}: {
  children: React.ReactNode;
  enabled: boolean;
  scopeKey: string;
  subscriptions: readonly RealtimeSubscriptionSpec[];
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

  const handleRealtimeEvent = React.useCallback((raw: unknown) => {
    try {
      const next = validateRealtimeEvent(raw);
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
  }, [queueInvalidation]);

  const handleSubscriptionError = React.useCallback(() => {
    setStatus(typeof navigator !== "undefined" && navigator.onLine ? "degraded" : "offline");
  }, []);

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
  return (
    <RealtimeContext.Provider value={value}>
      {subscriptions.map((spec) => (
        <RealtimeSubscription
          key={spec.fieldName}
          enabled={enabled}
          spec={spec}
          onEvent={handleRealtimeEvent}
          onSubscriptionError={handleSubscriptionError}
        />
      ))}
      {children}
    </RealtimeContext.Provider>
  );
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { admin } = useSessionCtx();
  const scopeKey = admin?.id ? `${admin.id}:${admin.tenant_id ?? "platform"}` : "none";
  return (
    <RealtimeTransportProvider
      enabled={Boolean(admin?.id)}
      scopeKey={scopeKey}
      subscriptions={ADMIN_REALTIME_SUBSCRIPTIONS}
    >
      {children}
    </RealtimeTransportProvider>
  );
}

export function PosRealtimeProvider({ children }: { children: React.ReactNode }) {
  const [tokenGeneration, setTokenGeneration] = React.useState(0);
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const token = await readPosDeviceToken();
      if (disposed) return;
      setEnabled(Boolean(token));
      setTokenGeneration((value) => value + 1);
    };
    void refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("bms-pos-device-token-changed", refresh);
    return () => {
      disposed = true;
      window.removeEventListener("storage", refresh);
      window.removeEventListener("bms-pos-device-token-changed", refresh);
    };
  }, []);
  return (
    <RealtimeTransportProvider
      enabled={enabled}
      scopeKey={`pos:${tokenGeneration}`}
      subscriptions={POS_REALTIME_SUBSCRIPTIONS}
    >
      {children}
      {enabled ? <PosRealtimeIndicator /> : null}
    </RealtimeTransportProvider>
  );
}

export type PosApiConnectionStatus = "checking" | "online" | "offline";

export function PosConnectionStatus({
  apiStatus,
}: {
  apiStatus?: PosApiConnectionStatus;
}) {
  const { t } = useI18n();
  const menuRef = React.useRef<HTMLDetailsElement>(null);
  const { status } = useRealtimeStatus();
  const mode = apiStatus === "offline" || status === "offline"
    ? "offline"
    : apiStatus === "checking"
      ? "checking"
      : status === "connected"
        ? "online"
        : "fallback";

  React.useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  const label = mode === "offline"
    ? t("pos_realtime.offline")
    : mode === "checking"
      ? t("pos_realtime.checking")
      : mode === "online"
        ? t("pos_realtime.online")
        : t("pos_realtime.fallback");
  const chipClass = `${styles.posConnection} ${
    mode === "online" ? styles.posConnectionOnline
      : mode === "offline" ? styles.posConnectionOffline
        : mode === "fallback" ? styles.posConnectionFallback
          : ""
  }`.trim();

  if (mode !== "fallback") {
    return (
      <span className={chipClass} role="status" aria-live="polite" data-pos-connection={mode}>
        <i className={styles.posConnectionDot} aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <details ref={menuRef} className={styles.posConnectionMenu} data-pos-connection={mode}>
      <summary className={chipClass} aria-label={`${label} ${t("pos_realtime.open_details")}`}>
        <i className={styles.posConnectionDot} aria-hidden="true" />
        <span>{label}</span>
        <span className={styles.posConnectionInfo} aria-hidden="true">i</span>
      </summary>
      <div className={styles.posConnectionPopover} role="status">
        <strong>{t("pos_realtime.fallback_title")}</strong>
        <span>{t("pos_realtime.fallback_description")}</span>
      </div>
    </details>
  );
}

function PosRealtimeIndicator() {
  const pathname = usePathname();
  const { status } = useRealtimeStatus();
  // Operator surfaces own a persistent compact status control in their header. Customer display
  // and manual pages intentionally stay quiet; an infrastructure message there is not actionable.
  // Keep this fallback only for future POS routes that have not adopted the shared control yet.
  const ownsStatusControl = pathname === "/pos"
    || pathname === "/pos/app"
    || pathname.startsWith("/pos/restaurant")
    || pathname.startsWith("/pos/display")
    || pathname.startsWith("/pos/manual");
  if (status === "connected" || ownsStatusControl) return null;
  return (
    <div className={styles.posConnectionFloating}>
      <PosConnectionStatus />
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
