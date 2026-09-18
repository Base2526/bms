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
import type { AppStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'Receipt'>;

export default function ReceiptScreen({ route, navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const { findSale } = useSales();
  const sale = findSale(route.params.saleId);
  const leaveReceipt = () => {
    if (route.params.source === 'board_game' && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.reset({
      index: 0,
      routes: [
        {
          name: 'Tabs',
          params: {
            screen:
              route.params.source === 'restaurant' ? 'FloorTab' : 'SellTab',
          },
        },
      ],
    });
  };
  const leaveLabel =
    route.params.source === 'board_game'
      ? 'กลับรายละเอียดโต๊ะ'
      : route.params.source === 'restaurant'
      ? 'กลับผังโต๊ะ'
      : 'ขายรายการใหม่';

  if (!sale) {
    return (
      <ScreenContainer>
        <Text style={[typography.title, { color: colors.danger }]}>
          ไม่พบใบเสร็จ
        </Text>
        <Button label={leaveLabel} onPress={leaveReceipt} />
      </ScreenContainer>
    );
  }

  const lineTotal = sale.lines.reduce(
    (sum, line) => sum + line.qty * line.unitPrice,
    0,
  );
  const otherCharges =
    Math.round(
      (sale.total - (lineTotal - sale.discountTotal + sale.roundingAmount)) *
        100,
    ) / 100;

  const paper = (
    <Card style={{ flex: 1 }}>
      <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
        ใบเสร็จ · {sale.receiptNo}
      </Text>
      {sale.restaurantServiceMode ? (
        <Text style={[typography.captionStrong, { color: colors.textMuted }]}>
          {sale.restaurantServiceMode === 'TAKEAWAY'
            ? 'บริการ · กลับบ้าน'
            : 'บริการ · กินในร้าน'}
        </Text>
      ) : null}
      <ScrollView>
        {/* ⚠️ คีย์ด้วย orderItemId ไม่ใช่ sku — บิลใบเดียวมีสินค้าตัวเดียวกันหลายไซซ์ได้
            (บทเรียนเดียวกับตะกร้าที่เคยคีย์ด้วย sku แล้วบรรทัดยุบทับกัน) */}
        {sale.lines.map(l => (
          <View key={l.orderItemId} style={styles.line}>
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
        {/* ค่าบริการ/ค่าถุง (8.6) ไม่มีช่องของตัวเองในใบเสร็จที่ server ส่งมา แต่มันอยู่ใน
            ยอดสุทธิ · หาส่วนต่างจากยอดที่เหลือแทนการเงียบ ไม่งั้นรายการบนกระดาษบวกแล้ว
            ไม่เท่ากับยอดสุทธิบรรทัดล่างโดยไม่มีอะไรอธิบาย */}
        {otherCharges > 0.004 && (
          <AmountLine label="ค่าบริการ / อื่น ๆ" amount={otherCharges} />
        )}
        {sale.roundingAmount !== 0 && (
          <AmountLine label="ปัดเศษเงินสด" amount={sale.roundingAmount} />
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
      {sale.offlineTenderedAt ? (
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          รับเงินตอนออฟไลน์และซิงก์สำเร็จแล้ว
        </Text>
      ) : null}
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
        label={leaveLabel}
        accessibilityLabel={leaveLabel}
        fullWidth
        style={{ marginTop: spacing.sm }}
        onPress={leaveReceipt}
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
