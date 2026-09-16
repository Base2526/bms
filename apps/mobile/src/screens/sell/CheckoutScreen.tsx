import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@apollo/client';
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
import { useStoreMode } from '../../state/StoreModeContext';
import {
  MobilePosBoardGameCheckoutDocument,
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
import {
  calculateCashChange,
  paymentMethodLabel,
  quickCashAmounts,
  validateMockPayments,
  type MockPaymentInput,
  type MockPaymentMethod,
} from '../../lib/paymentMath';
import type { SellStackParamList } from '../../navigation/types';
import type { PosMember } from '../../types/pos';

type Props = NativeStackScreenProps<SellStackParamList, 'Checkout'>;

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
  const { isTablet } = useResponsive();
  const cart = useCart();
  const { refresh: refreshSales } = useSales();
  const { session } = useSession();
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
  const subtotal =
    source === 'restaurant'
      ? check?.amountDue ?? 0
      : cart.subtotal + (boardGameBill?.totalDue ?? 0);
  const payableBeforeRounding = round2(
    source === 'restaurant'
      ? subtotal
      : cart.total + (boardGameBill?.totalDue ?? 0),
  );
  const discounts =
    source === 'restaurant'
      ? {
          tierDiscount: 0,
          couponDiscount: 0,
          appliedManualDiscount: 0,
          discountTotal: 0,
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
  // แคชเชียร์แตะช่องชำระเงินเองแล้วหรือยัง — ตราบใดที่ยังไม่แตะ ยอดของช่องทางเดียวต้องเดินตาม
  // ยอดสุทธิเสมอ
  //
  // ⚠️ หน้านี้แก้จำนวนสินค้า/ใส่สมาชิก/ใส่คูปองได้ **ในหน้าเดียวกับที่กรอกเงิน** ของเดิมตั้งยอด
  // ช่องทางไว้ครั้งเดียวตอน mount แล้วไม่ตามอีกเลย → ขยับจำนวนทีเดียวปุ่มยืนยันก็ล็อกด้วย
  // "ยังขาด ฿x" จนกว่าจะพิมพ์ยอดใหม่เองทุกครั้ง
  const [paymentsTouched, setPaymentsTouched] = useState(false);
  useEffect(() => {
    if (paymentsTouched) return;
    setPayments(prev =>
      prev.length === 1 && prev[0].method === 'cash'
        ? [{ ...prev[0], amount: total, tendered: total }]
        : prev,
    );
  }, [paymentsTouched, total]);
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
  /** ตะกร้าค้าปลีกเท่านั้นที่มีชั้นส่วนลดของ server — บิลโต๊ะ/บอร์ดเกมได้ยอดสำเร็จรูปมาแล้ว */
  const discountPending = source === 'retail' && cart.previewLoading;
  const itemCount = lines.reduce((n, l) => n + l.qty, 0);
  const serialsReady = lines.every(line => {
    if (!line.serialTracked) return true;
    const required = Math.round(line.qty * line.baseQty);
    return required > 0 && line.serials.filter(Boolean).length === required;
  });
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
  const boardGameReady = source !== 'board_game' || Boolean(boardGameBill);
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
      !boardGameReady ||
      submittedRef.current ||
      !session
    )
      return;
    submittedRef.current = true;
    setSubmitting(true);
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
              payments: paymentInput,
            },
          },
        });
        const result = response.data?.bmsPosRestaurantSettleCheck;
        if (result?.status !== 'SOLD' || !result.orderId) {
          throw new Error(
            result?.reason ?? result?.status ?? 'ชำระบิลไม่สำเร็จ',
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
              pointsToRedeem: cart.pointsUsed,
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
          navigation.navigate('Menu');
          return;
        }
        if (result?.status !== 'SOLD' || !result.orderId) {
          idempotencyRef.current = null;
          throw new Error(
            result?.reason ?? result?.status ?? 'บันทึกการขายไม่สำเร็จ',
          );
        }
        orderId = result.orderId;
        cart.clear();
      }
      await refreshSales();
      idempotencyRef.current = null;
      setConfirmOpen(false);
      navigation.replace('Receipt', { saleId: orderId });
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
      <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
        รายการ ({itemCount})
      </Text>
      {source === 'restaurant' &&
      check?.items.some(item => item.status === 'NEW') ? (
        <Text style={[typography.captionStrong, { color: colors.danger }]}>
          มีรายการ NEW ที่ยังไม่ส่งครัว จึงชำระไม่ได้
        </Text>
      ) : null}
      <FlatList
        data={lines}
        keyExtractor={l => l.key}
        ItemSeparatorComponent={() => (
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
        )}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ไม่มีรายการสำหรับชำระเงิน
          </Text>
        }
        renderItem={({ item }) => (
          <View style={{ gap: spacing.sm }}>
            <View style={styles.line}>
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

  const paymentCard = (
    <Card>
      <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
        แบ่งชำระ
      </Text>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        ยอดและสิทธิ์จะถูกตรวจซ้ำที่เซิร์ฟเวอร์ก่อนบันทึก
      </Text>
      {source === 'retail' ? (
        <View style={[styles.methodRow, { marginTop: spacing.md }]}>
          <Button
            label="ขายปกติ"
            variant={saleMode === 'SALE' ? 'primary' : 'secondary'}
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
          <ScrollView style={{ maxHeight: isTablet ? 360 : 260 }}>
            {payments.map((payment, index) => (
              <View
                key={payment.id}
                style={{ marginTop: spacing.md, gap: spacing.sm }}
              >
                <View style={styles.line}>
                  <Text style={[typography.bodyStrong, { color: colors.text }]}>
                    ช่องทาง {index + 1}
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
                <View style={styles.methodRow}>
                  {availablePaymentMethods.map(method => (
                    <Button
                      key={method}
                      label={paymentMethodLabel(method)}
                      accessibilityLabel={`เลือก${paymentMethodLabel(method)}`}
                      variant={
                        payment.method === method ? 'primary' : 'secondary'
                      }
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
                <MoneyField
                  label="ยอดช่องทางนี้"
                  value={payment.amount}
                  onChange={amount => updatePayment(payment.id, { amount })}
                />
                {payment.method === 'cash' ? (
                  <>
                    <View style={styles.methodRow}>
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
                          onPress={() =>
                            updatePayment(payment.id, { tendered: amount })
                          }
                        />
                      ))}
                    </View>
                    <MoneyField
                      label="เงินสดที่รับ"
                      value={payment.tendered ?? 0}
                      onChange={tendered =>
                        updatePayment(payment.id, { tendered })
                      }
                    />
                    <Text
                      style={[
                        typography.captionStrong,
                        { color: colors.success },
                      ]}
                    >
                      เงินทอน ฿
                      {calculateCashChange(
                        payment.amount,
                        payment.tendered ?? 0,
                      ).toFixed(2)}
                    </Text>
                  </>
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
            ))}
          </ScrollView>
          <View style={[styles.methodRow, { marginTop: spacing.md }]}>
            {availablePaymentMethods.map(method => (
              <Button
                key={method}
                label={`+ ${paymentMethodLabel(method)}`}
                accessibilityLabel={`เพิ่มช่องทาง${paymentMethodLabel(method)}`}
                variant="secondary"
                onPress={() => addPayment(method)}
              />
            ))}
          </View>
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

  const totalAndActions = (
    <>
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
      <AmountRow label="ยอดสุทธิ" value={total} />
      <AmountRow label="ชำระแล้ว" value={validation.paidTotal} />
      <AmountRow label="คงเหลือ" value={validation.remaining} />
      {(zeroDueBoardGameBill ? [] : validation.errors).map(error => (
        <Text
          key={error}
          style={[typography.captionStrong, { color: colors.danger }]}
        >
          {error}
        </Text>
      ))}
      {/* ส่วนลดกำลังถูกคำนวณใหม่ที่เซิร์ฟเวอร์ — ยอดที่เห็นตอนนี้ยังเป็นของรอบก่อน
          ปุ่มที่กดได้ระหว่างนี้คือปุ่มที่เก็บเงินตามยอดที่ยังไม่ใช่คำตอบสุดท้าย */}
      {discountPending && (
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          กำลังคำนวณส่วนลดกับเซิร์ฟเวอร์…
        </Text>
      )}
      <Button
        label="ยืนยันการขาย"
        accessibilityLabel="ยืนยันการขายพร้อมป้องกันกดซ้ำ"
        fullWidth
        loading={submitting}
        disabled={
          discountPending ||
          lines.length === 0 ||
          Boolean(check?.items.some(item => item.status === 'NEW')) ||
          !canConfirmPayment ||
          !restaurantPaymentsValid ||
          !boardGameReady ||
          !serialsReady ||
          !depositReady ||
          (usesCredit && !activeMember) ||
          (Boolean(pharmacistId) &&
            pharmacistId !== session?.cashier.id &&
            !pharmacistPin)
        }
        onPress={() => setConfirmOpen(true)}
      />
    </>
  );

  return (
    <ScreenContainer>
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
        subtitle="ราคา สต็อก สิทธิ์ และผลชำระตรวจโดยเซิร์ฟเวอร์"
        onBack={() => navigation.goBack()}
      />
      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.lg }]}>
          <View style={{ flex: 1 }}>{linesCard}</View>
          <View style={{ width: 400, gap: spacing.md }}>
            <CheckoutAdjustmentsCard
              memberOnly={source === 'restaurant'}
              memberSelection={
                source === 'restaurant'
                  ? {
                      member: restaurantMember,
                      setMember: setRestaurantMember,
                      amount: total,
                    }
                  : undefined
              }
            />
            {paymentCard}
            {totalAndActions}
          </View>
        </View>
      ) : (
        <>
          <View style={{ flex: 1, marginBottom: spacing.md }}>{linesCard}</View>
          <CheckoutAdjustmentsCard
            memberOnly={source === 'restaurant'}
            memberSelection={
              source === 'restaurant'
                ? {
                    member: restaurantMember,
                    setMember: setRestaurantMember,
                    amount: total,
                  }
                : undefined
            }
          />
          <View style={{ marginVertical: spacing.md }}>{paymentCard}</View>
          {totalAndActions}
        </>
      )}
      <SaleConfirmationModal
        visible={confirmOpen}
        subtotal={subtotal}
        discountTotal={discounts.discountTotal}
        total={paymentTarget}
        itemCount={itemCount}
        payments={settlementPayments}
        memberName={activeMember?.name}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={completeSale}
      />
    </ScreenContainer>
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
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  methodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
});
