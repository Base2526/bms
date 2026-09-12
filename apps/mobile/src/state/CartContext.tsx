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
  PosManualDiscount,
  PosMember,
  PosMenuItem,
} from '../types/pos';
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
}

interface CartContextValue {
  lines: PosCartLine[];
  addItem: (item: PosMenuItem) => void;
  decrementItem: (key: string) => void;
  removeLine: (key: string) => void;
  clear: () => void;
  member: PosMember | null;
  setMember: (member: PosMember | null) => void;
  coupon: PosCoupon | null;
  setCoupon: (coupon: PosCoupon | null) => void;
  manualDiscount: PosManualDiscount | null;
  setManualDiscount: (discount: PosManualDiscount | null) => void;
  parkedBills: ParkedBill[];
  parkCurrentBill: (name: string, note: string) => Promise<string | null>;
  resumeParkedBill: (id: string) => Promise<string | null>;
  deleteParkedBill: (id: string) => Promise<string | null>;
  subtotal: number;
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
      pointsToRedeem: 0,
    }),
    [coupon?.code, manualDiscount?.amount, member?.id, subtotal],
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
    const key = `${item.sku}:${item.size}:${item.packCode}`;
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
          modifierCodes: [],
          serials: [],
          imageUrl: item.imageUrl,
        },
      ];
    });
  }, []);

  const decrementItem = useCallback((key: string) => {
    setLines(previous =>
      previous.flatMap(line =>
        line.key === key || line.sku === key
          ? line.qty > 1
            ? [{ ...line, qty: line.qty - 1 }]
            : []
          : [line],
      ),
    );
  }, []);
  const removeLine = useCallback(
    (key: string) =>
      setLines(previous => previous.filter(line => line.key !== key)),
    [],
  );
  const clear = useCallback(() => {
    setLines([]);
    setMember(null);
    setCoupon(null);
    setManualDiscount(null);
  }, []);

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
                `${line.sku}:${line.size ?? ''}:${line.packCode ?? ''}`,
              sku: line.sku,
              name: line.receiptName ?? line.productName ?? line.sku,
              qty: line.packQty ?? 1,
              unitPrice: line.packPrice ?? line.basePrice ?? 0,
              size: line.size ?? '',
              packCode: line.packCode ?? '',
              unitName: line.unitName ?? '',
              baseQty: line.baseQty ?? 1,
              modifierCodes: line.modifierCodes ?? [],
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
          version: 1,
          couponCode: coupon?.code ?? null,
          pointsToRedeem: '0',
          member: member
            ? {
                customerId: member.id,
                memberNo: member.memberNo,
                name: member.name,
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
            scaleBarcode: line.scaleBarcode,
            serials: line.serials,
          })),
        },
      });
      if (!failure) clear();
      return failure;
    },
    [clear, coupon?.code, lines, member, mutatePark, subtotal],
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
  const total = serverPreview?.netTotal ?? subtotal;
  const tierDiscount = serverPreview?.tierDiscount ?? 0;
  const couponDiscount = serverPreview?.couponDiscount ?? 0;
  const appliedManualDiscount = serverPreview?.manualDiscount ?? 0;
  const discountTotal = serverPreview?.totalDiscount ?? 0;

  const value = useMemo<CartContextValue>(
    () => ({
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
      deleteParkedBill,
      discountTotal,
      lines,
      manualDiscount,
      member,
      parkCurrentBill,
      parkedBills,
      preview.error?.message,
      preview.loading,
      removeLine,
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
