import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLazyQuery, useMutation } from '@apollo/client';
import {
  MobilePosSaleDocument,
  MobilePosSaleRecoveryDocument,
} from '../graphql/generated';
import {
  loadOfflineSales,
  patchOfflineSale,
  putOfflineSale,
  removeOfflineSale,
  type OfflineSalePayload,
  type OfflineSaleRecord,
} from '../lib/offlineSales';
import { isDecidedRejection, runWithOperationTimeout } from '../lib/operation';
import { useDevice } from './DeviceContext';
import { useSales } from './SalesContext';
import { useServerHealth } from './ServerHealthContext';
import { useSession } from './SessionContext';
import { useShift } from './ShiftContext';

interface StageOfflineSaleInput {
  payload: OfflineSalePayload;
  total: number;
}

interface OfflineSalesValue {
  records: OfflineSaleRecord[];
  pendingCount: number;
  reviewCount: number;
  syncing: boolean;
  storageError: string | null;
  stage: (input: StageOfflineSaleInput) => Promise<void>;
  queue: (idempotencyKey: string, error?: string | null) => Promise<void>;
  complete: (idempotencyKey: string) => Promise<void>;
  discard: (idempotencyKey: string) => Promise<void>;
  syncNow: () => Promise<void>;
  retryReview: () => Promise<void>;
}

const OfflineSalesContext = createContext<OfflineSalesValue | null>(null);

