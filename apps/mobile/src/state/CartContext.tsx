import React, { createContext, useContext, useMemo, useState } from 'react';
import { MockCartLine } from '../mocks/menu';

// state ตะกร้าฝั่ง client ล้วน ๆ — ยังไม่มี server เป็นเจ้าของความจริงเรื่องราคา/สต็อกใด ๆ
// (บนเว็บ POS มีกฎชัดว่าตัวเลขที่คิดเงินจริงต้องมาจาก server เสมอ ห้ามคิดเองที่จอ —
//  โครงนี้ยังไม่ต่อ backend จึงยังใช้ราคาจาก mock ได้ชั่วคราว ต้องแก้ตอนต่อ GraphQL จริง)
interface CartContextValue {
  lines: MockCartLine[];
  addItem: (sku: string, name: string, unitPrice: number) => void;
  /** ลดทีละ 1 — เหลือ 0 แล้วบรรทัดหายไปเอง ไม่ต้องมีปุ่มลบแยกอีกปุ่ม */
  decrementItem: (sku: string) => void;
  removeLine: (sku: string) => void;
  clear: () => void;
  total: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<MockCartLine[]>([]);

  const addItem = (sku: string, name: string, unitPrice: number) => {
    setLines(prev => {
      const existing = prev.find(l => l.sku === sku);
      if (existing) {
        return prev.map(l => (l.sku === sku ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { sku, name, unitPrice, qty: 1 }];
    });
  };

  const decrementItem = (sku: string) =>
    setLines(prev =>
      prev.flatMap(l =>
        l.sku === sku ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l],
      ),
    );

  const removeLine = (sku: string) =>
    setLines(prev => prev.filter(l => l.sku !== sku));
  const clear = () => setLines([]);

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0),
    [lines],
  );

  return (
    <CartContext.Provider
      value={{ lines, addItem, decrementItem, removeLine, clear, total }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart ต้องถูกเรียกใต้ <CartProvider>');
  return ctx;
}
