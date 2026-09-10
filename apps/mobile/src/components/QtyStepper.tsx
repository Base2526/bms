import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  qty: number;
  onIncrement: () => void;
  onDecrement: () => void;
  /** ชื่อรายการ — ใส่ใน accessibilityLabel เพราะบิลใบเดียวมีหลายบรรทัด ปุ่ม "ลด" เฉย ๆ บอกไม่ได้ว่าลดอะไร */
  itemName: string;
  variant?: 'solid' | 'outline';
}

// ปุ่มเพิ่ม/ลดจำนวน — ใช้ทั้งบนการ์ดเมนูและในรายการบิล เพื่อให้ "ลดจำนวน" ทำได้จากทุกที่ที่เห็นจำนวน
// ⚠️ ปุ่มลดเมื่อเหลือ 1 = เอาบรรทัดออกจากตะกร้า (ดู decrementItem) จึงไม่ต้องมีปุ่มถังขยะแยกอีกปุ่ม
// ให้แคชเชียร์ต้องเลือกว่าจะกดอันไหน
export function QtyStepper({
  qty,
  onIncrement,
  onDecrement,
  itemName,
  variant = 'solid',
}: Props) {
  const { colors, radius, typography } = useTheme();
  const solid = variant === 'solid';

  const bg = solid ? colors.primary : colors.surface2;
  const fg = solid ? colors.primaryText : colors.text;

  return (
    <View
      style={[styles.wrap, { backgroundColor: bg, borderRadius: radius.pill }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          qty > 1 ? `ลดจำนวน ${itemName}` : `เอา ${itemName} ออกจากตะกร้า`
        }
        onPress={onDecrement}
        hitSlop={6}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      >
        <Text style={[typography.subtitle, { color: fg }]}>−</Text>
      </Pressable>

      <Text style={[typography.captionStrong, styles.qty, { color: fg }]}>
        {qty}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`เพิ่มจำนวน ${itemName}`}
        onPress={onIncrement}
        hitSlop={6}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      >
        <Text style={[typography.subtitle, { color: fg }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  btn: {
    width: 32,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  qty: { minWidth: 18, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
