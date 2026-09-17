import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import {
  FloorIcon,
  InventoryIcon,
  MoreIcon,
  SellIcon,
  ShiftIcon,
  type TabIconProps,
} from './icons/TabIcons';
import { useTheme } from '../theme/ThemeProvider';

export type TabletMainTab =
  | 'SellTab'
  | 'BoardGameTab'
  | 'InventoryTab'
  | 'OperationsTab'
  | 'ShiftTab';

type NavigationItem = {
  key: TabletMainTab;
  label: string;
  Icon: React.ComponentType<TabIconProps>;
};

const ITEMS: NavigationItem[] = [
  { key: 'SellTab', label: 'ขาย', Icon: SellIcon },
  { key: 'BoardGameTab', label: 'โต๊ะ/เวลา', Icon: FloorIcon },
  { key: 'InventoryTab', label: 'สต็อก', Icon: InventoryIcon },
  { key: 'OperationsTab', label: 'งาน', Icon: MoreIcon },
  { key: 'ShiftTab', label: 'กะ', Icon: ShiftIcon },
];

export const TABLET_SIDEBAR_WIDTH = 252;

type Props = {
  activeTab: TabletMainTab;
  onNavigate: (tab: TabletMainTab) => void;
  showBoardGame?: boolean;
  style?: ViewStyle;
};

/**
 * เมนูหลักบน sidebar ต้องอยู่ตำแหน่งเดิมทุกหน้า เหมือน tab bar บน iPhone:
 * ไม่ซ่อนหน้าปัจจุบัน แต่ไฮไลต์แทน เพื่อให้กล้ามเนื้อจำตำแหน่งเมนูได้
 */
export function TabletMainNavigation({
  activeTab,
  onNavigate,
  showBoardGame = true,
  style,
}: Props) {
  const { colors, typography } = useTheme();
  const items = showBoardGame
    ? ITEMS
    : ITEMS.filter(item => item.key !== 'BoardGameTab');

  return (
    <View style={[styles.root, style]}>
      <Text style={[typography.caption, { color: colors.textSoft }]}>
        เมนูหลัก
      </Text>
      {items.map(({ key, label, Icon }) => {
        const selected = key === activeTab;
        const ink = selected ? colors.primary : colors.textMuted;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`ไปหน้า${label}`}
            accessibilityState={{ selected }}
            onPress={() => onNavigate(key)}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: selected
                  ? `${colors.primary}18`
                  : pressed
                  ? colors.surface2
                  : 'transparent',
              },
            ]}
          >
            <View style={styles.icon}>
              <Icon color={ink} size={19} />
            </View>
            <Text
              style={[
                typography.bodyStrong,
                { color: selected ? colors.primary : colors.textSecondary },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: 'auto',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 3,
  },
  button: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
