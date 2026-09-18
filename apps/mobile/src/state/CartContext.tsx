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
import {
  cartLinePricingSignature,
  cartProductSubtotal,
} from '../lib/cartPricing';
import { useCatalog } from './CatalogContext';
import { useSession } from './SessionContext';
import { useShift } from './ShiftContext';

const round2 = (value: number) => Math.round(value * 100) / 100;

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
  /**
   * ยิงสแกนทุกบรรทัดซ้ำก่อนรับเงิน · `changed: true` = ยอดที่ต้องจ่ายขยับและถูกอัปเดตแล้ว
   * จึง **ห้ามรับเงินรอบนั้น** — metadata ของราคาที่เปลี่ยนแต่ยอดบิลเท่าเดิมอัปเดตเงียบ ๆ ได้
   */
  refreshPricing: () => Promise<{ changed: boolean; error: string | null }>;
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
  /** ยอดสินค้าหลังหักส่วนลด + ค่าบริการ — **ยังไม่ปัดเศษเงินสด** (ขึ้นกับวิธีจ่าย) */
  total: number;
  /**
   * จำนวนแต้มที่ server บอกว่าจะหักจริง — ต้องส่งค่านี้ตอนขาย ไม่ใช่ค่าที่แคชเชียร์พิมพ์
   * (createOrderInTx ปฏิเสธทั้งบิลเมื่อ pointsUsed ไม่เท่าที่ขอเป๊ะ)
   */
  pointsUsed: number;
  pointsDiscount: number;
  previewLoading: boolean;
  previewError: string | null;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const { isOpen: isShiftOpen } = useShift();
  const { resolveVariant } = useCatalog();
  const [lines, setLines] = useState<PosCartLine[]>([]);
  const [member, setMember] = useState<PosMember | null>(null);
  const [coupon, setCoupon] = useState<PosCoupon | null>(null);
  const [manualDiscount, setManualDiscount] =
    useState<PosManualDiscount | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [extraLines, setExtraLines] = useState<PosExtraLine[]>([]);
  const [pharmacyReview, setPharmacyReview] =
    useState<PosPharmacyReview | null>(null);
  // ⚠️ ห้ามกลับไปเป็น `qty × unitPrice` — ยอดนี้ต้องเท่ากับที่ createOrderInTx คิดตอน commit
  // ทุกสตางค์ ไม่งั้น recordPosSale ตอบ PAYMENT_MISMATCH แล้วยกเลิกบิลทิ้งทั้งใบ
  // (ราคาส่ง 8.1 / โปร 8.7 คิดจากจำนวนรวมทั้งตะกร้า ไม่ใช่ต่อบรรทัด)
  const subtotal = useMemo(() => cartProductSubtotal(lines), [lines]);

  const previewInput = useMemo(
    () => ({
      subtotal,
      customerId: member?.id ?? null,
      couponCode: coupon?.code ?? null,
      manualDiscount: manualDiscount?.amount ?? null,
      pointsToRedeem,
      boardGameBillingGroupId: null,
      restaurantCheckId: null,
      lines: null,
      extraLines: null,
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
      // ⚠️ ขั้นราคาส่งและโปรมีขอบเขตระดับ SKU ไม่ใช่ SKU+ไซซ์ — การสแกนรอบล่าสุดคือ
      // กติกาที่ใหม่ที่สุดของ **ทุกไซซ์** ที่อยู่ในตะกร้าแล้ว ไม่ใช่ของบรรทัดที่เพิ่งกด
      // ถ้าไม่ซิงก์ ไซซ์ M อาจถูกคิดด้วยกฎเก่าขณะที่ XL ใช้กฎใหม่ แล้วยอดไม่ตรงกับ server
      const synced =
        item.priceTiers || item.promotion !== undefined
          ? previous.map(line =>
              line.sku === item.sku
                ? {
                    ...line,
                    priceTiers: item.priceTiers,
                    promotion: item.promotion ?? null,
                  }
                : line,
            )
          : previous;
      const existing = synced.find(line => line.key === key);
      if (existing) {
        return synced.map(line =>
          line.key === key ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [
        ...synced,
        {
          key,
          sku: item.sku,
          name: item.name,
          qty: 1,
          unitPrice: item.price,
          basePrice: item.basePrice,
          packBasePrice: item.packBasePrice ?? item.price,
          modifierUnitPrice: item.modifierUnitPrice ?? 0,
          priceTiers: item.priceTiers,
          promotion: item.promotion ?? null,
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

  /**
   * ยิงสแกนบรรทัดเดิมซ้ำเพื่อเอา "กติกาที่ตัดสินราคา ณ ตอนนี้" มาแปะบรรทัด
   *
   * ใช้สองที่: ตอนเรียกบิลพักกลับ (payload ของ parked cart ไม่มีช่องเก็บขั้นราคาส่ง/โปร/
   * ชื่อตัวเลือก) และตอนตรวจราคาซ้ำก่อนรับเงิน · กติกาที่ได้คือกติกาที่ server จะใช้ตอน commit
   */
  const rescanLine = useCallback(
    async (
      line: PosCartLine,
    ): Promise<{ line: PosCartLine; error: string | null }> => {
      try {
        const latest = await resolveVariant(
          line.scaleBarcode ?? line.sku,
          line.size,
          line.packCode || null,
        );
        const allowed = new Set((latest.modifiers ?? []).map(m => m.code));
        const closed = line.modifierCodes.find(code => !allowed.has(code));
        if (closed) {
          return {
            line,
            error: `ตัวเลือก ${closed} ของ ${line.name} ถูกปิดแล้ว กรุณาลบรายการและเพิ่มใหม่`,
          };
        }
        const selected = (latest.modifiers ?? []).filter(modifier =>
          line.modifierCodes.includes(modifier.code),
        );
        const modifierUnitPrice = selected.reduce(
          (sum, modifier) => sum + modifier.priceDelta,
          0,
        );
        const packBasePrice = latest.packBasePrice ?? latest.price;
        return {
          error: null,
          line: {
            ...line,
            unitPrice: packBasePrice + modifierUnitPrice,
            basePrice: latest.basePrice,
            packBasePrice,
            modifierUnitPrice,
            priceTiers: latest.priceTiers,
            promotion: latest.promotion ?? null,
            // ชื่อตัวเลือกไม่ได้ถูกเก็บลงบิลพัก — ประกอบใหม่จากรหัสที่เก็บไว้
            modifierNames: selected.map(modifier => modifier.name),
          } satisfies PosCartLine,
        };
      } catch (cause) {
        return {
          line,
          error:
            cause instanceof Error
              ? cause.message
              : `ตรวจราคาล่าสุดของ ${line.name} ไม่สำเร็จ`,
        };
      }
    },
    [resolveVariant],
  );

  /** บรรทัดที่สแกนไม่ผ่านตอนเรียกบิลพักกลับ คงค่าที่ติดมาไว้ — ให้ไปตกด่านตรวจก่อนรับเงินแทน */
  const refreshParkedLines = useCallback(
    async (parkedLines: PosCartLine[]): Promise<PosCartLine[]> =>
      (await Promise.all(parkedLines.map(rescanLine))).map(result => result.line),
    [rescanLine],
  );

  /**
   * ตรวจราคาซ้ำก่อนรับเงิน — รูปเดียวกับ `refreshCartPricingBeforePay()` ของจอเว็บ
   *
   * ⚠️ ตะกร้าถือ snapshot ของกติกา ณ ตอนที่สแกน · ร้านที่แก้ราคา/เปิด-ปิดโปรระหว่างที่บิล
   * ค้างอยู่บนจอ (หรือบิลพักที่ถูกเรียกกลับมาทีหลัง) จะทำให้ยอดที่จอโชว์ไม่ใช่ยอดที่ server
   * คิดตอน commit แล้วบิลถูกทิ้งทั้งใบด้วย PAYMENT_MISMATCH โดยแคชเชียร์ไม่รู้สาเหตุ
   *
   * `changed: true` = ยอดที่ต้องจ่ายเปลี่ยนและอัปเดตแล้ว **ห้ามรับเงินรอบนี้**
   * ต้องให้คนตรวจยอดใหม่ก่อน ส่วน snapshot ที่เปลี่ยนแต่ยอดเท่าเดิมไม่ควรขวางการขาย
   */
  const refreshPricing = useCallback(async (): Promise<{
    changed: boolean;
    error: string | null;
  }> => {
    if (lines.length === 0) return { changed: false, error: null };
    const results = await Promise.all(lines.map(rescanLine));
    const failure = results.find(result => result.error);
    if (failure) return { changed: false, error: failure.error };
    const refreshed = results.map(result => result.line);
    const pricingChanged = refreshed.some(
      (line, index) =>
        cartLinePricingSignature(line) !==
        cartLinePricingSignature(lines[index]),
    );
    // Catalog card รุ่นเก่าหรือ state ที่ค้างจาก hot reload อาจไม่มี snapshot ครบ การเติม
    // basePrice/priceTiers จึงทำให้ signature ต่างทั้งที่ยอดขายไม่เปลี่ยนแม้แต่สตางค์
    // อัปเดต snapshot ไว้เสมอ แต่หยุดให้รับเงินใหม่เฉพาะเมื่อยอดที่ลูกค้าต้องจ่ายเปลี่ยนจริง
    const amountChanged =
      cartProductSubtotal(refreshed) !== cartProductSubtotal(lines);
    if (pricingChanged) setLines(refreshed);
    return { changed: amountChanged, error: null };
  }, [lines, rescanLine]);

  const resumeParkedBill = useCallback(
    async (id: string) => {
      const parked = parkedBills.find(bill => bill.id === id);
      if (!parked) return 'ไม่พบบิลพัก';
      const failure = await mutatePark({ action: 'resume', parkedId: id });
      if (!failure) {
        setLines(await refreshParkedLines(parked.lines));
        setMember(parked.member);
        setCoupon(parked.coupon);
        setManualDiscount(null);
        setPointsToRedeem(parked.pointsUsed);
        setExtraLines(parked.extraLines);
        setPharmacyReview(parked.pharmacyReview);
      }
      return failure;
    },
    [mutatePark, parkedBills, refreshParkedLines],
  );

  const deleteParkedBill = useCallback(
    (id: string) => mutatePark({ action: 'drop', parkedId: id }),
    [mutatePark],
  );

  const serverPreview = preview.data?.bmsPosMemberPreview;
  const tierDiscount = serverPreview?.tierDiscount ?? 0;
  const couponDiscount = serverPreview?.couponDiscount ?? 0;
  const appliedManualDiscount = serverPreview?.manualDiscount ?? 0;
  const discountTotal = serverPreview?.totalDiscount ?? 0;
  const pointsUsed = Math.max(0, Math.floor(serverPreview?.pointsUsed ?? 0));
  const pointsDiscount = serverPreview?.pointsDiscount ?? 0;
  // ⚠️ หักส่วนลดจาก subtotal **ปัจจุบัน** ไม่ใช่ใช้ netTotal ของพรีวิวตรง ๆ — Apollo คืน
  // ผลรอบก่อนระหว่างกำลังโหลดรอบใหม่ ถ้าเอา netTotal มาใช้ ยอดจะเป็นของตะกร้าใบก่อน
  // (แคชเชียร์กดเพิ่มของแล้วกดรับเงินทันทีจะเก็บเงินตามยอดเก่า)
  const total = round2(
    Math.max(0, round2(subtotal - discountTotal)) + extraTotal,
  );

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
      refreshPricing,
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
      pointsUsed,
      pointsDiscount,
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
      pointsDiscount,
      pointsUsed,
      preview.error?.message,
      preview.loading,
      refreshPricing,
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
