import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { MenuGrid } from '../../components/MenuGrid';
import { QtyStepper } from '../../components/QtyStepper';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useCart } from '../../state/CartContext';
import type { SellStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<SellStackParamList, 'Menu'>;

/** ความกว้างแผงตะกร้าบนแท็บเล็ต
 *  320 ไม่ใช่เลขสวย ๆ — วัดจากจอจริง: ไอแพดแนวตั้ง 1024pt ถ้าแผงกว้าง 360 จะเหลือที่ให้กริด 664
 *  ซึ่งตกเกณฑ์ 700 แล้วกริดหล่นเหลือ 2 คอลัมน์ (การ์ดใหญ่เกินจำเป็น เห็นเมนูได้น้อยลงกว่าเดิม)
 *  ที่ 320 เหลือ 704 → 3 คอลัมน์ และแผงยังกว้างพอให้ชื่อเมนูไทยอ่านจบคู่กับปุ่มเพิ่ม/ลด */
export const CART_PANEL_WIDTH = 320;

// แท็บ "เมนูอาหาร" = ขายที่ไม่ผูกโต๊ะ (กลับบ้าน/สั่งที่เคาน์เตอร์)
// การสั่งให้โต๊ะอยู่ที่แท็บ "ผังโต๊ะ" → เลือกโต๊ะ → สั่งอาหาร (บิลของโต๊ะอยู่ใน ChecksContext)
export default function MenuScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { width, isTablet } = useResponsive();
  const { lines, addItem, decrementItem, total } = useCart();

  const qtyBySku = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of lines) map[l.sku] = l.qty;
    return map;
  }, [lines]);

  const cartCount = lines.reduce((n, l) => n + l.qty, 0);

  const grid = (
    <MenuGrid
      qtyBySku={qtyBySku}
      onAdd={item => addItem(item.sku, item.name, item.price)}
      onDecrement={sku => decrementItem(sku)}
      areaWidth={isTablet ? width - CART_PANEL_WIDTH : width}
      artHeight={isTablet ? 116 : 96}
      header={
        <Text style={[typography.title, { color: colors.text }]}>
          เมนูอาหาร
        </Text>
      }
    />
  );

  // แผงตะกร้าฝั่งขวาบนแท็บเล็ต — รูปเดียวกับแผงบิลของ /pos/restaurant บนเว็บ:
  // กริดเมนูอยู่ฝั่งกว้าง (แตะเลือกด้วยตา) · สิ่งที่ลูกค้าสั่งแล้วอยู่ในสายตาตลอดโดยไม่ต้องเปลี่ยนหน้า
  const cartPanel = (
    <View
      style={{
        width: CART_PANEL_WIDTH,
        backgroundColor: colors.surface,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: colors.border,
        padding: spacing.lg,
      }}
    >
      <Text
        style={[
          typography.subtitle,
          { color: colors.text, marginBottom: spacing.md },
        ]}
      >
        ตะกร้า {cartCount > 0 ? `· ${cartCount} รายการ` : ''}
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
            ยังไม่มีรายการ — แตะเมนูเพื่อเพิ่ม
          </Text>
        }
        renderItem={({ item }) => (
          <View style={{ gap: spacing.sm }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: spacing.sm,
              }}
            >
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
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
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

      <View
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          paddingTop: spacing.md,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: spacing.md,
          }}
        >
          <Text style={[typography.subtitle, { color: colors.text }]}>รวม</Text>
          <Text style={[typography.subtitle, { color: colors.text }]}>
            ฿{total.toFixed(2)}
          </Text>
        </View>
        <Button
          label="ไปหน้าชำระเงิน"
          fullWidth
          disabled={cartCount === 0}
          onPress={() => navigation.navigate('Checkout')}
        />
      </View>
    </View>
  );

  return (
    <ScreenContainer padded={false}>
      {isTablet ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {grid}
          {cartPanel}
        </View>
      ) : (
        <>
          {grid}
          {/* มือถือ: แถบสรุปล่างจอแทนแผงข้าง */}
          <View
            style={[
              styles.cartBar,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                padding: spacing.lg,
              },
            ]}
          >
            <View>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {cartCount} รายการ
              </Text>
              <Text style={[typography.subtitle, { color: colors.text }]}>
                ฿{total.toFixed(2)}
              </Text>
            </View>
            <Button
              label="ไปหน้าชำระเงิน"
              disabled={cartCount === 0}
              onPress={() => navigation.navigate('Checkout')}
            />
          </View>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
