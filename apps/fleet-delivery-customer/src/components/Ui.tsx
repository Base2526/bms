import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';

export function Screen({ children, title, subtitle }: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput {...props} style={styles.input} />
    </View>
  );
}

export function Button({ label, onPress, disabled = false, tone = 'primary' }: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'primary' && styles.primary,
        tone === 'secondary' && styles.secondary,
        tone === 'danger' && styles.danger,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <Text style={[styles.buttonLabel, tone === 'secondary' && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

export const textStyles = StyleSheet.create({
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  warning: { color: colors.warning, fontSize: 14, lineHeight: 20 },
  money: { color: colors.primary, fontSize: 28, fontWeight: '900' },
});

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  heading: { gap: spacing.xs },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  field: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderColor: colors.primary },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  buttonLabel: { color: colors.inverse, fontSize: 16, fontWeight: '800' },
  secondaryLabel: { color: colors.primary },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.4 },
});
