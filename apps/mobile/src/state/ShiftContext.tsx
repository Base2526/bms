import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  cashRefundsOf,
  cashSalesOf,
  cashVariance,
  drawerExpectedFrom,
  parseAmountInput,
  summarizeMovements,
  validateCashOut,
  type CashMovementType,
} from '../lib/shiftMath';
import { mockCashMovements, mockShift } from '../mocks/shift';
import type { MockCashMovement } from '../mocks/shift';
import { useSales } from './SalesContext';

// กะ/ลิ้นชักของรอบที่เปิดแอป — ยังเป็น state ในหน่วยความจำล้วน ไม่มี network
//
// ⚠️ ตัวเลขทุกตัวบนหน้ากะต้อง "คำนวณจากของที่เกิดขึ้นจริง" ไม่ใช่ค่าที่เขียนไว้:
// เงินสดที่เข้าลิ้นชักมาจากบิลใน SalesContext + เงินเข้า/ออกที่บันทึกไว้ในนี้
// ถ้าปล่อยให้เป็นเลขคงที่ จอจะบอกคนละเรื่องกับรายการที่แสดงอยู่ข้าง ๆ กันเอง

export interface ShiftCloseSummary {
  closedAt: string;
  countedCash: number;
  expectedCash: number;
  variance: number;
}

interface ShiftContextValue {
  openedAt: string;
  openedByName: string;
  openingFloat: number;
  movements: MockCashMovement[];
  /** เงินสดจากการขายในกะนี้ (mock ที่ seed ไว้ + บิลที่เพิ่งขายในแอป) */
  cashSales: number;
  /** เงินสดที่จ่ายคืนออกไปจริง (การคืนทาง QR/บัตรยังไม่ออกจากลิ้นชัก) */
  cashRefunds: number;
  movementIn: number;
  movementOut: number;
  expectedCash: number;
  closeSummary: ShiftCloseSummary | null;
  /** คืน error เป็นข้อความ ถ้า null แปลว่าบันทึกแล้ว */
  addMovement: (
    type: CashMovementType,
    amountText: string,
    reason: string,
  ) => string | null;
  closeShift: (countedCashText: string) => string | null;
  reopenShift: (openedByName: string) => void;
}

const ShiftContext = createContext<ShiftContextValue | null>(null);

function clockLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

export function ShiftProvider({
  children,
  openedByName,
}: {
  children: React.ReactNode;
  openedByName: string;
}) {
  const { sales } = useSales();
  const [openedAt, setOpenedAt] = useState(mockShift.openedAt);
  const [openingFloat, setOpeningFloat] = useState(mockShift.openingFloat);
  const [seededCashSales, setSeededCashSales] = useState(
    mockShift.seededCashSales,
  );
  const [movements, setMovements] = useState<MockCashMovement[]>(() => [
    ...mockCashMovements,
  ]);
  const [closeSummary, setCloseSummary] = useState<ShiftCloseSummary | null>(
    null,
  );
  const [reopenedBy, setReopenedBy] = useState<string | null>(null);
  // เวลาที่กะปัจจุบันเริ่ม — 0 = กะแรกของรอบที่เปิดแอป (นับบิลทั้งหมดที่ขายในแอป)
  // ⚠️ ledger ของการขายไม่ถูกล้างตอนเปิดกะใหม่ ถ้าไม่มีเส้นนี้ เงินของกะที่ปิดไปแล้วจะถูกนับ
  // เข้าลิ้นชักของกะใหม่อีกรอบ แล้วยอด "ควรมี" จะบวมขึ้นทุกครั้งที่เปิดกะ
  const [shiftStartedAtMs, setShiftStartedAtMs] = useState(0);

  const { movementIn, movementOut } = useMemo(
    () => summarizeMovements(movements),
    [movements],
  );
  const cashSales = useMemo(
    () => seededCashSales + cashSalesOf(sales, shiftStartedAtMs),
    [sales, seededCashSales, shiftStartedAtMs],
  );
  const cashRefunds = useMemo(
    () => cashRefundsOf(sales, shiftStartedAtMs),
    [sales, shiftStartedAtMs],
  );

  const expectedCash = useMemo(
    () =>
      drawerExpectedFrom({
        openingFloat,
        cashSales,
        cashRefunds,
        movementIn,
        movementOut,
      }),
    [cashRefunds, cashSales, movementIn, movementOut, openingFloat],
  );

  const addMovement = useCallback(
    (type: CashMovementType, amountText: string, reason: string) => {
      if (closeSummary) return 'กะนี้ปิดไปแล้ว — เปิดกะใหม่ก่อน';
      const parsed = parseAmountInput(amountText);
      if (!parsed.ok) return parsed.error ?? 'จำนวนเงินไม่ถูกต้อง';
      if (!reason.trim()) return 'ต้องระบุเหตุผลของเงินเข้า/ออก';
      if (type === 'OUT') {
        const overdraft = validateCashOut(parsed.amount, expectedCash);
        if (overdraft) return overdraft;
      }
      setMovements(prev => [
        {
          id: `cm-${Date.now()}`,
          type,
          amount: parsed.amount,
          reason: reason.trim(),
          at: clockLabel(new Date()),
        },
        ...prev,
      ]);
      return null;
    },
    [closeSummary, expectedCash],
  );

  const closeShift = useCallback(
    (countedCashText: string) => {
      if (closeSummary) return 'กะนี้ปิดไปแล้ว';
      const trimmed = countedCashText.trim();
      if (!trimmed) return 'กรอกยอดเงินสดที่นับได้';
      const counted = Number(trimmed);
      if (!Number.isFinite(counted) || counted < 0) {
        return 'ยอดเงินสดที่นับได้ต้องเป็นตัวเลขไม่ติดลบ';
      }
      setCloseSummary({
        closedAt: clockLabel(new Date()),
        countedCash: Math.round(counted * 100) / 100,
        expectedCash,
        variance: cashVariance(counted, expectedCash),
      });
      return null;
    },
    [closeSummary, expectedCash],
  );

  // เปิดกะใหม่ = เริ่มนับใหม่จากศูนย์ ยกเว้นเงินทอนตั้งต้นที่ยกยอดที่นับได้จริงมาเป็นตัวตั้ง
  // (ยอดขายของกะก่อนหน้าไม่ตามมา — ไม่งั้นสรุปกะใหม่จะรวมเงินที่ปิดไปแล้ว)
  const reopenShift = useCallback(
    (name: string) => {
      setOpeningFloat(closeSummary?.countedCash ?? openingFloat);
      setSeededCashSales(0);
      setMovements([]);
      setCloseSummary(null);
      setOpenedAt(clockLabel(new Date()));
      setReopenedBy(name);
      setShiftStartedAtMs(Date.now());
    },
    [closeSummary, openingFloat],
  );

  const value = useMemo<ShiftContextValue>(
    () => ({
      openedAt,
      openedByName: reopenedBy ?? openedByName,
      openingFloat,
      movements,
      cashSales,
      cashRefunds,
      movementIn,
      movementOut,
      expectedCash,
      closeSummary,
      addMovement,
      closeShift,
      reopenShift,
    }),
    [
      addMovement,
      cashRefunds,
      cashSales,
      closeShift,
      closeSummary,
      expectedCash,
      movementIn,
      movementOut,
      movements,
      openedAt,
      openedByName,
      openingFloat,
      reopenShift,
      reopenedBy,
    ],
  );

  return (
    <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
  );
}

export function useShift(): ShiftContextValue {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error('useShift ต้องถูกเรียกใต้ <ShiftProvider>');
  return ctx;
}
