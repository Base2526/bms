import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useCart } from '../../state/CartContext';
import type { SellStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<SellStackParamList, 'Receipt'>;

// snapshot ยอด ณ ตอนกด "ยืนยันการขาย" — เก็บไว้ตอนเข้าหน้านี้ครั้งเดียว ไม่ผูกกับตะกร้าสด
// (บนเว็บ POS เคยมีบั๊กที่ใบเสร็จอ่านค่าที่เปลี่ยนไปแล้วหลังขายจบ ยอดบนกระดาษกับที่คิดเงินจริงไม่ตรงกัน)
export default function ReceiptScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const {
    lines,
    subtotal,
    tierDiscount,
    couponDiscount,
    appliedManualDiscount,
    discountTotal,
    total,
    member,
    coupon,
    manualDiscount,
    clear,
  } = useCart();
  const snapshot = useRef({
    lines: [...lines],
    subtotal,
    tierDiscount,
    couponDiscount,
    appliedManualDiscount,
    discountTotal,
    total,
    member,
    coupon,
    manualDiscount,
  }).current;
  const itemCount = snapshot.lines.reduce((n, l) => n + l.qty, 0);

  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ใบเสร็จตั้งใจให้แคบเท่ากระดาษสลิปจริง ไม่ยืดเต็มจอ — แต่บนแท็บเล็ตต้องไม่ปล่อยครึ่งจอว่างเปล่า
  // จึงวางสรุป+ปุ่มไว้อีกฝั่งแทน
  const paper = (
    <Card style={{ flex: 1 }}>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        ใบเสร็จ (ตัวอย่าง — ยังไม่ผูกเลขบิลจริง)
      </Text>
      <ScrollView>
        {snapshot.lines.map(l => (
          <View key={l.sku} style={styles.line}>
            <Text style={[typography.body, { color: colors.text, flex: 1 }]}>
              {l.name} × {l.qty}
            </Text>
            <Text style={[typography.body, { color: colors.text }]}>
              ฿{(l.qty * l.unitPrice).toFixed(2)}
            </Text>
          </View>
        ))}
        {snapshot.member && (
          <View style={[styles.line, { marginTop: spacing.md }]}>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              สมาชิก
            </Text>
            <Text style={[typography.captionStrong, { color: colors.text }]}>
              {snapshot.member.name} · {snapshot.member.tier}
            </Text>
          </View>
        )}
        {snapshot.discountTotal > 0 && (
          <>
            <View style={[styles.line, { marginTop: spacing.md }]}>
              <Text style={[typography.body, { color: colors.textMuted }]}>
                ยอดสินค้า
              </Text>
              <Text style={[typography.body, { color: colors.text }]}>
                ฿{snapshot.subtotal.toFixed(2)}
              </Text>
            </View>
            {snapshot.tierDiscount > 0 && (
              <ReceiptDiscount
                label="ส่วนลดสมาชิก"
                amount={snapshot.tierDiscount}
              />
            )}
            {snapshot.couponDiscount > 0 && (
              <ReceiptDiscount
                label={`คูปอง ${snapshot.coupon?.code ?? ''}`}
                amount={snapshot.couponDiscount}
              />
            )}
            {snapshot.appliedManualDiscount > 0 && (
              <ReceiptDiscount
                label={`ส่วนลดพิเศษ · ${snapshot.manualDiscount?.reason ?? ''}`}
                amount={snapshot.appliedManualDiscount}
              />
            )}
          </>
        )}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: spacing.md,
            paddingTop: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ยอดสุทธิ
          </Text>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ฿{snapshot.total.toFixed(2)}
          </Text>
        </View>
      </ScrollView>
    </Card>
  );

  const summary = (
    <Card>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        สรุปการขาย
      </Text>
      <View style={styles.line}>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          จำนวนรายการ
        </Text>
        <Text style={[typography.body, { color: colors.text }]}>
          {itemCount}
        </Text>
      </View>
      <View style={styles.line}>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          ยอดสุทธิ
        </Text>
        <Text style={[typography.numeric, { color: colors.text }]}>
          ฿{snapshot.total.toFixed(2)}
        </Text>
      </View>
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
          <View style={{ width: 380 }}>
            {summary}
            <Button
              label="ขายรายการใหม่"
              fullWidth
              style={{ marginTop: spacing.lg }}
              onPress={() => navigation.navigate('Menu')}
            />
          </View>
        </View>
      ) : (
        <>
          <View style={{ flex: 1, marginBottom: spacing.lg }}>{paper}</View>
          <Button
            label="ขายรายการใหม่"
            fullWidth
            onPress={() => navigation.navigate('Menu')}
          />
        </>
      )}
    </ScreenContainer>
  );
}

function ReceiptDiscount({ label, amount }: { label: string; amount: number }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.line}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {label}
      </Text>
      <Text style={[typography.captionStrong, { color: colors.success }]}>
        −฿{amount.toFixed(2)}
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
  },
});
