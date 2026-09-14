import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import {
  MobileRestaurantQrOrdersDocument,
  MobileRestaurantServiceCallsDocument,
  MobileRestaurantWaitlistDocument,
  type MobileRestaurantQrOrdersQuery,
  type MobileRestaurantServiceCallsQuery,
  type MobileRestaurantWaitlistQuery,
} from '../graphql/generated';
import { useSession } from './SessionContext';
import { useStoreMode } from './StoreModeContext';

type QrSubmission =
  MobileRestaurantQrOrdersQuery['bmsPosRestaurantQrOrders']['submissions'][number];
type ServiceCall =
  MobileRestaurantServiceCallsQuery['bmsPosRestaurantServiceCalls']['calls'][number];
type WaitlistEntry =
  MobileRestaurantWaitlistQuery['bmsPosRestaurantWaitlist']['entries'][number];

const EMPTY_QR_SUBMISSIONS: QrSubmission[] = [];
const EMPTY_SERVICE_CALLS: ServiceCall[] = [];
const EMPTY_WAITLIST_ENTRIES: WaitlistEntry[] = [];

interface RestaurantOperationsContextValue {
  qrSubmissions: QrSubmission[];
  serviceCalls: ServiceCall[];
  waitlistEntries: WaitlistEntry[];
  pendingQrIds: string[];
  pendingServiceCallIds: string[];
  activeWaitlistIds: string[];
  pendingQrCount: number;
  pendingServiceCallCount: number;
  activeWaitlistCount: number;
  waitingGuests: number;
  totalPendingCount: number;
  initialized: boolean;
  refreshQr: () => Promise<void>;
  refreshServiceCalls: () => Promise<void>;
  refreshWaitlist: () => Promise<void>;
}

const RestaurantOperationsContext =
  createContext<RestaurantOperationsContextValue | null>(null);

export function RestaurantOperationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = useSession();
  const { mode } = useStoreMode();
  const skip = !session || mode !== 'restaurant';
  const qr = useQuery(MobileRestaurantQrOrdersDocument, {
    skip,
    notifyOnNetworkStatusChange: true,
  });
  const calls = useQuery(MobileRestaurantServiceCallsDocument, {
    skip,
    notifyOnNetworkStatusChange: true,
  });
  const waitlist = useQuery(MobileRestaurantWaitlistDocument, {
    skip,
    notifyOnNetworkStatusChange: true,
  });

  const qrSubmissions =
    qr.data?.bmsPosRestaurantQrOrders.submissions ?? EMPTY_QR_SUBMISSIONS;
  const serviceCalls =
    calls.data?.bmsPosRestaurantServiceCalls.calls ?? EMPTY_SERVICE_CALLS;
  const waitlistEntries =
    waitlist.data?.bmsPosRestaurantWaitlist.entries ?? EMPTY_WAITLIST_ENTRIES;
  const pendingQrIds = useMemo(
    () =>
      qrSubmissions
        .filter(item => item.status === 'PENDING')
        .map(item => item.id),
    [qrSubmissions],
  );
  const pendingServiceCallIds = useMemo(
    () =>
      serviceCalls
        .filter(item => ['PENDING', 'ACKNOWLEDGED'].includes(item.status))
        .map(item => item.id),
    [serviceCalls],
  );
  const activeWaitlistIds = useMemo(
    () =>
      waitlistEntries
        .filter(item => ['WAITING', 'CALLED'].includes(item.status))
        .map(item => item.id),
    [waitlistEntries],
  );

  const refreshQr = useCallback(async () => {
    await qr.refetch();
  }, [qr]);
  const refreshServiceCalls = useCallback(async () => {
    await calls.refetch();
  }, [calls]);
  const refreshWaitlist = useCallback(async () => {
    await waitlist.refetch();
  }, [waitlist]);
  const value = useMemo<RestaurantOperationsContextValue>(
    () => ({
      qrSubmissions,
      serviceCalls,
      waitlistEntries,
      pendingQrIds,
      pendingServiceCallIds,
      activeWaitlistIds,
      pendingQrCount: pendingQrIds.length,
      pendingServiceCallCount: pendingServiceCallIds.length,
      activeWaitlistCount: activeWaitlistIds.length,
      waitingGuests: waitlist.data?.bmsPosRestaurantWaitlist.waitingGuests ?? 0,
      totalPendingCount:
        pendingQrIds.length +
        pendingServiceCallIds.length +
        activeWaitlistIds.length,
      initialized: skip || (!qr.loading && !calls.loading && !waitlist.loading),
      refreshQr,
      refreshServiceCalls,
      refreshWaitlist,
    }),
    [
      activeWaitlistIds,
      pendingQrIds,
      pendingServiceCallIds,
      qrSubmissions,
      refreshQr,
      refreshServiceCalls,
      refreshWaitlist,
      serviceCalls,
      skip,
      calls.loading,
      qr.loading,
      waitlist.data?.bmsPosRestaurantWaitlist.waitingGuests,
      waitlist.loading,
      waitlistEntries,
    ],
  );

  return (
    <RestaurantOperationsContext.Provider value={value}>
      {children}
    </RestaurantOperationsContext.Provider>
  );
}

export function useRestaurantOperations(): RestaurantOperationsContextValue {
  const context = useContext(RestaurantOperationsContext);
  if (!context) {
    throw new Error(
      'useRestaurantOperations ต้องถูกเรียกใต้ <RestaurantOperationsProvider>',
    );
  }
  return context;
}
