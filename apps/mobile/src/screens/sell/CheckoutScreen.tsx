import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@apollo/client';
import Svg, { Path } from 'react-native-svg';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { MoneyField } from '../../components/MoneyField';
import { SaleConfirmationModal } from '../../components/SaleConfirmationModal';
import { CheckoutAdjustmentsCard } from '../../components/CheckoutAdjustmentsCard';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useCart } from '../../state/CartContext';
import { useSales } from '../../state/SalesContext';
import { useSession } from '../../state/SessionContext';
import { useShift } from '../../state/ShiftContext';
import { useStoreMode } from '../../state/StoreModeContext';
import {
  MobilePosBoardGameCheckoutDocument,
  MobilePosMemberPreviewDocument,
  MobilePosRequestPharmacyReviewDocument,
  MobilePosSaleDocument,
  MobileRestaurantCheckDocument,
  MobileRestaurantFloorDocument,
  MobileRestaurantSettleCheckDocument,
  PosBootstrapDocument,
} from '../../graphql/generated';
import { cartLineVariantLabel } from '../../lib/cartLine';
import {
  cashRoundingForPayments,
  isCashRounding,
  payableWithRounding,
} from '../../lib/cartPricing';
import { createIdempotencyKey } from '../../lib/operation';
import { describeMobileSaleFailure } from '../../lib/saleFailureMessage';
import {
  calculateCashChange,
  paymentMethodLabel,
  quickCashAmounts,
  validateMockPayments,
  type MockPaymentInput,
  type MockPaymentMethod,
} from '../../lib/paymentMath';
import type { AppStackParamList } from '../../navigation/types';
import type { PosMember } from '../../types/pos';

type Props = NativeStackScreenProps<AppStackParamList, 'Checkout'>;

const round2 = (value: number) => Math.round(value * 100) / 100;

const PAYMENT_METHODS: MockPaymentMethod[] = [
  'cash',
  'qr',
  'card',
  'bank_transfer',
  'wallet',
  'store_credit',
  'credit',
];
const RESTAURANT_PAYMENT_METHODS: MockPaymentMethod[] = ['cash', 'qr', 'card'];

