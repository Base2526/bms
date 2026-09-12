import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { useApolloClient, useQuery, useSubscription } from '@apollo/client';
import type { DocumentNode } from 'graphql';
import {
  MobileDeviceSessionChangedDocument,
  MobileIncomingOrderChangedDocument,
  MobileInventoryChangedDocument,
  MobileKitchenTicketChangedDocument,
  MobileMenuAvailabilityChangedDocument,
  MobileOrderChangedDocument,
  MobilePaymentChangedDocument,
  MobilePosOrderChangedDocument,
  MobileQrOrderChangedDocument,
  MobileRestaurantCheckChangedDocument,
  MobileRestaurantFloorChangedDocument,
  MobileServiceCallChangedDocument,
  MobileShiftChangedDocument,
  MobileWaitlistChangedDocument,
  PosBootstrapDocument,
} from '../graphql/generated';
import { useBmsGraphqlTransport } from '../graphql/BmsGraphqlProvider';
import {
  BoundedRealtimeDeduplicator,
  isMobileRealtimeEvent,
  type MobileRealtimeEvent,
  type MobileRealtimeStatus,
} from '../lib/realtime';
import { useDevice } from './DeviceContext';

interface RealtimeContextValue {
  status: MobileRealtimeStatus;
  event: MobileRealtimeEvent | null;
  lastEventAt: number | null;
}

interface SubscriptionSpec {
  document: DocumentNode;
  field: string;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);
const INVALIDATION_BATCH_MS = 150;
const DEGRADED_RECONCILE_MS = 30_000;

const BASE_SUBSCRIPTIONS: SubscriptionSpec[] = [
  {
    document: MobileDeviceSessionChangedDocument,
    field: 'bmsDeviceSessionChanged',
  },
  { document: MobileShiftChangedDocument, field: 'bmsShiftChanged' },
  { document: MobilePosOrderChangedDocument, field: 'bmsPosOrderChanged' },
  {
    document: MobileIncomingOrderChangedDocument,
    field: 'bmsIncomingOrderChanged',
  },
  { document: MobileInventoryChangedDocument, field: 'bmsInventoryChanged' },
  { document: MobilePaymentChangedDocument, field: 'bmsPaymentChanged' },
  { document: MobileOrderChangedDocument, field: 'bmsOrderChanged' },
];

const RESTAURANT_SUBSCRIPTIONS: SubscriptionSpec[] = [
  {
    document: MobileRestaurantFloorChangedDocument,
    field: 'bmsRestaurantFloorChanged',
  },
  {
    document: MobileRestaurantCheckChangedDocument,
    field: 'bmsRestaurantCheckChanged',
  },
  { document: MobileKitchenTicketChangedDocument, field: 'bmsKitchenTicketChanged' },
  {
    document: MobileMenuAvailabilityChangedDocument,
    field: 'bmsMenuAvailabilityChanged',
  },
  { document: MobileQrOrderChangedDocument, field: 'bmsQrOrderChanged' },
  { document: MobileWaitlistChangedDocument, field: 'bmsWaitlistChanged' },
  { document: MobileServiceCallChangedDocument, field: 'bmsServiceCallChanged' },
];

