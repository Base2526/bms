import { posText, usePosLanguage, posLocale } from '../../i18n/language';
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLazyQuery, useMutation, useQuery } from '@apollo/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { ReceiptDelivery } from '../../components/ReceiptDelivery';
import {
  MobilePosCompleteRefundDocument,
  MobilePosMembersDocument,
  MobilePosReturnDocument,
  MobilePosVoidDocument,
  PosBootstrapDocument,
} from '../../graphql/generated';
import { createIdempotencyKey, isDecidedRejection } from '../../lib/operation';
import { paymentMethodLabel } from '../../lib/paymentMath';
import { exchangeSeedLines, refundPaymentOptions } from '../../lib/returnMath';
import { useCart } from '../../state/CartContext';
import { useCatalog } from '../../state/CatalogContext';
import { useSales } from '../../state/SalesContext';
import { useSession } from '../../state/SessionContext';
import { useTheme } from '../../theme/ThemeProvider';
import type { AppStackParamList } from '../../navigation/types';
import type { PosCartLine, PosMember } from '../../types/pos';

type Props = NativeStackScreenProps<AppStackParamList, 'SaleDetail'>;
type Action = 'RETURN' | 'RETURN_FULL' | 'EXCHANGE' | 'VOID';
type ReturnReason =
  | 'DAMAGED'
  | 'WRONG_ITEM'
  | 'CUSTOMER_CHANGE'
  | 'PRICE_ERROR'
  | 'QUALITY_ISSUE'
  | 'OTHER';

const RETURN_REASONS: Array<{ code: ReturnReason; label: string }> = [
  { code: 'DAMAGED', get label() { return posText("สินค้าเสียหาย"); } },
  { code: 'WRONG_ITEM', get label() { return posText("สินค้าผิด"); } },
  { code: 'CUSTOMER_CHANGE', get label() { return posText("ลูกค้าเปลี่ยนใจ"); } },
  { code: 'PRICE_ERROR', get label() { return posText("ราคาผิด"); } },
  { code: 'QUALITY_ISSUE', get label() { return posText("ปัญหาคุณภาพ"); } },
  { code: 'OTHER', get label() { return posText("อื่น ๆ"); } },
];

