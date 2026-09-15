import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  MobilePosMemberPreviewDocument,
  MobilePosParkDocument,
  MobilePosParkedSalesDocument,
} from '../graphql/generated';
import type { SchemaBmsPosParkInput } from '../graphql/generated';
import type {
  PosCartLine,
  PosCoupon,
  PosExtraLine,
  PosManualDiscount,
  PosMember,
  PosMenuItem,
} from '../types/pos';
import { cartLineKey } from '../lib/cartLine';
import { useSession } from './SessionContext';
import { useShift } from './ShiftContext';

export interface ParkedBill {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  lines: PosCartLine[];
  member: PosMember | null;
  coupon: PosCoupon | null;
  pointsUsed: number;
  manualDiscount: null;
  extraLines: PosExtraLine[];
  pharmacyReview: PosPharmacyReview | null;
}

export interface PosPharmacyReview {
  assessmentId: string;
  caseCode: string;
  status: string | null;
  canResume: boolean;
  requiresSafetyCheck: boolean;
}

interface CartContextValue {
  lines: PosCartLine[];
  addItem: (item: PosMenuItem) => void;
  /** ลดจำนวนบรรทัดเดียวที่ระบุด้วย line.key — ห้ามส่ง sku มา (ดู decrementSku) */
  decrementItem: (key: string) => void;
  /** ลดจำนวนจากการ์ดสินค้า ซึ่งรู้แค่ sku — ลดที่บรรทัดล่าสุดของ sku นั้นบรรทัดเดียว */
  decrementSku: (sku: string) => void;
  removeLine: (key: string) => void;
  updateLine: (key: string, patch: Partial<PosCartLine>) => void;
  clear: () => void;
  replaceForExchange: (lines: PosCartLine[], member: PosMember | null) => void;
  member: PosMember | null;
  setMember: (member: PosMember | null) => void;
  coupon: PosCoupon | null;
  setCoupon: (coupon: PosCoupon | null) => void;
  manualDiscount: PosManualDiscount | null;
  setManualDiscount: (discount: PosManualDiscount | null) => void;
  pointsToRedeem: number;
  setPointsToRedeem: (points: number) => void;
  extraLines: PosExtraLine[];
  setExtraLines: (lines: PosExtraLine[]) => void;
  pharmacyReview: PosPharmacyReview | null;
  parkedBills: ParkedBill[];
  parkCurrentBill: (name: string, note: string) => Promise<string | null>;
  resumeParkedBill: (id: string) => Promise<string | null>;
  deleteParkedBill: (id: string) => Promise<string | null>;
  subtotal: number;
  extraTotal: number;
  tierDiscount: number;
  couponDiscount: number;
  appliedManualDiscount: number;
  discountTotal: number;
  total: number;
  previewLoading: boolean;
  previewError: string | null;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const { isOpen: isShiftOpen } = useShift();
  const [lines, setLines] = useState<PosCartLine[]>([]);
  const [member, setMember] = useState<PosMember | null>(null);
  const [coupon, setCoupon] = useState<PosCoupon | null>(null);
  const [manualDiscount, setManualDiscount] =
    useState<PosManualDiscount | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [extraLines, setExtraLines] = useState<PosExtraLine[]>([]);
  const [pharmacyReview, setPharmacyReview] =
    useState<PosPharmacyReview | null>(null);
  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0),
    [lines],
  );

  const previewInput = useMemo(
    () => ({
      subtotal,
      customerId: member?.id ?? null,
      couponCode: coupon?.code ?? null,
      manualDiscount: manualDiscount?.amount ?? null,
      pointsToRedeem,
    }),
    [
      coupon?.code,
      manualDiscount?.amount,
      member?.id,
      pointsToRedeem,
      subtotal,
    ],
  );
  const preview = useQuery(MobilePosMemberPreviewDocument, {
    variables: { input: previewInput },
    skip: !session || subtotal <= 0,
    notifyOnNetworkStatusChange: true,
  });
  const parkedQuery = useQuery(MobilePosParkedSalesDocument, {
    skip: !session || !isShiftOpen,
    notifyOnNetworkStatusChange: true,
  });
  const [parkMutation] = useMutation(MobilePosParkDocument);

  const addItem = useCallback((item: PosMenuItem) => {
    const modifierCodes = item.selectedModifierCodes ?? [];
    const key = cartLineKey({
      sku: item.sku,
      size: item.size,
      packCode: item.packCode,
      modifierCodes,
    });
    const modifierNames = (item.modifiers ?? [])
      .filter(modifier => modifierCodes.includes(modifier.code))
      .map(modifier => modifier.name);
    setLines(previous => {
      const existing = previous.find(line => line.key === key);
      if (existing) {
        return previous.map(line =>
          line.key === key ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [
        ...previous,
        {
          key,
          sku: item.sku,
          name: item.name,
          qty: 1,
          unitPrice: item.price,
          size: item.size,
          packCode: item.packCode,
          unitName: item.unitName,
          baseQty: item.baseQty,
          modifierCodes,
          modifierNames,
          serialTracked: item.serialTracked,
          scaleBarcode: item.scaleBarcode,
          serials: [],
          imageUrl: item.imageUrl,
        },
      ];
    });
  }, []);

  // ⚠️ เทียบ key เท่านั้น — เดิมยอมรับ sku ด้วย (`line.sku === key`) ซึ่งแมตช์ **ทุกบรรทัด**
  // ที่ sku เดียวกัน: กดลดที่บรรทัด L ของสินค้าที่มี S/M/L อยู่ในตะกร้า แล้วหายไปทั้งสามบรรทัด
  const decrementItem = useCallback((key: string) => {
    setLines(previous =>
      previous.flatMap(line =>
        line.key === key
          ? line.qty > 1
            ? [{ ...line, qty: line.qty - 1 }]
            : []
          : [line],
      ),
    );
  }, []);
  // การ์ดสินค้าในกริดรู้แค่ sku (การ์ดใบเดียวแทนทุกไซซ์) — ลดที่บรรทัดล่าสุดของ sku นั้น
  // คือบรรทัดที่เพิ่งถูกเพิ่ม ซึ่งตรงกับสิ่งที่คนกดกำลังแก้
  const decrementSku = useCallback((sku: string) => {
    setLines(previous => {
      let target = -1;
      for (let index = previous.length - 1; index >= 0; index -= 1) {
        if (previous[index].sku === sku) {
          target = index;
          break;
        }
      }
      if (target < 0) return previous;
      return previous.flatMap((line, index) =>
        index === target
          ? line.qty > 1
            ? [{ ...line, qty: line.qty - 1 }]
            : []
          : [line],
      );
    });
  }, []);
  const removeLine = useCallback(
    (key: string) =>
      setLines(previous => previous.filter(line => line.key !== key)),
    [],
  );
  const updateLine = useCallback((key: string, patch: Partial<PosCartLine>) => {
    setLines(previous =>
      previous.map(line => (line.key === key ? { ...line, ...patch } : line)),
    );
  }, []);
  const clear = useCallback(() => {
    setLines([]);
    setMember(null);
    setCoupon(null);
    setManualDiscount(null);
    setPointsToRedeem(0);
    setExtraLines([]);
    setPharmacyReview(null);
  }, []);
  const replaceForExchange = useCallback(
    (replacementLines: PosCartLine[], replacementMember: PosMember | null) => {
      setLines(replacementLines);
      setMember(replacementMember);
      setCoupon(null);
      setManualDiscount(null);
      setPointsToRedeem(0);
      setExtraLines([]);
      setPharmacyReview(null);
    },
    [],
  );

  const extraTotal = useMemo(
    () =>
      extraLines.reduce(
        (sum, line) =>
          sum +
          (line.label.trim() && line.qty > 0 && line.unitAmount > 0
            ? line.qty * line.unitAmount
            : 0),
        0,
      ),
    [extraLines],
  );

  const parkedBills = useMemo<ParkedBill[]>(
    () =>
      (parkedQuery.data?.bmsPosParkedSales.parked ?? []).map(parked => ({
        id: parked.id,
        name: parked.label,
        note: '',
        createdAt: parked.createdAt,
        lines: (parked.cart?.lines ?? []).flatMap(line => {
          if (!line.sku) return [];
          return [
            {
              key:
                line.key ??
                cartLineKey({
                  sku: line.sku,
                  size: line.size,
                  packCode: line.packCode,
                  modifierCodes: line.modifierCodes,
                }),
              sku: line.sku,
              name: line.receiptName ?? line.productName ?? line.sku,
              qty: line.packQty ?? 1,
              unitPrice: line.packPrice ?? line.basePrice ?? 0,
              size: line.size ?? '',
              packCode: line.packCode ?? '',
              unitName: line.unitName ?? '',
              baseQty: line.baseQty ?? 1,
              modifierCodes: line.modifierCodes ?? [],
              serialTracked: line.serialTracked ?? false,
              scaleBarcode: line.scaleBarcode,
              serials: line.serials ?? [],
              imageUrl: line.imageUrl,
            },
          ];
        }),
        member: parked.cart?.member?.customerId
          ? {
              id: parked.cart.member.customerId,
              memberNo: parked.cart.member.memberNo,
              name:
                parked.cart.member.name ??
                parked.cart.member.memberNo ??
                'สมาชิก',
              phone: parked.cart.member.phone,
              tier: null,
              tierDiscountPct: 0,
              points: parked.cart.member.pointsBalance ?? 0,
              pointsUsable: parked.cart.member.pointsUsable ?? 0,
            }
          : null,
        coupon: parked.cart?.couponCode
          ? { code: parked.cart.couponCode }
          : null,
        pointsUsed: Number(parked.cart?.pointsToRedeem ?? 0),
        manualDiscount: null,
        extraLines: (parked.cart?.extraLines ?? []).map((line, index) => ({
          id: `parked-extra-${parked.id}-${index}`,
          label: line.label,
          qty: 1,
          unitAmount: Number(line.unitAmount ?? 0),
        })),
        pharmacyReview: parked.pharmacyReview
          ? {
              assessmentId: parked.pharmacyReview.assessmentId,
              caseCode: parked.pharmacyReview.caseCode,
              status: parked.pharmacyReview.status ?? null,
              canResume: parked.pharmacyReview.canResume,
              requiresSafetyCheck: parked.pharmacyReview.requiresSafetyCheck,
            }
          : null,
      })),
    [parkedQuery.data],
  );

  const mutatePark = useCallback(
    async (input: Record<string, unknown>) => {
      if (!session) return 'กรุณาเข้าใช้งานใหม่';
      if (!isShiftOpen) return 'กรุณาเปิดกะก่อนจัดการบิลพัก';
      try {
        const response = await parkMutation({
          variables: {
            input: {
              cashierUserId: session.cashier.id,
              ...input,
            } as SchemaBmsPosParkInput,
          },
        });
        const result = response.data?.bmsPosPark;
        if (
          !result ||
          !['PARKED', 'RESUMED', 'DROPPED'].includes(result.status)
        ) {
          return result?.reason ?? result?.status ?? 'จัดการบิลพักไม่สำเร็จ';
        }
        await parkedQuery.refetch();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'จัดการบิลพักไม่สำเร็จ';
      }
    },
    [isShiftOpen, parkMutation, parkedQuery, session],
  );

  const parkCurrentBill = useCallback(
    async (name: string, note: string) => {
      if (!lines.length) return 'ยังไม่มีรายการในบิล';
      const failure = await mutatePark({
        action: 'park',
        label:
          [name.trim(), note.trim()].filter(Boolean).join(' - ') || 'บิลพัก',
        itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
        subtotalHint: subtotal,
        cart: {
          version: 2,
          couponCode: coupon?.code ?? null,
          pointsToRedeem: String(pointsToRedeem),
          extraLines: extraLines
            .filter(
              line => line.label.trim() && line.qty > 0 && line.unitAmount > 0,
            )
            .map(line => ({
              label:
                line.qty === 1
                  ? line.label.trim()
                  : `${line.label.trim()} × ${line.qty}`,
              unitAmount: String(line.qty * line.unitAmount),
            })),
          member: member
            ? {
                customerId: member.id,
                memberNo: member.memberNo,
                name: member.name,
              }
            : null,
          pharmacyReview: pharmacyReview
            ? {
                assessmentId: pharmacyReview.assessmentId,
                caseCode: pharmacyReview.caseCode,
                requiresSafetyCheck: pharmacyReview.requiresSafetyCheck,
              }
            : null,
          lines: lines.map(line => ({
            key: line.key,
            sku: line.sku,
            size: line.size,
            receiptName: line.name,
            packCode: line.packCode,
            unitName: line.unitName,
            packQty: line.qty,
            packPrice: line.unitPrice,
            baseQty: line.baseQty,
            modifierCodes: line.modifierCodes,
            serialTracked: line.serialTracked,
            scaleBarcode: line.scaleBarcode,
            serials: line.serials,
          })),
        },
      });
      if (!failure) clear();
      return failure;
    },
    [
      clear,
      coupon?.code,
      extraLines,
      lines,
      member,
      mutatePark,
      pharmacyReview,
      pointsToRedeem,
      subtotal,
    ],
  );

  const resumeParkedBill = useCallback(
    async (id: string) => {
      const parked = parkedBills.find(bill => bill.id === id);
      if (!parked) return 'ไม่พบบิลพัก';
      const failure = await mutatePark({ action: 'resume', parkedId: id });
      if (!failure) {
        setLines(parked.lines);
        setMember(parked.member);
        setCoupon(parked.coupon);
        setManualDiscount(null);
        setPointsToRedeem(parked.pointsUsed);
        setExtraLines(parked.extraLines);
        setPharmacyReview(parked.pharmacyReview);
      }
      return failure;
    },
    [mutatePark, parkedBills],
  );

  const deleteParkedBill = useCallback(
    (id: string) => mutatePark({ action: 'drop', parkedId: id }),
    [mutatePark],
  );

  const serverPreview = preview.data?.bmsPosMemberPreview;
  const total = (serverPreview?.netTotal ?? subtotal) + extraTotal;
  const tierDiscount = serverPreview?.tierDiscount ?? 0;
  const couponDiscount = serverPreview?.couponDiscount ?? 0;
  const appliedManualDiscount = serverPreview?.manualDiscount ?? 0;
  const discountTotal = serverPreview?.totalDiscount ?? 0;

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      addItem,
      decrementItem,
      decrementSku,
      removeLine,
      updateLine,
      clear,
      replaceForExchange,
      member,
      setMember,
      coupon,
      setCoupon,
      manualDiscount,
      setManualDiscount,
      pointsToRedeem,
      setPointsToRedeem,
      extraLines,
      setExtraLines,
      pharmacyReview,
      parkedBills,
      parkCurrentBill,
      resumeParkedBill,
      deleteParkedBill,
      subtotal,
      extraTotal,
      tierDiscount,
      couponDiscount,
      appliedManualDiscount,
      discountTotal,
      total,
      previewLoading: preview.loading,
      previewError:
        preview.error?.message ?? serverPreview?.couponError ?? null,
    }),
    [
      addItem,
      appliedManualDiscount,
      clear,
      coupon,
      couponDiscount,
      decrementItem,
      decrementSku,
      deleteParkedBill,
      discountTotal,
      lines,
      manualDiscount,
      pointsToRedeem,
      extraLines,
      pharmacyReview,
      extraTotal,
      member,
      parkCurrentBill,
      parkedBills,
      preview.error?.message,
      preview.loading,
      removeLine,
      replaceForExchange,
      updateLine,
      resumeParkedBill,
      serverPreview?.couponError,
      subtotal,
      tierDiscount,
      total,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart ต้องถูกเรียกใต้ <CartProvider>');
  return context;
}
