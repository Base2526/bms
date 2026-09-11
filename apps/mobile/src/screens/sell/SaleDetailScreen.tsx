import React, { useMemo, useState } from 'react';
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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useSales } from '../../state/SalesContext';
import {
  allocateMockRefundToOriginalPayments,
  calculateMockReturnTotal,
} from '../../lib/returnMath';
import { paymentMethodLabel } from '../../lib/paymentMath';
import type { MockCartLine } from '../../mocks/menu';
import type { SellStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<SellStackParamList, 'SaleDetail'>;

export default function SaleDetailScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const { findSale, appendReturn } = useSales();
  const sale = findSale(route.params.saleId);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [voidPin, setVoidPin] = useState('');
  const [voidOpen, setVoidOpen] = useState(false);
  const returnedQtyBySku = useMemo(() => {
    const map: Record<string, number> = {};
    for (const record of sale?.returns ?? []) {
      for (const line of record.lines) {
        map[line.sku] = (map[line.sku] ?? 0) + line.qty;
      }
    }
    return map;
  }, [sale]);
  const priorAllocations = useMemo(
    () => (sale?.returns ?? []).flatMap(record => record.allocations),
    [sale],
  );
  const netRefundRatio =
    sale && sale.subtotal > 0 ? Math.min(1, sale.total / sale.subtotal) : 1;

  const returnLines = useMemo(
    () =>
      (sale?.lines ?? []).map(line => ({
        sku: line.sku,
        soldQty: Math.max(0, line.qty - (returnedQtyBySku[line.sku] ?? 0)),
        returnQty: returnQty[line.sku] ?? 0,
        unitRefundPrice: line.unitPrice * netRefundRatio,
      })),
    [netRefundRatio, returnQty, returnedQtyBySku, sale],
  );
  const returnPreview = calculateMockReturnTotal(returnLines);

  if (!sale) {
    return (
      <ScreenContainer>
        <Text style={[typography.title, { color: colors.danger }]}>
          ไม่พบใบเสร็จ TEST
        </Text>
      </ScreenContainer>
    );
  }

  const selectedLines: MockCartLine[] = sale.lines
    .map(line => ({ ...line, qty: returnQty[line.sku] ?? 0 }))
    .filter(line => line.qty > 0);

  const commitReturn = (type: 'RETURN' | 'VOID') => {
    if (!reason.trim()) {
      Alert.alert('ต้องระบุเหตุผล', 'Return/Void ต้องมีเหตุผลใน mock นี้');
      return;
    }
    if (returnPreview.total <= 0 || returnPreview.errors.length > 0) return;
    appendReturn(sale.id, {
      type,
      reason: reason.trim(),
      lines: selectedLines,
      total: returnPreview.total,
      allocations: allocateMockRefundToOriginalPayments(
        returnPreview.total,
        sale.payments,
        priorAllocations,
      ),
    });
    setReason('');
    setReturnQty({});
    setVoidPin('');
    setVoidOpen(false);
    Alert.alert(
      type === 'VOID' ? 'Void สำเร็จใน mock' : 'บันทึกคืนสินค้า mock แล้ว',
      'ใบเสร็จเดิมไม่ถูกแก้ไข ประวัติคืนถูกเพิ่มแยกต่างหาก',
    );
  };

  const detail = (
    <Card style={{ flex: 1 }}>
      <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
        รายละเอียดใบเสร็จ TEST · {sale.receiptNo}
      </Text>
      <FlatList
        data={sale.lines}
        keyExtractor={line => line.sku}
        ItemSeparatorComponent={() => (
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
        )}
        renderItem={({ item }) => (
          <View style={{ gap: spacing.sm }}>
            <View style={styles.row}>
              <Text style={[typography.body, { color: colors.text, flex: 1 }]}>
                {item.name} × {item.qty}
              </Text>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                ฿{(item.qty * item.unitPrice).toFixed(2)}
              </Text>
            </View>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              คืนแล้ว {returnedQtyBySku[item.sku] ?? 0} · คืนได้อีก{' '}
              {Math.max(0, item.qty - (returnedQtyBySku[item.sku] ?? 0))}
            </Text>
            <QtyStepper
              qty={returnQty[item.sku] ?? 0}
              itemName={`จำนวนคืน ${item.name}`}
              variant="outline"
              onIncrement={() =>
                setReturnQty(prev => ({
                  ...prev,
                  [item.sku]: Math.min(
                    Math.max(0, item.qty - (returnedQtyBySku[item.sku] ?? 0)),
                    (prev[item.sku] ?? 0) + 1,
                  ),
                }))
              }
              onDecrement={() =>
                setReturnQty(prev => ({
                  ...prev,
                  [item.sku]: Math.max(0, (prev[item.sku] ?? 0) - 1),
                }))
              }
            />
          </View>
        )}
      />
    </Card>
  );

  const actions = (
    <Card>
      <Text style={[typography.captionStrong, { color: colors.warning }]}>
        Return/Void TEST
      </Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="เหตุผลคืนสินค้า/void"
        placeholderTextColor={colors.textSoft}
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
      />
      <AmountRow label="ยอดคืนก่อนยืนยัน" value={returnPreview.total} />
      {returnPreview.errors.map(error => (
        <Text key={error} style={[typography.captionStrong, { color: colors.danger }]}>
          {error}
        </Text>
      ))}
      {allocateMockRefundToOriginalPayments(
        returnPreview.total,
        sale.payments,
        priorAllocations,
      ).map(allocation => (
          <Text
            key={`${allocation.method}-${allocation.amount}`}
            style={[typography.caption, { color: colors.textMuted }]}
          >
            {paymentMethodLabel(allocation.method)} ฿{allocation.amount.toFixed(2)}
            {' · '}
            {allocation.status === 'COMPLETED'
              ? 'สำเร็จทันที'
              : 'รอยืนยันการคืนเงิน'}
          </Text>
        ))}
      <Button
        label="คืนสินค้าที่เลือก"
        accessibilityLabel="ยืนยันคืนสินค้าที่เลือกแบบทดสอบ"
        fullWidth
        disabled={returnPreview.total <= 0 || returnPreview.errors.length > 0}
        style={{ marginTop: spacing.md }}
        onPress={() => commitReturn('RETURN')}
      />
      <Button
        label="Void ทั้งบิล"
        accessibilityLabel="เริ่ม Void ทั้งบิล ต้องมี PIN ผู้อนุมัติคนที่สอง"
        variant="danger"
        fullWidth
        style={{ marginTop: spacing.sm }}
        disabled={
          sale.voided ||
          sale.lines.every(
            line => (returnedQtyBySku[line.sku] ?? 0) >= line.qty,
          )
        }
        onPress={() => {
          const wholeBill: Record<string, number> = {};
          for (const line of sale.lines) {
            wholeBill[line.sku] = Math.max(
              0,
              line.qty - (returnedQtyBySku[line.sku] ?? 0),
            );
          }
          setReturnQty(wholeBill);
          setVoidOpen(true);
        }}
      />
      <Button
        label="พิมพ์ซ้ำ mock"
        accessibilityLabel="พิมพ์ซ้ำแบบทดสอบ ยังไม่ต่อเครื่องพิมพ์จริง"
        variant="secondary"
        fullWidth
        style={{ marginTop: spacing.sm }}
        onPress={() =>
          Alert.alert('พิมพ์ซ้ำ mock', 'ยังไม่ต่อเครื่องพิมพ์ ESC/POS จริง')
        }
      />
      {sale.returns.length > 0 && (
        <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
          <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
            ประวัติคืน/void แยกต่างหาก
          </Text>
          {sale.returns.map(record => (
            <Text key={record.id} style={[typography.caption, { color: colors.text }]}>
              {record.type} · ฿{record.total.toFixed(2)} · {record.reason}
            </Text>
          ))}
        </View>
      )}
    </Card>
  );

  return (
    <ScreenContainer>
      <ScreenHeader
        title={sale.receiptNo}
        subtitle="ใบเสร็จเดิม immutable; return/void เป็นประวัติแยก"
        onBack={() => navigation.goBack()}
      />
      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.lg }]}>
          <View style={{ flex: 1 }}>{detail}</View>
          <View style={{ width: 390 }}>{actions}</View>
        </View>
      ) : (
        <>
          <View style={{ flex: 1, marginBottom: spacing.md }}>{detail}</View>
          {actions}
        </>
      )}
      <Modal transparent visible={voidOpen} animationType="fade">
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setVoidOpen(false)} />
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[typography.subtitle, { color: colors.text }]}>
                ยืนยัน Void TEST
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                Void แยกจาก Return และใช้ mock PIN ผู้อนุมัติคนที่สอง 9999
              </Text>
              <TextInput
                value={voidPin}
                onChangeText={setVoidPin}
                placeholder="PIN ผู้อนุมัติคนที่สอง"
                placeholderTextColor={colors.textSoft}
                keyboardType="number-pad"
                secureTextEntry
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.text },
                ]}
              />
              <Button
                label="ยืนยัน Void"
                accessibilityLabel="ยืนยัน Void ทั้งบิลด้วย PIN ทดสอบ"
                variant="danger"
                fullWidth
                disabled={voidPin !== '9999'}
                onPress={() => commitReturn('VOID')}
              />
              <Button
                label="ยกเลิก"
                variant="secondary"
                fullWidth
                style={{ marginTop: spacing.sm }}
                onPress={() => setVoidOpen(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function AmountRow({ label, value }: { label: string; value: number }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[typography.body, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[typography.subtitle, { color: colors.text }]}>
        ฿{value.toFixed(2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panes: { flex: 1, flexDirection: 'row' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginVertical: 12,
  },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '92%',
    maxWidth: 520,
    maxHeight: '82%',
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
});