function confirmAction(title: string, message: string): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      title,
      message,
      [
        { text: posText("ยกเลิก"), style: 'cancel', onPress: () => resolve(false) },
        { text: posText("ยืนยัน"), onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

export default function SaleDetailScreen({ route, navigation }: Props) {
  usePosLanguage();
  const { colors, spacing, typography } = useTheme();
  const { session } = useSession();
  const cart = useCart();
  const { resolveVariant } = useCatalog();
  const { findSale, refresh, loading } = useSales();
  const sale = findSale(route.params.saleId);
  const bootstrap = useQuery(PosBootstrapDocument);
  const allApprovers = (bootstrap.data?.bmsPosSession.approvers ?? []).filter(
    approver => approver.id !== session?.cashier.id,
  );
  const [returnMutation] = useMutation(MobilePosReturnDocument);
  const [findMembers] = useLazyQuery(MobilePosMembersDocument, {
    fetchPolicy: 'network-only',
  });
  const [voidMutation] = useMutation(MobilePosVoidDocument);
  const [completeRefund] = useMutation(MobilePosCompleteRefundDocument);
  const [action, setAction] = useState<Action | null>(null);
  const approvers = allApprovers.filter(approver =>
    action === 'VOID'
      ? approver.approvals.includes('pos.void')
      : approver.approvals.some(permission =>
          ['payment.refund', 'pos.return.cross_branch'].includes(permission),
        ),
  );
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [returnReason, setReturnReason] = useState<ReturnReason>('OTHER');
  const [preferredRefundMethod, setPreferredRefundMethod] = useState('');
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const [refundRefs, setRefundRefs] = useState<Record<string, string>>({});
  const [secondaryAction, setSecondaryAction] = useState('');
  const returnKey = useRef<string | null>(null);
  const voidKey = useRef<string | null>(null);
  const deliveryScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const selectedLines = useMemo(
    () =>
      (sale?.lines ?? []).flatMap(line => {
        const qty = quantities[line.orderItemId] ?? 0;
        return qty > 0 ? [{ line, qty }] : [];
      }),
    [quantities, sale?.lines],
  );
  const estimatedRefund = selectedLines.reduce(
    (sum, selected) => sum + selected.qty * selected.line.unitPrice,
    0,
  );
  const pendingRefunds =
    sale?.returns.flatMap(record =>
      record.allocations.filter(allocation => allocation.status === 'PENDING'),
    ) ?? [];
  const refundOptions = useMemo(
    () =>
      refundPaymentOptions(
        sale?.payments ?? [],
        sale?.returns.flatMap(record => record.allocations) ?? [],
      ),
    [sale?.payments, sale?.returns],
  );

  const runSecondary = async (key: string, actionFn: () => Promise<void>) => {
    if (secondaryAction) return;
    setSecondaryAction(key);
    try {
      await actionFn();
    } catch (error) {
      Alert.alert(
        posText("ทำรายการไม่สำเร็จ"),
        error instanceof Error ? error.message : posText("กรุณาลองใหม่"),
      );
    } finally {
      setSecondaryAction('');
    }
  };

  if (!sale) {
    return (
      <ScreenContainer>
        <ScreenHeader
          title={loading ? posText("กำลังโหลดใบเสร็จ…") : posText("ไม่พบใบเสร็จ")}
          onBack={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  const close = () => {
    setAction(null);
    setReturnReason('OTHER');
    setPreferredRefundMethod('');
    setQuantities({});
    setReason('');
    setApproverId('');
    setApproverPin('');
  };

  const performSubmit = async () => {
    if (!session || !action || submitting) return;
    const isReturnAction = action !== 'VOID';
    const isPartialReturn = action === 'RETURN' || action === 'EXCHANGE';
    if (!reason.trim()) {
      Alert.alert(posText("ต้องระบุเหตุผล"), posText("การคืนสินค้าและ Void ต้องมีเหตุผล"));
      return;
    }
    if (isPartialReturn && selectedLines.length === 0) {
      Alert.alert(posText("ยังไม่ได้เลือกรายการ"), posText("เลือกจำนวนสินค้าที่ต้องการคืน"));
      return;
    }
    const selectedRefundMethod =
      refundOptions.length === 1
        ? refundOptions[0].method
        : refundOptions.some(option => option.method === preferredRefundMethod)
        ? preferredRefundMethod
        : null;
    if (isReturnAction && refundOptions.length > 1 && !selectedRefundMethod) {
      Alert.alert(
        posText("ต้องเลือกช่องทางคืนเงิน"),
        posText("บิลนี้จ่ายหลายช่องทาง กรุณาเลือกช่องทางคืนเงินก่อน"),
      );
      return;
    }
    if (action === 'VOID' && (!approverId || !approverPin)) {
      Alert.alert(posText("ต้องมีผู้อนุมัติ"), posText("Void ต้องใช้ PIN ของผู้อนุมัติคนที่สอง"));
      return;
    }
    if (action === 'EXCHANGE') {
      if (
        cart.lines.length > 0 &&
        !(await confirmAction(
          posText("แทนที่ตะกร้าปัจจุบัน"),
          posText("ตะกร้ามี {v0} รายการและจะถูกแทนที่ด้วยบิลเปลี่ยนสินค้า", { v0: cart.lines.length }),
        ))
      ) {
        return;
      }
      if (
        !(await confirmAction(
          posText("ยืนยันรับคืนก่อนเปลี่ยนสินค้า"),
          posText("ระบบจะรับคืนสินค้าที่เลือกก่อน แล้วเปิดบิลขายใหม่ เงินสดถือว่าคืนแล้ว ส่วนช่องทางอื่นอาจต้องยืนยันคืนเงินจริงภายหลัง"),
        ))
      ) {
        return;
      }
    }
    setSubmitting(true);
    try {
      if (isReturnAction) {
        returnKey.current ??= createIdempotencyKey(
          action === 'EXCHANGE'
            ? 'exchange-return'
            : action === 'RETURN_FULL'
            ? 'full-return'
            : 'return',
        );
        const response = await returnMutation({
          variables: {
            input: {
              cashierUserId: session.credentials.cashierUserId,
              pin: session.credentials.pin,
              orderId: sale.id,
              mode: action === 'RETURN_FULL' ? 'FULL' : 'PARTIAL',
              note: `[${returnReason}] ${reason.trim()}`,
              idempotencyKey: returnKey.current,
              preferredRefundMethod:
                selectedRefundMethod?.toUpperCase() ?? null,
              approvalUserId: approverId || null,
              approvalPin: approverPin || null,
              lines:
                action === 'RETURN_FULL'
                  ? []
                  : selectedLines.map(selected => ({
                      orderItemId: selected.line.orderItemId,
                      packQty: selected.qty,
                    })),
            },
          },
        });
        const result = response.data?.bmsPosReturn;
        if (!result?.status) {
          throw new Error(posText("ยังไม่ได้รับผลยืนยันการคืนสินค้า กรุณาลองอีกครั้งด้วยรายการเดิม"));
        }
        const successStatus =
          action === 'RETURN_FULL' ? 'RETURNED' : 'PARTIAL_RETURNED';
        if (result?.status !== successStatus) {
          returnKey.current = null;
          throw new Error(
            result?.reason ?? result?.status ?? posText("คืนสินค้าไม่สำเร็จ"),
          );
        }
        if (action === 'EXCHANGE') {
          const seeds = exchangeSeedLines(
            sale.id,
            sale.lines,
            result.returnedItems ?? [],
          );
          if (seeds.length === 0) {
            throw new Error(
              posText("รับคืนสำเร็จแล้ว แต่ผลจากเซิร์ฟเวอร์ไม่มีรายการสำหรับเปิดบิลเปลี่ยน กรุณาเริ่มบิลขายใหม่จากหน้าเมนู"),
            );
          }
          const replacementLines = await Promise.all(
            seeds.map(async seed => {
              try {
                const latest = await resolveVariant(
                  seed.line.sku,
                  seed.line.size,
                  seed.line.packCode,
                );
                return {
                  key: seed.key,
                  sku: latest.sku,
                  name: latest.name,
                  qty: seed.qty,
                  unitPrice: latest.price,
                  // บิลเปลี่ยนสินค้าคิดยอดใหม่ทั้งใบ จึงต้องพกกติกาของราคาไปด้วย
                  // ไม่งั้นบิลใหม่ที่เข้าขั้นราคาส่งจะโดน PAYMENT_MISMATCH ตอนรับเงิน
                  basePrice: latest.basePrice,
                  packBasePrice: latest.packBasePrice ?? latest.price,
                  modifierUnitPrice: 0,
                  priceTiers: latest.priceTiers,
                  promotion: latest.promotion ?? null,
                  size: latest.size,
                  packCode: latest.packCode,
                  unitName: latest.unitName,
                  baseQty: latest.baseQty,
                  modifierCodes: latest.selectedModifierCodes ?? [],
                  serialTracked: latest.serialTracked,
                  scaleBarcode: latest.scaleBarcode,
                  serials: [],
                  imageUrl: latest.imageUrl,
                } satisfies PosCartLine;
              } catch {
                return {
                  key: seed.key,
                  sku: seed.line.sku,
                  name: seed.line.name,
                  qty: seed.qty,
                  unitPrice: seed.line.unitPrice,
                  size: seed.line.size,
                  packCode: seed.line.packCode,
                  unitName: seed.line.unitName,
                  baseQty: seed.line.baseQty,
                  modifierCodes: [],
                  serialTracked: seed.line.serialTracked,
                  scaleBarcode: seed.line.scaleBarcode,
                  serials: [],
                  imageUrl: seed.line.imageUrl,
                } satisfies PosCartLine;
              }
            }),
          );
          let replacementMember: PosMember | null = null;
          if (sale.member?.memberNo) {
            try {
              const memberResult = await findMembers({
                variables: { q: sale.member.memberNo, amount: 0 },
              });
              const hit = memberResult.data?.bmsPosMemberSearch.members.find(
                candidate => candidate.memberNo === sale.member?.memberNo,
              );
              if (hit) {
                replacementMember = {
                  id: hit.customerId,
                  memberNo: hit.memberNo,
                  name: hit.name,
                  phone: hit.phone,
                  tier: hit.tier?.name ?? null,
                  tierDiscountPct:
                    hit.tier?.discountType === 'PERCENT'
                      ? hit.tier.discountValue
                      : 0,
                  points: hit.pointsBalance,
                  pointsUsable: hit.pointsUsable,
                };
              }
            } catch {
              // The return is already committed. The cashier can attach the member again in checkout.
            }
          }
          cart.replaceForExchange(replacementLines, replacementMember);
          returnKey.current = null;
          await refresh().catch(() => undefined);
          close();
          navigation.popToTop();
          Alert.alert(
            posText("เปิดบิลเปลี่ยนสินค้าแล้ว"),
            posText("รับคืน ฿{v0} และนำ {v1} รายการมาเริ่มบิลใหม่", { v0: (result.refundAmount ?? 0).toFixed(2), v1: replacementLines.length }),
          );
          return;
        }
        returnKey.current = null;
        Alert.alert(
          posText("คืนสินค้าสำเร็จ"),
          posText("ยอดคืนตามเซิร์ฟเวอร์ ฿{v0}", { v0: (result.refundAmount ?? 0).toFixed(2) }),
        );
      } else {
        voidKey.current ??= createIdempotencyKey('void');
        const response = await voidMutation({
          variables: {
            input: {
              cashierUserId: session.credentials.cashierUserId,
              pin: session.credentials.pin,
              orderId: sale.id,
              reason: reason.trim(),
              idempotencyKey: voidKey.current,
              approverUserId: approverId,
              approverPin,
            },
          },
        });
        const result = response.data?.bmsPosVoid;
        if (!result?.status) {
          throw new Error(posText("ยังไม่ได้รับผลยืนยัน Void กรุณาลองอีกครั้งด้วยรายการเดิม"));
        }
        if (result?.status !== 'VOIDED') {
          voidKey.current = null;
          throw new Error(result?.reason ?? result?.status ?? posText("Void ไม่สำเร็จ"));
        }
        voidKey.current = null;
        Alert.alert(
          posText("Void สำเร็จ"),
          posText("ยอดคืน ฿{v0}", { v0: (result.refundAmount ?? 0).toFixed(2) }),
        );
      }
      await refresh().catch(() => undefined);
      close();
    } catch (error) {
      if (isDecidedRejection(error)) {
        if (isReturnAction) returnKey.current = null;
        else voidKey.current = null;
      }
      Alert.alert(
        action === 'VOID'
          ? posText("Void ไม่สำเร็จ")
          : action === 'EXCHANGE'
          ? posText("เปลี่ยนสินค้าไม่สำเร็จ")
          : posText("คืนสินค้าไม่สำเร็จ"),
        error instanceof Error ? error.message : posText("กรุณาลองใหม่"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    // Lock before any confirmation await: React state alone cannot stop same-frame taps.
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    try {
      await performSubmit();
    } finally {
      submissionInFlight.current = false;
    }
  };

  return (
    <ScreenContainer edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={sale.receiptNo}
        subtitle={`${new Date(sale.createdAt).toLocaleString(posLocale())}${
          sale.restaurantServiceMode === 'TAKEAWAY'
            ? posText(" · กลับบ้าน")
            : sale.restaurantServiceMode === 'DINE_IN'
            ? posText(" · กินในร้าน")
            : ''
        }`}
        onBack={() => navigation.goBack()}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={deliveryScroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: spacing.lg }}
        >
          <Button
            label={posText("ดูตัวอย่างใบเสร็จ")}
            variant="secondary"
            fullWidth
            style={{ marginBottom: spacing.md }}
            onPress={() =>
              navigation.navigate('Receipt', {
                saleId: sale.id,
                source: sale.source,
                mode: 'preview',
              })
            }
          />
          <Card>
            {sale.lines.map(item => (
              <View
                key={item.orderItemId}
                style={[styles.row, { marginBottom: spacing.sm }]}
              >
                <Text
                  style={[typography.body, { color: colors.text, flex: 1 }]}
                >
                  {item.name} × {item.qty}
                </Text>
                <Text style={[typography.bodyStrong, { color: colors.text }]}>
                  {posText("฿")}{(item.qty * item.unitPrice).toFixed(2)}
                </Text>
              </View>
            ))}
            <View style={[styles.row, { marginTop: spacing.md }]}>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                {posText("รวม") + " "}</Text>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                {posText("฿")}{sale.total.toFixed(2)}
              </Text>
            </View>
            {sale.payments.map(payment => (
              <Text
                key={payment.id}
                style={[typography.caption, { color: colors.textMuted }]}
              >
                {paymentMethodLabel(payment.method)} {" " + posText("฿") + " "}{payment.amount.toFixed(2)}
              </Text>
            ))}
          </Card>
          {sale.returns.map(record => (
            <Card key={record.id} style={{ marginTop: spacing.md }}>
              <Text style={[typography.bodyStrong, { color: colors.warning }]}>
                {record.type} {" " + posText("· ฿")}{record.total.toFixed(2)}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {record.reason} · {record.settlementStatus}
              </Text>
            </Card>
          ))}
          {pendingRefunds.length > 0 ? (
            <Card style={{ marginTop: spacing.md }}>
              <Text style={[typography.bodyStrong, { color: colors.warning }]}>
                {posText("คืนเงินที่ยังไม่เสร็จ") + " "}</Text>
              {pendingRefunds.map((allocation, index) => {
                const allocationId = allocation.id ?? '';
                return (
                  <View
                    key={allocationId || `${allocation.method}-${index}`}
                    style={{ gap: spacing.sm, marginTop: spacing.md }}
                  >
                    <Text style={[typography.body, { color: colors.text }]}>
                      {paymentMethodLabel(allocation.method)} {" " + posText("· ฿") + " "}{allocation.amount.toFixed(2)}
                    </Text>
                    <TextInput
                      value={refundRefs[allocationId] ?? ''}
                      onChangeText={value =>
                        setRefundRefs(previous => ({
                          ...previous,
                          [allocationId]: value,
                        }))
                      }
                      placeholder={posText("เลขอ้างอิงการคืนเงิน")}
                      placeholderTextColor={colors.textSoft}
                      style={[
                        styles.input,
                        { borderColor: colors.border, color: colors.text },
                      ]}
                    />
                    <Button
                      label={posText("ยืนยันคืนเงินสำเร็จ")}
                      disabled={
                        !allocationId || !refundRefs[allocationId]?.trim()
                      }
                      loading={secondaryAction === `refund-${allocationId}`}
                      onPress={() =>
                        runSecondary(`refund-${allocationId}`, async () => {
                          if (!session) return;
                          const response = await completeRefund({
                            variables: {
                              input: {
                                cashierUserId:
                                  session.credentials.cashierUserId,
                                pin: session.credentials.pin,
                                userId: null,
                                allocationId,
                                externalRef:
                                  refundRefs[allocationId]?.trim() || null,
                              },
                            },
                          });
                          const result = response.data?.bmsPosCompleteRefund;
                          if (result?.status !== 'COMPLETED')
                            throw new Error(
                              result?.reason ??
                                result?.status ??
                                posText("ยืนยันคืนเงินไม่สำเร็จ"),
                            );
                          await refresh();
                        })
                      }
                    />
                  </View>
                );
              })}
            </Card>
          ) : null}
          <Card style={{ marginTop: spacing.md }}>
            <ReceiptDelivery
              key={sale.id}
              orderId={sale.id}
              scrollRef={deliveryScroll}
              disabled={sale.voided || sale.returns.length > 0}
            />
          </Card>
          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Button
              label={posText("คืนบางรายการ")}
              fullWidth
              disabled={!sale.returnEligible || sale.voided}
              onPress={() => setAction('RETURN')}
            />
            <Button
              label={posText("คืนทั้งบิล")}
              variant="secondary"
              fullWidth
              disabled={!sale.returnEligible || sale.voided}
              onPress={() => setAction('RETURN_FULL')}
            />
            <Button
              label={posText("เปลี่ยนสินค้า")}
              variant="secondary"
              fullWidth
              disabled={!sale.returnEligible || sale.voided}
              onPress={() => setAction('EXCHANGE')}
            />
            <Button
              label={posText("Void ทั้งบิล")}
              variant="danger"
              fullWidth
              disabled={!sale.returnEligible || sale.voided}
              onPress={() => setAction('VOID')}
            />
            {!sale.returnEligible && sale.returnBlockedReason ? (
              <Text style={[typography.caption, { color: colors.danger }]}>
                {sale.returnBlockedReason}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        transparent
        visible={action !== null}
        animationType="fade"
        onRequestClose={close}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[typography.title, { color: colors.text }]}>
                {action === 'VOID'
                  ? posText("Void ทั้งบิล")
                  : action === 'EXCHANGE'
                  ? posText("เปลี่ยนสินค้า")
                  : action === 'RETURN_FULL'
                  ? posText("คืนทั้งบิล")
                  : posText("คืนสินค้า")}
              </Text>
              {action === 'RETURN' || action === 'EXCHANGE'
                ? sale.lines.map(line => (
                    <View key={line.orderItemId} style={styles.row}>
                      <Text
                        style={[
                          typography.body,
                          { color: colors.text, flex: 1 },
                        ]}
                      >
                        {line.name}
                      </Text>
                      <QtyStepper
                        qty={quantities[line.orderItemId] ?? 0}
                        itemName={line.name}
                        onIncrement={() =>
                          setQuantities(previous => ({
                            ...previous,
                            [line.orderItemId]: Math.min(
                              line.refundablePackQty,
                              (previous[line.orderItemId] ?? 0) + 1,
                            ),
                          }))
                        }
                        onDecrement={() =>
                          setQuantities(previous => ({
                            ...previous,
                            [line.orderItemId]: Math.max(
                              0,
                              (previous[line.orderItemId] ?? 0) - 1,
                            ),
                          }))
                        }
                      />
                    </View>
                  ))
                : null}
              {action !== 'VOID' ? (
                <>
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textMuted, marginTop: spacing.sm },
                    ]}
                  >
                    {posText("ประมาณการ ฿") + " "}{(action === 'RETURN_FULL'
                      ? sale.lines.reduce(
                          (sum, line) =>
                            sum + line.refundablePackQty * line.unitPrice,
                          0,
                        )
                      : estimatedRefund
                    ).toFixed(2)}{' '}
                    {posText("· ยอดจริงคำนวณจาก snapshot และนโยบายคืนสินค้าที่เซิร์ฟเวอร์") + " "}</Text>
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.textMuted },
                    ]}
                  >
                    {posText("ประเภทเหตุผล") + " "}</Text>
                  <View style={styles.reasonGrid}>
                    {RETURN_REASONS.map(option => (
                      <Button
                        key={option.code}
                        label={option.label}
                        variant={
                          returnReason === option.code ? 'primary' : 'secondary'
                        }
                        onPress={() => setReturnReason(option.code)}
                      />
                    ))}
                  </View>
                  {refundOptions.length > 1 ? (
                    <>
                      <Text
                        style={[
                          typography.captionStrong,
                          { color: colors.textMuted, marginTop: spacing.md },
                        ]}
                      >
                        {posText("ช่องทางคืนเงิน") + " "}</Text>
                      <View style={styles.reasonGrid}>
                        {refundOptions.map(option => (
                          <Button
                            key={option.method}
                            label={posText("{v0} · ฿{v1}", { v0: paymentMethodLabel(
                              option.method,
                            ), v1: option.available.toFixed(2) })}
                            variant={
                              preferredRefundMethod === option.method
                                ? 'primary'
                                : 'secondary'
                            }
                            onPress={() =>
                              setPreferredRefundMethod(option.method)
                            }
                          />
                        ))}
                      </View>
                    </>
                  ) : null}
                </>
              ) : null}
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder={posText("เหตุผล")}
                placeholderTextColor={colors.textSoft}
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              <Text
                style={[typography.captionStrong, { color: colors.textMuted }]}
              >
                {posText("ผู้อนุมัติ") + " "}{action === 'VOID' ? posText("(บังคับ)") : posText("(เมื่อกฎกำหนด)")}
              </Text>
              <View style={{ gap: spacing.sm }}>
                {approvers.map(approver => (
                  <Button
                    key={approver.id}
                    label={`${approver.name ?? approver.id}${
                      approver.hasPin ? '' : posText(" · ยังไม่ได้ตั้ง PIN")
                    }`}
                    variant={
                      approverId === approver.id ? 'primary' : 'secondary'
                    }
                    fullWidth
                    disabled={!approver.hasPin}
                    onPress={() => setApproverId(approver.id)}
                  />
                ))}
              </View>
              <TextInput
                value={approverPin}
                onChangeText={setApproverPin}
                placeholder={posText("PIN ผู้อนุมัติ")}
                placeholderTextColor={colors.textSoft}
                keyboardType="number-pad"
                secureTextEntry
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              <Button
                label={
                  submitting
                    ? posText("กำลังบันทึก…")
                    : action === 'EXCHANGE'
                    ? posText("รับคืนและเปิดบิลใหม่")
                    : posText("ยืนยัน")
                }
                variant={action === 'VOID' ? 'danger' : 'primary'}
                fullWidth
                disabled={submitting}
                onPress={submit}
              />
              <Button
                label={posText("ยกเลิก")}
                variant="secondary"
                fullWidth
                onPress={close}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '92%',
    maxWidth: 560,
    maxHeight: '88%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 20,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginVertical: 12,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
