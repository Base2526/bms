import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOfflineSales } from '../state/OfflineSalesContext';
import { useRealtime } from '../state/RealtimeContext';
import { useServerHealth } from '../state/ServerHealthContext';
import { useTheme } from '../theme/ThemeProvider';
import { OfflineSyncCenter } from './OfflineSyncCenter';

export function OfflineStatusBanner() {
  const [syncCenterOpen, setSyncCenterOpen] = useState(false);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { visible, offline, checking, degraded, queue } =
    useOfflineStatusBannerState();
  if (!visible) return null;
  const danger = queue.reviewCount > 0 || Boolean(queue.storageError);
  const backgroundColor = danger
    ? colors.dangerBg
    : offline || degraded || checking
    ? colors.warningBg
    : colors.surface2;
  const color = danger
    ? colors.danger
    : offline || degraded || checking
    ? colors.warning
    : colors.text;
  const parts = [
    offline
      ? 'ออฟไลน์'
      : checking
      ? 'กำลังตรวจการเชื่อมต่อ'
      : degraded
      ? 'ข้อมูลสดขัดข้อง'
      : 'ออนไลน์',
    queue.pendingCount > 0 ? `รอซิงก์ ${queue.pendingCount} รายการ` : null,
    queue.reviewCount > 0 ? `ต้องตรวจสอบ ${queue.reviewCount} รายการ` : null,
    queue.storageError ? 'คิวออฟไลน์ผิดพลาด' : null,
  ].filter(Boolean);
  return (
    <>
      <View
        style={[
          styles.floating,
          {
            top: insets.top + 8,
          },
        ]}
        pointerEvents="box-none"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="เปิดศูนย์ซิงก์รายการออฟไลน์"
          onPress={() => setSyncCenterOpen(true)}
          style={[styles.row, { backgroundColor, borderColor: color }]}
        >
          {queue.syncing ? (
            <ActivityIndicator size="small" color={color} />
          ) : (
            <View style={[styles.dot, { backgroundColor: color }]} />
          )}
          <Text style={[styles.text, { color }]} numberOfLines={2}>
            {parts.join(' · ')}
          </Text>
        </Pressable>
      </View>
      <OfflineSyncCenter
        visible={syncCenterOpen}
        onClose={() => setSyncCenterOpen(false)}
      />
    </>
  );
}

export function useOfflineStatusBannerState() {
  const health = useServerHealth();
  const realtime = useRealtime();
  const queue = useOfflineSales();
  const offline = health.status === 'offline';
  const checking = health.status === 'checking';
  const degraded =
    health.status === 'online' && realtime.status !== 'connected';
  const visible =
    offline ||
    degraded ||
    queue.pendingCount > 0 ||
    queue.reviewCount > 0 ||
    Boolean(queue.storageError);

  return { visible, offline, checking, degraded, queue };
}

const styles = StyleSheet.create({
  floating: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
    elevation: 100,
  },
  row: {
    minHeight: 40,
    maxWidth: '86%',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.24,
    shadowRadius: 5,
    elevation: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
});
