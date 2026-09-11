import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { MockCartLine } from '../mocks/menu';
import type { MockCoupon, MockMember } from '../mocks/checkout';
import {
  calculateMockDiscounts,
  couponEligibilityError,
  type ManualDiscount,
} from '../lib/checkoutMath';

// state ตะกร้าฝั่ง client ล้วน ๆ — ยังไม่มี server เป็นเจ้าของความจริงเรื่องราคา/สต็อกใด ๆ
// (บนเว็บ POS มีกฎชัดว่าตัวเลขที่คิดเงินจริงต้องมาจาก server เสมอ ห้ามคิดเองที่จอ —
//  โครงนี้ยังไม่ต่อ backend จึงยังใช้ราคาจาก mock ได้ชั่วคราว ต้องแก้ตอนต่อ GraphQL จริง)
interface CartContextValue {
  lines: MockCartLine[];
  addItem: (
    sku: string,
    name: string,
    unitPrice: number,
    barcode?: string,
  ) => void;
  /** ลดทีละ 1 — เหลือ 0 แล้วบรรทัดหายไปเอง ไม่ต้องมีปุ่มลบแยกอีกปุ่ม */
  decrementItem: (sku: string) => void;
  removeLine: (sku: string) => void;
  clear: () => void;
  member: MockMember | null;
  setMember: (member: MockMember | null) => void;
  coupon: MockCoupon | null;
  setCoupon: (coupon: MockCoupon | null) => void;
  manualDiscount: ManualDiscount | null;
  setManualDiscount: (discount: ManualDiscount | null) => void;
  parkedBills: ParkedBill[];
  parkCurrentBill: (name: string, note: string) => void;
  resumeParkedBill: (id: string) => void;
  deleteParkedBill: (id: string) => void;
  subtotal: number;
  tierDiscount: number;
  couponDiscount: number;
  appliedManualDiscount: number;
  discountTotal: number;
  total: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export interface ParkedBill {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  lines: MockCartLine[];
  member: MockMember | null;
  coupon: MockCoupon | null;
  pointsUsed: number;
  manualDiscount: Omit<ManualDiscount, 'approverName'> | null;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<MockCartLine[]>([]);
  const [member, setMember] = useState<MockMember | null>(null);
  const [coupon, setCoupon] = useState<MockCoupon | null>(null);
  const [manualDiscount, setManualDiscount] = useState<ManualDiscount | null>(
    null,
  );
  const [parkedBills, setParkedBills] = useState<ParkedBill[]>([]);

  const addItem = (
    sku: string,
    name: string,
    unitPrice: number,
    barcode?: string,
  ) => {
    setLines(prev => {
      const existing = prev.find(l => l.sku === sku);
      if (existing) {
        return prev.map(l => (l.sku === sku ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { sku, name, unitPrice, barcode, qty: 1 }];
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
  const clear = () => {
    setLines([]);
    setMember(null);
    setCoupon(null);
    setManualDiscount(null);
  };

  const parkCurrentBill = (name: string, note: string) => {
    if (lines.length === 0) return;
    setParkedBills(prev => [
      {
        id: `parked-${Date.now()}`,
        name: name.trim() || `บิลพัก ${prev.length + 1}`,
        note: note.trim(),
        createdAt: new Date().toISOString(),
        lines: lines.map(line => ({ ...line })),
        member,
        coupon,
        pointsUsed: 0,
        manualDiscount: manualDiscount
          ? {
              amount: manualDiscount.amount,
              reason: manualDiscount.reason,
            }
          : null,
      },
      ...prev,
    ]);
    clear();
  };

  const resumeParkedBill = (id: string) => {
    const parked = parkedBills.find(bill => bill.id === id);
    if (!parked) return;
    setLines(parked.lines.map(line => ({ ...line })));
    setMember(parked.member);
    setCoupon(parked.coupon);
    // ห้ามเก็บ PIN/ผู้อนุมัติของส่วนลดพิเศษในบิลพัก: resume แล้วต้องอนุมัติใหม่
    setManualDiscount(null);
    setParkedBills(prev => prev.filter(bill => bill.id !== id));
  };

  const deleteParkedBill = (id: string) =>
    setParkedBills(prev => prev.filter(bill => bill.id !== id));

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0),
    [lines],
  );
  const discounts = useMemo(
    () => calculateMockDiscounts({ subtotal, member, coupon, manualDiscount }),
    [coupon, manualDiscount, member, subtotal],
  );

  // ตะกร้าเปลี่ยนแล้ว preview เดิมใช้ไม่ได้: mock เลือกล้างสิทธิ์ที่ไม่ผ่านแทนการแสดงส่วนลดเก่า
  // ของจริงให้ server preview ใหม่และอธิบายเหตุผลที่สิทธิ์หลุด
  useEffect(() => {
    if (coupon && couponEligibilityError(coupon, subtotal, Boolean(member))) {
      setCoupon(null);
    }
  }, [coupon, member, subtotal]);

  useEffect(() => {
    if (manualDiscount && discounts.manualDiscount !== manualDiscount.amount) {
      setManualDiscount(null);
    }
  }, [discounts.manualDiscount, manualDiscount]);

  return (
    <CartContext.Provider
      value={{
        lines,
        addItem,
        decrementItem,
        removeLine,
        clear,
        member,
        setMember,
        coupon,
        setCoupon,
        manualDiscount,
        setManualDiscount,
        parkedBills,
        parkCurrentBill,
        resumeParkedBill,
        deleteParkedBill,
        subtotal,
        tierDiscount: discounts.tierDiscount,
        couponDiscount: discounts.couponDiscount,
        appliedManualDiscount: discounts.manualDiscount,
        discountTotal: discounts.discountTotal,
        total: discounts.netTotal,
      }}
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
