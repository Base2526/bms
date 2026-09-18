import React from 'react';
import {
  ActivityIndicator,
  Alert,
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

export function OfflineStatusBanner() {
  const { colors } = useTheme();
  const health = useServerHealth();
  const realtime = useRealtime();
  const queue = useOfflineSales();
  const offline = health.status === 'offline';
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
    : offline || degraded
    ? colors.warningBg
    : colors.surface2;
  const color = danger
    ? colors.danger
    : offline || degraded
    ? colors.warning
    : colors.text;
  const parts = [
    offline ? 'ออฟไลน์' : degraded ? 'ข้อมูลสดขัดข้อง' : 'ออนไลน์',
    queue.pendingCount > 0 ? `รอซิงก์ ${queue.pendingCount} รายการ` : null,
    queue.reviewCount > 0 ? `ต้องตรวจสอบ ${queue.reviewCount} รายการ` : null,
    queue.storageError ? 'คิวออฟไลน์ผิดพลาด' : null,
  ].filter(Boolean);
  const showDetails = () => {
    const records = queue.records
      .map(record => {
        const state =
          record.state === 'NEEDS_REVIEW' ? 'ต้องตรวจสอบ' : 'รอซิงก์';
        const tenderedAt = new Date(record.tenderedAt);
        const time = Number.isFinite(tenderedAt.getTime())
          ? tenderedAt.toLocaleString('th-TH', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : record.tenderedAt;
        return `${record.id.slice(-10)} · ฿${record.total.toFixed(
          2,
        )} · ${state}\n${time} · แคชเชียร์ ${record.cashierName ?? 'คนเดิม'}${
          record.lastError ? `\n${record.lastError}` : ''
        }`;
      })
      .join('\n\n');
    const detail = [queue.storageError, records].filter(Boolean).join('\n\n');
    Alert.alert(
      'รายการออฟไลน์',
      detail || 'ไม่มีรายการค้าง',
      queue.records.length > 0
        ? [
            { text: 'ปิด', style: 'cancel' },
            {
              text: queue.reviewCount > 0 ? 'แก้แล้ว ลองซิงก์' : 'ซิงก์ตอนนี้',
              onPress: () => {
                const action =
                  queue.reviewCount > 0 ? queue.retryReview : queue.syncNow;
                action().catch(error => {
                  Alert.alert(
                    'ลองซิงก์ไม่สำเร็จ',
                    error instanceof Error
                      ? error.message
                      : 'กรุณาตรวจการเชื่อมต่อแล้วลองใหม่',
                  );
                });
              },
            },
          ]
        : [{ text: 'ปิด' }],
    );
  };
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="ดูสถานะและรายการออฟไลน์"
        onPress={showDetails}
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
