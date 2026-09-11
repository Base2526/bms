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

/**
 * สถานะของโต๊ะบนผังโต๊ะ
 *
 * ⚠️ "ไม่มีบรรทัดแล้ว = ว่าง" ต้องมาก่อนธง CLOSING ที่ mock ตั้งไว้เสมอ
 * ของเดิมเช็ค CLOSING ก่อน โต๊ะที่ seed เป็น CLOSING (T04) จึงขึ้นว่า "กำลังคิดเงิน" ตลอดไป
 * **แม้คิดเงินจบและบิลว่างแล้ว** = โต๊ะที่ไม่มีวันกลับมาว่างและเปิดบิลใหม่ไม่ได้
 */
export function tableStatusFor(
  lineCount: number,
  seededStatus: TableStatus | undefined,
): TableStatus {
  if (lineCount === 0) return 'EMPTY';
  return seededStatus === 'CLOSING' ? 'CLOSING' : 'OCCUPIED';
}

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
  /**
   * ส่งครัว = บรรทัด NEW ทั้งหมดกลายเป็น SENT · คืน "บรรทัดที่ส่งไป" ไม่ใช่แค่จำนวน
   * เพราะผู้เรียกต้องเอาไปออกตั๋วครัวต่อ (จำนวนอย่างเดียวบอกไม่ได้ว่าต้องออกตั๋วให้สถานีไหน)
   */
  sendRound: (tableId: string) => MockCheckLine[];
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
      const unsent = lines.filter(l => l.status === 'NEW');
      if (unsent.length === 0) return [];
      setByTable(prev => ({
        ...prev,
        [tableId]: (prev[tableId] ?? []).map(l =>
          l.status === 'NEW' ? { ...l, status: 'SENT' } : l,
        ),
      }));
      return unsent.map(l => ({ ...l, status: 'SENT' as CheckLineStatus }));
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
      const status = tableStatusFor(lines.length, base?.status);
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
