import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  MobilePosCashMovementDocument,
  MobilePosCashMovementsDocument,
  MobilePosShiftDocument,
  MobilePosShiftHistoryDocument,
  MobilePosShiftReportDocument,
  PosBootstrapDocument,
} from '../graphql/generated';
import { createIdempotencyKey } from '../lib/operation';
import type { CashMovementType } from '../lib/shiftMath';
import { useSession } from './SessionContext';

export interface ShiftMovement {
  id: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  at: string;
  actorName: string | null;
  approvedByName: string | null;
}

export interface ShiftCloseSummary {
  closedAt: string;
  countedCash: number;
  expectedCash: number;
  variance: number;
}

interface MovementApproval {
  approverUserId?: string;
  approverPin?: string;
}

interface ShiftContextValue {
  isOpen: boolean;
  openedAt: string;
  openedByName: string;
  openingFloat: number;
  movements: ShiftMovement[];
  cashSales: number;
  cashRefunds: number;
  movementIn: number;
  movementOut: number;
  expectedCash: number;
  closeSummary: ShiftCloseSummary | null;
  loading: boolean;
  error: string | null;
  addMovement: (
    type: CashMovementType,
    amountText: string,
    reason: string,
    approval?: MovementApproval,
    idempotencyKey?: string,
  ) => Promise<string | null>;
  closeShift: (countedCashText: string) => Promise<string | null>;
  reopenShift: (openingFloat?: number) => Promise<string | null>;
}

const ShiftContext = createContext<ShiftContextValue | null>(null);

