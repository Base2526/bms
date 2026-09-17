import React, { useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery } from '@apollo/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import {
  MobileRestaurantCancelOrderLinesDocument,
  MobileRestaurantSetOrderingPausedDocument,
  PosBootstrapDocument,
} from '../../graphql/generated';
import { createIdempotencyKey } from '../../lib/operation';
import { useSession } from '../../state/SessionContext';
import { useRestaurantOperations } from '../../state/RestaurantOperationsContext';
import type { OrdersStackParamList } from '../../navigation/types';
import { getAppNavigation } from '../../navigation/parentNavigation';

const CHANNEL_LABEL: Record<string, string> = {
  LINE: 'LINE',
  FACEBOOK: 'Facebook',
  WEB: 'เว็บไซต์',
  QR_TABLE: 'QR ที่โต๊ะ',
};

type Props = NativeStackScreenProps<OrdersStackParamList, 'IncomingOrders'>;

export default function IncomingOrdersScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { isTablet } = useResponsive();
  const {
    orders,
    pending,
    loading,
    error,
    orderingPaused,
    acceptOrder,
    refresh,
  } = useIncomingOrders();
  const { session } = useSession();
  const bootstrap = useQuery(PosBootstrapDocument);
  const [setPaused] = useMutation(MobileRestaurantSetOrderingPausedDocument);
  const [cancelLines] = useMutation(MobileRestaurantCancelOrderLinesDocument);
  const { settings, soundAvailable, acknowledge } = useOrderAlerts();
  const { activeWaitlistCount, pendingQrCount, pendingServiceCallCount } =
    useRestaurantOperations();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [managerId, setManagerId] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const cancelKeys = useRef<Record<string, string>>({});
  const managers = (bootstrap.data?.bmsPosSession.approvers ?? []).filter(
    approver =>
      approver.id !== session?.cashier.id &&
      approver.hasPin &&
      approver.approvals.includes('restaurant.floor.manage'),
  );

  const togglePaused = async () => {
    if (!session || workingId) return;
    setWorkingId('pause');
    try {
      const response = await setPaused({
        variables: {
          input: {
            cashierUserId: session.credentials.cashierUserId,
            pin: session.credentials.pin,
            paused: !orderingPaused,
          },
        },
      });
      const result = response.data?.bmsPosRestaurantSetOrderingPaused;
      if (!result || result.reason)
        throw new Error(result?.reason ?? 'เปลี่ยนสถานะรับออร์เดอร์ไม่สำเร็จ');
      await refresh();
    } catch (cause) {
      Alert.alert(
        'ทำรายการไม่สำเร็จ',
        cause instanceof Error ? cause.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorkingId(null);
    }
  };

  const cancelLine = async (
    order: PosIncomingOrder,
    orderItemId: number,
    qty: number,
  ) => {
    if (!session || workingId) return;
    const intent = `${order.id}:${orderItemId}`;
    const idempotencyKey =
      cancelKeys.current[intent] ??
      (cancelKeys.current[intent] = createIdempotencyKey(
        'restaurant-cancel-line',
      ));
    setWorkingId(`cancel-${orderItemId}`);
    try {
      const response = await cancelLines({
        variables: {
          input: {
            cashierUserId: session.credentials.cashierUserId,
            pin: session.credentials.pin,
            orderId: order.id,
            idempotencyKey,
            lines: [
              {
                orderItemId,
                packQty: Math.max(1, Math.trunc(qty)),
                cause: 'MERCHANT_OUT_OF_STOCK',
              },
            ],
            managerUserId: managerId || null,
            managerPin: managerPin || null,
            note: cancelNote.trim() || null,
          },
        },
      });
      const result = response.data?.bmsPosRestaurantCancelOrderLines;
      if (
        !result ||
        result.reason ||
        !['RETURNED', 'CANCELLED', 'COMPLETED'].includes(result.status ?? '')
      ) {
        delete cancelKeys.current[intent];
        throw new Error(
          result?.reason ?? result?.status ?? 'ยกเลิกรายการไม่สำเร็จ',
        );
      }
      delete cancelKeys.current[intent];
      await refresh();
    } catch (cause) {
      Alert.alert(
        'ยกเลิกรายการไม่สำเร็จ',
        cause instanceof Error ? cause.message : 'กรุณาลองใหม่',
      );
    } finally {
      setWorkingId(null);
    }
  };

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
    Alert.alert(
      'รับออร์เดอร์แล้ว',
      `ส่งเข้าครัว ${result.ticketsCreated} ตั๋ว`,
    );
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
        <Button
          label={orderingPaused ? 'เปิดรับออนไลน์' : 'พักรับออนไลน์'}
          variant={orderingPaused ? 'primary' : 'secondary'}
          loading={workingId === 'pause'}
          onPress={togglePaused}
        />
      </View>
      {orderingPaused ? (
        <Text style={[typography.captionStrong, { color: colors.warning }]}>
          หยุดรับออร์เดอร์ออนไลน์ชั่วคราว
        </Text>
      ) : null}
      {/* คิว · QR · เรียกพนักงาน · คำขอจากแชท เป็นงานชนิดเดียวกับออร์เดอร์เข้า — "มีคนรอเราตอบ"
          จึงอยู่ใต้แท็บเดียวกัน · เลขบนปุ่มคือเลขเดียวกับที่รวมเป็น badge บนแถบล่าง
          ถ้าเลขบนแถบกับที่นี่ไม่ตรงกัน แปลว่ามีถังที่ badge นับแต่กดเข้าไปไม่ถึง */}
      <View style={[styles.row, { marginBottom: spacing.sm }]}>
        <Button
          label={`คิว ${activeWaitlistCount}`}
          variant="secondary"
          onPress={() =>
            getAppNavigation(navigation).navigate('RestaurantOps', {
              initialView: 'QUEUE',
            })
          }
        />
        <Button
          label={`QR ${pendingQrCount}`}
          variant="secondary"
          onPress={() =>
            getAppNavigation(navigation).navigate('RestaurantOps', {
              initialView: 'QR',
            })
          }
        />
        <Button
          label={`เรียก ${pendingServiceCallCount}`}
          variant="secondary"
          onPress={() =>
            getAppNavigation(navigation).navigate('RestaurantOps', {
              initialView: 'CALLS',
            })
          }
        />
      </View>
      <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
        <TextInput
          value={cancelNote}
          onChangeText={setCancelNote}
          placeholder="หมายเหตุกรณียกเลิกรายการออนไลน์"
          placeholderTextColor={colors.textSoft}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border },
          ]}
        />
        <View style={styles.managerRow}>
          {managers.map(manager => (
            <Button
              key={manager.id}
              label={manager.name ?? manager.id}
              variant={managerId === manager.id ? 'primary' : 'secondary'}
              onPress={() => setManagerId(manager.id)}
            />
          ))}
        </View>
        {managerId ? (
          <TextInput
            value={managerPin}
            onChangeText={setManagerPin}
            placeholder="PIN ผู้จัดการ"
            keyboardType="number-pad"
            secureTextEntry
            placeholderTextColor={colors.textSoft}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border },
            ]}
          />
        ) : null}
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
                  <Text
                    style={[typography.body, { color: colors.text, flex: 1 }]}
                  >
                    {line.name} × {line.qty}
                  </Text>
                  {item.status !== 'PAID' ? (
                    <Button
                      label="หมด / ยกเลิก"
                      variant="danger"
                      loading={workingId === `cancel-${line.orderItemId}`}
                      onPress={() =>
                        cancelLine(item, line.orderItemId, line.qty)
                      }
                    />
                  ) : null}
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
  managerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
});
