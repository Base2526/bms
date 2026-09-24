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
  canRetryOfflineSale,
  loadOfflineSales,
  patchOfflineSale,
  putOfflineSale,
  removeOfflineSale,
  type OfflineSalePayload,
  type OfflineSaleRecord,
} from '../lib/offlineSales';
import {
  countOfflineQueue,
  normalizeOfflineStateAfterRestart,
  sortOfflineQueueOldestFirst,
} from '../lib/offlineContinuity';
import { isDecidedRejection, runWithOperationTimeout } from '../lib/operation';
import { describeMobileSaleFailure } from '../lib/saleFailureMessage';
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
  retryRecord: (id: string) => Promise<void>;
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
  const activeStages = useRef(new Set<string>());
  const [recover] = useLazyQuery(MobilePosSaleRecoveryDocument, {
    fetchPolicy: 'network-only',
  });
  const [sell] = useMutation(MobilePosSaleDocument);

  const rememberStorageError = useCallback((error: unknown) => {
    setStorageError(
      error instanceof Error ? error.message : 'จัดการคิวออฟไลน์ไม่ได้',
    );
  }, []);

  const visibleRecords = useMemo(
    () =>
      sortOfflineQueueOldestFirst(
        records.filter(
          record =>
            record.serverUrl === target?.serverUrl &&
            (!record.deviceId || record.deviceId === session?.deviceId) &&
            record.branchId === session?.branch.id,
        ),
      ),
    [records, session?.branch.id, session?.deviceId, target?.serverUrl],
  );

  const reload = useCallback(async () => {
    try {
      const loaded = await loadOfflineSales();
      // STAGED/SYNCING surviving a process restart has an unknown outcome: the request may have
      // left the app and even committed. Recovery must check the original key before retrying.
      const normalized = await Promise.all(
        loaded.map(async record => {
          const next = normalizeOfflineStateAfterRestart(record);
          if (next === record) return record;
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
      if (!shift.id) throw new Error('ต้องเปิดกะก่อนรับเงินออฟไลน์');
      const now = new Date().toISOString();
      try {
        const next = await putOfflineSale({
          id: payload.idempotencyKey,
          serverUrl: target.serverUrl,
          deviceId: session.deviceId,
          branchId: session.branch.id,
          shiftId: shift.id,
          cashierUserId: session.cashier.id,
          cashierName: session.cashier.name,
          tenderedAt: payload.offlineTenderedAt ?? now,
          total,
          payload,
          state: 'STAGED',
          attempts: 0,
          lastError: null,
          failureCode: null,
          updatedAt: now,
        });
        activeStages.current.add(payload.idempotencyKey);
        setRecords(next);
        setStorageError(null);
      } catch (error) {
        rememberStorageError(error);
        throw error;
      }
    },
    [rememberStorageError, session, shift.id, target],
  );

  const queue = useCallback(
    async (idempotencyKey: string, error?: string | null) => {
      try {
        const next = await patchOfflineSale(idempotencyKey, {
          state: 'UNKNOWN',
          lastError: error ?? null,
          failureCode: null,
        });
        setRecords(next);
        setStorageError(null);
      } catch (cause) {
        rememberStorageError(cause);
        throw cause;
      } finally {
        activeStages.current.delete(idempotencyKey);
      }
    },
    [rememberStorageError],
  );

  const complete = useCallback(
    async (idempotencyKey: string) => {
      try {
        setRecords(await removeOfflineSale(idempotencyKey));
        setStorageError(null);
      } catch (error) {
        rememberStorageError(error);
        throw error;
      } finally {
        activeStages.current.delete(idempotencyKey);
      }
    },
    [rememberStorageError],
  );

  const discard = complete;

  const syncNow = useCallback(async () => {
    if (syncLock.current || !session) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      const candidates = sortOfflineQueueOldestFirst(
        (await loadOfflineSales()).filter(
          record =>
            record.serverUrl === target?.serverUrl &&
            (!record.deviceId || record.deviceId === session.deviceId) &&
            record.branchId === session.branch.id &&
            // An active STAGED row belongs to the checkout call that is still in flight. A STAGED
            // row whose checkout finished/failed is recoverable, as are UNKNOWN/SYNCING rows.
            (record.state !== 'STAGED' ||
              !activeStages.current.has(record.id)) &&
            record.state !== 'NEEDS_REVIEW',
        ),
      );
      setStorageError(null);
      for (const record of candidates) {
        try {
          setRecords(
            await patchOfflineSale(record.id, {
              state: 'SYNCING',
              lastError: null,
              failureCode: null,
            }),
          );
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
          if (!shift.isOpen || !shift.id) {
            setRecords(
              await patchOfflineSale(record.id, {
                state: 'NEEDS_REVIEW',
                failureCode: 'SHIFT_NOT_OPEN',
                lastError:
                  'ตรวจแล้ว Server ยังไม่มีบิล และกะเดิมไม่ได้เปิดอยู่ ห้ามลงยอดเข้ากะใหม่ กรุณาให้ผู้จัดการตรวจสอบ',
              }),
            );
            continue;
          }
          if (record.shiftId && record.shiftId !== shift.id) {
            setRecords(
              await patchOfflineSale(record.id, {
                state: 'NEEDS_REVIEW',
                failureCode: 'SHIFT_MISMATCH',
                lastError:
                  'รายการนี้รับเงินในกะเดิมที่ปิดไปแล้ว ห้ามลงยอดเข้ากะใหม่ กรุณาให้ผู้จัดการตรวจสอบ',
              }),
            );
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
          if (!result) {
            throw new Error('Server ไม่ส่งผลการขายกลับมา ยังไม่ทราบผลรายการ');
          }
          if (result?.status === 'SOLD') {
            setRecords(await removeOfflineSale(record.id));
            continue;
          }
          setRecords(
            await patchOfflineSale(record.id, {
              state: 'NEEDS_REVIEW',
              attempts: record.attempts + 1,
              failureCode: result?.status ?? 'UNKNOWN_BUSINESS_RESULT',
              lastError: describeMobileSaleFailure(
                result,
                'Server ปฏิเสธรายการออฟไลน์',
              ),
            }),
          );
        } catch (error) {
          if (isDecidedRejection(error)) {
            setRecords(
              await patchOfflineSale(record.id, {
                state: 'NEEDS_REVIEW',
                attempts: record.attempts + 1,
                failureCode: 'DECIDED_REJECTION',
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
              failureCode: null,
              lastError:
                error instanceof Error ? error.message : 'ยังไม่ทราบผลการซิงก์',
            }),
          );
          health.markOffline();
          break;
        }
      }
      await refreshSales().catch(() => undefined);
    } catch (error) {
      rememberStorageError(error);
      throw error;
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [
    health,
    recover,
    rememberStorageError,
    refreshSales,
    sell,
    session,
    shift.isOpen,
    shift.id,
    target?.serverUrl,
  ]);

  const retryReview = useCallback(async () => {
    try {
      const reviewRecords = visibleRecords.filter(record =>
        canRetryOfflineSale(record),
      );
      for (const record of reviewRecords) {
        await patchOfflineSale(record.id, {
          state: 'UNKNOWN',
          lastError: 'กำลังลองซิงก์ใหม่',
          failureCode: null,
        });
      }
      setRecords(await loadOfflineSales());
      setStorageError(null);
      await syncNow();
    } catch (error) {
      rememberStorageError(error);
      throw error;
    }
  }, [rememberStorageError, syncNow, visibleRecords]);

  const retryRecord = useCallback(
    async (id: string) => {
      const record = visibleRecords.find(candidate => candidate.id === id);
      if (!record) throw new Error('ไม่พบรายการออฟไลน์ในสาขานี้');
      if (record.state === 'SYNCING') return;
      if (!canRetryOfflineSale(record)) {
        throw new Error(
          'Server ตัดสินรายการนี้แล้ว ห้ามส่งซ้ำ กรุณาให้ผู้จัดการกระทบยอด',
        );
      }
      try {
        setRecords(
          await patchOfflineSale(record.id, {
            state: 'UNKNOWN',
            lastError: 'กำลังลองซิงก์ใหม่',
            failureCode: null,
          }),
        );
        setStorageError(null);
        await syncNow();
      } catch (error) {
        rememberStorageError(error);
        throw error;
      }
    },
    [rememberStorageError, syncNow, visibleRecords],
  );

  useEffect(() => {
    if (health.status === 'online') syncNow().catch(() => undefined);
  }, [health.status, syncNow]);

  const value = useMemo<OfflineSalesValue>(() => {
    const counts = countOfflineQueue(visibleRecords);
    return {
      records: visibleRecords,
      pendingCount: counts.pending,
      reviewCount: counts.review,
      syncing,
      storageError,
      stage,
      queue,
      complete,
      discard,
      syncNow,
      retryReview,
      retryRecord,
    };
  }, [
    complete,
    discard,
    queue,
    retryReview,
    retryRecord,
    stage,
    storageError,
    syncNow,
    syncing,
    visibleRecords,
  ]);

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