function RealtimeSubscription({
  spec,
  enabled,
  onEvent,
  onFailure,
}: {
  spec: SubscriptionSpec;
  enabled: boolean;
  onEvent: (event: unknown) => void;
  onFailure: () => void;
}) {
  const { data, error } = useSubscription(spec.document, { skip: !enabled });

  useEffect(() => {
    if (!data || typeof data !== 'object') return;
    onEvent((data as Record<string, unknown>)[spec.field]);
  }, [data, onEvent, spec.field]);

  useEffect(() => {
    if (error) onFailure();
  }, [error, onFailure]);

  return null;
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const client = useApolloClient();
  const { realtimeStatus } = useBmsGraphqlTransport();
  const { status: pairStatus, target, verify, runVerify } = useDevice();
  const bootstrap = useQuery(PosBootstrapDocument, {
    skip: pairStatus !== 'PAIRED',
  });
  const [event, setEvent] = useState<MobileRealtimeEvent | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [subscriptionFailed, setSubscriptionFailed] = useState(false);
  const deduplicator = useRef(new BoundedRealtimeDeduplicator());
  const latestByEntity = useRef(new Map<string, number | string>());
  const invalidationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = pairStatus === 'PAIRED' && !!target;
  const isRestaurant =
    bootstrap.data?.bmsPosSession.businessArchetype === 'restaurant' ||
    (verify.kind === 'OK' && verify.info.businessArchetype === 'restaurant');

  const reconcile = useCallback(() => {
    client.refetchQueries({ include: 'active' }).catch(() => undefined);
  }, [client]);

  const scheduleReconcile = useCallback(() => {
    if (invalidationTimer.current) return;
    invalidationTimer.current = setTimeout(() => {
      invalidationTimer.current = null;
      reconcile();
    }, INVALIDATION_BATCH_MS);
  }, [reconcile]);

  const handleEvent = useCallback(
    (candidate: unknown) => {
      if (!isMobileRealtimeEvent(candidate)) return;
      if (!deduplicator.current.accept(candidate.eventId)) return;

      const entityKey = `${candidate.entityType}:${candidate.entityId}`;
      const cursor =
        candidate.aggregateVersion ?? candidate.updatedAt ?? candidate.occurredAt;
      const previous = latestByEntity.current.get(entityKey);
      if (
        previous !== undefined &&
        typeof previous === typeof cursor &&
        cursor <= previous
      ) {
        return;
      }
      latestByEntity.current.set(entityKey, cursor);
      setSubscriptionFailed(false);
      setEvent(candidate);
      setLastEventAt(Date.now());
      scheduleReconcile();
      if (candidate.eventType === 'device.session.changed') {
        runVerify().catch(() => undefined);
      }
    },
    [runVerify, scheduleReconcile],
  );

  const handleFailure = useCallback(() => setSubscriptionFailed(true), []);

  useEffect(() => {
    deduplicator.current.clear();
    latestByEntity.current.clear();
    setEvent(null);
    setLastEventAt(null);
    setSubscriptionFailed(false);
  }, [target?.serverUrl, target?.token]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && enabled) reconcile();
    });
    return () => subscription.remove();
  }, [enabled, reconcile]);

  // Realtime has no replay yet. Re-read authoritative GraphQL state whenever a
  // fresh or recovered socket connects so events missed during the gap cannot linger.
  useEffect(() => {
    if (enabled && realtimeStatus === 'connected') reconcile();
  }, [enabled, realtimeStatus, reconcile]);

  const effectiveStatus: MobileRealtimeStatus = subscriptionFailed
    ? 'degraded'
    : realtimeStatus;

  useEffect(() => {
    if (
      !enabled ||
      (effectiveStatus !== 'offline' && effectiveStatus !== 'degraded')
    ) {
      return;
    }
    const timer = setInterval(reconcile, DEGRADED_RECONCILE_MS);
    return () => clearInterval(timer);
  }, [effectiveStatus, enabled, reconcile]);

  useEffect(
    () => () => {
      if (invalidationTimer.current) clearTimeout(invalidationTimer.current);
    },
    [],
  );

  const value = useMemo<RealtimeContextValue>(
    () => ({ status: effectiveStatus, event, lastEventAt }),
    [effectiveStatus, event, lastEventAt],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {BASE_SUBSCRIPTIONS.map(spec => (
        <RealtimeSubscription
          key={spec.field}
          spec={spec}
          enabled={enabled}
          onEvent={handleEvent}
          onFailure={handleFailure}
        />
      ))}
      {RESTAURANT_SUBSCRIPTIONS.map(spec => (
        <RealtimeSubscription
          key={spec.field}
          spec={spec}
          enabled={enabled && isRestaurant}
          onEvent={handleEvent}
          onFailure={handleFailure}
        />
      ))}
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime ต้องถูกเรียกใต้ <RealtimeProvider>');
  return ctx;
}
