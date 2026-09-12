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
import {
  MobilePosSaleDocument,
  MobileRestaurantCheckDocument,
  MobileRestaurantFloorDocument,
  MobileRestaurantSettleCheckDocument,
} from '../../graphql/generated';
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

type Props = NativeStackScreenProps<SellStackParamList, 'Checkout'>;

const PAYMENT_METHODS: MockPaymentMethod[] = ['cash', 'qr', 'card'];

export default function CheckoutScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const cart = useCart();
  const { refresh: refreshSales } = useSales();
  const { session } = useSession();
  const source = route.params?.source ?? 'retail';
  const tableId = route.params?.tableId;
  const floor = useQuery(MobileRestaurantFloorDocument, {
    skip: source !== 'restaurant',
  });
  const table = tableId
    ? floor.data?.bmsPosRestaurantFloor.tables.find(item => item.id === tableId)
    : undefined;
  const restaurantCheck = useQuery(MobileRestaurantCheckDocument, {
    variables: { id: table?.check?.id ?? '' },
    skip: source !== 'restaurant' || !table?.check?.id,
  });
  const check = restaurantCheck.data?.bmsPosRestaurantCheck;
  const lines = source === 'restaurant'
    ? (check?.items ?? []).map(item => ({
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
        serials: [],
        status: item.status,
      }))
    : cart.lines;
  const subtotal =
    source === 'restaurant' ? check?.amountDue ?? 0 : cart.subtotal;
  const total = source === 'restaurant' ? subtotal : cart.total;
  const discounts =
    source === 'restaurant'
      ? {
          tierDiscount: 0,
          couponDiscount: 0,
          appliedManualDiscount: 0,
          discountTotal: 0,
        }
      : cart;
  const [payments, setPayments] = useState<MockPaymentInput[]>([
    { id: 'payment-1', method: 'cash', amount: total, tendered: total },
  ]);
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
  const [sell] = useMutation(MobilePosSaleDocument);
  const [settleCheck] = useMutation(MobileRestaurantSettleCheckDocument);
  const validation = useMemo(
    () => validateMockPayments(total, payments),
    [payments, total],
  );
  const itemCount = lines.reduce((n, l) => n + l.qty, 0);

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
    if (!validation.canConfirm || submittedRef.current || !session) return;
    submittedRef.current = true;
    setSubmitting(true);
    const paymentInput = payments.map(payment => ({
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
              customerId: null,
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
              mode: 'SALE',
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
              pointsToRedeem: 0,
              manualDiscount: cart.manualDiscount?.amount ?? null,
              discountReason: cart.manualDiscount?.reason ?? null,
              discountApproverUserId:
                cart.manualDiscount?.approverUserId ?? null,
              discountApproverPin: cart.manualDiscount?.approverPin ?? null,
              extraLines: null,
              creditApproverPin: null,
              creditApproverUserId: null,
              depositCustomerNote: null,
              depositDueAt: null,
              pharmacistAuthorizationNote: null,
              pharmacistAuthorizerPin: null,
              pharmacistAuthorizerUserId: null,
              pharmacyApprovedAssessmentId: null,
              pharmacyReviewAssessmentId: null,
            },
          },
        });
        const result = response.data?.bmsPosSale;
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
        keyExtractor={(l, i) => `${l.sku}-${i}`}
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
              <Text style={[typography.body, { color: colors.text, flex: 1 }]}>
                {item.name}
              </Text>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                ฿{(item.qty * item.unitPrice).toFixed(2)}
              </Text>
            </View>
            {source === 'retail' ? (
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
                    })
                  }
                  onDecrement={() => cart.decrementItem(item.sku)}
                />
                <Text style={[typography.caption, { color: colors.textSoft }]}>
                  ฿{item.unitPrice.toFixed(2)} / หน่วย
                </Text>
              </View>
            ) : (
              <Text style={[typography.caption, { color: colors.textSoft }]}>
                คิดเงินจากบิลโต๊ะเดิม ไม่สร้าง cart ใหม่
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
                    setPayments(prev => prev.filter(p => p.id !== payment.id));
                  }}
                />
              )}
            </View>
            <View style={styles.methodRow}>
              {PAYMENT_METHODS.map(method => (
                <Button
                  key={method}
                  label={paymentMethodLabel(method)}
                  accessibilityLabel={`เลือก${paymentMethodLabel(method)}`}
                  variant={payment.method === method ? 'primary' : 'secondary'}
                  onPress={() =>
                    updatePayment(payment.id, {
                      method,
                      reference: method === 'cash' ? undefined : '',
                      tendered: method === 'cash' ? payment.amount : undefined,
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
                      accessibilityLabel={`เงินสดรับ ${amount.toFixed(2)} บาท`}
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
                  onChange={tendered => updatePayment(payment.id, { tendered })}
                />
                <Text
                  style={[typography.captionStrong, { color: colors.success }]}
                >
                  เงินทอน ฿
                  {calculateCashChange(
                    payment.amount,
                    payment.tendered ?? 0,
                  ).toFixed(2)}
                </Text>
              </>
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
        {PAYMENT_METHODS.map(method => (
          <Button
            key={method}
            label={`+ ${paymentMethodLabel(method)}`}
            accessibilityLabel={`เพิ่มช่องทาง${paymentMethodLabel(method)}`}
            variant="secondary"
            onPress={() => addPayment(method)}
          />
        ))}
      </View>
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
      <AmountRow label="ยอดสุทธิ" value={total} />
      <AmountRow label="ชำระแล้ว" value={validation.paidTotal} />
      <AmountRow label="คงเหลือ" value={validation.remaining} />
      {validation.errors.map(error => (
        <Text
          key={error}
          style={[typography.captionStrong, { color: colors.danger }]}
        >
          {error}
        </Text>
      ))}
      <Button
        label="ยืนยันการขาย"
        accessibilityLabel="ยืนยันการขายพร้อมป้องกันกดซ้ำ"
        fullWidth
        loading={submitting}
        disabled={
          lines.length === 0 ||
          Boolean(check?.items.some(item => item.status === 'NEW')) ||
          !validation.canConfirm
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
            ? `ชำระโต๊ะ ${table?.code ?? '-'}`
            : 'ชำระเงิน'
        }
        subtitle="ราคา สต็อก สิทธิ์ และผลชำระตรวจโดยเซิร์ฟเวอร์"
        onBack={() => navigation.goBack()}
      />
      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.lg }]}>
          <View style={{ flex: 1 }}>{linesCard}</View>
          <View style={{ width: 400, gap: spacing.md }}>
            {source === 'retail' ? <CheckoutAdjustmentsCard /> : null}
            {paymentCard}
            {totalAndActions}
          </View>
        </View>
      ) : (
        <>
          <View style={{ flex: 1, marginBottom: spacing.md }}>{linesCard}</View>
          {source === 'retail' ? <CheckoutAdjustmentsCard /> : null}
          <View style={{ marginVertical: spacing.md }}>{paymentCard}</View>
          {totalAndActions}
        </>
      )}
      <SaleConfirmationModal
        visible={confirmOpen}
        subtotal={subtotal}
        discountTotal={discounts.discountTotal}
        total={total}
        itemCount={itemCount}
        payments={payments}
        // บิลโต๊ะบันทึก member เป็น null เสมอ (ดู recordSale) — ถ้าโชว์ชื่อสมาชิกที่ค้างอยู่
        // ในตะกร้าค้าปลีก popup จะยืนยันสิ่งที่ใบเสร็จไม่ได้บันทึก
        memberName={source === 'restaurant' ? undefined : cart.member?.name}
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
