import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  DriverHttpTransport,
  DriverOfflineQueue,
  driverOfflineCommandSchema,
  type DriverOfflineCommand,
  type FlushResult,
} from '@bms/fleet-delivery-driver-core';
import type { DriverSnapshotV1, OfferDecision } from '@bms/fleet-delivery-contracts';
import { KeychainDriverCommandStore } from '../storage/secureStore';
import { useDriverSession } from './DriverSessionContext';

type RuntimeStatus = 'IDLE' | 'REFRESHING' | 'SYNCING';
type Rejection = { commandId: string; code: string };

type DriverRuntimeValue = {
  snapshot: DriverSnapshotV1 | null;
  snapshotReceivedAt: number | null;
  queuedCommands: DriverOfflineCommand[];
  rejected: Rejection[];
  status: RuntimeStatus;
  error: string | null;
  refresh(): Promise<void>;
  flush(): Promise<FlushResult | null>;
  setAvailability(state: 'ONLINE' | 'OFFLINE'): Promise<void>;
  decideOffer(offerId: string, decision: OfferDecision, expectedOfferVersion: number): Promise<void>;
  advancePickup(deliveryId: string, action: 'start_pickup' | 'arrive_pickup', expectedVersion: number): Promise<void>;
  clearQueue(): Promise<void>;
};

const DriverRuntimeContext = createContext<DriverRuntimeValue | null>(null);
const store = new KeychainDriverCommandStore();
let sequence = 0;

function makeOpaqueId(): string {
  sequence = (sequence + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DriverRuntimeProvider({ children }: { children: React.ReactNode }) {
  const { state } = useDriverSession();
  const session = state.kind === 'ACTIVE' ? state.session : null;
  const [snapshot, setSnapshot] = useState<DriverSnapshotV1 | null>(null);
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState<number | null>(null);
  const [queuedCommands, setQueuedCommands] = useState<DriverOfflineCommand[]>([]);
  const [rejected, setRejected] = useState<Rejection[]>([]);
  const [status, setStatus] = useState<RuntimeStatus>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const transport = useMemo(() => session
    ? new DriverHttpTransport(
      session.apiBaseUrl,
      async () => session.accessToken,
      (url, init) => fetch(url, init),
    )
    : null, [session]);
  const queue = useMemo(() => transport
    ? new DriverOfflineQueue(store, transport, makeOpaqueId)
    : null, [transport]);
  const scope = useMemo(() => session ? {
    tenantRef: session.tenantRef,
    branchRef: session.branchRef,
  } : null, [session]);

  const reloadQueue = useCallback(async () => {
    const raw = await store.load();
    if (mounted.current) setQueuedCommands(driverOfflineCommandSchema.array().max(100).parse(raw));
  }, []);

  const refresh = useCallback(async () => {
    if (!transport || !scope) return;
    setStatus('REFRESHING');
    try {
      const next = await transport.getSnapshot(scope);
      if (mounted.current) {
        setSnapshot(next);
        setSnapshotReceivedAt(Date.now());
        setError(null);
      }
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught));
    } finally {
      if (mounted.current) setStatus('IDLE');
    }
  }, [scope, transport]);

  const flush = useCallback(async () => {
    if (!queue) return null;
    setStatus('SYNCING');
    try {
      const result = await queue.flush();
      if (mounted.current) {
        setRejected(result.rejected);
        setError(result.retryPending ? 'NETWORK_OR_AUTH_RETRY_REQUIRED' : null);
      }
      await reloadQueue();
      if (!result.retryPending) await refresh();
      return result;
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught));
      return null;
    } finally {
      if (mounted.current) setStatus('IDLE');
    }
  }, [queue, refresh, reloadQueue]);

  const setAvailability = useCallback(async (availability: 'ONLINE' | 'OFFLINE') => {
    if (!queue || !scope) return;
    try {
      await queue.enqueueAvailability(scope, availability);
      await reloadQueue();
      await flush();
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught));
    }
  }, [flush, queue, reloadQueue, scope]);

  const decideOffer = useCallback(async (
    offerId: string,
    decision: OfferDecision,
    expectedOfferVersion: number,
  ) => {
    if (!queue || !scope) return;
    try {
      await queue.enqueueOfferDecision(scope, offerId, decision, expectedOfferVersion);
      await reloadQueue();
      await flush();
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught));
    }
  }, [flush, queue, reloadQueue, scope]);

  const advancePickup = useCallback(async (
    deliveryId: string,
    action: 'start_pickup' | 'arrive_pickup',
    expectedVersion: number,
  ) => {
    if (!queue || !scope) return;
    try {
      await queue.enqueuePickupJourneyAction(scope, deliveryId, action, expectedVersion);
      await reloadQueue();
      await flush();
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught));
    }
  }, [flush, queue, reloadQueue, scope]);

  const clearQueue = useCallback(async () => {
    await store.clear();
    setQueuedCommands([]);
    setRejected([]);
  }, []);

  useEffect(() => {
    mounted.current = true;
    reloadQueue().catch(caught => setError(errorMessage(caught)));
    refresh().catch(caught => setError(errorMessage(caught)));
    const interval = setInterval(() => {
      refresh().catch(caught => setError(errorMessage(caught)));
    }, 10_000);
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        flush().catch(caught => setError(errorMessage(caught)));
        refresh().catch(caught => setError(errorMessage(caught)));
      }
    });
    return () => {
      mounted.current = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, [flush, refresh, reloadQueue]);

  const value = useMemo<DriverRuntimeValue>(() => ({
    snapshot,
    snapshotReceivedAt,
    queuedCommands,
    rejected,
    status,
    error,
    refresh,
    flush,
    setAvailability,
    decideOffer,
    advancePickup,
    clearQueue,
  }), [
    snapshot, snapshotReceivedAt, queuedCommands, rejected, status, error, refresh, flush,
    setAvailability, decideOffer, advancePickup, clearQueue,
  ]);

  return <DriverRuntimeContext.Provider value={value}>{children}</DriverRuntimeContext.Provider>;
}

export function useDriverRuntime(): DriverRuntimeValue {
  const value = useContext(DriverRuntimeContext);
  if (!value) throw new Error('useDriverRuntime must be used inside DriverRuntimeProvider');
  return value;
}
