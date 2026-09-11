import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { SaleConfirmationModal } from '../../components/SaleConfirmationModal';
import { CheckoutAdjustmentsCard } from '../../components/CheckoutAdjustmentsCard';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useCart } from '../../state/CartContext';
import { useChecks } from '../../state/ChecksContext';
import { useSales } from '../../state/SalesContext';
import { mockTables } from '../../mocks/floor';
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
  const checks = useChecks();
  const { recordSale } = useSales();
  const source = route.params?.source ?? 'retail';
  const tableId = route.params?.tableId;
  const table = tableId ? mockTables.find(t => t.id === tableId) : undefined;
  const tableSummary = tableId ? checks.summaryFor(tableId) : undefined;
  const lines = source === 'restaurant' ? tableSummary?.lines ?? [] : cart.lines;
  const subtotal =
    source === 'restaurant'
      ? tableSummary?.amountDue ?? 0
      : cart.subtotal;
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);
  const validation = useMemo(
    () => validateMockPayments(total, payments),
    [payments, total],
  );
  const itemCount = lines.reduce((n, l) => n + l.qty, 0);

  const updatePayment = (id: string, patch: Partial<MockPaymentInput>) => {
    setPayments(prev =>
      prev.map(payment =>
        payment.id === id ? { ...payment, ...patch } : payment,
      ),
    );
  };

  const addPayment = (method: MockPaymentMethod) => {
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

  const completeSale = () => {
    if (!validation.canConfirm || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    const sale = recordSale({
      source,
      tableId,
      tableCode: table?.code,
      lines: lines.map(line => ({ ...line })),
      subtotal,
      tierDiscount: discounts.tierDiscount,
      couponDiscount: discounts.couponDiscount,
      manualDiscountAmount: discounts.appliedManualDiscount,
      discountTotal: discounts.discountTotal,
      total,
      member: source === 'restaurant' ? null : cart.member,
      coupon: source === 'restaurant' ? null : cart.coupon,
      manualDiscount: source === 'restaurant' ? null : cart.manualDiscount,
      payments: payments.map(payment => ({ ...payment })),
    });
    if (source === 'restaurant' && tableId) checks.closeCheck(tableId);
    if (source === 'retail') cart.clear();
    setConfirmOpen(false);
    navigation.replace('Receipt', { saleId: sale.id });
  };

  const linesCard = (
    <Card style={{ flex: 1 }}>
      <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
        รายการ TEST ({itemCount})
      </Text>
      {source === 'restaurant' && tableSummary?.hasUnsent ? (
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
                    cart.addItem(
                      item.sku,
                      item.name,
                      item.unitPrice,
                      item.barcode,
                    )
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
        Split payment TEST
      </Text>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        ของจริงต้องใช้ server preview, cashier session, RBAC และ idempotency key
      </Text>
      <ScrollView style={{ maxHeight: isTablet ? 360 : 260 }}>
        {payments.map((payment, index) => (
          <View key={payment.id} style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <View style={styles.line}>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                ช่องทาง {index + 1}
              </Text>
              {payments.length > 1 && (
                <Button
                  label="ลบ"
                  accessibilityLabel={`ลบช่องทางชำระเงินที่ ${index + 1}`}
                  variant="ghost"
                  onPress={() =>
                    setPayments(prev => prev.filter(p => p.id !== payment.id))
                  }
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
            <MoneyInput
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
                      label={amount === payment.amount ? 'รับพอดี' : `฿${amount}`}
                      accessibilityLabel={`เงินสดรับ ${amount.toFixed(2)} บาท`}
                      variant="secondary"
                      onPress={() =>
                        updatePayment(payment.id, { tendered: amount })
                      }
                    />
                  ))}
                </View>
                <MoneyInput
                  label="เงินสดที่รับ"
                  value={payment.tendered ?? 0}
                  onChange={tendered =>
                    updatePayment(payment.id, { tendered })
                  }
                />
                <Text style={[typography.captionStrong, { color: colors.success }]}>
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
                placeholder="เลขอ้างอิง mock"
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
            <AmountRow label="ส่วนลดสมาชิก" value={-discounts.tierDiscount} discount />
          )}
          {discounts.couponDiscount > 0 && (
            <AmountRow label="ส่วนลดคูปอง" value={-discounts.couponDiscount} discount />
          )}
          {discounts.appliedManualDiscount > 0 && (
            <AmountRow label="ส่วนลดพิเศษ" value={-discounts.appliedManualDiscount} discount />
          )}
        </View>
      )}
      <AmountRow label="ยอดสุทธิ" value={total} />
      <AmountRow label="ชำระแล้ว" value={validation.paidTotal} />
      <AmountRow label="คงเหลือ" value={validation.remaining} />
      {validation.errors.map(error => (
        <Text key={error} style={[typography.captionStrong, { color: colors.danger }]}>
          {error}
        </Text>
      ))}
      <Button
        label="ยืนยันการขาย"
        accessibilityLabel="ยืนยันการขายทดสอบพร้อมป้องกันกดซ้ำ"
        fullWidth
        loading={submitting}
        disabled={
          lines.length === 0 ||
          Boolean(tableSummary?.hasUnsent) ||
          !validation.canConfirm
        }
        onPress={() => setConfirmOpen(true)}
      />
    </>
  );

  return (
    <ScreenContainer>
      <ScreenHeader
        title={source === 'restaurant' ? `ชำระโต๊ะ ${table?.code ?? '-'}` : 'ชำระเงิน'}
        subtitle="TEST mock payment เท่านั้น ยังไม่เรียก mutation จริง"
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
        memberName={cart.member?.name}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={completeSale}
      />
    </ScreenContainer>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const { colors, typography } = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      value={value ? String(value) : ''}
      onChangeText={text => onChange(Number(text) || 0)}
      placeholder={label}
      placeholderTextColor={colors.textSoft}
      keyboardType="decimal-pad"
      style={[styles.input, typography.body, { borderColor: colors.border, color: colors.text }]}
    />
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
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
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
