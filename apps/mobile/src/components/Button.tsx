import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

// ปุ่มมาตรฐานของ POS — สูงอย่างน้อย minTouchTarget เสมอ กันเป้าแตะเล็กเกินนิ้วบนแท็บเล็ต
// (บั๊กคลาสเดียวกับที่เว็บ POS โดนมาหลายรอบ: ปุ่มที่ไม่ได้ตั้ง min-height ถูกลดขนาดจนกดพลาด)
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  fullWidth,
  style,
}: Props) {
  const { colors, spacing, radius, typography, minTouchTarget } = useTheme();

  const palette: Record<
    ButtonVariant,
    { bg: string; fg: string; border?: string }
  > = {
    primary: { bg: colors.primary, fg: colors.primaryText },
    secondary: { bg: colors.surface2, fg: colors.text, border: colors.border },
    danger: { bg: colors.danger, fg: colors.primaryText },
    ghost: { bg: 'transparent', fg: colors.primary },
  };
  const p = palette[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: minTouchTarget,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          backgroundColor: p.bg,
          borderWidth: p.border ? 1 : 0,
          borderColor: p.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <Text
          style={[typography.bodyStrong, { color: p.fg }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});
