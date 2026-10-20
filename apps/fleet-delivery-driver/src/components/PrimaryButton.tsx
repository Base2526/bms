import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, spacing } from '../theme';

type Props = {
  label: string;
  onPress(): void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({ label, onPress, disabled = false, tone = 'primary', style }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        tone === 'primary' && styles.primary,
        tone === 'secondary' && styles.secondary,
        tone === 'danger' && styles.danger,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}>
      <Text style={[styles.label, tone === 'secondary' && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderColor: colors.primary },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.45 },
  label: { color: colors.inverse, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondaryLabel: { color: colors.primary },
});
