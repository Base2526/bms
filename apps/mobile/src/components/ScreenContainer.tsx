import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  children: React.ReactNode;
  edges?: Edge[];
  style?: ViewStyle;
  padded?: boolean;
}

// กล่องมาตรฐานของทุกหน้าจอ — คุม safe-area + พื้นตามธีมที่เดียว
// ไม่ให้แต่ละหน้าจอเขียน backgroundColor ของตัวเองแล้ว drift กันทีละหน้า
export function ScreenContainer({
  children,
  edges = ['top', 'left', 'right'],
  style,
  padded = true,
}: Props) {
  const { colors, spacing } = useTheme();
  return (
    <SafeAreaView
      edges={edges}
      style={[styles.root, { backgroundColor: colors.bg }]}
    >
      <View style={[padded && { padding: spacing.lg }, styles.flex, style]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
});
