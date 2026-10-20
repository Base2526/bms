import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';

export function Screen({ children, title, subtitle, topInset = false }: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  topInset?: boolean;
}) {
  return (
    <SafeAreaView edges={topInset ? ['top', 'bottom'] : ['bottom']} style={styles.safe}>
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

export const screenStyles = StyleSheet.create({
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: spacing.sm },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  warning: { color: colors.warning, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', gap: spacing.sm },
  gap: { gap: spacing.md },
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
});
