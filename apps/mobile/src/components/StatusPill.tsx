import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

interface Props {
  label: string;
  tone?: StatusTone;
}

// ป้ายสถานะเดียวใช้ทั้งโต๊ะ/ตั๋วครัว/กะ — ห้ามให้แต่ละหน้าจอผสมสีเอง
// (บทเรียนจากเว็บ POS: สีสถานะกระจายอยู่หลายที่จนวันหนึ่งความหมายเพี้ยนไปคนละจอ)
export function StatusPill({ label, tone = 'neutral' }: Props) {
  const { colors, spacing, radius, typography } = useTheme();

  const toneColor: Record<StatusTone, { fg: string; bg: string }> = {
    success: { fg: colors.success, bg: colors.successBg },
    warning: { fg: colors.warning, bg: colors.warningBg },
    danger: { fg: colors.danger, bg: colors.dangerBg },
    neutral: { fg: colors.textMuted, bg: colors.surface2 },
  };
  const c = toneColor[tone];

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: c.bg,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs / 2,
        },
      ]}
    >
      <Text style={[typography.captionStrong, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start' },
});