export function OfflineSalesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { target } = useDevice();
  const { session } = useSession();
  const shift = useShift();
  const { refresh: refreshSales } = useSales();
  const health = useServerHealth();
  const [records, setRecords] = useState<OfflineSaleRecord[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncLock = useRef(false);
  const [recover] = useLazyQuery(MobilePosSaleRecoveryDocument, {
    fetchPolicy: 'network-only',
  });
  const [sell] = useMutation(MobilePosSaleDocument);

  const visibleRecords = useMemo(
    () =>
      records.filter(
        record =>
          record.serverUrl === target?.serverUrl &&
          record.branchId === session?.branch.id,
      ),
    [records, session?.branch.id, target?.serverUrl],
  );

  const reload = useCallback(async () => {
    try {
      const loaded = await loadOfflineSales();
      // STAGED surviving a process restart has an unknown outcome: the request may have left the app.
      const normalized = await Promise.all(
        loaded.map(async record => {
          if (record.state !== 'STAGED') return record;
          const next = { ...record, state: 'UNKNOWN' as const };
          await putOfflineSale(next);
          return next;
        }),
      );
      setRecords(normalized);
      setStorageError(null);
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : 'อ่านคิวออฟไลน์ไม่ได้',
      );
    }
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const stage = useCallback(
    async ({ payload, total }: StageOfflineSaleInput) => {
      if (!target || !session)
        throw new Error('ไม่พบเครื่องหรือพนักงานที่กำลังใช้งาน');
      const now = new Date().toISOString();
      const next = await putOfflineSale({
        id: payload.idempotencyKey,
        serverUrl: target.serverUrl,
        branchId: session.branch.id,
        cashierUserId: session.cashier.id,
        cashierName: session.cashier.name,
        tenderedAt: payload.offlineTenderedAt ?? now,
        total,
        payload,
        state: 'STAGED',
        attempts: 0,
        lastError: null,
        updatedAt: now,
      });
      setRecords(next);
      setStorageError(null);
    },
    [session, target],
  );

  const queue = useCallback(
    async (idempotencyKey: string, error?: string | null) => {
      const next = await patchOfflineSale(idempotencyKey, {
        state: 'UNKNOWN',
        lastError: error ?? null,
      });
      setRecords(next);
    },
    [],
  );

  const complete = useCallback(async (idempotencyKey: string) => {
    setRecords(await removeOfflineSale(idempotencyKey));
  }, []);

  const discard = complete;

  const syncNow = useCallback(async () => {
    if (syncLock.current || !session || !shift.isOpen) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      const candidates = (await loadOfflineSales())
        .filter(
          record =>
            record.serverUrl === target?.serverUrl &&
            record.branchId === session.branch.id &&
            (record.state === 'UNKNOWN' || record.state === 'STAGED'),
        )
        .sort((a, b) => a.tenderedAt.localeCompare(b.tenderedAt));
      for (const record of candidates) {
        try {
          const credentials = {
            cashierUserId: session.credentials.cashierUserId,
            pin: session.credentials.pin,
          };
          const recovered = await runWithOperationTimeout(signal =>
            recover({
              context: { fetchOptions: { signal } },
              variables: {
                input: {
                  ...credentials,
                  idempotencyKey: record.payload.idempotencyKey,
                },
              },
            }),
          );
          if (recovered.data?.bmsPosSaleRecovery.status === 'SOLD') {
            setRecords(await removeOfflineSale(record.id));
            continue;
          }
          if (record.cashierUserId !== session.cashier.id) {
            setRecords(
              await patchOfflineSale(record.id, {
                state: 'UNKNOWN',
                lastError: `ต้องให้แคชเชียร์ ${
                  record.cashierName ?? 'คนเดิม'
                } เข้าสู่ระบบเพื่อซิงก์รายการนี้`,
              }),
            );
            continue;
          }
          const response = await runWithOperationTimeout(signal =>
            sell({
              context: { fetchOptions: { signal } },
              variables: {
                input: {
                  ...record.payload,
                  ...credentials,
                  couponCode: null,
                  creditApproverPin: null,
                  creditApproverUserId: null,
                  customerId: null,
                  depositCustomerNote: null,
                  depositDueAt: null,
                  discountApproverPin: null,
                  discountApproverUserId: null,
                  discountReason: null,
                  extraLines: null,
                  manualDiscount: null,
                  pharmacistAuthorizationNote: null,
                  pharmacistAuthorizerPin: null,
                  pharmacistAuthorizerUserId: null,
                  pharmacyApprovedAssessmentId: null,
                  pharmacyReviewAssessmentId: null,
                },
              },
            }),
          );
          const result = response.data?.bmsPosSale;
          if (result?.status === 'SOLD') {
            setRecords(await removeOfflineSale(record.id));
            continue;
          }
          setRecords(
            await patchOfflineSale(record.id, {
              state: 'NEEDS_REVIEW',
              attempts: record.attempts + 1,
              lastError:
                result?.reason ?? result?.status ?? 'server ปฏิเสธรายการ',
            }),
          );
        } catch (error) {
          if (isDecidedRejection(error)) {
            setRecords(
              await patchOfflineSale(record.id, {
                state: 'NEEDS_REVIEW',
                attempts: record.attempts + 1,
                lastError:
                  error instanceof Error
                    ? error.message
                    : 'server ปฏิเสธรายการ',
              }),
            );
            continue;
          }
          setRecords(
            await patchOfflineSale(record.id, {
              state: 'UNKNOWN',
              attempts: record.attempts + 1,
              lastError:
                error instanceof Error ? error.message : 'ยังไม่ทราบผลการซิงก์',
            }),
          );
          health.markOffline();
          break;
        }
      }
      await refreshSales().catch(() => undefined);
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [
    health,
    recover,
    refreshSales,
    sell,
    session,
    shift.isOpen,
    target?.serverUrl,
  ]);

  const retryReview = useCallback(async () => {
    const reviewRecords = visibleRecords.filter(
      record => record.state === 'NEEDS_REVIEW',
    );
    for (const record of reviewRecords) {
      await patchOfflineSale(record.id, {
        state: 'UNKNOWN',
        lastError: 'กำลังลองซิงก์ใหม่',
      });
    }
    setRecords(await loadOfflineSales());
    await syncNow();
  }, [syncNow, visibleRecords]);

  useEffect(() => {
    if (health.status === 'online') syncNow().catch(() => undefined);
  }, [health.status, syncNow]);

  const value = useMemo<OfflineSalesValue>(
    () => ({
      records: visibleRecords,
      pendingCount: visibleRecords.filter(
        record => record.state !== 'NEEDS_REVIEW',
      ).length,
      reviewCount: visibleRecords.filter(
        record => record.state === 'NEEDS_REVIEW',
      ).length,
      syncing,
      storageError,
      stage,
      queue,
      complete,
      discard,
      syncNow,
      retryReview,
    }),
    [
      complete,
      discard,
      queue,
      retryReview,
      stage,
      storageError,
      syncNow,
      syncing,
      visibleRecords,
    ],
  );

  return (
    <OfflineSalesContext.Provider value={value}>
      {children}
    </OfflineSalesContext.Provider>
  );
}

export function useOfflineSales(): OfflineSalesValue {
  const value = useContext(OfflineSalesContext);
  if (!value)
    throw new Error('useOfflineSales ต้องอยู่ใต้ <OfflineSalesProvider>');
  return value;
}
