import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import {
  MobileRestaurantQrOrdersDocument,
  MobileRestaurantKioskOrdersDocument,
  MobileRestaurantServiceCallsDocument,
  MobileRestaurantWaitlistDocument,
  type MobileRestaurantQrOrdersQuery,
  type MobileRestaurantKioskOrdersQuery,
  type MobileRestaurantServiceCallsQuery,
  type MobileRestaurantWaitlistQuery,
} from '../graphql/generated';
import { useSession } from './SessionContext';
import { useStoreMode } from './StoreModeContext';

type QrSubmission =
  MobileRestaurantQrOrdersQuery['bmsPosRestaurantQrOrders']['submissions'][number];
type KioskSubmission =
  MobileRestaurantKioskOrdersQuery['bmsPosRestaurantKioskOrders']['submissions'][number];
type ServiceCall =
  MobileRestaurantServiceCallsQuery['bmsPosRestaurantServiceCalls']['calls'][number];
type WaitlistEntry =
  MobileRestaurantWaitlistQuery['bmsPosRestaurantWaitlist']['entries'][number];

const EMPTY_QR_SUBMISSIONS: QrSubmission[] = [];
const EMPTY_KIOSK_SUBMISSIONS: KioskSubmission[] = [];
const EMPTY_SERVICE_CALLS: ServiceCall[] = [];
const EMPTY_WAITLIST_ENTRIES: WaitlistEntry[] = [];

interface RestaurantOperationsContextValue {
  qrSubmissions: QrSubmission[];
  kioskSubmissions: KioskSubmission[];
  kioskError: string | null;
  serviceCalls: ServiceCall[];
  waitlistEntries: WaitlistEntry[];
  pendingQrIds: string[];
  pendingKioskIds: string[];
  pendingServiceCallIds: string[];
  activeWaitlistIds: string[];
  pendingQrCount: number;
  pendingKioskCount: number;
  pendingServiceCallCount: number;
  activeWaitlistCount: number;
  waitingGuests: number;
  totalPendingCount: number;
  initialized: boolean;
  refreshQr: () => Promise<void>;
  refreshKiosk: () => Promise<void>;
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
  // Device GraphQL has no kiosk subscription yet. Poll while restaurant mode is active.
  const kiosk = useQuery(MobileRestaurantKioskOrdersDocument, {
    variables: { requestCode: null },
    skip,
    pollInterval: skip ? 0 : 10_000,
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
  const kioskSubmissions =
    kiosk.data?.bmsPosRestaurantKioskOrders.submissions ?? EMPTY_KIOSK_SUBMISSIONS;
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
  const pendingKioskIds = useMemo(
    () => kioskSubmissions.filter(item => item.status === 'PENDING').map(item => item.id),
    [kioskSubmissions],
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
  const refreshKiosk = useCallback(async () => {
    await kiosk.refetch();
  }, [kiosk]);
  const refreshServiceCalls = useCallback(async () => {
    await calls.refetch();
  }, [calls]);
  const refreshWaitlist = useCallback(async () => {
    await waitlist.refetch();
  }, [waitlist]);
  const value = useMemo<RestaurantOperationsContextValue>(
    () => ({
      qrSubmissions,
      kioskSubmissions,
      kioskError: kiosk.error?.message ?? null,
      serviceCalls,
      waitlistEntries,
      pendingQrIds,
      pendingKioskIds,
      pendingServiceCallIds,
      activeWaitlistIds,
      pendingQrCount: pendingQrIds.length,
      pendingKioskCount: pendingKioskIds.length,
      pendingServiceCallCount: pendingServiceCallIds.length,
      activeWaitlistCount: activeWaitlistIds.length,
      waitingGuests: waitlist.data?.bmsPosRestaurantWaitlist.waitingGuests ?? 0,
      totalPendingCount:
        pendingQrIds.length +
        pendingKioskIds.length +
        pendingServiceCallIds.length +
        activeWaitlistIds.length,
      initialized: skip || (!qr.loading && !kiosk.loading && !calls.loading && !waitlist.loading),
      refreshQr,
      refreshKiosk,
      refreshServiceCalls,
      refreshWaitlist,
    }),
    [
      activeWaitlistIds,
      pendingQrIds,
      pendingKioskIds,
      pendingServiceCallIds,
      qrSubmissions,
      kioskSubmissions,
      kiosk.error?.message,
      refreshQr,
      refreshKiosk,
      refreshServiceCalls,
      refreshWaitlist,
      serviceCalls,
      skip,
      calls.loading,
      qr.loading,
      kiosk.loading,
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