export function ShiftProvider({
  children,
}: {
  children: React.ReactNode;
  openedByName?: string;
}) {
  const { session } = useSession();
  const credentials = session?.credentials;
  const bootstrap = useQuery(PosBootstrapDocument, {
    skip: !session,
    notifyOnNetworkStatusChange: true,
  });
  const shift = bootstrap.data?.bmsPosSession.shift ?? null;
  const movementsQuery = useQuery(MobilePosCashMovementsDocument, {
    skip: !session || !shift,
    notifyOnNetworkStatusChange: true,
  });
  const historyQuery = useQuery(MobilePosShiftHistoryDocument, {
    variables: {
      credentials: credentials ?? { cashierUserId: '', pin: '' },
    },
    skip: !credentials,
    notifyOnNetworkStatusChange: true,
  });
  const latestClosedShift =
    historyQuery.data?.bmsPosShiftHistory.shifts.find(
      item => item.status === 'CLOSED',
    ) ?? null;
  const reportShiftId = shift?.id ?? latestClosedShift?.id ?? null;
  const reportQuery = useQuery(MobilePosShiftReportDocument, {
    variables: {
      credentials: credentials ?? { cashierUserId: '', pin: '' },
      shiftId: reportShiftId ?? '',
    },
    skip: !credentials || !reportShiftId,
    notifyOnNetworkStatusChange: true,
  });
  const [shiftMutation] = useMutation(MobilePosShiftDocument);
  const [movementMutation] = useMutation(MobilePosCashMovementDocument);
  const report = reportQuery.data?.bmsPosShiftReport.report;

  const movements = useMemo<ShiftMovement[]>(
    () =>
      (shift
        ? movementsQuery.data?.bmsPosCashMovements.movements ?? []
        : []
      ).map(movement => ({
        id: movement.id,
        type: movement.direction === 'OUT' ? 'OUT' : 'IN',
        amount: movement.amount,
        reason: movement.reason,
        at: new Date(movement.createdAt).toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        actorName: movement.actorName,
        approvedByName: movement.approvedByName,
      })),
    [movementsQuery.data, shift],
  );

  const refresh = useCallback(async () => {
    await bootstrap.refetch();
    await historyQuery.refetch();
    if (shift) {
      await movementsQuery.refetch();
      await reportQuery.refetch();
    }
  }, [bootstrap, historyQuery, movementsQuery, reportQuery, shift]);

  const addMovement = useCallback(
    async (
      type: CashMovementType,
      amountText: string,
      reason: string,
      approval: MovementApproval = {},
      idempotencyKey = createIdempotencyKey('cash'),
    ) => {
      if (!credentials) return 'กรุณาเข้าใช้งานใหม่';
      const amount = Number(amountText);
      if (!Number.isFinite(amount) || amount <= 0) {
        return 'จำนวนเงินต้องมากกว่า 0';
      }
      if (!reason.trim()) return 'ต้องระบุเหตุผลของเงินเข้า/ออก';
      if (
        type === 'OUT' &&
        (!approval.approverUserId || !approval.approverPin)
      ) {
        return 'เงินออกต้องมีผู้อนุมัติคนที่สองและ PIN';
      }
      try {
        const response = await movementMutation({
          variables: {
            input: {
              cashierUserId: credentials.cashierUserId,
              pin: credentials.pin,
              direction: type,
              amount,
              reason: reason.trim(),
              idempotencyKey,
              approverUserId: approval.approverUserId ?? null,
              approverPin: approval.approverPin ?? null,
            },
          },
        });
        const result = response.data?.bmsPosCashMovement;
        if (result?.status !== 'RECORDED') {
          return result?.reason ?? result?.status ?? 'บันทึกเงินไม่สำเร็จ';
        }
        await refresh();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'บันทึกเงินไม่สำเร็จ';
      }
    },
    [credentials, movementMutation, refresh],
  );

  const closeShift = useCallback(
    async (countedCashText: string) => {
      if (!credentials) return 'กรุณาเข้าใช้งานใหม่';
      const countedCash = Number(countedCashText);
      if (!Number.isFinite(countedCash) || countedCash < 0) {
        return 'ยอดเงินสดที่นับได้ต้องเป็นตัวเลขไม่ติดลบ';
      }
      try {
        const response = await shiftMutation({
          variables: {
            input: {
              action: 'CLOSE',
              cashierUserId: credentials.cashierUserId,
              pin: credentials.pin,
              countedCash,
              openingFloat: null,
              note: null,
              userId: null,
            },
          },
        });
        const result = response.data?.bmsPosShift;
        if (result?.status !== 'CLOSED') {
          return result?.reason ?? result?.status ?? 'ปิดกะไม่สำเร็จ';
        }
        await Promise.all([bootstrap.refetch(), historyQuery.refetch()]);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'ปิดกะไม่สำเร็จ';
      }
    },
    [bootstrap, credentials, historyQuery, shiftMutation],
  );

  const reopenShift = useCallback(
    async (openingFloat = shift?.countedCash ?? 0) => {
      if (!credentials) return 'กรุณาเข้าใช้งานใหม่';
      if (!Number.isFinite(openingFloat) || openingFloat < 0) {
        return 'เงินทอนตั้งต้นต้องเป็นตัวเลขไม่ติดลบ';
      }
      try {
        const response = await shiftMutation({
          variables: {
            input: {
              action: 'OPEN',
              cashierUserId: credentials.cashierUserId,
              pin: credentials.pin,
              openingFloat,
              countedCash: null,
              note: null,
              userId: null,
            },
          },
        });
        const result = response.data?.bmsPosShift;
        if (result?.status !== 'OPENED') {
          return result?.reason ?? result?.status ?? 'เปิดกะไม่สำเร็จ';
        }
        await refresh();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'เปิดกะไม่สำเร็จ';
      }
    },
    [credentials, refresh, shift, shiftMutation],
  );

  const closeSummary = useMemo(
    () =>
      report?.status === 'CLOSED' && report.countedCash != null
        ? {
            closedAt: report.closedAt ?? '',
            countedCash: report.countedCash,
            expectedCash: report.expectedCash ?? 0,
            variance: report.cashVariance ?? 0,
          }
        : null,
    [report],
  );
  const value = useMemo<ShiftContextValue>(
    () => ({
      isOpen: shift?.status === 'OPEN',
      openedAt: shift?.openedAt ?? report?.openedAt ?? 'ยังไม่เปิดกะ',
      openedByName: report?.openedByName ?? session?.cashier.name ?? '-',
      openingFloat: shift?.openingFloat ?? report?.openingFloat ?? 0,
      movements,
      cashSales:
        report?.byMethod.find(item => item.method === 'CASH')?.amount ?? 0,
      cashRefunds: report?.cashRefunds ?? 0,
      movementIn: report?.cashIn ?? 0,
      movementOut: report?.cashOut ?? 0,
      expectedCash: report?.expectedCash ?? shift?.expectedCash ?? 0,
      closeSummary,
      loading:
        bootstrap.loading ||
        historyQuery.loading ||
        movementsQuery.loading ||
        reportQuery.loading,
      error:
        bootstrap.error?.message ??
        historyQuery.error?.message ??
        movementsQuery.error?.message ??
        reportQuery.error?.message ??
        null,
      addMovement,
      closeShift,
      reopenShift,
    }),
    [
      addMovement,
      bootstrap.error?.message,
      bootstrap.loading,
      closeShift,
      closeSummary,
      historyQuery.error?.message,
      historyQuery.loading,
      movements,
      movementsQuery.error?.message,
      movementsQuery.loading,
      reopenShift,
      report,
      reportQuery.error?.message,
      reportQuery.loading,
      session?.cashier.name,
      shift,
    ],
  );
  return (
    <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
  );
}

export function useShift(): ShiftContextValue {
  const context = useContext(ShiftContext);
  if (!context) throw new Error('useShift ต้องถูกเรียกใต้ <ShiftProvider>');
  return context;
}
