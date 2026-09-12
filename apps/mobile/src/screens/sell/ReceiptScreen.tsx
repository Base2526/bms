import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useSales } from '../../state/SalesContext';
import { paymentMethodLabel } from '../../lib/paymentMath';
import type { SellStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<SellStackParamList, 'Receipt'>;

export default function ReceiptScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const { findSale } = useSales();
  const sale = findSale(route.params.saleId);

  if (!sale) {
    return (
      <ScreenContainer>
        <Text style={[typography.title, { color: colors.danger }]}>
          ไม่พบใบเสร็จ
        </Text>
        <Button label="กลับไปขาย" onPress={() => navigation.navigate('Menu')} />
      </ScreenContainer>
    );
  }

  const paper = (
    <Card style={{ flex: 1 }}>
      <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
        ใบเสร็จ · {sale.receiptNo}
      </Text>
      <ScrollView>
        {sale.lines.map(l => (
          <View key={l.sku} style={styles.line}>
            <Text style={[typography.body, { color: colors.text, flex: 1 }]}>
              {l.name} × {l.qty}
            </Text>
            <Text style={[typography.body, { color: colors.text }]}>
              ฿{(l.qty * l.unitPrice).toFixed(2)}
            </Text>
          </View>
        ))}
        {sale.discountTotal > 0 && (
          <AmountLine label="ส่วนลดรวม" amount={-sale.discountTotal} />
        )}
        {sale.payments.map(payment => (
          <AmountLine
            key={payment.id}
            label={paymentMethodLabel(payment.method)}
            amount={payment.amount}
          />
        ))}
        <View style={[styles.line, { marginTop: spacing.md }]}>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ยอดสุทธิ
          </Text>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ฿{sale.total.toFixed(2)}
          </Text>
        </View>
      </ScrollView>
    </Card>
  );

  const summary = (
    <Card>
      <Text style={[typography.captionStrong, { color: colors.success }]}>
        บันทึกบนเซิร์ฟเวอร์แล้ว
      </Text>
      <Text style={[typography.body, { color: colors.textMuted }]}>
        เปิดดูหรือคืนสินค้าได้จากประวัติการขาย
      </Text>
      <Button
        label="ดูประวัติ"
        accessibilityLabel="เปิดประวัติการขาย"
        variant="secondary"
        fullWidth
        style={{ marginTop: spacing.sm }}
        onPress={() => navigation.navigate('SalesHistory')}
      />
      <Button
        label="ขายรายการใหม่"
        accessibilityLabel="กลับไปเริ่มขายรายการใหม่"
        fullWidth
        style={{ marginTop: spacing.sm }}
        onPress={() => navigation.navigate('Menu')}
      />
    </Card>
  );

  return (
    <ScreenContainer>
      <Text
        style={[
          typography.title,
          { color: colors.success, marginBottom: spacing.lg },
        ]}
      >
        ขายสำเร็จ
      </Text>
      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.lg }]}>
          <View style={{ flex: 1 }}>{paper}</View>
          <View style={{ width: 380 }}>{summary}</View>
        </View>
      ) : (
        <>
          <View style={{ flex: 1, marginBottom: spacing.lg }}>{paper}</View>
          {summary}
        </>
      )}
    </ScreenContainer>
  );
}

function AmountLine({ label, amount }: { label: string; amount: number }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.line}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {label}
      </Text>
      <Text style={[typography.captionStrong, { color: colors.text }]}>
        {amount < 0 ? '−' : ''}฿{Math.abs(amount).toFixed(2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panes: { flex: 1, flexDirection: 'row' },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
});
