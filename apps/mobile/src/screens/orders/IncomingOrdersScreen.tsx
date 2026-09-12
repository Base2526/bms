import React, { useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusPill } from '../../components/StatusPill';
import { OrderAlertSettingsModal } from '../../components/OrderAlertSettingsModal';
import { useTheme } from '../../theme/ThemeProvider';
import { useResponsive } from '../../theme/useResponsive';
import { useIncomingOrders } from '../../state/IncomingOrdersContext';
import { useOrderAlerts } from '../../state/OrderAlertContext';
import { describeAgo } from '../../lib/orderAlert';
import type { PosIncomingOrder } from '../../types/pos';

const CHANNEL_LABEL: Record<string, string> = {
  LINE: 'LINE',
  FACEBOOK: 'Facebook',
  WEB: 'เว็บไซต์',
  QR_TABLE: 'QR ที่โต๊ะ',
};

export default function IncomingOrdersScreen() {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const { orders, pending, loading, error, acceptOrder, refresh } =
    useIncomingOrders();
  const { settings, soundAvailable, acknowledge } = useOrderAlerts();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const onAccept = async (order: PosIncomingOrder) => {
    if (workingId) return;
    setWorkingId(order.id);
    const result = await acceptOrder(order.id);
    setWorkingId(null);
    if (typeof result === 'string') {
      Alert.alert('รับออร์เดอร์ไม่สำเร็จ', result);
      return;
    }
    acknowledge();
    Alert.alert('รับออร์เดอร์แล้ว', `ส่งเข้าครัว ${result.ticketsCreated} ตั๋ว`);
  };

  return (
    <ScreenContainer>
      <View style={[styles.row, { marginBottom: spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={[typography.title, { color: colors.text }]}>
            ออร์เดอร์เข้า
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {loading
              ? 'กำลังโหลด…'
              : `รอรับ ${pending.length} ใบ · ทั้งหมด ${orders.length} ใบ`}
          </Text>
        </View>
        <Button
          label={settings.enabled ? 'แจ้งเตือน' : 'ปิดแจ้งเตือน'}
          variant="secondary"
          onPress={() => setSettingsOpen(true)}
        />
      </View>
      {error ? (
        <Button
          label={`${error} · ลองใหม่`}
          variant="danger"
          fullWidth
          onPress={() => refresh()}
        />
      ) : null}
      {!soundAvailable && settings.sound ? (
        <Text style={[typography.caption, { color: colors.warning }]}>
          เครื่องนี้แจ้งเตือนด้วยการสั่นและแถบบนจอ
        </Text>
      ) : null}
      <FlatList
        data={orders}
        keyExtractor={order => order.id}
        contentContainerStyle={{ gap: spacing.md, paddingTop: spacing.md }}
        numColumns={isTablet ? 2 : 1}
        columnWrapperStyle={isTablet ? { gap: spacing.md } : undefined}
        ListEmptyComponent={
          <Text style={[typography.body, { color: colors.textMuted }]}>
            ไม่มีออร์เดอร์ออนไลน์ในคิว
          </Text>
        }
        renderItem={({ item }) => (
          <Card style={{ flex: 1 }}>
            <View style={styles.row}>
              <Text style={[typography.bodyStrong, { color: colors.text }]}>
                {item.customerName}
              </Text>
              <StatusPill
                label={item.status === 'PAID' ? 'รอรับ' : item.status}
                tone={item.status === 'PAID' ? 'warning' : 'success'}
              />
            </View>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {CHANNEL_LABEL[item.channel] ?? item.channel} ·{' '}
              {item.fulfillmentType} ·{' '}
              {describeAgo(Date.now() - Date.parse(item.receivedAt))}
            </Text>
            <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
              {item.lines.map(line => (
                <View key={line.orderItemId} style={styles.row}>
                  <Text style={[typography.body, { color: colors.text, flex: 1 }]}>
                    {line.name} × {line.qty}
                  </Text>
                </View>
              ))}
            </View>
            <View
              style={[
                styles.row,
                {
                  marginTop: spacing.sm,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                  paddingTop: spacing.sm,
                },
              ]}
            >
              <Text style={[typography.subtitle, { color: colors.text }]}>
                ฿{item.amountDue.toFixed(2)}
              </Text>
            </View>
            {item.status === 'PAID' ? (
              <Button
                label={
                  workingId === item.id ? 'กำลังรับ…' : 'รับออร์เดอร์และส่งครัว'
                }
                fullWidth
                disabled={Boolean(workingId)}
                style={{ marginTop: spacing.md }}
                onPress={() => onAccept(item)}
              />
            ) : null}
          </Card>
        )}
      />
      <OrderAlertSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