export default function CheckoutScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { width, isTablet } = useResponsive();
  const cart = useCart();
  const { refresh: refreshSales } = useSales();
  const { session } = useSession();
  const { isOpen: isShiftOpen, loading: shiftLoading } = useShift();
  const { mode: storeMode } = useStoreMode();
  const restaurantParams =
    route.params?.source === 'restaurant' ? route.params : null;
  const boardGameParams =
    route.params?.source === 'board_game' ? route.params : null;
  const source = boardGameParams
    ? 'board_game'
    : restaurantParams
    ? 'restaurant'
    : 'retail';
  const tableId = restaurantParams?.tableId;
  const routedCheckId = restaurantParams?.checkId;
  const floor = useQuery(MobileRestaurantFloorDocument, {
    skip: source !== 'restaurant' || !tableId,
  });
  const table = tableId
    ? floor.data?.bmsPosRestaurantFloor.tables.find(item => item.id === tableId)
    : undefined;
  const restaurantCheckId = routedCheckId ?? table?.check?.id ?? null;
  const [restaurantMembers, setRestaurantMembers] = useState<
    Record<string, PosMember | null>
  >({});
  const restaurantMember = restaurantCheckId
    ? restaurantMembers[restaurantCheckId] ?? null
    : null;
  const [restaurantCoupon, setRestaurantCoupon] = useState<{ code: string } | null>(null);
  const [restaurantPointsToRedeem, setRestaurantPointsToRedeem] = useState(0);
  const [restaurantManualDiscount, setRestaurantManualDiscount] = useState<{
    amount: number;
    reason: string;
    approverUserId: string;
    approverName: string;
    approverPin: string;
  } | null>(null);
  useEffect(() => {
    setRestaurantCoupon(null);
    setRestaurantPointsToRedeem(0);
    setRestaurantManualDiscount(null);
  }, [restaurantCheckId]);
  const setRestaurantMember = (member: PosMember | null) => {
    if (!restaurantCheckId) return;
    setRestaurantMembers(previous => ({
      ...previous,
      [restaurantCheckId]: member,
    }));
  };
  const activeMember = source === 'restaurant' ? restaurantMember : cart.member;
  const restaurantCheck = useQuery(MobileRestaurantCheckDocument, {
    variables: { id: restaurantCheckId ?? '' },
    skip: source !== 'restaurant' || !restaurantCheckId,
  });
  const check = restaurantCheck.data?.bmsPosRestaurantCheck;
  const boardGameCheckout = useQuery(MobilePosBoardGameCheckoutDocument, {
    variables: {
      credentials: session?.credentials ?? { cashierUserId: '', pin: '' },
      id: boardGameParams?.boardGameBillingGroupId ?? '',
    },
    skip: !session || !boardGameParams?.boardGameBillingGroupId,
  });
  const boardGameBill = boardGameCheckout.data?.bmsPosBoardGameCheckout;
  const boardGamePricingInput = useMemo(
    () => ({
      subtotal: cart.subtotal,
      boardGameBillingGroupId:
        source === 'board_game'
          ? boardGameParams?.boardGameBillingGroupId ?? null
          : null,
      restaurantCheckId: null,
      customerId: cart.member?.id ?? null,
      pointsToRedeem: cart.pointsToRedeem,
      couponCode: cart.coupon?.code ?? null,
      manualDiscount: cart.manualDiscount?.amount ?? null,
      lines: cart.lines.map(line => ({
        sku: line.sku,
        size: line.size,
        packCode: line.packCode || null,
        packQty: line.qty,
        baseQty: line.baseQty,
        packPrice: null,
        unitName: line.unitName || null,
        modifierCodes: line.modifierCodes,
        scaleBarcode: line.scaleBarcode ?? null,
        serials: line.serials,
      })),
      extraLines: cart.extraLines.map(line => ({
        label: line.label,
        qty: line.qty,
        unitAmount: line.unitAmount,
      })),
    }),
    [
      boardGameParams?.boardGameBillingGroupId,
      cart.coupon?.code,
      cart.extraLines,
      cart.lines,
      cart.manualDiscount?.amount,
      cart.member?.id,
      cart.pointsToRedeem,
      cart.subtotal,
      source,
    ],
  );
  const boardGamePricing = useQuery(MobilePosMemberPreviewDocument, {
    variables: { input: boardGamePricingInput },
    skip: source !== 'board_game' || !session || !boardGameBill,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  });
  const boardGamePreview = boardGamePricing.data?.bmsPosMemberPreview;
  const restaurantPricing = useQuery(MobilePosMemberPreviewDocument, {
    variables: {
      input: {
        subtotal: check?.amountDue ?? 0,
        restaurantCheckId,
        boardGameBillingGroupId: null,
        customerId: activeMember?.id ?? null,
        pointsToRedeem: restaurantPointsToRedeem,
        couponCode: restaurantCoupon?.code ?? null,
        manualDiscount: restaurantManualDiscount?.amount ?? null,
        lines: null,
        extraLines: null,
      },
    },
    skip: source !== 'restaurant' || !session || !check || !restaurantCheckId,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  });
  const restaurantPreview = restaurantPricing.data?.bmsPosMemberPreview;
  const restaurantItems = (check?.items ?? []).filter(
    item => item.status !== 'CANCELLED',
  );
  const productLines =
    source === 'restaurant'
      ? restaurantItems.map(item => ({
          key: item.id,
          sku: item.sku,
          name: item.productName,
          qty: item.packQty,
          unitPrice: item.packPrice ?? 0,
          size: item.size,
          packCode: item.packCode ?? '',
          unitName: item.unitName ?? '',
          baseQty: item.baseQty ?? 1,
          modifierCodes: item.modifierCodes,
          serialTracked: false,
          serials: [],
          status: item.status,
        }))
      : cart.lines;
  const lines = boardGameBill
    ? [
        {
          key: `board-game-${boardGameBill.id}`,
          sku: '__BOARD_GAME_TIME__',
          name: `บิลบอร์ดเกม · ${boardGameBill.tableCode} ${
            boardGameBill.tableName
          }${
            boardGameBill.sessionGroupCount > 1
              ? ` · กลุ่ม ${boardGameBill.groupNo}`
              : ''
          }`,
          qty: 1,
          unitPrice: boardGameBill.totalDue,
          size: 'SERVICE',
          packCode: '',
          unitName: 'session',
          baseQty: 1,
          modifierCodes: [] as string[],
          serialTracked: false,
          serials: [] as string[],
          status: 'CLOSING',
        },
        ...productLines,
      ]
    : productLines;
  const confirmationItems = [
    ...lines.map(item => ({
      key: item.key,
      name: item.name,
      variantLabel:
        item.sku === '__BOARD_GAME_TIME__'
          ? undefined
          : cartLineVariantLabel(item) || undefined,
      qty: item.qty,
      unitPrice: item.unitPrice,
    })),
    ...(source === 'retail'
      ? cart.extraLines.map(line => ({
          key: `extra-${line.id}`,
          name: line.label,
          variantLabel: 'รายการเพิ่มเติม',
          qty: line.qty,
          unitPrice: line.unitAmount,
        }))
      : []),
  ];
  const fallbackSubtotal =
    source === 'restaurant'
      ? check?.amountDue ?? 0
      : cart.subtotal + (boardGameBill?.totalDue ?? 0);
  const subtotal =
    source === 'restaurant' && restaurantPreview?.subtotal != null
      ? restaurantPreview.subtotal
      : source === 'board_game' && boardGamePreview?.amountDue != null
      ? round2(
          (boardGamePreview.grossAmountDue ?? boardGamePreview.amountDue)
            + (boardGamePreview.totalDiscount ?? 0),
        )
      : fallbackSubtotal;
  const payableBeforeRounding = round2(
    source === 'restaurant' && restaurantPreview?.amountDue != null
      ? restaurantPreview.amountDue
      : source === 'board_game' && boardGamePreview?.amountDue != null
      ? boardGamePreview.amountDue
      : cart.total + (boardGameBill?.totalDue ?? 0),
  );
  const discounts =
    source === 'restaurant' && restaurantPreview
      ? {
          tierDiscount: restaurantPreview.tierDiscount ?? 0,
          couponDiscount: restaurantPreview.couponDiscount ?? 0,
          pointsDiscount: restaurantPreview.pointsDiscount ?? 0,
          appliedManualDiscount: restaurantPreview.manualDiscount ?? 0,
          discountTotal: restaurantPreview.totalDiscount ?? 0,
        }
      : source === 'board_game' && boardGamePreview
      ? {
          tierDiscount: boardGamePreview.tierDiscount ?? 0,
          couponDiscount: boardGamePreview.couponDiscount ?? 0,
          pointsDiscount: boardGamePreview.pointsDiscount ?? 0,
          appliedManualDiscount: boardGamePreview.manualDiscount ?? 0,
          discountTotal: boardGamePreview.totalDiscount ?? 0,
        }
      : cart;
  const bootstrap = useQuery(PosBootstrapDocument);
  const [saleMode, setSaleMode] = useState<'SALE' | 'DEPOSIT'>('SALE');
  const [payments, setPayments] = useState<MockPaymentInput[]>([
    {
      id: 'payment-1',
      method: 'cash',
      amount: payableBeforeRounding,
      tendered: payableBeforeRounding,
    },
  ]);
  // ปัดเศษเงินสด (7.95) — `recordPosSale()` ปัดเองทุกเส้นทาง (ค้าปลีก บิลโต๊ะ บอร์ดเกม)
  // เฉพาะบิลที่ **ทุกช่องทางเป็นเงินสด** แล้วเทียบยอดที่เครื่องส่งมากับยอดที่ปัดแล้ว
  // ไม่ปัดที่จอ = ร้านที่เปิดปัดเศษขายจากมือถือไม่ได้เลย (PAYMENT_MISMATCH ทุกบิล)
  //
  // การรับมัดจำไม่ถูกปัด — `takeInitialPosDeposit()` ทำงานก่อนขั้นตอนปัดเศษ และของจะถูกปัด
  // ตอนรับของจริง ปัดที่นี่ด้วยจะทำให้ยอดบนจอไม่ตรงกับบิลที่เปิดค้างไว้
  const cashRoundingMode = bootstrap.data?.bmsPosSession.vat.cashRounding;
  const roundingDelta =
    saleMode === 'DEPOSIT'
      ? 0
      : cashRoundingForPayments(
          payableBeforeRounding,
          isCashRounding(cashRoundingMode) ? cashRoundingMode : 'NONE',
          payments,
        );
  const total = payableWithRounding(payableBeforeRounding, roundingDelta);
  // ยอดของบิลที่จ่ายช่องทางเดียวต้องเดินตามยอดสุทธิเสมอ เพราะ layout ใหม่ไม่แสดงช่อง
  // "ยอดช่องทางนี้" ซ้ำกับยอดบิลอีกแล้ว; `paymentsTouched` ใช้จำเฉพาะเงินสดที่รับจริง
  // เพื่อไม่เขียนทับสิ่งที่แคชเชียร์พิมพ์เมื่อสิทธิ์หรือราคาเปลี่ยน
  //
  // ⚠️ หน้านี้แก้จำนวนสินค้า/ใส่สมาชิก/ใส่คูปองได้ **ในหน้าเดียวกับที่กรอกเงิน** ของเดิมตั้งยอด
  // ช่องทางไว้ครั้งเดียวตอน mount แล้วไม่ตามอีกเลย → ขยับจำนวนทีเดียวปุ่มยืนยันก็ล็อกด้วย
  // "ยังขาด ฿x" จนกว่าจะพิมพ์ยอดใหม่เองทุกครั้ง
  const [paymentsTouched, setPaymentsTouched] = useState(false);
  useEffect(() => {
    if (saleMode !== 'SALE') return;
    setPayments(prev => {
      if (prev.length !== 1) return prev;
      const payment = prev[0];
      return [
        {
          ...payment,
          amount: total,
          tendered:
            payment.method === 'cash'
              ? paymentsTouched
                ? payment.tendered
                : total
              : undefined,
        },
      ];
    });
  }, [paymentsTouched, saleMode, total]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);
  const idempotencyRef = useRef<string | null>(null);
  const pharmacyReviewKeyRef = useRef<string | null>(null);
  const [sell] = useMutation(MobilePosSaleDocument);
  const [requestPharmacyReview] = useMutation(
    MobilePosRequestPharmacyReviewDocument,
  );
  const [settleCheck] = useMutation(MobileRestaurantSettleCheckDocument);
  const [creditApproverId, setCreditApproverId] = useState('');
  const [creditApproverPin, setCreditApproverPin] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [depositDueAt, setDepositDueAt] = useState('');
  const [pharmacistId, setPharmacistId] = useState('');
  const [pharmacistPin, setPharmacistPin] = useState('');
  const [pharmacistNote, setPharmacistNote] = useState('');
  const [otherMethodsOpen, setOtherMethodsOpen] = useState(false);
  const [splitOptionsOpen, setSplitOptionsOpen] = useState(false);
  useEffect(() => {
    if (source === 'retail') return;
    setSaleMode('SALE');
    setPaymentsTouched(false);
    setPayments([
      { id: 'payment-1', method: 'cash', amount: total, tendered: total },
    ]);
  }, [
    boardGameParams?.boardGameBillingGroupId,
    restaurantCheckId,
    source,
    total,
  ]);
  const paymentTarget =
    saleMode === 'DEPOSIT' ? Number(depositAmount) || 0 : total;
  const validation = useMemo(
    () => validateMockPayments(paymentTarget, payments),
    [paymentTarget, payments],
  );
  const discountPending =
    (source === 'retail' && cart.previewLoading) ||
    (source === 'restaurant' && restaurantPricing.loading) ||
    (source === 'board_game' && boardGamePricing.loading);
  const itemCount = lines.reduce((n, l) => n + l.qty, 0);
  const serialsReady = lines.every(line => {
    if (!line.serialTracked) return true;
    const required = Math.round(line.qty * line.baseQty);
    return required > 0 && line.serials.filter(Boolean).length === required;
  });
  const requiresPhoneLineEntry = lines.some(line => line.serialTracked);
  const creditApprovers = (
    bootstrap.data?.bmsPosSession.approvers ?? []
  ).filter(
    approver =>
      approver.id !== session?.cashier.id &&
      approver.hasPin &&
      approver.approvals.includes('ar.sell'),
  );
  const usesCredit =
    source !== 'restaurant' &&
    payments.some(payment => payment.method === 'credit');
  const pharmacistCandidates = (
    bootstrap.data?.bmsPosSession.cashiers ?? []
  ).filter(cashier => cashier.isPharmacist && cashier.hasPin);
  const availablePaymentMethods =
    source === 'restaurant'
      ? RESTAURANT_PAYMENT_METHODS
      : saleMode === 'DEPOSIT'
      ? PAYMENT_METHODS.filter(
          method => method !== 'store_credit' && method !== 'credit',
        )
      : PAYMENT_METHODS;
  const selectedPharmacist = pharmacistCandidates.find(
    cashier => cashier.id === pharmacistId,
  );
  const depositReady =
    saleMode === 'SALE' ||
    (paymentTarget > 0 && paymentTarget < total && payments.length === 1);
  const restaurantPaymentsValid =
    source !== 'restaurant' ||
    payments.every(payment =>
      RESTAURANT_PAYMENT_METHODS.includes(payment.method),
    );
  const boardGameReady =
    source !== 'board_game' ||
    (Boolean(boardGameBill) &&
      boardGamePreview?.status === 'READY' &&
      boardGamePreview.amountDue != null &&
      !boardGamePricing.error);
  const restaurantReady =
    source !== 'restaurant' ||
    (restaurantPreview?.status === 'READY' &&
      restaurantPreview.amountDue != null &&
      !restaurantPricing.error);
  // บิลบอร์ดเกมที่ไม่เหลือยอดต้องชำระ — settle ด้วย payment list ว่าง ไม่ใช่สร้าง CASH ฿0
  // ซึ่งทั้ง `validateMockPayments` (ต้องมียอด > 0) และ `recordPosSale` ปฏิเสธ
  //
  // ⚠️ ห้ามตั้งชื่อ/เขียนข้อความว่า "แพ็กเกจสมาชิกครอบคลุม" จากเงื่อนไขนี้ — ยอดศูนย์เกิดได้
  // โดยไม่มีแพ็กเกจเลย (โต๊ะที่มีแต่ผู้ชมที่ไม่คิดเงิน หรือเวลาที่ยังไม่พ้น grace) · ใครจ่ายแทน
  // เป็นข้อมูลของ server (`passCoveredAmount`) ไม่ใช่สิ่งที่จอเดาจากยอดรวม
  const zeroDueBoardGameBill =
    source === 'board_game' && Boolean(boardGameBill) && paymentTarget <= 0;
  const passCoveredAmount = boardGameBill?.passCoveredAmount ?? 0;
  const canConfirmPayment = validation.canConfirm || zeroDueBoardGameBill;
  // แถวชำระเงินที่จะถูกส่งจริง — จอยืนยันต้องแสดงชุดเดียวกันนี้ ไม่ใช่ state ของฟอร์มซึ่งยังค้าง
  // CASH ฿0 อยู่ · ไม่งั้นจอบอกว่า "ไม่มียอดต้องชำระ" แล้วหน้ายืนยันบอกว่ารับเงินสด ฿0 ทอน ฿0
  // ซึ่งเป็นจอที่ขัดกันเอง และเป็นเหตุที่คนเลิกเชื่อตัวเลขทั้งจอ
  const settlementPayments = zeroDueBoardGameBill ? [] : payments;

  const updatePayment = (id: string, patch: Partial<MockPaymentInput>) => {
    setPaymentsTouched(true);
    setPayments(prev =>
      prev.map(payment =>
        payment.id === id ? { ...payment, ...patch } : payment,
      ),
    );
  };

  const addPayment = (method: MockPaymentMethod) => {
    setPaymentsTouched(true);
    setPayments(prev => [
      ...prev,
      {
        id: `payment-${Date.now()}`,
        method,
        amount: validation.remaining || 0,
        tendered: method === 'cash' ? validation.remaining || 0 : undefined,
        reference: method === 'cash' ? undefined : '',
      },
    ]);
  };

  const completeSale = async () => {
    if (
      !canConfirmPayment ||
      !restaurantPaymentsValid ||
      !restaurantReady ||
      !boardGameReady ||
      submittedRef.current ||
      !session
    )
      return;
    submittedRef.current = true;
    setSubmitting(true);
    let confirmedBoardGamePreview = boardGamePreview;
    let confirmedRestaurantPreview = restaurantPreview;
    // ⚠️ ตรวจราคาซ้ำก่อนส่ง — ตะกร้าถือกติกา ณ ตอนที่สแกน ร้านที่แก้ราคา/เปิด-ปิดโปรระหว่าง
    // ที่บิลค้างบนจอ (หรือบิลพักที่เพิ่งเรียกกลับ) จะทำให้ยอดที่จอโชว์ไม่ใช่ยอดที่ server คิด
    // แล้วบิลถูกทิ้งทั้งใบ · หยุดก่อนออกคีย์กันบิลซ้ำ เพื่อไม่ให้คีย์ถูกเผาทิ้งโดยเปล่าประโยชน์
    if (source === 'retail') {
      const recheck = await cart.refreshPricing();
      if (recheck.error || recheck.changed) {
        submittedRef.current = false;
        setSubmitting(false);
        setConfirmOpen(false);
        if (recheck.changed) {
          setPaymentsTouched(false);
          setPayments([{ id: 'payment-1', method: 'cash', amount: 0 }]);
        }
        Alert.alert(
          recheck.error ? 'ตรวจราคาไม่สำเร็จ' : 'ราคามีการเปลี่ยนแปลง',
          recheck.error ??
            'ราคา ขั้นราคาส่ง หรือโปรโมชันเปลี่ยนไป · อัปเดตยอดล่าสุดแล้ว กรุณาตรวจและรับเงินใหม่',
        );
        return;
      }
    }
    if (source === 'board_game') {
      try {
        const recheck = await boardGamePricing.refetch();
        const latest = recheck.data?.bmsPosMemberPreview;
        if (!latest || latest.status !== 'READY' || latest.amountDue == null) {
          throw new Error(
            latest?.reason ??
              latest?.couponError ??
              'ตรวจยอดบิลบอร์ดเกมล่าสุดไม่สำเร็จ',
          );
        }
        const signature = (
          value: typeof latest | typeof boardGamePreview | undefined,
        ) =>
          JSON.stringify({
            amountDue: value?.amountDue ?? null,
            subtotal: value?.subtotal ?? null,
            totalDiscount: value?.totalDiscount ?? null,
            pointsUsed: value?.pointsUsed ?? null,
          });
        confirmedBoardGamePreview = latest;
        if (signature(latest) !== signature(boardGamePreview)) {
          submittedRef.current = false;
          setSubmitting(false);
          setConfirmOpen(false);
          setPaymentsTouched(false);
          setPayments([
            { id: 'payment-1', method: 'cash', amount: 0, tendered: 0 },
          ]);
          Alert.alert(
            'ยอดบิลมีการเปลี่ยนแปลง',
            'ยอดสินค้า ส่วนลด หรือเวลาเล่นเปลี่ยนไป · อัปเดตยอดล่าสุดแล้ว กรุณาตรวจและรับเงินใหม่',
          );
          return;
        }
      } catch (error) {
        submittedRef.current = false;
        setSubmitting(false);
        setConfirmOpen(false);
        Alert.alert(
          'ตรวจยอดไม่สำเร็จ',
          error instanceof Error
            ? error.message
            : 'ตรวจยอดบิลบอร์ดเกมล่าสุดไม่สำเร็จ',
        );
        return;
      }
    }
    if (source === 'restaurant') {
      try {
        const recheck = await restaurantPricing.refetch();
        const latest = recheck.data?.bmsPosMemberPreview;
        if (!latest || latest.status !== 'READY' || latest.amountDue == null) {
          throw new Error(latest?.reason ?? latest?.couponError ?? 'ตรวจยอดบิลโต๊ะล่าสุดไม่สำเร็จ');
        }
        const signature = (value: typeof latest | typeof restaurantPreview | undefined) =>
          JSON.stringify({
            amountDue: value?.amountDue ?? null,
            subtotal: value?.subtotal ?? null,
            totalDiscount: value?.totalDiscount ?? null,
            pointsUsed: value?.pointsUsed ?? null,
          });
        confirmedRestaurantPreview = latest;
        if (signature(latest) !== signature(restaurantPreview)) {
          submittedRef.current = false;
          setSubmitting(false);
          setConfirmOpen(false);
          setPaymentsTouched(false);
          setPayments([{ id: 'payment-1', method: 'cash', amount: 0, tendered: 0 }]);
          Alert.alert('ยอดบิลมีการเปลี่ยนแปลง', 'ยอดอาหาร ส่วนลด หรือแต้มเปลี่ยนไป · กรุณาตรวจและรับเงินใหม่');
          return;
        }
      } catch (error) {
        submittedRef.current = false;
        setSubmitting(false);
        setConfirmOpen(false);
        Alert.alert('ตรวจยอดไม่สำเร็จ', error instanceof Error ? error.message : 'ตรวจยอดบิลโต๊ะล่าสุดไม่สำเร็จ');
        return;
      }
    }
    const paymentInput = settlementPayments.map(payment => ({
      method: payment.method.toUpperCase(),
      amount: payment.amount,
      cashTendered:
        payment.method === 'cash' ? payment.tendered ?? payment.amount : null,
      ref: payment.reference?.trim() || null,
    }));
    try {
      let orderId: string;
      if (source === 'restaurant') {
        if (!check) throw new Error('ไม่พบบิลโต๊ะสำหรับชำระเงิน');
        const response = await settleCheck({
          variables: {
            checkId: check.id,
            input: {
              cashierUserId: session.credentials.cashierUserId,
              pin: session.credentials.pin,
              customerId: activeMember?.id ?? null,
              couponCode: restaurantCoupon?.code ?? null,
              pointsToRedeem: confirmedRestaurantPreview?.pointsUsed ?? 0,
              manualDiscount: restaurantManualDiscount?.amount ?? null,
              discountReason: restaurantManualDiscount?.reason ?? null,
              discountApproverUserId: restaurantManualDiscount?.approverUserId ?? null,
              discountApproverPin: restaurantManualDiscount?.approverPin ?? null,
              payments: paymentInput,
            },
          },
        });
        const result = response.data?.bmsPosRestaurantSettleCheck;
        if (result?.status !== 'SOLD' || !result.orderId) {
          throw new Error(
            describeMobileSaleFailure(result, 'ชำระบิลไม่สำเร็จ'),
          );
        }
        orderId = result.orderId;
      } else {
        idempotencyRef.current ??= createIdempotencyKey('sale');
        const response = await sell({
          variables: {
            input: {
              cashierUserId: session.credentials.cashierUserId,
              pin: session.credentials.pin,
              idempotencyKey: idempotencyRef.current,
              mode: saleMode,
              boardGameBillingGroupId:
                boardGameParams?.boardGameBillingGroupId ?? null,
              lines: cart.lines.map(line => ({
                sku: line.sku,
                size: line.size,
                packCode: line.packCode || null,
                packQty: line.qty,
                baseQty: line.baseQty,
                packPrice: null,
                unitName: line.unitName || null,
                modifierCodes: line.modifierCodes,
                scaleBarcode: line.scaleBarcode ?? null,
                serials: line.serials,
              })),
              payments: paymentInput,
              customerId: cart.member?.id ?? null,
              couponCode: cart.coupon?.code ?? null,
              // ⚠️ ส่งจำนวนแต้มที่ **พรีวิวบอกว่าจะหักจริง** ไม่ใช่ที่แคชเชียร์พิมพ์ —
              // createOrderInTx ปฏิเสธทั้งบิลเมื่อหักได้ไม่เท่าที่ขอ (เศษแต้มที่ไม่ครบ
              // หน่วยแลก ต่ำกว่าขั้นต่ำ หรือชนเพดานส่วนลดของบิล) และยอดที่จอโชว์ก็มาจาก
              // พรีวิวตัวเดียวกันนี้อยู่แล้ว
              pointsToRedeem:
                source === 'board_game'
                  ? confirmedBoardGamePreview?.pointsUsed ?? 0
                  : cart.pointsUsed,
              manualDiscount: cart.manualDiscount?.amount ?? null,
              discountReason: cart.manualDiscount?.reason ?? null,
              discountApproverUserId:
                cart.manualDiscount?.approverUserId ?? null,
              discountApproverPin: cart.manualDiscount?.approverPin ?? null,
              extraLines: cart.extraLines.map(line => ({
                label: line.label,
                qty: line.qty,
                unitAmount: line.unitAmount,
              })),
              creditApproverPin: creditApproverPin || null,
              creditApproverUserId: creditApproverId || null,
              depositCustomerNote:
                saleMode === 'DEPOSIT' ? depositNote.trim() || null : null,
              depositDueAt:
                saleMode === 'DEPOSIT' ? depositDueAt.trim() || null : null,
              pharmacistAuthorizationNote: pharmacistId
                ? pharmacistNote.trim() || null
                : null,
              pharmacistAuthorizerPin:
                pharmacistId && pharmacistId !== session.cashier.id
                  ? pharmacistPin || null
                  : null,
              pharmacistAuthorizerUserId: pharmacistId || null,
              pharmacyApprovedAssessmentId:
                cart.pharmacyReview?.canResume === true
                  ? cart.pharmacyReview.assessmentId
                  : null,
              pharmacyReviewAssessmentId:
                pharmacistId && cart.pharmacyReview
                  ? cart.pharmacyReview.assessmentId
                  : null,
            },
          },
        });
        const result = response.data?.bmsPosSale;
        if (
          result?.status === 'PHARMACY_REVIEW_REQUIRED' ||
          result?.status === 'PHARMACY_SAFETY_CHECK_REQUIRED'
        ) {
          pharmacyReviewKeyRef.current ??=
            createIdempotencyKey('pharmacy-review');
          const review = await requestPharmacyReview({
            variables: {
              input: {
                cashierUserId: session.credentials.cashierUserId,
                pin: session.credentials.pin,
                idempotencyKey: pharmacyReviewKeyRef.current,
                customerId: cart.member?.id ?? null,
                label: 'รอเภสัชกรตรวจจาก POS Mobile',
                lines: cart.lines.map(line => ({
                  sku: line.sku,
                  size: line.size,
                  packCode: line.packCode || null,
                  packQty: line.qty,
                  baseQty: line.baseQty,
                  unitName: line.unitName || null,
                  packPrice: null,
                  modifierCodes: line.modifierCodes,
                  scaleBarcode: line.scaleBarcode ?? null,
                  serials: line.serials,
                })),
                parkedCart: {
                  version: 2,
                  couponCode: cart.coupon?.code ?? null,
                  pointsToRedeem: String(cart.pointsToRedeem),
                  extraLines: cart.extraLines,
                  member: cart.member
                    ? {
                        customerId: cart.member.id,
                        memberNo: cart.member.memberNo,
                        name: cart.member.name,
                      }
                    : null,
                  lines: cart.lines,
                },
                itemCount,
                subtotalHint: cart.subtotal,
              },
            },
          });
          const reviewResult = review.data?.bmsPosRequestPharmacyReview;
          if (!reviewResult?.assessmentId) {
            pharmacyReviewKeyRef.current = null;
            throw new Error(
              reviewResult?.reason ??
                reviewResult?.status ??
                'ส่งให้เภสัชกรตรวจไม่สำเร็จ',
            );
          }
          pharmacyReviewKeyRef.current = null;
          cart.clear();
          idempotencyRef.current = null;
          setConfirmOpen(false);
          Alert.alert(
            'ส่งให้เภสัชกรแล้ว',
            `เลขเคส ${
              reviewResult.caseCode ?? reviewResult.assessmentId.slice(0, 8)
            } เมื่ออนุมัติแล้วให้เรียกบิลพักกลับมาชำระ`,
          );
          return;
        }
        if (result?.status === 'DEPOSIT_TAKEN' && result.orderId) {
          cart.clear();
          await refreshSales();
          idempotencyRef.current = null;
          setConfirmOpen(false);
          Alert.alert(
            'รับมัดจำแล้ว',
            `รับมัดจำ ฿${paymentTarget.toFixed(2)} สำเร็จ`,
          );
          navigation.reset({
            index: 0,
            routes: [{ name: 'Tabs', params: { screen: 'SellTab' } }],
          });
          return;
        }
        if (result?.status !== 'SOLD' || !result.orderId) {
          idempotencyRef.current = null;
          throw new Error(describeMobileSaleFailure(result));
        }
        orderId = result.orderId;
        cart.clear();
      }
      await refreshSales();
      idempotencyRef.current = null;
      setConfirmOpen(false);
      navigation.replace('Receipt', { saleId: orderId, source });
    } catch (error) {
      setConfirmOpen(false);
      Alert.alert(
        'ขายไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      submittedRef.current = false;
      setSubmitting(false);
    }
  };

  const linesCard = (
    <Card style={{ flex: 1 }}>
      <View style={styles.line}>
        <Text style={[typography.subtitle, { color: colors.text }]}>
          รายการ ({itemCount})
        </Text>
        {source === 'retail' && lines.length > 0 ? (
          <Button
            label="ล้างรายการ"
            variant="secondary"
            onPress={() =>
              Alert.alert(
                'ล้างรายการทั้งหมด?',
                'สินค้าทั้งหมดจะถูกนำออกจากบิล',
                [
                  { text: 'ยกเลิก', style: 'cancel' },
                  {
                    text: 'ล้างรายการ',
                    style: 'destructive',
                    onPress: cart.clear,
                  },
                ],
              )
            }
          />
        ) : null}
      </View>
      {source === 'restaurant' &&
      check?.items.some(item => item.status === 'NEW') ? (
        <Text style={[typography.captionStrong, { color: colors.danger }]}>
          มีรายการ NEW ที่ยังไม่ส่งครัว จึงชำระไม่ได้
        </Text>
      ) : null}
      <FlatList
        data={lines}
        keyExtractor={l => l.key}
        contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.md }}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ไม่มีรายการสำหรับชำระเงิน
          </Text>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.cartLineCard,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <View style={styles.line}>
              <View
                style={[
                  styles.cartItemIcon,
                  { backgroundColor: colors.surface2 },
                ]}
              >
                <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M6 8h12l1 12H5L6 8Zm3 0V6a3 3 0 0 1 6 0v2"
                    stroke={colors.textMuted}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.body, { color: colors.text }]}>
                  {item.name}
                </Text>
                {/* ไซซ์/หน่วยขาย/ตัวเลือก — หน้าจ่ายเงินคือจุดสุดท้ายที่แก้ได้ก่อนรับเงิน
                    ค่าเวลาบอร์ดเกมไม่มีรุ่น (size 'SERVICE' เป็นค่าที่ server ต้องการ ไม่ใช่ป้าย) */}
                {item.sku !== '__BOARD_GAME_TIME__' &&
                cartLineVariantLabel(item) ? (
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    {cartLineVariantLabel(item)}
                  </Text>
                ) : null}
                {/* ค่าเล่นกับของที่สั่งระหว่างเล่นเป็นคนละก้อน (`9.90`) — ยอดรวมก้อนเดียว
                    ทำให้แคชเชียร์อธิบายไม่ได้ว่ามาจากอะไร · เบราว์เซอร์แยกให้ดูมาตั้งแต่ต้น */}
                {item.sku === '__BOARD_GAME_TIME__' && boardGameBill ? (
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    {boardGameBill.chargeLineCount} คน · ปิดเวลา{' '}
                    {new Date(boardGameBill.endedAt).toLocaleTimeString(
                      'th-TH',
                      { hour: '2-digit', minute: '2-digit' },
                    )}
                    {boardGameBill.tabItemCount > 0
                      ? ` · ของที่สั่งไว้ ${
                          boardGameBill.tabItemCount
                        } รายการ ฿${boardGameBill.tabAmount.toFixed(2)}`
                      : ''}
                  </Text>
                ) : null}
                {/* `9.92`: ค่าเล่นที่ถูกกว่าที่ลูกค้าคาดต้องมีบรรทัดอธิบาย ไม่งั้นแคชเชียร์
                    ตอบไม่ได้ว่าหายไปไหน — เลขมาจาก server ไม่ใช่การเดาจากยอดที่เหลือ */}
                {item.sku === '__BOARD_GAME_TIME__' && passCoveredAmount > 0 ? (
                  <Text style={[typography.caption, { color: colors.success }]}>
                    แพ็กเกจสมาชิกจ่ายค่าเล่นให้แล้ว ฿
                    {passCoveredAmount.toFixed(2)}
                  </Text>
                ) : null}
              </View>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                ฿{(item.qty * item.unitPrice).toFixed(2)}
              </Text>
            </View>
            {source !== 'restaurant' && item.sku !== '__BOARD_GAME_TIME__' ? (
              <>
                <View style={styles.line}>
                  <QtyStepper
                    qty={item.qty}
                    itemName={item.name}
                    variant="outline"
                    onIncrement={() =>
                      cart.addItem({
                        ...item,
                        price: item.unitPrice,
                        category: 'สินค้า',
                        station: 'สินค้า',
                        sellable: true,
                        selectedModifierCodes: item.modifierCodes,
                      })
                    }
                    onDecrement={() => cart.decrementItem(item.key)}
                  />
                  <Text
                    style={[typography.caption, { color: colors.textSoft }]}
                  >
                    ฿{item.unitPrice.toFixed(2)} / หน่วย
                  </Text>
                </View>
                {item.serialTracked ? (
                  <View style={{ gap: spacing.xs }}>
                    <Text
                      style={[
                        typography.captionStrong,
                        { color: colors.warning },
                      ]}
                    >
                      เลขเครื่อง {item.serials.filter(Boolean).length}/
                      {Math.round(item.qty * item.baseQty)}
                    </Text>
                    {Array.from({
                      length: Math.round(item.qty * item.baseQty),
                    }).map((_, serialIndex) => (
                      <TextInput
                        key={`${item.key}-serial-${serialIndex}`}
                        value={item.serials[serialIndex] ?? ''}
                        onChangeText={serial => {
                          const serials = [...item.serials];
                          serials[serialIndex] = serial.trim();
                          cart.updateLine(item.key, { serials });
                        }}
                        placeholder={`Serial ${serialIndex + 1}`}
                        placeholderTextColor={colors.textSoft}
                        autoCapitalize="characters"
                        style={[
                          styles.input,
                          { borderColor: colors.border, color: colors.text },
                        ]}
                      />
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={[typography.caption, { color: colors.textSoft }]}>
                {item.sku === '__BOARD_GAME_TIME__'
                  ? 'ยอดค่าเวลาถูก freeze จาก session และตรวจซ้ำที่เซิร์ฟเวอร์'
                  : 'คิดเงินจากบิลร้านอาหารเดิม ไม่สร้าง cart ใหม่'}
              </Text>
            )}
          </View>
        )}
      />
    </Card>
  );

  const primaryPaymentMethods = availablePaymentMethods.filter(method =>
    (['cash', 'qr', 'card', 'bank_transfer'] as MockPaymentMethod[]).includes(
      method,
    ),
  );
  const otherPaymentMethods = availablePaymentMethods.filter(
    method => !primaryPaymentMethods.includes(method),
  );

  const paymentCard = (
    <Card
      elevated={isTablet}
      style={
        isTablet
          ? styles.paymentCard
          : { ...styles.phonePaymentCard, backgroundColor: colors.bg }
      }
    >
      {isTablet ? (
        <Text style={[typography.title, { color: colors.text }]}>
          รับชำระเงิน
        </Text>
      ) : null}
      {source === 'retail' ? (
        <View
          style={[
            styles.saleModeRow,
            { marginTop: spacing.md, backgroundColor: colors.surface2 },
          ]}
        >
          <Button
            label="ขายปกติ"
            variant={saleMode === 'SALE' ? 'primary' : 'secondary'}
            style={styles.saleModeButton}
            onPress={() => {
              setSaleMode('SALE');
              setPaymentsTouched(false);
              setPayments([
                {
                  id: 'payment-1',
                  method: 'cash',
                  amount: total,
                  tendered: total,
                },
              ]);
            }}
          />
          <Button
            label="รับมัดจำ"
            variant={saleMode === 'DEPOSIT' ? 'primary' : 'secondary'}
            style={styles.saleModeButton}
            onPress={() => {
              setSaleMode('DEPOSIT');
              setDepositAmount('');
              setPaymentsTouched(true);
              setPayments([
                { id: 'payment-1', method: 'cash', amount: 0, tendered: 0 },
              ]);
            }}
          />
        </View>
      ) : null}
      {saleMode === 'DEPOSIT' ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <TextInput
            value={depositAmount}
            onChangeText={value => {
              setDepositAmount(value);
              const parsed = Number(value) || 0;
              setPaymentsTouched(true);
              setPayments(previous => [
                {
                  ...(previous[0] ?? {
                    id: 'payment-1',
                    method: 'cash' as const,
                  }),
                  amount: parsed,
                  tendered:
                    (previous[0]?.method ?? 'cash') === 'cash'
                      ? parsed
                      : undefined,
                },
              ]);
            }}
            placeholder="ยอดมัดจำ (ต้องน้อยกว่ายอดบิล)"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.textSoft}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text },
            ]}
          />
          <TextInput
            value={depositNote}
            onChangeText={setDepositNote}
            placeholder="ชื่อลูกค้า / หมายเหตุรับของ"
            placeholderTextColor={colors.textSoft}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text },
            ]}
          />
          <TextInput
            value={depositDueAt}
            onChangeText={setDepositDueAt}
            placeholder="วันรับของ เช่น 2026-09-20"
            autoCapitalize="none"
            placeholderTextColor={colors.textSoft}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text },
            ]}
          />
        </View>
      ) : null}
      {zeroDueBoardGameBill ? (
        <Text
          style={[
            typography.bodyStrong,
            { color: colors.success, marginTop: spacing.md },
          ]}
        >
          {passCoveredAmount > 0
            ? `แพ็กเกจสมาชิกจ่ายค่าเล่นให้แล้ว ฿${passCoveredAmount.toFixed(
                2,
              )} · ไม่มียอดต้องชำระ`
            : 'บิลนี้ไม่มียอดต้องชำระ'}
        </Text>
      ) : (
        <>
          {payments.map((payment, index) => {
            const selectedIsOther = otherPaymentMethods.includes(
              payment.method,
            );
            return (
              <View key={payment.id} style={styles.paymentSection}>
                <View style={styles.line}>
                  <Text
                    style={[
                      index === 0 ? typography.subtitle : typography.bodyStrong,
                      { color: colors.text },
                    ]}
                  >
                    {index === 0
                      ? isTablet
                        ? 'ช่องทางการชำระเงิน'
                        : 'เลือกช่องทางชำระเงิน'
                      : `ช่องทาง ${index + 1}`}
                  </Text>
                  {payments.length > 1 && (
                    <Button
                      label="ลบ"
                      accessibilityLabel={`ลบช่องทางชำระเงินที่ ${index + 1}`}
                      variant="ghost"
                      onPress={() => {
                        setPaymentsTouched(true);
                        setPayments(prev =>
                          prev.filter(p => p.id !== payment.id),
                        );
                      }}
                    />
                  )}
                </View>
                <View
                  style={[
                    styles.paymentMethodGrid,
                    isTablet && styles.tabletPaymentMethodGrid,
                  ]}
                >
                  {(isTablet
                    ? availablePaymentMethods
                    : primaryPaymentMethods
                  ).map(method => (
                    <PaymentMethodButton
                      key={method}
                      method={method}
                      selected={payment.method === method}
                      tablet={isTablet}
                      onPress={() =>
                        updatePayment(payment.id, {
                          method,
                          reference: method === 'cash' ? undefined : '',
                          tendered:
                            method === 'cash' ? payment.amount : undefined,
                        })
                      }
                    />
                  ))}
                </View>
                {!isTablet && otherPaymentMethods.length > 0 ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        expanded: otherMethodsOpen || selectedIsOther,
                      }}
                      onPress={() => setOtherMethodsOpen(value => !value)}
                      style={({ pressed }) => [
                        styles.otherMethodsRow,
                        {
                          borderColor: colors.border,
                          backgroundColor: pressed
                            ? colors.surface2
                            : colors.surface,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            typography.bodyStrong,
                            { color: colors.text },
                          ]}
                        >
                          ช่องทางอื่น
                        </Text>
                        <Text
                          style={[
                            typography.caption,
                            { color: colors.textMuted },
                          ]}
                        >
                          {otherPaymentMethods
                            .map(paymentMethodLabel)
                            .join(' · ')}
                        </Text>
                      </View>
                      <Text
                        style={[
                          typography.subtitle,
                          { color: colors.textMuted },
                        ]}
                      >
                        {otherMethodsOpen || selectedIsOther ? '⌃' : '›'}
                      </Text>
                    </Pressable>
                    {otherMethodsOpen || selectedIsOther ? (
                      <View style={styles.paymentMethodGrid}>
                        {otherPaymentMethods.map(method => (
                          <PaymentMethodButton
                            key={method}
                            method={method}
                            selected={payment.method === method}
                            onPress={() =>
                              updatePayment(payment.id, {
                                method,
                                reference: '',
                                tendered: undefined,
                              })
                            }
                          />
                        ))}
                      </View>
                    ) : null}
                  </>
                ) : null}
                {payments.length > 1 ? (
                  <MoneyField
                    label="ยอดช่องทางนี้"
                    value={payment.amount}
                    onChange={amount => updatePayment(payment.id, { amount })}
                  />
                ) : null}
                {payment.method === 'cash' ? (
                  <View
                    style={[
                      styles.cashPanel,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[typography.bodyStrong, { color: colors.text }]}
                    >
                      รับเงิน
                    </Text>
                    <MoneyField
                      label="เงินสดที่รับ"
                      value={payment.tendered ?? 0}
                      style={styles.cashInput}
                      onChange={tendered =>
                        updatePayment(payment.id, { tendered })
                      }
                    />
                    <View style={styles.quickCashRow}>
                      {quickCashAmounts(payment.amount).map(amount => (
                        <Button
                          key={amount}
                          label={
                            amount === payment.amount ? 'รับพอดี' : `฿${amount}`
                          }
                          accessibilityLabel={`เงินสดรับ ${amount.toFixed(
                            2,
                          )} บาท`}
                          variant="secondary"
                          style={styles.quickCashButton}
                          onPress={() =>
                            updatePayment(payment.id, { tendered: amount })
                          }
                        />
                      ))}
                    </View>
                    <View
                      style={[
                        styles.changePanel,
                        { backgroundColor: colors.successBg },
                      ]}
                    >
                      <Text
                        style={[typography.subtitle, { color: colors.success }]}
                      >
                        ✓ เงินทอน ฿
                        {calculateCashChange(
                          payment.amount,
                          payment.tendered ?? 0,
                        ).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ) : payment.method === 'credit' ? (
                  <Text
                    style={[typography.caption, { color: colors.textMuted }]}
                  >
                    ขายเชื่อจะใช้สมาชิกในบิลและตรวจวงเงินที่เซิร์ฟเวอร์
                  </Text>
                ) : (
                  <TextInput
                    value={payment.reference ?? ''}
                    onChangeText={reference =>
                      updatePayment(payment.id, { reference })
                    }
                    placeholder="เลขอ้างอิง"
                    placeholderTextColor={colors.textSoft}
                    style={[
                      styles.input,
                      { borderColor: colors.border, color: colors.text },
                    ]}
                  />
                )}
              </View>
            );
          })}
          {saleMode === 'SALE' ? (
            <View style={{ marginTop: spacing.md }}>
              <Button
                label={
                  splitOptionsOpen
                    ? 'ซ่อนตัวเลือกแบ่งชำระ'
                    : 'แบ่งชำระหลายช่องทาง'
                }
                variant="ghost"
                fullWidth
                onPress={() => setSplitOptionsOpen(value => !value)}
              />
              {splitOptionsOpen ? (
                <View style={styles.addPaymentGrid}>
                  {availablePaymentMethods.map(method => (
                    <Button
                      key={method}
                      label={`+ ${paymentMethodLabel(method)}`}
                      accessibilityLabel={`เพิ่มช่องทาง${paymentMethodLabel(
                        method,
                      )}`}
                      variant="secondary"
                      style={styles.addPaymentButton}
                      onPress={() => addPayment(method)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}
      {usesCredit ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
            ผู้มีสิทธิ์ขายเชื่อ (เลือกเมื่อแคชเชียร์ไม่มีสิทธิ์)
          </Text>
          <View style={styles.methodRow}>
            {creditApprovers.map(approver => (
              <Button
                key={approver.id}
                label={approver.name ?? approver.id}
                variant={
                  creditApproverId === approver.id ? 'primary' : 'secondary'
                }
                onPress={() => setCreditApproverId(approver.id)}
              />
            ))}
          </View>
          {creditApproverId ? (
            <TextInput
              value={creditApproverPin}
              onChangeText={setCreditApproverPin}
              placeholder="PIN ผู้อนุมัติขายเชื่อ"
              placeholderTextColor={colors.textSoft}
              keyboardType="number-pad"
              secureTextEntry
              style={[
                styles.input,
                { borderColor: colors.border, color: colors.text },
              ]}
            />
          ) : null}
        </View>
      ) : null}
      {source === 'retail' && storeMode === 'pharmacy' ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
            เภสัชกรอนุมัติที่เคาน์เตอร์
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            เลือกเฉพาะเมื่อเภสัชกรผู้มีใบอนุญาตตรวจรายการและอนุมัติการจ่ายยาแล้ว
          </Text>
          <View style={styles.methodRow}>
            <Button
              label="ส่งเข้าคิวตรวจ"
              variant={!pharmacistId ? 'primary' : 'secondary'}
              onPress={() => {
                setPharmacistId('');
                setPharmacistPin('');
              }}
            />
            {pharmacistCandidates.map(pharmacist => (
              <Button
                key={pharmacist.id}
                label={pharmacist.name ?? pharmacist.id}
                variant={
                  pharmacistId === pharmacist.id ? 'primary' : 'secondary'
                }
                onPress={() => setPharmacistId(pharmacist.id)}
              />
            ))}
          </View>
          {selectedPharmacist &&
          selectedPharmacist.id !== session?.cashier.id ? (
            <TextInput
              value={pharmacistPin}
              onChangeText={setPharmacistPin}
              placeholder="PIN เภสัชกร"
              keyboardType="number-pad"
              secureTextEntry
              placeholderTextColor={colors.textSoft}
              style={[
                styles.input,
                { borderColor: colors.border, color: colors.text },
              ]}
            />
          ) : null}
          {selectedPharmacist ? (
            <TextInput
              value={pharmacistNote}
              onChangeText={setPharmacistNote}
              placeholder="บันทึกการอนุมัติ (ถ้ามี)"
              placeholderTextColor={colors.textSoft}
              style={[
                styles.input,
                { borderColor: colors.border, color: colors.text },
              ]}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );

  const confirmDisabled =
    shiftLoading ||
    !isShiftOpen ||
    discountPending ||
    lines.length === 0 ||
    Boolean(check?.items.some(item => item.status === 'NEW')) ||
    !canConfirmPayment ||
    !restaurantPaymentsValid ||
    !restaurantReady ||
    !boardGameReady ||
    !serialsReady ||
    !depositReady ||
    (usesCredit && !activeMember) ||
    (Boolean(pharmacistId) &&
      pharmacistId !== session?.cashier.id &&
      !pharmacistPin);

  const validationFeedback = (
    <>
      {!shiftLoading && !isShiftOpen ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.captionStrong, { color: colors.danger }]}>
            ยังไม่ได้เปิดกะของเครื่องนี้ กรุณาเปิดกะก่อนขาย
          </Text>
          <Button
            label="ไปเปิดกะ"
            accessibilityLabel="ไปหน้าเปิดกะก่อนขาย"
            variant="secondary"
            onPress={() => navigation.navigate('ShiftDetail')}
          />
        </View>
      ) : null}
      {(zeroDueBoardGameBill ? [] : validation.errors).map(error => (
        <Text
          key={error}
          style={[typography.captionStrong, { color: colors.danger }]}
        >
          {error}
        </Text>
      ))}
      {discountPending && (
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          กำลังคำนวณส่วนลดกับเซิร์ฟเวอร์…
        </Text>
      )}
      {source === 'board_game' && !discountPending && !boardGameReady && (
        <Text style={[typography.captionStrong, { color: colors.danger }]}>
          {boardGamePricing.error?.message ??
            boardGamePreview?.reason ??
            boardGamePreview?.couponError ??
            'ยังตรวจยอดบิลบอร์ดเกมล่าสุดไม่สำเร็จ'}
        </Text>
      )}
      {source === 'restaurant' && !discountPending && !restaurantReady && (
        <Text style={[typography.captionStrong, { color: colors.danger }]}>
          {restaurantPricing.error?.message ??
            restaurantPreview?.reason ??
            restaurantPreview?.couponError ??
            'ยังตรวจยอดบิลโต๊ะล่าสุดไม่สำเร็จ'}
        </Text>
      )}
    </>
  );

  const confirmButton = (
    <Button
      label="ยืนยันการขาย"
      accessibilityLabel="ยืนยันการขายพร้อมป้องกันกดซ้ำ"
      fullWidth
      loading={submitting}
      disabled={confirmDisabled}
      onPress={() => setConfirmOpen(true)}
    />
  );

  const totalAndActions = (
    <Card style={styles.summaryCard}>
      {discounts.discountTotal > 0 && (
        <View style={{ gap: spacing.xs, marginBottom: spacing.md }}>
          <AmountRow label="ยอดสินค้า" value={subtotal} />
          {discounts.tierDiscount > 0 && (
            <AmountRow
              label="ส่วนลดสมาชิก"
              value={-discounts.tierDiscount}
              discount
            />
          )}
          {discounts.couponDiscount > 0 && (
            <AmountRow
              label="ส่วนลดคูปอง"
              value={-discounts.couponDiscount}
              discount
            />
          )}
          {discounts.pointsDiscount > 0 && (
            <AmountRow
              label="ส่วนลดจากแต้ม"
              value={-discounts.pointsDiscount}
              discount
            />
          )}
          {discounts.appliedManualDiscount > 0 && (
            <AmountRow
              label="ส่วนลดพิเศษ"
              value={-discounts.appliedManualDiscount}
              discount
            />
          )}
        </View>
      )}
      {/* ไม่มีบรรทัดนี้ ยอดสุทธิจะไม่เท่ากับยอดสินค้าหักส่วนลดโดยไม่มีอะไรบนจอเดียวกันอธิบาย */}
      {roundingDelta !== 0 && (
        <>
          <AmountRow label="ยอดก่อนปัดเศษ" value={payableBeforeRounding} />
          <AmountRow label="ปัดเศษเงินสด" value={roundingDelta} />
        </>
      )}
      {source === 'board_game' && (boardGamePreview?.reservationDepositApplied ?? 0) > 0 && (
        <AmountRow label="ใช้มัดจำการจอง" value={-Number(boardGamePreview?.reservationDepositApplied ?? 0)} discount />
      )}
      <AmountRow label="ยอดสุทธิ" value={total} />
      <AmountRow label="ชำระแล้ว" value={validation.paidTotal} />
      <AmountRow label="คงเหลือ" value={validation.remaining} />
      {validationFeedback}
      {confirmButton}
    </Card>
  );

  const adjustmentProps = {
    memberOnly: false,
    amountOverride:
      source === 'restaurant'
        ? restaurantPreview?.subtotal ?? check?.amountDue ?? 0
        : source === 'board_game'
        ? boardGamePreview?.subtotal ?? cart.subtotal
        : undefined,
    pointsUsedOverride:
      source === 'restaurant'
        ? restaurantPreview?.pointsUsed ?? 0
        : source === 'board_game' ? boardGamePreview?.pointsUsed ?? 0 : undefined,
    previewLoadingOverride:
      source === 'restaurant'
        ? restaurantPricing.loading
        : source === 'board_game' ? boardGamePricing.loading : undefined,
    previewErrorOverride:
      source === 'restaurant'
        ? restaurantPricing.error?.message ??
          restaurantPreview?.reason ??
          restaurantPreview?.couponError ??
          null
        : source === 'board_game'
        ? boardGamePricing.error?.message ??
          boardGamePreview?.reason ??
          boardGamePreview?.couponError ??
          null
        : undefined,
    hideExtra: source === 'restaurant',
  };
  const restaurantMemberSelection =
    source === 'restaurant'
      ? {
          member: restaurantMember,
          setMember: setRestaurantMember,
          amount: total,
        }
      : undefined;
  const restaurantBenefitsSelection = source === 'restaurant'
    ? {
        coupon: restaurantCoupon,
        setCoupon: setRestaurantCoupon,
        pointsToRedeem: restaurantPointsToRedeem,
        setPointsToRedeem: setRestaurantPointsToRedeem,
        manualDiscount: restaurantManualDiscount,
        setManualDiscount: setRestaurantManualDiscount,
      }
    : undefined;

  return (
    <ScreenContainer edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={
          source === 'restaurant'
            ? `ชำระ${
                check?.serviceMode === 'TAKEAWAY' ? 'บิลกลับบ้าน' : 'โต๊ะ'
              } ${
                check?.serviceMode === 'TAKEAWAY'
                  ? `#${check.id.slice(0, 8)}`
                  : table?.code ?? check?.tableCode ?? '-'
              }`
            : source === 'board_game'
            ? `ชำระโต๊ะ ${boardGameBill?.tableCode ?? '-'}`
            : 'ชำระเงิน'
        }
        subtitle="ตรวจสอบรายการและรับชำระเงิน"
        onBack={() => navigation.goBack()}
        right={
          !isTablet ? (
            <View
              style={[styles.totalPill, { backgroundColor: colors.surface3 }]}
            >
              <Text style={[typography.bodyStrong, { color: colors.primary }]}>
                ฿{total.toFixed(2)}
              </Text>
            </View>
          ) : undefined
        }
      />
      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.lg }]}>
          <View style={[styles.leftPane, { gap: spacing.md }]}>
            {linesCard}
            <CheckoutAdjustmentsCard
              {...adjustmentProps}
              memberSelection={restaurantMemberSelection}
              benefitsSelection={restaurantBenefitsSelection}
              presentation="horizontal"
            />
          </View>
          <View
            style={{
              width: Math.min(540, Math.max(460, width * 0.4)),
              gap: spacing.md,
            }}
          >
            <ScrollView
              style={styles.tabletPaymentScroll}
              contentContainerStyle={styles.tabletPaymentContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {paymentCard}
            </ScrollView>
            {totalAndActions}
          </View>
        </View>
      ) : (
        <View style={styles.phoneLayout}>
          <ScrollView
            style={styles.phoneScroll}
            contentContainerStyle={{
              gap: spacing.md,
              paddingBottom: spacing.lg,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {requiresPhoneLineEntry ? (
              <View style={styles.phoneSerialLines}>{linesCard}</View>
            ) : null}
            <CheckoutAdjustmentsCard
              {...adjustmentProps}
              memberSelection={restaurantMemberSelection}
              benefitsSelection={restaurantBenefitsSelection}
              presentation="collapsed"
            />
            {paymentCard}
            <View style={{ gap: spacing.xs }}>{validationFeedback}</View>
          </ScrollView>
          <View
            style={[
              styles.phoneFooter,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                ยอดสุทธิ
              </Text>
              <Text style={[typography.numeric, { color: colors.text }]}>
                ฿{total.toFixed(2)}
              </Text>
            </View>
            <View style={styles.phoneConfirm}>{confirmButton}</View>
          </View>
        </View>
      )}
      <SaleConfirmationModal
        visible={confirmOpen}
        subtotal={subtotal}
        discountTotal={discounts.discountTotal}
        total={paymentTarget}
        items={confirmationItems}
        payments={settlementPayments}
        memberName={activeMember?.name}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={completeSale}
      />
    </ScreenContainer>
  );
}

function PaymentMethodButton({
  method,
  selected,
  tablet = false,
  onPress,
}: {
  method: MockPaymentMethod;
  selected: boolean;
  tablet?: boolean;
  onPress: () => void;
}) {
  const { colors, radius, typography } = useTheme();
  const foreground = selected ? colors.primaryText : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`เลือก${paymentMethodLabel(method)}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.paymentMethodButton,
        tablet && styles.tabletPaymentMethodButton,
        {
          borderRadius: radius.md,
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primary : colors.surface2,
          opacity: pressed ? 0.84 : 1,
        },
      ]}
    >
      <PaymentMethodIcon method={method} color={foreground} />
      <Text style={[typography.bodyStrong, { color: foreground }]}>
        {paymentMethodLabel(method)}
      </Text>
    </Pressable>
  );
}

function PaymentMethodIcon({
  method,
  color,
}: {
  method: MockPaymentMethod;
  color: string;
}) {
  const paths: Record<MockPaymentMethod, string> = {
    cash: 'M3 7h18v10H3V7Zm3 3h2m8 4h2m-6-5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    qr: 'M4 4h5v5H4V4Zm11 0h5v5h-5V4ZM4 15h5v5H4v-5Zm11 0h2v2h-2v-2Zm3 0h2v5h-2v-5Zm-3 3h2v2h-2v-2Z',
    card: 'M3 6h18v12H3V6Zm0 4h18M7 15h4',
    bank_transfer: 'M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M2 20h20L12 4 2 10Z',
    wallet:
      'M4 7h15a2 2 0 0 1 2 2v9H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13v3m0 5h4',
    store_credit: 'M4 10v10h16V10M3 10l2-6h14l2 6M8 20v-6h4v6m-8-10h16',
    credit: 'M6 3h9l4 4v14H6V3Zm9 0v5h4M9 13h6m-6 4h6',
  };
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d={paths[method]}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function AmountRow({
  label,
  value,
  discount = false,
}: {
  label: string;
  value: number;
  discount?: boolean;
}) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.line}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          typography.captionStrong,
          { color: discount ? colors.success : colors.text },
        ]}
      >
        {value < 0 ? '−' : ''}฿{Math.abs(value).toFixed(2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panes: { flex: 1, flexDirection: 'row' },
  leftPane: { flex: 1, minWidth: 0 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cartLineCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  cartItemIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  paymentCard: {
    paddingBottom: 16,
  },
  phonePaymentCard: {
    padding: 0,
    borderWidth: 0,
  },
  saleModeRow: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 14,
  },
  saleModeButton: {
    flex: 1,
  },
  paymentSection: {
    gap: 10,
    marginTop: 16,
  },
  paymentMethodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tabletPaymentMethodGrid: {
    gap: 10,
  },
  paymentMethodButton: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 72,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  tabletPaymentMethodButton: {
    flexBasis: '22%',
    minHeight: 88,
    flexDirection: 'column',
    gap: 6,
  },
  otherMethodsRow: {
    minHeight: 58,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cashPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  cashInput: {
    minHeight: 60,
    fontSize: 28,
    fontWeight: '700',
  },
  quickCashRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickCashButton: {
    flex: 1,
    paddingHorizontal: 8,
  },
  changePanel: {
    minHeight: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  addPaymentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  addPaymentButton: {
    flexGrow: 1,
    flexBasis: '30%',
    paddingHorizontal: 8,
  },
  summaryCard: {
    gap: 6,
  },
  tabletPaymentScroll: {
    flex: 1,
  },
  tabletPaymentContent: {
    paddingBottom: 2,
  },
  phoneLayout: {
    flex: 1,
    minHeight: 0,
  },
  phoneScroll: {
    flex: 1,
    minHeight: 0,
  },
  phoneSerialLines: {
    height: 360,
  },
  totalPill: {
    minHeight: 40,
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  phoneFooter: {
    minHeight: 84,
    marginHorizontal: -16,
    marginBottom: -16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 8,
  },
  phoneConfirm: {
    flex: 1.45,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
});
