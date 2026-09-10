import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useCart } from '../../state/CartContext';
import type { SellStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<SellStackParamList, 'Checkout'>;

const PAYMENT_METHODS = ['เงินสด', 'QR พร้อมเพย์', 'บัตรเครดิต'] as const;

export default function CheckoutScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const { lines, total, clear, addItem, decrementItem } = useCart();
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>(
    PAYMENT_METHODS[0],
  );

  const itemCount = lines.reduce((n, l) => n + l.qty, 0);

  const linesCard = (
    <Card style={{ flex: 1 }}>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        รายการ ({itemCount})
      </Text>
      <FlatList
        data={lines}
        keyExtractor={l => l.sku}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: colors.border,
              marginVertical: spacing.md,
            }}
          />
        )}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ตะกร้าว่าง
          </Text>
        }
        renderItem={({ item }) => (
          <View style={{ gap: spacing.sm }}>
            <View style={styles.line}>
              <Text
                style={[typography.body, { color: colors.text, flex: 1 }]}
                numberOfLines={2}
              >
                {item.name}
              </Text>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                ฿{(item.qty * item.unitPrice).toFixed(2)}
              </Text>
            </View>
            {/* แก้จำนวนได้ที่นี่ด้วย — ลูกค้าเปลี่ยนใจตอนยืนจ่ายเงินเป็นเรื่องปกติ
                ไม่ควรต้องย้อนกลับไปหน้าเมนูเพื่อลดหนึ่งจาน */}
            <View style={styles.line}>
              <QtyStepper
                qty={item.qty}
                itemName={item.name}
                variant="outline"
                onIncrement={() => addItem(item.sku, item.name, item.unitPrice)}
                onDecrement={() => decrementItem(item.sku)}
              />
              <Text style={[typography.caption, { color: colors.textSoft }]}>
                ฿{item.unitPrice.toFixed(2)} / หน่วย
              </Text>
            </View>
          </View>
        )}
      />
    </Card>
  );

  const paymentCard = (
    <Card>
      <Text
        style={[
          typography.captionStrong,
          { color: colors.textMuted, marginBottom: spacing.sm },
        ]}
      >
        วิธีชำระเงิน
      </Text>
      {/* แท็บเล็ต: เรียงลงมาเป็นปุ่มเต็มความกว้างในแผงขวา · มือถือ: เรียงข้างกันสามช่อง */}
      <View
        style={{ flexDirection: isTablet ? 'column' : 'row', gap: spacing.sm }}
      >
        {PAYMENT_METHODS.map(m => (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityState={{ selected: method === m }}
            onPress={() => setMethod(m)}
            style={{
              flex: isTablet ? undefined : 1,
              minHeight: 48,
              paddingVertical: spacing.md,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: method === m ? colors.primary : colors.surface2,
            }}
          >
            <Text
              style={[
                typography.body,
                { color: method === m ? colors.primaryText : colors.text },
              ]}
            >
              {m}
            </Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );

  const totalAndActions = (
    <>
      <View style={styles.totalRow}>
        <Text style={[typography.subtitle, { color: colors.text }]}>
          ยอดสุทธิ
        </Text>
        <Text style={[typography.numeric, { color: colors.text }]}>
          ฿{total.toFixed(2)}
        </Text>
      </View>

      <Button
        label="ยืนยันการขาย"
        fullWidth
        disabled={lines.length === 0}
        onPress={() => navigation.replace('Receipt')}
      />
      <Button
        label="ล้างตะกร้าและกลับไปเมนู"
        variant="ghost"
        fullWidth
        style={{ marginTop: 8 }}
        onPress={() => {
          clear();
          navigation.navigate('Menu');
        }}
      />
    </>
  );

  return (
    <ScreenContainer>
      {/* ปุ่มย้อนกลับ = กลับไปเมนูโดย "ไม่ล้างตะกร้า" — คนละอย่างกับปุ่มล้างตะกร้าด้านล่าง
          ซึ่งเป็นการทิ้งของที่ลูกค้าเลือกไว้แล้ว */}
      <ScreenHeader title="ชำระเงิน" onBack={() => navigation.goBack()} />

      {isTablet ? (
        <View style={[styles.panes, { gap: spacing.lg }]}>
          <View style={{ flex: 1 }}>{linesCard}</View>
          <View style={{ width: 380 }}>
            {paymentCard}
            <View style={{ marginTop: spacing.lg }}>{totalAndActions}</View>
          </View>
        </View>
      ) : (
        <>
          <View style={{ flex: 1, marginBottom: spacing.md }}>{linesCard}</View>
          <View style={{ marginBottom: spacing.md }}>{paymentCard}</View>
          {totalAndActions}
        </>
      )}
    </ScreenContainer>
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
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
});
