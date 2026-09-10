import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
}

// ช่องค้นหาเมนู — ยกกติกามาจากปุ่มล้างของ /pos/restaurant บนเว็บทั้งสามข้อ:
// 1) ปุ่มล้างขึ้นเฉพาะตอนมีข้อความ — ปุ่มที่ลอยอยู่ตลอดแม้ช่องว่างคือปุ่มที่กดแล้วไม่เกิดอะไร
//    ซึ่งสอนให้คนเลิกเชื่อปุ่มบนแถบนั้น
// 2) คืนโฟกัสให้ช่องหลังล้าง — ไม่งั้นต้องแตะช่องอีกครั้งก่อนพิมพ์คำใหม่
// 3) เป้าแตะของปุ่มล้างต้องใหญ่พอสำหรับนิ้ว แต่ไม่ทับตัวหนังสือในช่อง (กันที่ด้วย paddingRight)
export function SearchField({ value, onChangeText, placeholder }: Props) {
  const { colors, spacing, radius, typography, minTouchTarget } = useTheme();
  // RN 0.87 เปลี่ยนชนิด instance ของ TextInput (ไม่ใช่คลาส TextInput แล้ว) — ใช้ ComponentRef
  // เพื่อให้ตามชนิดจริงของเวอร์ชันที่ติดตั้งอยู่เสมอ ไม่ต้องมาแก้ทุกครั้งที่อัปเกรด
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  return (
    <View style={styles.wrap}>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSoft}
        returnKeyType="search"
        clearButtonMode="never"
        autoCorrect={false}
        style={[
          typography.body,
          {
            minHeight: minTouchTarget,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            color: colors.text,
            paddingHorizontal: spacing.md,
            paddingRight: 44,
          },
        ]}
      />
      {value.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ล้างคำค้น"
          onPress={() => {
            onChangeText('');
            inputRef.current?.focus();
          }}
          style={({ pressed }) => [
            styles.clear,
            {
              borderRadius: radius.sm,
              backgroundColor: pressed ? colors.surface2 : 'transparent',
            },
          ]}
        >
          <Text style={[typography.body, { color: colors.textMuted }]}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  clear: {
    position: 'absolute',
    right: 4,
    width: 36,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
