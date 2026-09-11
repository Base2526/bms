import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  CheckLineStatus,
  MockCheckLine,
  mockCheckLinesByTable,
  mockTables,
  TableStatus,
} from '../mocks/floor';

// บิลของโต๊ะ (dine-in) — แยกจาก CartContext ซึ่งเป็นตะกร้าขายกลับบ้าน/หน้าร้านที่ไม่ผูกโต๊ะ
//
// ⚠️ นี่คือส่วนที่ทำให้ "เลือกโต๊ะแล้วสั่งอาหาร" เป็นไปได้: ก่อนหน้านี้รายการของโต๊ะเป็นค่าคงที่
// ใน mock จอบิลจึงเป็นทางตัน (เห็นรายการแต่เพิ่มไม่ได้) · ยังเป็น state ในหน่วยความจำล้วน
// ไม่มี network — ตอนต่อ backend จริงชั้นนี้จะกลายเป็น GraphQL mutation ของบิลโต๊ะ
// (addRestaurantCheckItem / sendRestaurantKitchenRound) โดยจุดเรียกในหน้าจอไม่ต้องแก้

export interface TableCheckSummary {
  lines: MockCheckLine[];
  amountDue: number;
  dishCount: number;
  hasUnsent: boolean;
  status: TableStatus;
}

interface ChecksContextValue {
  linesFor: (tableId: string) => MockCheckLine[];
  summaryFor: (tableId: string) => TableCheckSummary;
  addItem: (
    tableId: string,
    item: { sku: string; name: string; unitPrice: number },
  ) => void;
  decrementItem: (tableId: string, sku: string) => void;
  /** ส่งครัว = บรรทัด NEW ทั้งหมดกลายเป็น SENT · คืนจำนวนบรรทัดที่ส่งไป */
  sendRound: (tableId: string) => number;
  closeCheck: (tableId: string) => void;
}

const ChecksContext = createContext<ChecksContextValue | null>(null);

const EMPTY: MockCheckLine[] = [];

export function ChecksProvider({ children }: { children: React.ReactNode }) {
  const [byTable, setByTable] = useState<Record<string, MockCheckLine[]>>(
    () => ({ ...mockCheckLinesByTable }),
  );

  const linesFor = useCallback(
    (tableId: string) => byTable[tableId] ?? EMPTY,
    [byTable],
  );

  const addItem = useCallback(
    (
      tableId: string,
      item: { sku: string; name: string; unitPrice: number },
    ) => {
      setByTable(prev => {
        const lines = prev[tableId] ?? [];
        // รวมกับบรรทัดเดิม "เฉพาะบรรทัดที่ยังไม่ส่งครัว" — ของที่ส่งครัวไปแล้วเป็นรอบที่ครัวรับไปทำ
        // แล้ว การไปบวกจำนวนทับจะทำให้ตั๋วที่ครัวถืออยู่กับบิลไม่ตรงกัน (กฎเดียวกับฝั่งเว็บ)
        const idx = lines.findIndex(
          l => l.sku === item.sku && l.status === 'NEW',
        );
        const next =
          idx >= 0
            ? lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l))
            : [
                ...lines,
                {
                  sku: item.sku,
                  name: item.name,
                  unitPrice: item.unitPrice,
                  qty: 1,
                  status: 'NEW' as CheckLineStatus,
                },
              ];
        return { ...prev, [tableId]: next };
      });
    },
    [],
  );

  const decrementItem = useCallback((tableId: string, sku: string) => {
    setByTable(prev => {
      const lines = prev[tableId] ?? [];
      // ลดได้เฉพาะบรรทัดที่ยังไม่ส่งครัว — ของที่ครัวรับไปแล้วต้องยกเลิกที่จอครัว ไม่ใช่ลบเงียบ ๆ
      // จากบิล (ฝั่งเว็บบังคับเรื่องนี้เพราะอาหารอาจทำไปแล้วจริง)
      const idx = lines.findIndex(l => l.sku === sku && l.status === 'NEW');
      if (idx < 0) return prev;
      const line = lines[idx];
      const next =
        line.qty > 1
          ? lines.map((l, i) => (i === idx ? { ...l, qty: l.qty - 1 } : l))
          : lines.filter((_, i) => i !== idx);
      return { ...prev, [tableId]: next };
    });
  }, []);

  const sendRound = useCallback(
    (tableId: string) => {
      const lines = byTable[tableId] ?? [];
      const unsent = lines.filter(l => l.status === 'NEW').length;
      if (unsent === 0) return 0;
      setByTable(prev => ({
        ...prev,
        [tableId]: (prev[tableId] ?? []).map(l =>
          l.status === 'NEW' ? { ...l, status: 'SENT' } : l,
        ),
      }));
      return unsent;
    },
    [byTable],
  );

  const closeCheck = useCallback((tableId: string) => {
    setByTable(prev => ({ ...prev, [tableId]: [] }));
  }, []);

  const summaryFor = useCallback(
    (tableId: string): TableCheckSummary => {
      const lines = byTable[tableId] ?? EMPTY;
      const base = mockTables.find(t => t.id === tableId);
      const amountDue = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
      const dishCount = lines.reduce((n, l) => n + l.qty, 0);
      // สถานะมาจากข้อมูลจริงของบิล ไม่ใช่ธงที่ตั้งไว้ตายตัว — เพิ่มรายการให้โต๊ะว่างแล้วผังโต๊ะ
      // ต้องเปลี่ยนเป็น "มีลูกค้า" ทันที ไม่งั้นสองจอบอกคนละเรื่องกัน
      const status: TableStatus =
        base?.status === 'CLOSING'
          ? 'CLOSING'
          : lines.length > 0
          ? 'OCCUPIED'
          : 'EMPTY';
      return {
        lines,
        amountDue,
        dishCount,
        hasUnsent: lines.some(l => l.status === 'NEW'),
        status,
      };
    },
    [byTable],
  );

  const value = useMemo<ChecksContextValue>(
    () => ({
      linesFor,
      summaryFor,
      addItem,
      decrementItem,
      sendRound,
      closeCheck,
    }),
    [linesFor, summaryFor, addItem, decrementItem, sendRound, closeCheck],
  );

  return (
    <ChecksContext.Provider value={value}>{children}</ChecksContext.Provider>
  );
}

export function useChecks(): ChecksContextValue {
  const ctx = useContext(ChecksContext);
  if (!ctx) throw new Error('useChecks ต้องถูกเรียกใต้ <ChecksProvider>');
  return ctx;
}
