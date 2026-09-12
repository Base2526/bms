import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import {
  MobilePosReturnDocument,
  MobilePosVoidDocument,
  PosBootstrapDocument,
} from '../../graphql/generated';
import { createIdempotencyKey } from '../../lib/operation';
import { paymentMethodLabel } from '../../lib/paymentMath';
import { useSales } from '../../state/SalesContext';
import { useSession } from '../../state/SessionContext';
import { useTheme } from '../../theme/ThemeProvider';
import type { SellStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<SellStackParamList, 'SaleDetail'>;
type Action = 'RETURN' | 'VOID';
type ReturnReason =
  | 'DAMAGED'
  | 'WRONG_ITEM'
  | 'CUSTOMER_CHANGE'
  | 'PRICE_ERROR'
  | 'QUALITY_ISSUE'
  | 'OTHER';

const RETURN_REASONS: Array<{ code: ReturnReason; label: string }> = [
  { code: 'DAMAGED', label: 'สินค้าเสียหาย' },
  { code: 'WRONG_ITEM', label: 'สินค้าผิด' },
  { code: 'CUSTOMER_CHANGE', label: 'ลูกค้าเปลี่ยนใจ' },
  { code: 'PRICE_ERROR', label: 'ราคาผิด' },
  { code: 'QUALITY_ISSUE', label: 'ปัญหาคุณภาพ' },
  { code: 'OTHER', label: 'อื่น ๆ' },
];

export default function SaleDetailScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { session } = useSession();
  const { findSale, refresh, loading } = useSales();
  const sale = findSale(route.params.saleId);
  const bootstrap = useQuery(PosBootstrapDocument);
  const allApprovers = (bootstrap.data?.bmsPosSession.approvers ?? []).filter(
    approver => approver.id !== session?.cashier.id,
  );
  const [returnMutation] = useMutation(MobilePosReturnDocument);
  const [voidMutation] = useMutation(MobilePosVoidDocument);
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
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const returnKey = useRef<string | null>(null);
  const voidKey = useRef<string | null>(null);

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

  if (!sale) {
    return (
      <ScreenContainer>
        <ScreenHeader
          title={loading ? 'กำลังโหลดใบเสร็จ…' : 'ไม่พบใบเสร็จ'}
          onBack={() => navigation.goBack()}
        />
      </ScreenContainer>
    );
  }

  const close = () => {
    setAction(null);
    setReturnReason('OTHER');
    setReason('');
    setApproverId('');
    setApproverPin('');
  };

  const submit = async () => {
    if (!session || !action || submitting) return;
    if (!reason.trim()) {
      Alert.alert('ต้องระบุเหตุผล', 'การคืนสินค้าและ Void ต้องมีเหตุผล');
      return;
    }
    if (action === 'RETURN' && selectedLines.length === 0) {
      Alert.alert('ยังไม่ได้เลือกรายการ', 'เลือกจำนวนสินค้าที่ต้องการคืน');
      return;
    }
    if (action === 'VOID' && (!approverId || !approverPin)) {
      Alert.alert('ต้องมีผู้อนุมัติ', 'Void ต้องใช้ PIN ของผู้อนุมัติคนที่สอง');
      return;
    }
    setSubmitting(true);
    try {
      if (action === 'RETURN') {
        returnKey.current ??= createIdempotencyKey('return');
        const response = await returnMutation({
          variables: {
            input: {
              cashierUserId: session.credentials.cashierUserId,
              pin: session.credentials.pin,
              orderId: sale.id,
              mode: 'PARTIAL',
              note: `[${returnReason}] ${reason.trim()}`,
              idempotencyKey: returnKey.current,
              preferredRefundMethod: null,
              approvalUserId: approverId || null,
              approvalPin: approverPin || null,
              lines: selectedLines.map(selected => ({
                orderItemId: selected.line.orderItemId,
                packQty: selected.qty,
              })),
            },
          },
        });
        const result = response.data?.bmsPosReturn;
        if (result?.status !== 'RETURNED') {
          returnKey.current = null;
          throw new Error(
            result?.reason ?? result?.status ?? 'คืนสินค้าไม่สำเร็จ',
          );
        }
        returnKey.current = null;
        Alert.alert(
          'คืนสินค้าสำเร็จ',
          `ยอดคืนตามเซิร์ฟเวอร์ ฿${(result.refundAmount ?? 0).toFixed(2)}`,
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
        if (result?.status !== 'RETURNED') {
          voidKey.current = null;
          throw new Error(result?.reason ?? result?.status ?? 'Void ไม่สำเร็จ');
        }
        voidKey.current = null;
        Alert.alert(
          'Void สำเร็จ',
          `ยอดคืน ฿${(result.refundAmount ?? 0).toFixed(2)}`,
        );
      }
      await refresh();
      close();
    } catch (error) {
      Alert.alert(
        action === 'VOID' ? 'Void ไม่สำเร็จ' : 'คืนสินค้าไม่สำเร็จ',
        error instanceof Error ? error.message : 'กรุณาลองใหม่',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <ScreenHeader
        title={sale.receiptNo}
        subtitle={new Date(sale.createdAt).toLocaleString('th-TH')}
        onBack={() => navigation.goBack()}
      />
      <Card>
        <FlatList
          data={sale.lines}
          keyExtractor={line => String(line.orderItemId)}
          renderItem={({ item }) => (
            <View style={[styles.row, { marginBottom: spacing.sm }]}>
              <Text style={[typography.body, { color: colors.text, flex: 1 }]}>
                {item.name} × {item.qty}
              </Text>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                ฿{(item.qty * item.unitPrice).toFixed(2)}
              </Text>
            </View>
          )}
        />
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <Text style={[typography.subtitle, { color: colors.text }]}>รวม</Text>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ฿{sale.total.toFixed(2)}
          </Text>
        </View>
        {sale.payments.map(payment => (
          <Text
            key={payment.id}
            style={[typography.caption, { color: colors.textMuted }]}
          >
            {paymentMethodLabel(payment.method)} ฿{payment.amount.toFixed(2)}
          </Text>
        ))}
      </Card>
      {sale.returns.map(record => (
        <Card key={record.id} style={{ marginTop: spacing.md }}>
          <Text style={[typography.bodyStrong, { color: colors.warning }]}>
            {record.type} · ฿{record.total.toFixed(2)}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {record.reason} · {record.settlementStatus}
          </Text>
        </Card>
      ))}
      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <Button
          label="คืนสินค้า"
          fullWidth
          disabled={!sale.returnEligible || sale.voided}
          onPress={() => setAction('RETURN')}
        />
        <Button
          label="Void ทั้งบิล"
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

      <Modal transparent visible={action !== null} animationType="fade">
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
                {action === 'VOID' ? 'Void ทั้งบิล' : 'คืนสินค้า'}
              </Text>
              {action === 'RETURN'
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
              {action === 'RETURN' ? (
                <>
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textMuted, marginTop: spacing.sm },
                    ]}
                  >
                    ประมาณการ ฿{estimatedRefund.toFixed(2)} · ยอดจริงคำนวณจาก
                    snapshot และนโยบายคืนสินค้าที่เซิร์ฟเวอร์
                  </Text>
                  <Text
                    style={[
                      typography.captionStrong,
                      { color: colors.textMuted },
                    ]}
                  >
                    ประเภทเหตุผล
                  </Text>
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
                </>
              ) : null}
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="เหตุผล"
                placeholderTextColor={colors.textSoft}
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              <Text
                style={[typography.captionStrong, { color: colors.textMuted }]}
              >
                ผู้อนุมัติ {action === 'VOID' ? '(บังคับ)' : '(เมื่อกฎกำหนด)'}
              </Text>
              <View style={{ gap: spacing.sm }}>
                {approvers.map(approver => (
                  <Button
                    key={approver.id}
                    label={`${approver.name ?? approver.id}${
                      approver.hasPin ? '' : ' · ยังไม่ได้ตั้ง PIN'
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
                placeholder="PIN ผู้อนุมัติ"
                placeholderTextColor={colors.textSoft}
                keyboardType="number-pad"
                secureTextEntry
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              <Button
                label={submitting ? 'กำลังบันทึก…' : 'ยืนยัน'}
                variant={action === 'VOID' ? 'danger' : 'primary'}
                fullWidth
                disabled={submitting}
                onPress={submit}
              />
              <Button
                label="ยกเลิก"
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
