import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  title: string;
  subtitle?: string;
  /** ไม่ส่ง = ไม่มีปุ่มย้อนกลับ (หน้าที่เป็นรากของแท็บ) */
  onBack?: () => void;
  right?: React.ReactNode;
}

// หัวจอที่มีปุ่มย้อนกลับของตัวเอง — navigator ทั้งแอปตั้ง `headerShown: false` ไว้เพราะจอขาย
// ต้องการพื้นที่ทุกพิกเซล แต่หน้าที่ถูก push เข้ามา (บิลโต๊ะ/ชำระเงิน) ต้องมีทางออกเสมอ
// ไม่งั้นเหลือแค่ปัดขอบจอซึ่งบนแท็บเล็ตที่วางในกล่องกันกระแทกทำได้ยาก
export function ScreenHeader({ title, subtitle, onBack, right }: Props) {
  const { colors, spacing, radius, typography, minTouchTarget } = useTheme();

  return (
    <View style={[styles.row, { marginBottom: spacing.lg, gap: spacing.sm }]}>
      {onBack && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ย้อนกลับ"
          onPress={onBack}
          style={({ pressed }) => [
            styles.back,
            {
              width: minTouchTarget,
              height: minTouchTarget,
              borderRadius: radius.md,
              backgroundColor: pressed ? colors.surface2 : colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path
              d="M15 19l-7-7 7-7"
              stroke={colors.text}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      )}

      <View style={styles.titles}>
        <Text
          style={[typography.title, { color: colors.text }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[typography.caption, { color: colors.textMuted }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  back: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  titles: { flex: 1, minWidth: 0 },
});
