import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOfflineSales } from '../state/OfflineSalesContext';
import { useRealtime } from '../state/RealtimeContext';
import { useServerHealth } from '../state/ServerHealthContext';
import { useTheme } from '../theme/ThemeProvider';
import { OfflineSyncCenter } from './OfflineSyncCenter';

export function OfflineStatusBanner() {
  const [syncCenterOpen, setSyncCenterOpen] = useState(false);
  const { colors } = useTheme();
  const health = useServerHealth();
  const realtime = useRealtime();
  const queue = useOfflineSales();
  const offline = health.status === 'offline';
  const checking = health.status === 'checking';
  const degraded =
    health.status === 'online' && realtime.status !== 'connected';
  if (
    !offline &&
    !degraded &&
    queue.pendingCount === 0 &&
    queue.reviewCount === 0 &&
    !queue.storageError
  ) {
    return null;
  }
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
      <SafeAreaView edges={['top']} style={{ backgroundColor }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="เปิดศูนย์ซิงก์รายการออฟไลน์"
          onPress={() => setSyncCenterOpen(true)}
          style={[styles.row, { backgroundColor }]}
        >
          {queue.syncing ? (
            <ActivityIndicator size="small" color={color} />
          ) : (
            <View style={[styles.dot, { backgroundColor: color }]} />
          )}
          <Text style={[styles.text, { color }]}>{parts.join(' · ')}</Text>
        </Pressable>
      </SafeAreaView>
      <OfflineSyncCenter
        visible={syncCenterOpen}
        onClose={() => setSyncCenterOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 34,
    paddingHorizontal: 16,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
});
